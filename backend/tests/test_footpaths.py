"""Radius footpaths: the cell grid must not miss any pair within 200 m.

The grid indexes stops by degree cells, so a cell that is narrower than the
search radius in meters hides neighbours two cells away. Longitude cells
shrink with cos(lat), which is why this runs at two very different
latitudes: nothing in the ingestion may assume the latitude of Paris.
"""

import io
import zipfile

import numpy as np
import pandas as pd

from app import config
from app.core.geo import haversine_m
from ingest.build_network import build_footpaths


def gtfs_without_transfers() -> zipfile.ZipFile:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("stops.txt", "stop_id\n")
    return zipfile.ZipFile(buf)


def scattered_stops(lat0: float, lon0: float, n: int = 90, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    return pd.DataFrame({
        "stop_lat": lat0 + rng.uniform(-0.01, 0.01, n),
        "stop_lon": lon0 + rng.uniform(-0.03, 0.03, n),
        "parent_station": [""] * n,
    })


def pairs_found(stops: pd.DataFrame) -> set[tuple[int, int]]:
    indptr, target, _ = build_footpaths(gtfs_without_transfers(), stops, {})
    return {
        (i, int(target[j]))
        for i in range(len(stops))
        for j in range(indptr[i], indptr[i + 1])
    }


def pairs_expected(stops: pd.DataFrame) -> set[tuple[int, int]]:
    lats = stops["stop_lat"].to_numpy()
    lons = stops["stop_lon"].to_numpy()
    out = set()
    for i in range(len(lats)):
        d = haversine_m(lats[i], lons[i], lats, lons)
        near = np.nonzero((d <= config.FOOTPATH_RADIUS_M) & (np.arange(len(lats)) != i))[0]
        assert near.size <= config.FOOTPATH_MAX_DEGREE  # else the cap, not the grid, decides
        out.update((i, int(j)) for j in near)
    return out


def test_no_neighbour_missed_in_paris():
    stops = scattered_stops(48.85, 2.35)
    assert pairs_expected(stops) <= pairs_found(stops)


def test_no_neighbour_missed_far_north():
    # at 69 N a longitude degree is worth ~39 km, not 111: a grid sized for
    # Paris would drop more than half of the pairs here
    stops = scattered_stops(69.65, 18.96)
    assert pairs_expected(stops) <= pairs_found(stops)
