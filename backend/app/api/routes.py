import re
import time

import numpy as np
from fastapi import APIRouter, HTTPException, Query, Request, Response

from app import config
from app.core.csa import (
    INF,
    extract_journey,
    mode_mask_from_names,
    query_one_to_all,
    run_scan,
)
from app.core.geo import stops_within_radius

router = APIRouter()

LATLNG_RE = re.compile(r"^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$")
TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})$")

MODE_LABELS = ["Tram", "Métro", "Train/RER", "Bus", "Transport"]


def parse_at(at: str) -> int:
    m = TIME_RE.match(at)
    if not m or int(m.group(1)) > 27 or int(m.group(2)) > 59:
        raise HTTPException(422, "at must be HH:MM")
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60


def parse_sources(from_: list[str]) -> list[tuple[float, float]]:
    sources = []
    for s in from_:
        pm = LATLNG_RE.match(s)
        if not pm:
            raise HTTPException(422, f"bad from coordinate: {s!r} (want lat,lng)")
        sources.append((float(pm.group(1)), float(pm.group(2))))
    return sources


def parse_modes(modes: str | None) -> np.int32:
    try:
        return mode_mask_from_names(modes.split(",") if modes else None)
    except ValueError as e:
        raise HTTPException(422, str(e))


def fmt_time(secs: int) -> str:
    return f"{secs // 3600 % 24:02d}:{secs % 3600 // 60:02d}"


@router.get("/health")
def health(request: Request) -> dict:
    net = request.app.state.network
    return {
        "status": "ok",
        "serviceDate": net.meta["service_date"],
        "stops": net.n_stops,
        "connections": net.n_connections,
    }


@router.get("/stops")
def stops(request: Request, response: Response) -> dict:
    net = request.app.state.network
    response.headers["Cache-Control"] = "public, max-age=86400"
    return {
        "ids": net.stop_ids,
        "names": net.stop_names,
        "lats": net.stop_lats.round(6).tolist(),
        "lons": net.stop_lons.round(6).tolist(),
    }


@router.get("/walkmask")
def walkmask(request: Request, response: Response):
    wm = request.app.state.network.walkmask
    if wm is None:
        raise HTTPException(404, "no walkability mask available")
    # no-cache + ETag: the browser revalidates each session (a 304 when the
    # mask is unchanged) instead of serving a stale mask for a day
    if request.headers.get("if-none-match") == wm.etag:
        return Response(status_code=304, headers={"ETag": wm.etag, "Cache-Control": "no-cache"})
    response.headers["ETag"] = wm.etag
    response.headers["Cache-Control"] = "no-cache"
    return {
        "w": wm.w, "h": wm.h, "cellM": wm.cell_m,
        "south": wm.south, "west": wm.west, "north": wm.north, "east": wm.east,
        "packedBits": wm.packed_b64,
    }


@router.get("/traveltime")
def traveltime(
    request: Request,
    from_: list[str] = Query(alias="from", min_length=1, max_length=4),
    at: str = "08:30",
    max_mins: int = Query(default=config.MAX_TRAVEL_MINS, alias="max", ge=5, le=config.MAX_TRAVEL_MINS),
    mode: str = Query(default="union", pattern="^(union|meet)$"),
    modes: str | None = None,
    dir: str = Query(default="depart", pattern="^(depart|arrive)$"),
    date: str | None = None,
) -> dict:
    net = request.app.state.network
    if date is not None and date != net.meta["service_date"]:
        raise HTTPException(422, f"only service date {net.meta['service_date']} is preprocessed")

    depart_secs = parse_at(at)
    sources = parse_sources(from_)
    mode_mask = parse_modes(modes)

    t0 = time.perf_counter()
    idx, minutes = query_one_to_all(
        net, sources, depart_secs, max_mins, mode_mask, combine=mode, direction=dir
    )
    return {
        "departAt": at,
        "serviceDate": net.meta["service_date"],
        "queryMs": round((time.perf_counter() - t0) * 1000, 1),
        "idx": idx.tolist(),
        "minutes": [round(float(v), 1) for v in minutes],
    }


@router.get("/route")
def route(
    request: Request,
    from_: list[str] = Query(alias="from", min_length=1, max_length=4),
    to: str = Query(),
    at: str = "08:30",
    modes: str | None = None,
    dir: str = Query(default="depart", pattern="^(depart|arrive)$"),
) -> dict:
    """Fastest journey from the sources to an arbitrary clicked point.

    Picks the stop near `to` minimizing arrival + final walk, then rebuilds
    the journey from the CSA predecessor chain.
    """
    if dir == "arrive":
        raise HTTPException(422, "l'itinéraire détaillé n'est disponible qu'en mode départ")
    net = request.app.state.network
    depart_secs = parse_at(at)
    sources = parse_sources(from_)
    mode_mask = parse_modes(modes)

    pm = LATLNG_RE.match(to)
    if not pm:
        raise HTTPException(422, f"bad to coordinate: {to!r} (want lat,lng)")
    to_lat, to_lon = float(pm.group(1)), float(pm.group(2))

    scan = run_scan(net, sources, depart_secs, config.MAX_TRAVEL_MINS, mode_mask)

    cand, dist = stops_within_radius(to_lat, to_lon, 800.0, net.stop_lats, net.stop_lons)
    if cand.size == 0:
        raise HTTPException(404, "no stop within 800 m of the destination point")
    walk_out_s = (dist / config.WALK_SPEED_M_PER_MIN * 60.0).astype(np.int64)
    arr = scan.arrival[cand].astype(np.int64)
    total = np.where(arr >= INF, np.int64(INF), arr + walk_out_s)
    best = int(np.argmin(total))
    if total[best] >= INF:
        raise HTTPException(404, "destination not reachable within 100 minutes")
    stop = int(cand[best])

    legs = extract_journey(net, scan, stop)
    out = []
    first_dep = int(scan.arrival[legs[0]["from"]]) if legs else int(scan.arrival[stop])
    # initial walk from the departure point to the first stop
    src_stop = legs[0]["from"] if legs else stop
    init_walk_min = (first_dep - depart_secs) / 60.0
    if init_walk_min > 0.2:
        out.append({
            "kind": "walk",
            "fromName": "Départ",
            "toName": net.stop_names[src_stop],
            "dep": fmt_time(depart_secs),
            "arr": fmt_time(first_dep),
            "minutes": round(init_walk_min, 1),
        })
    for leg in legs:
        entry = {
            "kind": leg["kind"],
            "fromName": net.stop_names[leg["from"]],
            "toName": net.stop_names[leg["to"]],
            "dep": fmt_time(leg["dep"]),
            "arr": fmt_time(leg["arr"]),
            "minutes": round((leg["arr"] - leg["dep"]) / 60.0, 1),
        }
        if leg["kind"] == "transit":
            entry["route"] = net.trip_route_name[leg["trip"]]
            entry["mode"] = MODE_LABELS[int(net.trip_mode[leg["trip"]])]
        out.append(entry)
    # final walk from the chosen stop to the clicked point
    if walk_out_s[best] > 15:
        out.append({
            "kind": "walk",
            "fromName": net.stop_names[stop],
            "toName": "Arrivée",
            "dep": fmt_time(int(arr[best])),
            "arr": fmt_time(int(total[best])),
            "minutes": round(float(walk_out_s[best]) / 60.0, 1),
        })

    return {
        "totalMinutes": round((float(total[best]) - depart_secs) / 60.0, 1),
        "arriveAt": fmt_time(int(total[best])),
        "legs": out,
    }
