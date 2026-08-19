"""Toy 6-stop network exercising the exact CSA kernel used in production.

Topology (times in seconds after midnight):
  stops: 0=A 1=B 2=C 3=D 4=E 5=F
  trip 0 (metro): A dep 1000 -> B arr 1300, B dep 1360 -> C arr 1600
  trip 1 (bus):   B dep 1500 -> D arr 1800   (catchable after 60s interchange at B)
  trip 2 (rail):  E dep 1900 -> F arr 2200   (E only reachable by footpath from C)
  footpath: C <-> E, 120 s
"""

import numpy as np

from app.core.csa import (
    ALL_MODES_MASK,
    INF,
    MODE_BUS,
    MODE_METRO,
    MODE_RAIL,
    NEG_INF,
    csa_scan,
    csa_scan_reverse,
    mode_mask_from_names,
)

N_STOPS, N_TRIPS = 6, 3

# connections sorted by dep_time, as the kernel requires (it breaks out of
# the loop on the first departure past t_max)
# order: A->B, B->C, B->D, E->F
DEP_STOP = np.array([0, 1, 1, 4], dtype=np.int32)
ARR_STOP = np.array([1, 2, 3, 5], dtype=np.int32)
DEP_TIME = np.array([1000, 1360, 1500, 1900], dtype=np.int32)
ARR_TIME = np.array([1300, 1600, 1800, 2200], dtype=np.int32)
TRIP = np.array([0, 0, 1, 2], dtype=np.int32)
CONN_MODE = np.array([MODE_METRO, MODE_METRO, MODE_BUS, MODE_RAIL], dtype=np.int8)

# footpaths CSR: C(2) <-> E(4), 120 s
FP_INDPTR = np.array([0, 0, 0, 1, 1, 2, 2], dtype=np.int32)
FP_TARGET = np.array([4, 2], dtype=np.int32)
FP_DUR = np.array([120, 120], dtype=np.int32)


# generous enough that the toy footpaths never hit the walking budget
WALK_BUDGET_S = 10_000


def fp_scratch() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Scratch arrays for the kernel's footpath cascade, owned by the caller."""
    return (
        np.empty(N_STOPS, dtype=np.int32),
        np.empty(N_STOPS, dtype=np.int32),
        np.zeros(N_STOPS, dtype=np.bool_),
    )


def run(start_stop: int, depart: int, t_max: int = 10_000, mode_mask=ALL_MODES_MASK):
    arrival = np.full(N_STOPS, INF, dtype=np.int32)
    board = np.full(N_STOPS, INF, dtype=np.int32)
    arrival[start_stop] = board[start_stop] = depart
    pred_conn = np.full(N_STOPS, -1, dtype=np.int32)
    pred_from = np.full(N_STOPS, -1, dtype=np.int32)
    trip_board_conn = np.full(N_TRIPS, -1, dtype=np.int32)
    csa_scan(
        DEP_STOP, ARR_STOP, DEP_TIME, ARR_TIME, TRIP, CONN_MODE,
        FP_INDPTR, FP_TARGET, FP_DUR,
        arrival, board, np.zeros(N_TRIPS, dtype=np.bool_),
        pred_conn, pred_from, trip_board_conn,
        *fp_scratch(),
        0, np.int32(t_max), np.int32(60), np.int32(mode_mask),
        np.int32(WALK_BUDGET_S),
    )
    return arrival, pred_conn, pred_from, trip_board_conn


def test_direct_and_same_trip_continuation():
    arrival, *_ = run(0, 900)
    assert arrival[1] == 1300  # A->B
    assert arrival[2] == 1600  # stays on trip 0 through B (no buffer needed)


def test_transfer_respects_interchange_buffer():
    arrival, *_ = run(0, 900)
    # arrive B 1300, board allowed from 1360, trip 1 departs 1500 -> D 1800
    assert arrival[3] == 1800


def test_footpath_then_board():
    arrival, *_ = run(0, 900)
    assert arrival[4] == 1600 + 120  # C -> E walk
    assert arrival[5] == 2200  # boards trip 2 at E (dep 1900 >= 1720)


def test_interchange_buffer_blocks_tight_transfer():
    # a passenger arriving B at 1450 cannot catch the 1500 departure (60s buffer)
    arrival = np.full(N_STOPS, INF, dtype=np.int32)
    board = np.full(N_STOPS, INF, dtype=np.int32)
    arrival[1] = 1450
    board[1] = 1450 + 60
    csa_scan(
        DEP_STOP, ARR_STOP, DEP_TIME, ARR_TIME, TRIP, CONN_MODE,
        FP_INDPTR, FP_TARGET, FP_DUR,
        arrival, board, np.zeros(N_TRIPS, dtype=np.bool_),
        np.full(N_STOPS, -1, dtype=np.int32), np.full(N_STOPS, -1, dtype=np.int32),
        np.full(N_TRIPS, -1, dtype=np.int32),
        *fp_scratch(),
        0, np.int32(10_000), np.int32(60), ALL_MODES_MASK,
        np.int32(WALK_BUDGET_S),
    )
    assert arrival[3] == INF  # board=1510 > dep 1500: buffer blocks the transfer


def test_fixture_is_sorted_by_departure():
    assert np.all(np.diff(DEP_TIME) >= 0)  # the kernel's break relies on it


def test_t_max_pruning():
    arrival, *_ = run(0, 900, t_max=1400)
    assert arrival[1] == 1300
    assert arrival[2] == 1600  # B->C departs 1360, still under t_max
    assert arrival[3] == INF  # trip 1 departs after t_max


def test_unreachable_without_source():
    arrival, *_ = run(5, 900)
    assert arrival[0] == INF and arrival[2] == INF


def test_mode_mask_excludes_bus():
    mask = mode_mask_from_names(["metro", "rail"])
    arrival, *_ = run(0, 900, mode_mask=mask)
    assert arrival[2] == 1600  # metro still fine
    assert arrival[3] == INF  # D only served by the bus trip
    assert arrival[5] == 2200  # rail via footpath still fine


def test_mode_mask_all_when_empty():
    assert mode_mask_from_names(None) == ALL_MODES_MASK
    assert mode_mask_from_names([]) == ALL_MODES_MASK


def run_reverse(dest_stop: int, arrive: int, t_min: int = 0, mode_mask=ALL_MODES_MASK):
    depart = np.full(N_STOPS, NEG_INF, dtype=np.int32)
    alight = np.full(N_STOPS, NEG_INF, dtype=np.int32)
    depart[dest_stop] = alight[dest_stop] = arrive
    order_desc = np.argsort(ARR_TIME, kind="stable").astype(np.int32)[::-1].copy()
    csa_scan_reverse(
        order_desc, DEP_STOP, ARR_STOP, DEP_TIME, ARR_TIME, TRIP, CONN_MODE,
        FP_INDPTR, FP_TARGET, FP_DUR,
        depart, alight, np.zeros(N_TRIPS, dtype=np.bool_),
        *fp_scratch(),
        0, np.int32(t_min), np.int32(60), np.int32(mode_mask),
        np.int32(WALK_BUDGET_S),
    )
    return depart


def test_reverse_latest_departure():
    depart = run_reverse(3, 1800)  # be at D by 1800
    assert depart[1] == 1500  # last useful departure from B is trip 1
    assert depart[0] == 1000  # ride trip 0 from A, transfer at B (alight 1440 >= 1300)


def test_reverse_arrival_too_early_blocks():
    depart = run_reverse(3, 1799)  # one second too early for trip 1
    assert depart[1] == NEG_INF and depart[0] == NEG_INF


def test_reverse_footpath():
    depart = run_reverse(5, 2200)  # be at F by 2200
    assert depart[4] == 1900  # board trip 2 at E
    assert depart[2] == 1900 - 120  # walk C -> E before that
    assert depart[0] == 1000  # whole chain back to A


def test_predecessors_rebuild_journey():
    arrival, pred_conn, pred_from, trip_board_conn = run(0, 900)
    # F(5) reached by trip 2 boarded at E(4)
    assert pred_conn[5] == 3 and trip_board_conn[2] == 3
    # E reached on foot from C
    assert pred_conn[4] == -1 and pred_from[4] == 2
    # C reached by trip 0, boarded at A: its first connection is index 0
    assert pred_conn[2] == 1 and trip_board_conn[0] == 0
    assert DEP_STOP[trip_board_conn[0]] == 0  # boarding stop of trip 0 is A
