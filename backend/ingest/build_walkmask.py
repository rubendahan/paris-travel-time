"""Build a walkability raster for Île-de-France from OpenStreetMap.

Blocked cells: water bodies (Seine, Marne, canals, lakes >= 1 ha) and railway
land. Pedestrian-usable bridges are carved back as walkable so isochrones
cross the river exactly where people can.

The result is tiny (~320 kB packed) and stable over time, so it is committed
to the repo (backend/assets/walkmask.npz) rather than rebuilt per deploy.

Usage: python -m ingest.build_walkmask  (needs: requests, pillow)
"""

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np
import requests
from PIL import Image, ImageDraw

# south, west, north, east: covers the GTFS network's useful extent
BBOX = (48.40, 1.60, 49.10, 3.20)
CELL_M = 30.0
MIN_WATER_M2 = 10_000  # ignore village ponds
# full-IDF queries 504 on the main instance: fetch per tile, with fallbacks
OVERPASS_SERVERS = [
    "https://overpass.openstreetmap.fr/api/interpreter",  # fastest for IDF data
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
TILES = 2  # split the bbox into TILES x TILES sub-queries

OUT = Path(__file__).resolve().parent.parent / "assets" / "walkmask.npz"

def water_query(bbox: tuple) -> str:
    # water ONLY. An earlier version also blocked landuse=railway, but rail
    # corridors are crossed by plenty of untagged street bridges and the
    # result read as incomprehensible holes in the middle of neighborhoods.
    # Water is the one barrier everyone understands.
    b = f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}"
    return f"""
[out:json][timeout:180];
(
  way["natural"="water"]({b});
  relation["natural"="water"]({b});
  way["waterway"="riverbank"]({b});
  relation["waterway"="riverbank"]({b});
);
out geom;
"""


def waterway_query(bbox: tuple) -> str:
    # river/canal CENTERLINES, drawn as thick strokes. Large rivers are
    # multipolygon relations whose rings rarely close inside the bbox (the
    # Seine vanished entirely when unclosed rings were dropped); centerline
    # plus width is robust no matter how the area mapping is cut.
    b = f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}"
    return f"""
[out:json][timeout:180];
(
  way["waterway"~"^(river|canal)$"]({b});
);
out geom;
"""


def bridge_query(bbox: tuple) -> str:
    # bridges cross water, tunnels cross rail land: both reopen the mask
    b = f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}"
    return f"""
[out:json][timeout:180];
(
  way["bridge"]["highway"]["highway"!~"motorway|motorway_link|trunk|trunk_link"]["foot"!~"no"]({b});
  way["tunnel"]["highway"]["highway"!~"motorway|motorway_link|trunk|trunk_link"]["foot"!~"no"]({b});
);
out geom;
"""


def tiles() -> list[tuple]:
    s, w, n, e = BBOX
    dlat = (n - s) / TILES
    dlon = (e - w) / TILES
    return [
        (s + i * dlat, w + j * dlon, s + (i + 1) * dlat, w + (j + 1) * dlon)
        for i in range(TILES)
        for j in range(TILES)
    ]


def fetch(query: str) -> dict:
    # overpass-api.de rejects the default python-requests User-Agent (406)
    headers = {"User-Agent": "paris-travel-time-walkmask/1.0"}
    last: Exception | None = None
    for server in OVERPASS_SERVERS:
        for attempt in range(2):
            try:
                r = requests.post(server, data={"data": query}, headers=headers, timeout=300)
                r.raise_for_status()
                return r.json()
            except Exception as e:  # 504s and transient overloads: try the next option
                last = e
                print(f"  retry ({server.split('/')[2]}, attempt {attempt + 1}): {e}")
                time.sleep(5)
    raise last  # type: ignore[misc]


def fetch_tiled(make_query) -> list[dict]:
    """Fetch per tile, deduplicating elements by (type, id)."""
    seen: set[tuple[str, int]] = set()
    elements: list[dict] = []
    for i, t in enumerate(tiles()):
        print(f"  tile {i + 1}/{TILES * TILES}...")
        for el in fetch(make_query(t))["elements"]:
            key = (el["type"], el["id"])
            if key not in seen:
                seen.add(key)
                elements.append(el)
    return elements


def ring_area_m2(ring: list[tuple[float, float]]) -> float:
    """Shoelace on (lat, lon) rings, in m² (local equirectangular)."""
    if len(ring) < 3:
        return 0.0
    lat0 = ring[0][0]
    k = 111_320.0 * math.cos(math.radians(lat0))
    pts = [((lon * k), (lat * 111_320.0)) for lat, lon in ring]
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


class Grid:
    def __init__(self):
        south, west, north, east = BBOX
        lat_mid = (south + north) / 2
        self.m_per_deg_lon = 111_320.0 * math.cos(math.radians(lat_mid))
        self.w = round((east - west) * self.m_per_deg_lon / CELL_M)
        self.h = round((north - south) * 111_320.0 / CELL_M)
        self.south, self.west, self.north, self.east = BBOX

    def px(self, lat: float, lon: float) -> tuple[float, float]:
        x = (lon - self.west) / (self.east - self.west) * self.w
        y = (self.north - lat) / (self.north - self.south) * self.h
        return x, y


def assemble_rings(segments: list[list]) -> list[list]:
    """Stitch way segments into closed rings by matching endpoints.

    Relation members are PARTIAL boundary ways, not rings: filling each
    segment as if it were a closed polygon (PIL auto-closes the path) painted
    huge bogus water sheets across the city. Unclosable leftovers (boundary
    cut by the bbox) are dropped.
    """
    segs = [list(s) for s in segments if len(s) >= 2]
    rings: list[list] = []
    while segs:
        ring = segs.pop()
        progress = True
        while ring[0] != ring[-1] and progress:
            progress = False
            for i, s in enumerate(segs):
                if s[0] == ring[-1]:
                    ring += s[1:]
                elif s[-1] == ring[-1]:
                    ring += s[-2::-1]
                elif s[-1] == ring[0]:
                    ring = s[:-1] + ring
                elif s[0] == ring[0]:
                    ring = s[::-1][:-1] + ring
                else:
                    continue
                segs.pop(i)
                progress = True
                break
        if ring[0] == ring[-1] and len(ring) >= 4:
            rings.append(ring)
    return rings


def geom_rings(el: dict) -> tuple[list, list]:
    """(outer rings, inner rings) of an Overpass element with geometry."""
    if el["type"] == "way":
        pts = [(g["lat"], g["lon"]) for g in el.get("geometry", [])]
        # a standalone way must already be closed to be a polygon
        if len(pts) >= 4 and pts[0] == pts[-1]:
            return [pts], []
        return [], []
    outer_segs, inner_segs = [], []
    for m in el.get("members", []):
        pts = [(g["lat"], g["lon"]) for g in m.get("geometry", [])]
        if len(pts) < 2:
            continue
        (inner_segs if m.get("role") == "inner" else outer_segs).append(pts)
    return assemble_rings(outer_segs), assemble_rings(inner_segs)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    grid = Grid()
    print(f"grid {grid.w} x {grid.h} cells of {CELL_M:.0f} m")

    print("fetching water polygons from Overpass (tiled, 2-6 min)...")
    t0 = time.perf_counter()
    blocked_elements = fetch_tiled(water_query)
    print(f"  {len(blocked_elements):,} elements in {time.perf_counter() - t0:.0f}s")
    print("fetching river/canal centerlines...")
    t0 = time.perf_counter()
    waterway_elements = fetch_tiled(waterway_query)
    print(f"  {len(waterway_elements):,} waterways in {time.perf_counter() - t0:.0f}s")
    print("fetching pedestrian bridges...")
    t0 = time.perf_counter()
    bridge_elements = fetch_tiled(bridge_query)
    print(f"  {len(bridge_elements):,} bridges in {time.perf_counter() - t0:.0f}s")

    img = Image.new("L", (grid.w, grid.h), 1)  # 1 = walkable
    draw = ImageDraw.Draw(img)

    n_drawn = 0
    for el in blocked_elements:
        outers, inners = geom_rings(el)
        big = [r for r in outers if ring_area_m2(r) >= MIN_WATER_M2]
        if not big:
            continue
        for ring in big:
            draw.polygon([grid.px(lat, lon) for lat, lon in ring], fill=0)
            n_drawn += 1
        for ring in inners:  # islands stay walkable
            draw.polygon([grid.px(lat, lon) for lat, lon in ring], fill=1)
    print(f"  {n_drawn:,} blocking polygons drawn")

    # rivers and canals as thick centerline strokes (width tag when sane,
    # else a default per type); robust to bbox-cut area mapping
    n_strokes = 0
    for el in waterway_elements:
        pts = [grid.px(g["lat"], g["lon"]) for g in el.get("geometry", [])]
        if len(pts) < 2:
            continue
        tags = el.get("tags", {})
        try:
            width_m = float(str(tags.get("width", "")).replace(",", ".").split(";")[0])
        except ValueError:
            width_m = 160.0 if tags.get("waterway") == "river" else 35.0
        width_m = min(max(width_m, 20.0), 400.0)
        draw.line(pts, fill=0, width=max(1, round(width_m / CELL_M)))
        n_strokes += 1
    print(f"  {n_strokes:,} waterway strokes drawn")

    for el in bridge_elements:
        pts = [grid.px(g["lat"], g["lon"]) for g in el.get("geometry", [])]
        if len(pts) >= 2:
            draw.line(pts, fill=1, width=2)
    print(f"  {len(bridge_elements):,} bridges carved")

    # every GTFS stop must live on a walkable cell (platforms often sit in
    # the middle of blocked railway land)
    stops_pq = Path(__file__).resolve().parent.parent / "data" / "stops.parquet"
    if stops_pq.exists():
        import pyarrow.parquet as pq

        stops = pq.read_table(stops_pq)
        carved = 0
        for lat, lon in zip(stops.column("lat").to_numpy(), stops.column("lon").to_numpy()):
            if BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]:
                x, y = grid.px(lat, lon)
                draw.point((x, y), fill=1)
                carved += 1
        print(f"  {carved:,} stop cells carved")

    mask = np.asarray(img, dtype=np.uint8)
    walkable_pct = 100.0 * mask.mean()
    print(f"walkable: {walkable_pct:.1f}% of cells")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    meta = {
        "w": grid.w, "h": grid.h, "cell_m": CELL_M,
        "south": grid.south, "west": grid.west,
        "north": grid.north, "east": grid.east,
    }
    np.savez_compressed(args.out, mask=np.packbits(mask.ravel()), meta=np.array([json.dumps(meta)]))
    print(f"saved {args.out} ({args.out.stat().st_size / 1024:.0f} kB)")


if __name__ == "__main__":
    main()
