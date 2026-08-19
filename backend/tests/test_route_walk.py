"""The final walk of /route, on a toy network cut in two by a river.

Three stops on one line, a destination point on the west bank, and a
blocked band with no bridge between it and the nearest stop. Crow-fly
distance says to get off across the water; the walkability mask knows
better.
"""

import base64
import hashlib

import numpy as np
import pytest

from app.api import routes
from app.core.network import Network
from app.core.walkgrid import Walkmask

LAT = 48.8500
LON_S, LON_Y, LON_DEST, LON_X = 2.3400, 2.3450, 2.3470, 2.3485
RIVER = (2.3475, 2.3480)  # blocked band, no bridge
DEPART_S = 8 * 3600
ARRIVE_S = DEPART_S + 100

GRID = dict(south=48.845, west=2.335, north=48.855, east=2.355, cell_m=10.0)


class FakeRequest:
    def __init__(self, network):
        self.app = type("App", (), {"state": type("State", (), {"network": network})})


def toy_walkmask() -> Walkmask:
    w = round((GRID["east"] - GRID["west"]) * 111_320 * np.cos(np.radians(LAT)) / GRID["cell_m"])
    h = round((GRID["north"] - GRID["south"]) * 111_320 / GRID["cell_m"])
    mask = np.ones((h, w), dtype=np.uint8)
    x0 = int((RIVER[0] - GRID["west"]) / (GRID["east"] - GRID["west"]) * w)
    x1 = int((RIVER[1] - GRID["west"]) / (GRID["east"] - GRID["west"]) * w)
    mask[:, x0 : x1 + 1] = 0  # spans every row: the only way across is around
    packed = np.packbits(mask.ravel()).tobytes()
    return Walkmask(
        mask=mask,
        packed_b64=base64.b64encode(packed).decode(),
        etag=f'"{hashlib.md5(packed).hexdigest()[:16]}"',
        w=w, h=h, **GRID,
    )


def toy_network() -> Network:
    """S --trip 0--> X (east bank), S --trip 1--> Y (west bank), same times."""
    net = Network(
        dep_stop=np.array([0, 0], dtype=np.int32),
        arr_stop=np.array([1, 2], dtype=np.int32),
        dep_time=np.array([DEPART_S, DEPART_S], dtype=np.int32),
        arr_time=np.array([ARRIVE_S, ARRIVE_S], dtype=np.int32),
        trip=np.array([0, 1], dtype=np.int32),
        conn_mode=np.array([1, 1], dtype=np.int8),
        trip_route_name=["M1", "M2"],
        trip_mode=np.array([1, 1], dtype=np.int8),
        fp_indptr=np.zeros(4, dtype=np.int32),
        fp_target=np.empty(0, dtype=np.int32),
        fp_dur=np.empty(0, dtype=np.int32),
        stop_ids=["S", "X", "Y"],
        stop_names=["Start stop", "Across the river", "Same bank"],
        stop_lats=np.array([LAT, LAT, LAT]),
        stop_lons=np.array([LON_S, LON_X, LON_Y]),
        meta={"n_trips": 2, "service_date": "2026-06-16"},
    )
    order_asc = np.argsort(net.arr_time, kind="stable").astype(np.int32)
    net.arr_sorted = net.arr_time[order_asc]
    net.order_arr_desc = order_asc[::-1].copy()
    return net


def final_leg(network) -> dict:
    answer = routes.route(
        FakeRequest(network),
        from_=[f"{LAT},{LON_S}"],
        to=f"{LAT},{LON_DEST}",
        at="08:00",
        modes=None,
        dir="depart",
    )
    last = answer["legs"][-1]
    assert last["toName"] == "Destination"
    return last


def test_crow_fly_walk_gets_off_across_the_river():
    """Without a mask, the nearest stop wins: 110 m as the crow flies."""
    assert final_leg(toy_network())["fromName"] == "Across the river"


def test_final_walk_honors_the_walkability_mask():
    net = toy_network()
    net.walkmask = toy_walkmask()
    leg = final_leg(net)
    assert leg["fromName"] == "Same bank"  # 147 m, but on the right side
    assert leg["minutes"] == pytest.approx(147 / 80.0, abs=0.3)
