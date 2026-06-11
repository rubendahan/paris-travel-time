"""Walkability mask: load, serve, and source-walk initialization.

The mask is a coarse (60 m) raster of Île-de-France where water and railway
land are blocked and pedestrian bridges are walkable. It refines the two
crow-fly approximations: the initial walk from a marker to its nearby stops
(here), and the client-side final-walk field (served via /walkmask).
"""

import base64
import hashlib
import heapq
import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app import config

ASSET = Path(__file__).resolve().parent.parent.parent / "assets" / "walkmask.npz"


@dataclass
class Walkmask:
    mask: np.ndarray  # uint8[h, w], 1 = walkable
    packed_b64: str  # packbits payload, ready to serve
    etag: str  # content hash, so browsers revalidate instead of caching stale masks
    w: int
    h: int
    cell_m: float
    south: float
    west: float
    north: float
    east: float

    def cell(self, lat: float, lon: float) -> tuple[int, int] | None:
        if not (self.south <= lat <= self.north and self.west <= lon <= self.east):
            return None
        x = int((lon - self.west) / (self.east - self.west) * self.w)
        y = int((self.north - lat) / (self.north - self.south) * self.h)
        return min(self.h - 1, y), min(self.w - 1, x)


def load_walkmask(path: Path = ASSET) -> Walkmask | None:
    if not path.exists():
        return None
    npz = np.load(path, allow_pickle=False)
    meta = json.loads(str(npz["meta"][0]))
    packed = npz["mask"]
    mask = np.unpackbits(packed)[: meta["w"] * meta["h"]].reshape(meta["h"], meta["w"])
    packed_bytes = packed.tobytes()
    return Walkmask(
        mask=mask,
        packed_b64=base64.b64encode(packed_bytes).decode(),
        etag=f'"{hashlib.md5(packed_bytes).hexdigest()[:16]}"',
        w=meta["w"], h=meta["h"], cell_m=meta["cell_m"],
        south=meta["south"], west=meta["west"],
        north=meta["north"], east=meta["east"],
    )


def _snap(mask: np.ndarray, y: int, x: int, radius: int = 3) -> tuple[int, int] | None:
    """Nearest walkable cell within `radius` (the cell itself first)."""
    h, w = mask.shape
    if mask[y, x]:
        return y, x
    for r in range(1, radius + 1):
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if max(abs(dy), abs(dx)) != r:
                    continue
                yy, xx = y + dy, x + dx
                if 0 <= yy < h and 0 <= xx < w and mask[yy, xx]:
                    return yy, xx
    return None


def walk_seconds_from(
    wm: Walkmask,
    lat: float,
    lon: float,
    stop_idx: np.ndarray,
    stop_lats: np.ndarray,
    stop_lons: np.ndarray,
) -> tuple[np.ndarray, np.ndarray] | None:
    """Mask-aware walking times from (lat, lon) to candidate stops.

    Returns (kept stop indices, walk seconds), or None when the source is
    outside the mask (caller falls back to crow-fly). Stops across blocked
    cells (e.g. the river) are dropped unless reachable within the budget.
    """
    src = wm.cell(lat, lon)
    if src is None:
        return None
    src = _snap(wm.mask, *src)
    if src is None:
        return None

    # subgrid Dijkstra around the source, budget = max source walk
    reach_cells = int(config.MAX_SOURCE_WALK_M / wm.cell_m) + 2
    y0 = max(0, src[0] - reach_cells)
    y1 = min(wm.h, src[0] + reach_cells + 1)
    x0 = max(0, src[1] - reach_cells)
    x1 = min(wm.w, src[1] + reach_cells + 1)
    sub = wm.mask[y0:y1, x0:x1]
    sh, sw = sub.shape
    dist = np.full(sh * sw, np.inf)
    sy, sx = src[0] - y0, src[1] - x0
    start = sy * sw + sx
    dist[start] = 0.0
    ortho, diag = wm.cell_m, wm.cell_m * math.sqrt(2.0)
    limit = config.MAX_SOURCE_WALK_M * 1.3  # slack for detours via bridges
    heap = [(0.0, start)]
    while heap:
        d, k = heapq.heappop(heap)
        if d > dist[k] or d > limit:
            continue
        ky, kx = divmod(k, sw)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                ny, nx = ky + dy, kx + dx
                if not (0 <= ny < sh and 0 <= nx < sw):
                    continue
                if not sub[ny, nx]:
                    continue
                nd = d + (diag if dy and dx else ortho)
                nk = ny * sw + nx
                if nd < dist[nk]:
                    dist[nk] = nd
                    heapq.heappush(heap, (nd, nk))

    kept, secs = [], []
    for j, s in enumerate(stop_idx):
        c = wm.cell(stop_lats[s], stop_lons[s])
        if c is None:
            continue
        cs = _snap(wm.mask, *c, radius=2)
        if cs is None or not (y0 <= cs[0] < y1 and x0 <= cs[1] < x1):
            continue
        d = dist[(cs[0] - y0) * sw + (cs[1] - x0)]
        if not np.isfinite(d) or d > limit:
            continue
        kept.append(s)
        secs.append(d / config.WALK_SPEED_M_PER_MIN * 60.0)
    if not kept:
        return np.empty(0, dtype=np.int64), np.empty(0, dtype=np.int32)
    return np.asarray(kept, dtype=np.int64), np.asarray(secs, dtype=np.int32)
