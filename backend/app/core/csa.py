"""Connection Scan Algorithm — one-to-all earliest arrival.

The kernel is written against plain numpy arrays so it runs identically
without numba (slow, for debugging). numba JIT brings it to ~15-35 ms
on the full IDF network.

Mode filtering: each connection carries a mode group (see MODE_BITS); the
kernel skips connections whose bit is absent from mode_mask.

Journey extraction: the kernel records, for each improved stop, the
connection (or footpath origin) that improved it, plus the first connection
where each trip was boarded — enough to rebuild a valid journey backwards.
"""

import numpy as np

from app import config
from app.core.geo import stops_within_radius

INF = np.int32(2**31 - 1)

# mode groups (bit index in mode_mask)
MODE_TRAM, MODE_METRO, MODE_RAIL, MODE_BUS, MODE_OTHER = 0, 1, 2, 3, 4
MODE_NAMES = {"tram": MODE_TRAM, "metro": MODE_METRO, "rail": MODE_RAIL, "bus": MODE_BUS}
ALL_MODES_MASK = np.int32(0b11111)

try:
    from numba import njit

    HAS_NUMBA = True
except ImportError:  # degraded mode: same code, pure python
    HAS_NUMBA = False

    def njit(*args, **kwargs):
        def wrap(f):
            return f

        return wrap if not (len(args) == 1 and callable(args[0])) else args[0]


def mode_mask_from_names(names: list[str] | None) -> np.int32:
    """'metro,rail' -> bitmask. None/empty -> all modes. MODE_OTHER is always on."""
    if not names:
        return ALL_MODES_MASK
    mask = 1 << MODE_OTHER
    for n in names:
        bit = MODE_NAMES.get(n.strip().lower())
        if bit is None:
            raise ValueError(f"unknown mode {n!r} (expected {', '.join(MODE_NAMES)})")
        mask |= 1 << bit
    return np.int32(mask)


@njit(cache=True)
def csa_scan(
    dep_stop, arr_stop, dep_time, arr_time, trip, conn_mode,
    fp_indptr, fp_target, fp_dur,
    arrival, board, trip_reached,
    pred_conn, pred_from, trip_board_conn,
    start_idx, t_max, interchange_s, mode_mask,
):
    for i in range(start_idx, dep_stop.shape[0]):
        dt = dep_time[i]
        if dt > t_max:  # connections are dep_time-sorted: nothing later can help
            break
        if ((mode_mask >> conn_mode[i]) & 1) == 0:
            continue
        tr = trip[i]
        if trip_reached[tr] or board[dep_stop[i]] <= dt:
            if not trip_reached[tr]:
                trip_reached[tr] = True
                trip_board_conn[tr] = i
            a = arr_time[i]
            s = arr_stop[i]
            if a < arrival[s]:
                arrival[s] = a
                pred_conn[s] = i
                pred_from[s] = -1
                if a + interchange_s < board[s]:
                    board[s] = a + interchange_s
                for j in range(fp_indptr[s], fp_indptr[s + 1]):
                    s2 = fp_target[j]
                    a2 = a + fp_dur[j]
                    if a2 < arrival[s2]:
                        arrival[s2] = a2
                        pred_conn[s2] = -1
                        pred_from[s2] = s
                        if a2 < board[s2]:
                            board[s2] = a2


class ScanResult:
    """State of one CSA run, kept for journey extraction."""

    __slots__ = ("arrival", "pred_conn", "pred_from", "trip_board_conn", "depart_secs")

    def __init__(self, arrival, pred_conn, pred_from, trip_board_conn, depart_secs):
        self.arrival = arrival
        self.pred_conn = pred_conn
        self.pred_from = pred_from
        self.trip_board_conn = trip_board_conn
        self.depart_secs = depart_secs


def run_scan(
    network,
    sources: list[tuple[float, float]],
    depart_secs: int,
    max_mins: int = config.MAX_TRAVEL_MINS,
    mode_mask: np.int32 = ALL_MODES_MASK,
) -> ScanResult:
    """One CSA pass from source coordinates (min over sources = union)."""
    n_stops = network.n_stops
    arrival = np.full(n_stops, INF, dtype=np.int32)
    board = np.full(n_stops, INF, dtype=np.int32)
    trip_reached = np.zeros(network.n_trips, dtype=np.bool_)
    pred_conn = np.full(n_stops, -1, dtype=np.int32)
    pred_from = np.full(n_stops, -1, dtype=np.int32)
    trip_board_conn = np.full(network.n_trips, -1, dtype=np.int32)

    for lat, lon in sources:
        idx, dist = stops_within_radius(
            lat, lon, config.MAX_SOURCE_WALK_M, network.stop_lats, network.stop_lons
        )
        walk_s = (dist / config.WALK_SPEED_M_PER_MIN * 60.0).astype(np.int32)
        t0 = depart_secs + walk_s
        np.minimum.at(arrival, idx, t0)
        np.minimum.at(board, idx, t0)

    t_max = np.int32(depart_secs + max_mins * 60)
    start_idx = int(np.searchsorted(network.dep_time, depart_secs, side="left"))

    csa_scan(
        network.dep_stop, network.arr_stop, network.dep_time, network.arr_time,
        network.trip, network.conn_mode,
        network.fp_indptr, network.fp_target, network.fp_dur,
        arrival, board, trip_reached,
        pred_conn, pred_from, trip_board_conn,
        start_idx, t_max, np.int32(config.INTERCHANGE_BUFFER_S), mode_mask,
    )
    return ScanResult(arrival, pred_conn, pred_from, trip_board_conn, depart_secs)


def query_one_to_all(
    network,
    sources: list[tuple[float, float]],
    depart_secs: int,
    max_mins: int = config.MAX_TRAVEL_MINS,
    mode_mask: np.int32 = ALL_MODES_MASK,
    combine: str = "union",
) -> tuple[np.ndarray, np.ndarray]:
    """Travel times from sources.

    combine='union': reachable from ANY source (min) — one scan, sources merged.
    combine='meet' : meeting-point view — time for EVERYONE to get there (max
    over per-source scans); stops unreachable from any source are excluded.

    Returns (stop_idx int32[], minutes float32[]).
    """
    t_max = depart_secs + max_mins * 60
    if combine == "meet" and len(sources) > 1:
        arrival = None
        for src in sources:
            a = run_scan(network, [src], depart_secs, max_mins, mode_mask).arrival
            arrival = a if arrival is None else np.maximum(arrival, a)
    else:
        arrival = run_scan(network, sources, depart_secs, max_mins, mode_mask).arrival

    reached = np.nonzero(arrival <= t_max)[0]
    minutes = ((arrival[reached] - depart_secs) / 60.0).astype(np.float32)
    return reached.astype(np.int32), minutes


def extract_journey(network, scan: ScanResult, target_stop: int) -> list[dict] | None:
    """Walk the predecessor chain back from target_stop to a source stop.

    Returns legs in travel order:
      {"kind": "transit", "trip": t, "from": s, "to": s2, "dep": secs, "arr": secs}
      {"kind": "walk",    "from": s, "to": s2, "dep": secs, "arr": secs}
    or None if the stop was never reached.
    """
    if scan.arrival[target_stop] == INF:
        return None
    legs: list[dict] = []
    t = int(target_stop)
    for _ in range(200):  # guard against pathological chains
        c = int(scan.pred_conn[t])
        if c >= 0:
            tr = int(network.trip[c])
            b = int(scan.trip_board_conn[tr])
            legs.append({
                "kind": "transit",
                "trip": tr,
                "from": int(network.dep_stop[b]),
                "to": t,
                "dep": int(network.dep_time[b]),
                "arr": int(network.arr_time[c]),
            })
            t = int(network.dep_stop[b])
        elif scan.pred_from[t] >= 0:
            s = int(scan.pred_from[t])
            legs.append({
                "kind": "walk",
                "from": s,
                "to": t,
                "dep": int(scan.arrival[s]),
                "arr": int(scan.arrival[t]),
            })
            t = s
        else:
            break  # source stop (reached by the initial walk)
    legs.reverse()
    return legs
