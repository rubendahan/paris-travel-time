"""Preprocess a GTFS zip into CSA-ready arrays for one service date.

Usage:
  python -m ingest.build_network --gtfs data/gtfs/IDFM-gtfs.zip --date 2026-06-16

Outputs (in --out, default backend/data/):
  network.npz    connection arrays sorted by dep_time + footpath CSR
  stops.parquet  stop catalog (idx-aligned: stop_id, name, lat, lon)
"""

import argparse
import datetime as dt
import io
import json
import time
import zipfile
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from app import config
from ingest.gtfs_calendar import active_service_ids
from ingest.gtfs_time import parse_gtfs_times


def read_stops(zf: zipfile.ZipFile) -> pd.DataFrame:
    with zf.open("stops.txt") as f:
        stops = pd.read_csv(
            io.TextIOWrapper(f, encoding="utf-8-sig"),
            usecols=lambda c: c in ("stop_id", "stop_name", "stop_lat", "stop_lon", "location_type", "parent_station"),
            dtype={"stop_id": str, "stop_name": str, "parent_station": str},
            low_memory=False,
        )
    if "location_type" in stops.columns:
        lt = pd.to_numeric(stops["location_type"], errors="coerce").fillna(0)
        stops = stops[lt == 0]
    if "parent_station" not in stops.columns:
        stops["parent_station"] = ""
    stops = stops.dropna(subset=["stop_lat", "stop_lon"]).reset_index(drop=True)
    stops["parent_station"] = stops["parent_station"].fillna("")
    return stops


def mode_group(route_type: int) -> int:
    """GTFS route_type (standard + extended) -> mode group bit index.

    0=tram, 1=metro, 2=rail (RER/Transilien), 3=bus/coach, 4=other.
    """
    if route_type == 0 or 900 <= route_type <= 999:
        return 0
    if route_type == 1 or 400 <= route_type <= 499:
        return 1
    if route_type == 2 or 100 <= route_type <= 199:
        return 2
    if route_type == 3 or 200 <= route_type <= 299 or 700 <= route_type <= 899:
        return 3
    return 4


def read_active_trips(
    zf: zipfile.ZipFile, date: dt.date
) -> tuple[dict[str, int], list[str], np.ndarray]:
    """Trips whose service runs on `date`.

    Returns (trip_id -> dense code, route name per code, mode group per code).
    """
    services = active_service_ids(zf, date)
    if not services:
        raise SystemExit(f"no active services on {date}, check the date is within the feed window")

    with zf.open("routes.txt") as f:
        routes = pd.read_csv(
            io.TextIOWrapper(f, encoding="utf-8-sig"),
            usecols=["route_id", "route_short_name", "route_long_name", "route_type"],
            dtype={"route_id": str, "route_short_name": str, "route_long_name": str},
            low_memory=False,
        )
    routes["name"] = routes["route_short_name"].fillna(routes["route_long_name"]).fillna("?")
    route_name = dict(zip(routes["route_id"], routes["name"]))
    route_mode = {
        rid: mode_group(int(rt)) for rid, rt in zip(routes["route_id"], routes["route_type"])
    }

    with zf.open("trips.txt") as f:
        trips = pd.read_csv(
            io.TextIOWrapper(f, encoding="utf-8-sig"),
            usecols=["trip_id", "service_id", "route_id"],
            dtype=str, low_memory=False,
        )
    active = trips[trips["service_id"].isin(services)]
    trip_code = {tid: i for i, tid in enumerate(active["trip_id"])}
    trip_route_name = [route_name.get(rid, "?") for rid in active["route_id"]]
    trip_mode = np.array(
        [route_mode.get(rid, 4) for rid in active["route_id"]], dtype=np.int8
    )
    return trip_code, trip_route_name, trip_mode


def build_connections(
    zf: zipfile.ZipFile, trip_code: dict[str, int], stop_idx: dict[str, int],
    chunksize: int = 5_000_000,
) -> tuple[np.ndarray, ...]:
    parts = []
    with zf.open("stop_times.txt") as f:
        reader = pd.read_csv(
            io.TextIOWrapper(f, encoding="utf-8-sig"),
            usecols=["trip_id", "stop_id", "arrival_time", "departure_time", "stop_sequence"],
            dtype={"trip_id": str, "stop_id": str, "arrival_time": str, "departure_time": str, "stop_sequence": np.int32},
            chunksize=chunksize, low_memory=False,
        )
        for chunk in reader:
            chunk = chunk[chunk["trip_id"].isin(trip_code.keys())]
            if not len(chunk):
                continue
            parts.append(
                pd.DataFrame({
                    "trip": chunk["trip_id"].map(trip_code).astype(np.int32),
                    "stop": chunk["stop_id"].map(stop_idx).astype("Int32"),
                    "seq": chunk["stop_sequence"],
                    "arr": parse_gtfs_times(chunk["arrival_time"]),
                    "dep": parse_gtfs_times(chunk["departure_time"]),
                })
            )
            print(f"  stop_times: kept {sum(len(p) for p in parts):,} rows", end="\r", flush=True)
    st = pd.concat(parts, ignore_index=True)
    del parts
    print()

    st = st.dropna(subset=["stop"])
    st = st[(st["arr"] >= 0) & (st["dep"] >= 0)]
    st["stop"] = st["stop"].astype(np.int32)
    st = st.sort_values(["trip", "seq"], kind="stable").reset_index(drop=True)

    # consecutive same-trip pairs -> connections
    trip_a = st["trip"].to_numpy()
    same_trip = trip_a[:-1] == trip_a[1:]
    dep_stop = st["stop"].to_numpy()[:-1][same_trip]
    arr_stop = st["stop"].to_numpy()[1:][same_trip]
    dep_time = st["dep"].to_numpy()[:-1][same_trip]
    arr_time = st["arr"].to_numpy()[1:][same_trip]
    trip = trip_a[:-1][same_trip]

    ok = (arr_time >= dep_time) & (dep_stop != arr_stop)
    dep_stop, arr_stop, dep_time, arr_time, trip = (
        a[ok] for a in (dep_stop, arr_stop, dep_time, arr_time, trip)
    )

    order = np.argsort(dep_time, kind="stable")
    return (
        dep_stop[order].astype(np.int32),
        arr_stop[order].astype(np.int32),
        dep_time[order].astype(np.int32),
        arr_time[order].astype(np.int32),
        trip[order].astype(np.int32),
    )


def build_footpaths(
    zf: zipfile.ZipFile, stops: pd.DataFrame, stop_idx: dict[str, int]
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """CSR footpath graph from transfers.txt + same-parent + 200m radius."""
    n = len(stops)
    best: dict[tuple[int, int], int] = {}

    def add(a: int, b: int, dur: int) -> None:
        if a == b:
            return
        for k in ((a, b), (b, a)):
            if k not in best or dur < best[k]:
                best[k] = dur

    # 1) transfers.txt
    try:
        with zf.open("transfers.txt") as f:
            tr = pd.read_csv(
                io.TextIOWrapper(f, encoding="utf-8-sig"),
                dtype={"from_stop_id": str, "to_stop_id": str}, low_memory=False,
            )
        durs = pd.to_numeric(tr.get("min_transfer_time"), errors="coerce").fillna(config.DEFAULT_TRANSFER_S)
        for f_id, t_id, d in zip(tr["from_stop_id"], tr["to_stop_id"], durs):
            a, b = stop_idx.get(f_id), stop_idx.get(t_id)
            if a is not None and b is not None:
                add(a, b, max(config.FOOTPATH_MIN_DUR_S, int(d)))
        print(f"  transfers.txt: {len(tr):,} rows")
    except KeyError:
        print("  no transfers.txt")

    # 2) same parent_station
    by_parent = defaultdict(list)
    for i, p in enumerate(stops["parent_station"]):
        if p:
            by_parent[p].append(i)
    for members in by_parent.values():
        for i, a in enumerate(members):
            for b in members[i + 1:]:
                add(a, b, config.SAME_PARENT_TRANSFER_S)

    # 3) radius neighbours via cell grid (~200m cells)
    lats = stops["stop_lat"].to_numpy()
    lons = stops["stop_lon"].to_numpy()
    cell_deg = config.FOOTPATH_RADIUS_M / 111_000.0
    cx = np.floor(lons / cell_deg).astype(np.int64)
    cy = np.floor(lats / cell_deg).astype(np.int64)
    grid = defaultdict(list)
    for i in range(n):
        grid[(cx[i], cy[i])].append(i)

    coslat = np.cos(np.radians(48.85))
    m_per_deg = 111_000.0
    for i in range(n):
        cands = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                cands.extend(grid.get((cx[i] + dx, cy[i] + dy), ()))
        cands = np.asarray(cands)
        cands = cands[cands > i]  # each unordered pair once
        if not cands.size:
            continue
        dist = np.hypot(
            (lats[cands] - lats[i]) * m_per_deg,
            (lons[cands] - lons[i]) * m_per_deg * coslat,
        )
        near = cands[dist <= config.FOOTPATH_RADIUS_M]
        ndist = dist[dist <= config.FOOTPATH_RADIUS_M]
        if near.size > config.FOOTPATH_MAX_DEGREE:
            keep = np.argsort(ndist)[: config.FOOTPATH_MAX_DEGREE]
            near, ndist = near[keep], ndist[keep]
        for b, d in zip(near, ndist):
            dur = max(config.FOOTPATH_MIN_DUR_S, int(d / config.WALK_SPEED_M_PER_MIN * 60))
            add(i, int(b), dur)

    # dict -> CSR
    srcs = np.fromiter((k[0] for k in best), dtype=np.int32, count=len(best))
    tgts = np.fromiter((k[1] for k in best), dtype=np.int32, count=len(best))
    durs_a = np.fromiter(best.values(), dtype=np.int32, count=len(best))
    order = np.argsort(srcs, kind="stable")
    srcs, tgts, durs_a = srcs[order], tgts[order], durs_a[order]
    indptr = np.zeros(n + 1, dtype=np.int32)
    np.add.at(indptr, srcs + 1, 1)
    indptr = np.cumsum(indptr, dtype=np.int32)
    return indptr, tgts, durs_a


def next_weekday(weekday: int = 1) -> dt.date:
    """Next occurrence of `weekday` (0=Monday, 1=Tuesday) at least 2 days out."""
    today = dt.date.today()
    delta = (weekday - today.weekday()) % 7
    return today + dt.timedelta(days=delta if delta >= 2 else delta + 7)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gtfs", type=Path, required=True)
    ap.add_argument("--date", type=dt.date.fromisoformat, default=None,
                    help="service date (default: next Tuesday)")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "data")
    ap.add_argument("--chunksize", type=int, default=5_000_000,
                    help="stop_times rows per chunk (lower = less RAM)")
    args = ap.parse_args()
    if args.date is None:
        args.date = next_weekday()
        print(f"no --date given, using next Tuesday: {args.date}")

    t0 = time.perf_counter()
    with zipfile.ZipFile(args.gtfs) as zf:
        print("reading stops...")
        stops = read_stops(zf)
        stop_idx = {sid: i for i, sid in enumerate(stops["stop_id"])}
        print(f"  {len(stops):,} stops")

        print(f"resolving services for {args.date}...")
        trip_code, trip_route_name, trip_mode = read_active_trips(zf, args.date)
        print(f"  {len(trip_code):,} active trips")

        print("building connections (this is the slow part)...")
        dep_stop, arr_stop, dep_time, arr_time, trip = build_connections(
            zf, trip_code, stop_idx, args.chunksize
        )
        print(f"  {len(dep_stop):,} connections")

        print("building footpaths...")
        fp_indptr, fp_target, fp_dur = build_footpaths(zf, stops, stop_idx)
        print(f"  {len(fp_target):,} footpath edges")

    args.out.mkdir(parents=True, exist_ok=True)
    meta = {
        "service_date": args.date.isoformat(),
        "n_trips": len(trip_code),
        "walk_speed_m_per_min": config.WALK_SPEED_M_PER_MIN,
        "gtfs_file": args.gtfs.name,
    }
    np.savez(
        args.out / "network.npz",
        dep_stop=dep_stop, arr_stop=arr_stop, dep_time=dep_time, arr_time=arr_time, trip=trip,
        conn_mode=trip_mode[trip],
        fp_indptr=fp_indptr, fp_target=fp_target, fp_dur=fp_dur,
        meta=np.array([json.dumps(meta)]),
    )
    pq.write_table(
        pa.table({"route_name": pa.array(trip_route_name, type=pa.string()),
                  "mode": pa.array(trip_mode)}),
        args.out / "trips.parquet",
    )
    pq.write_table(
        pa.table({
            "stop_id": stops["stop_id"].astype(str),
            "name": stops["stop_name"].astype(str),
            "lat": stops["stop_lat"].astype(np.float64),
            "lon": stops["stop_lon"].astype(np.float64),
        }),
        args.out / "stops.parquet",
    )
    print(
        f"done in {time.perf_counter() - t0:.0f}s: stops={len(stops):,} trips={len(trip_code):,} "
        f"connections={len(dep_stop):,} footpaths={len(fp_target):,}\n"
        f"dep_time range: {dep_time.min() // 3600:02d}h-{dep_time.max() // 3600}h"
    )


if __name__ == "__main__":
    main()
