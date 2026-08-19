"""The kernel against a reference solver, on small random networks.

The scan's whole claim is that reading connections once, in departure
order, is worth a full fixpoint. So the reference is exactly that fixpoint:
relax every connection and every footpath, in any order, until nothing
moves. It is quadratic and shares no line of code with the kernel, which is
the point.

Networks are drawn with a seeded RNG, so a failure is reproducible from the
seed printed by pytest.
"""

from dataclasses import dataclass

import numpy as np
import pytest

from app.core.csa import ALL_MODES_MASK, INF, NEG_INF, csa_scan, csa_scan_reverse

BUFFER_S = 60
T_MAX = 900
ARRIVE_BY = 1_200  # late enough that the reverse scan has a network to chew on
WALK_BUDGET_S = 10_000  # unbounded chains, like the reference solver
STEP = 30  # times land on a coarse grid, so tight transfers happen often


@dataclass
class ToyNet:
    n_stops: int
    n_trips: int
    dep_stop: np.ndarray
    arr_stop: np.ndarray
    dep_time: np.ndarray
    arr_time: np.ndarray
    trip: np.ndarray
    conn_mode: np.ndarray
    fp_indptr: np.ndarray
    fp_target: np.ndarray
    fp_dur: np.ndarray
    sources: dict[int, int]  # stop -> time the traveller is there


def footpath_csr(n_stops: int, edges: dict[tuple[int, int], int]) -> tuple:
    """Symmetric footpath edges -> CSR, as build_network emits them."""
    rows: list[list[tuple[int, int]]] = [[] for _ in range(n_stops)]
    for (a, b), dur in edges.items():
        rows[a].append((b, dur))
        rows[b].append((a, dur))
    indptr = np.zeros(n_stops + 1, dtype=np.int32)
    target, dur_arr = [], []
    for s, row in enumerate(rows):
        indptr[s + 1] = indptr[s] + len(row)
        for b, d in row:
            target.append(b)
            dur_arr.append(d)
    return (
        indptr,
        np.asarray(target, dtype=np.int32),
        np.asarray(dur_arr, dtype=np.int32),
    )


def walk_closure(start: int, t0: int, indptr, target, dur) -> dict[int, int]:
    """Every stop walkable from `start`, with its arrival time (Dijkstra).

    Mirrors what production hands the kernel: the initial walk out of the
    marker is a mask-aware Dijkstra over the raster, so the stops it seeds
    are already closed under walking.
    """
    best = {start: t0}
    frontier = [start]
    while frontier:
        s = frontier.pop()
        for j in range(indptr[s], indptr[s + 1]):
            v, cand = int(target[j]), best[s] + int(dur[j])
            if cand < best.get(v, 1 << 30):
                best[v] = cand
                frontier.append(v)
    return best


def random_network(rng: np.random.Generator, chains: bool = False) -> ToyNet:
    """A handful of stops, a few trips riding through them, some footpaths.

    chains=False draws footpaths as disjoint pairs: walking out of a walk
    can then never beat the direct edge, so a single relaxation hop is all
    the model needs. chains=True draws an arbitrary walking graph, where
    reaching a stop can take two or three footpaths in a row, exactly like
    a station transfer followed by a 200 m hop in the real feed.
    """
    n_stops = int(rng.integers(4, 10))
    n_trips = int(rng.integers(2, 7))

    conns: list[tuple[int, int, int, int, int, int]] = []

    def add_trip(tr: int, start: int, t: int) -> None:
        n_hops = int(rng.integers(1, min(4, n_stops)))
        rest = [int(s) for s in rng.permutation(n_stops) if int(s) != start]
        path = [start] + rest[:n_hops]
        mode = int(rng.integers(0, 5))
        for a, b in zip(path, path[1:]):
            ride = STEP * int(rng.integers(1, 6))
            conns.append((a, b, t, t + ride, tr, mode))
            t += ride + STEP * int(rng.integers(0, 5))  # dwell

    for tr in range(n_trips):
        if conns and rng.random() < 0.5:
            # hang this trip off another trip's arrival, a few dozen seconds
            # later: transfers the interchange buffer has to arbitrate, some
            # too tight to catch, some just catchable
            _, at_stop, _, at_time, _, _ = conns[int(rng.integers(0, len(conns)))]
            add_trip(tr, at_stop, at_time + STEP * int(rng.integers(0, 5)))
        else:
            add_trip(tr, int(rng.integers(0, n_stops)), STEP * int(rng.integers(0, 20)))

    dep_stop, arr_stop, dep_time, arr_time, trip, conn_mode = (list(c) for c in zip(*conns))
    order = np.argsort(np.asarray(dep_time), kind="stable")  # the kernel's invariant

    edges: dict[tuple[int, int], int] = {}
    if chains:
        for _ in range(int(rng.integers(1, n_stops))):
            a, b = (int(x) for x in rng.choice(n_stops, size=2, replace=False))
            edges[(min(a, b), max(a, b))] = STEP * int(rng.integers(2, 6))
    else:
        shuffled = list(rng.permutation(n_stops))
        for a, b in zip(shuffled[::2], shuffled[1::2]):
            if rng.random() < 0.5:
                edges[(int(a), int(b))] = STEP * int(rng.integers(2, 6))
    fp_indptr, fp_target, fp_dur = footpath_csr(n_stops, edges)

    start = int(rng.integers(0, n_stops))
    t0 = STEP * int(rng.integers(0, 6))
    sources = walk_closure(start, t0, fp_indptr, fp_target, fp_dur)

    return ToyNet(
        n_stops=n_stops,
        n_trips=n_trips,
        dep_stop=np.asarray(dep_stop, dtype=np.int32)[order],
        arr_stop=np.asarray(arr_stop, dtype=np.int32)[order],
        dep_time=np.asarray(dep_time, dtype=np.int32)[order],
        arr_time=np.asarray(arr_time, dtype=np.int32)[order],
        trip=np.asarray(trip, dtype=np.int32)[order],
        conn_mode=np.asarray(conn_mode, dtype=np.int8)[order],
        fp_indptr=fp_indptr,
        fp_target=fp_target,
        fp_dur=fp_dur,
        sources=sources,
    )


def reference_arrivals(net: ToyNet, mode_mask: int = int(ALL_MODES_MASK)) -> np.ndarray:
    """Earliest arrivals by relaxation to a fixpoint. No ordering assumed.

    Two labels per stop: `arr` (being there) and `brd` (being allowed to
    board a departure there), which differ by the interchange buffer after
    alighting from a vehicle but not after a walk.
    """
    arr = np.full(net.n_stops, INF, dtype=np.int64)
    brd = np.full(net.n_stops, INF, dtype=np.int64)
    for s, t in net.sources.items():
        arr[s] = brd[s] = t

    conns_of_trip = [np.nonzero(net.trip == tr)[0] for tr in range(net.n_trips)]

    changed = True
    while changed:
        changed = False
        for s in range(net.n_stops):
            if arr[s] == INF:
                continue
            for j in range(net.fp_indptr[s], net.fp_indptr[s + 1]):
                s2 = int(net.fp_target[j])
                cand = arr[s] + int(net.fp_dur[j])
                if cand < arr[s2]:
                    arr[s2], changed = cand, True
                if cand < brd[s2]:  # walking in, you may board straight away
                    brd[s2], changed = cand, True
        for conns in conns_of_trip:
            onboard = False
            for i in conns:  # in departure order along the trip
                if net.dep_time[i] > T_MAX:
                    break
                if not (mode_mask >> int(net.conn_mode[i])) & 1:
                    continue
                if brd[net.dep_stop[i]] <= net.dep_time[i]:
                    onboard = True
                if not onboard:
                    continue
                s2 = int(net.arr_stop[i])
                a = int(net.arr_time[i])
                if a < arr[s2]:
                    arr[s2], changed = a, True
                if a + BUFFER_S < brd[s2]:
                    brd[s2], changed = a + BUFFER_S, True
    return arr


def kernel_arrivals(
    net: ToyNet,
    mode_mask: int = int(ALL_MODES_MASK),
    walk_budget_s: int = WALK_BUDGET_S,
) -> np.ndarray:
    arrival = np.full(net.n_stops, INF, dtype=np.int32)
    board = np.full(net.n_stops, INF, dtype=np.int32)
    for s, t in net.sources.items():
        arrival[s] = board[s] = t
    csa_scan(
        net.dep_stop, net.arr_stop, net.dep_time, net.arr_time, net.trip, net.conn_mode,
        net.fp_indptr, net.fp_target, net.fp_dur,
        arrival, board, np.zeros(net.n_trips, dtype=np.bool_),
        np.full(net.n_stops, -1, dtype=np.int32), np.full(net.n_stops, -1, dtype=np.int32),
        np.full(net.n_trips, -1, dtype=np.int32),
        np.empty(net.n_stops, dtype=np.int32), np.empty(net.n_stops, dtype=np.int32),
        np.zeros(net.n_stops, dtype=np.bool_),
        0, np.int32(T_MAX), np.int32(BUFFER_S), np.int32(mode_mask),
        np.int32(walk_budget_s),
    )
    return arrival.astype(np.int64)


@pytest.mark.parametrize("seed", range(120))
def test_matches_reference_solver(seed: int):
    net = random_network(np.random.default_rng(seed))
    assert list(kernel_arrivals(net)) == list(reference_arrivals(net))


@pytest.mark.parametrize("seed", range(120))
def test_matches_reference_solver_with_footpath_chains(seed: int):
    net = random_network(np.random.default_rng(seed), chains=True)
    assert list(kernel_arrivals(net)) == list(reference_arrivals(net))


def test_a_walk_out_of_a_walk_is_taken():
    """A --train--> B, then two footpaths in a row. No B->D edge exists."""
    net = ToyNet(
        n_stops=4, n_trips=1,
        dep_stop=np.array([0], dtype=np.int32),
        arr_stop=np.array([1], dtype=np.int32),
        dep_time=np.array([100], dtype=np.int32),
        arr_time=np.array([200], dtype=np.int32),
        trip=np.array([0], dtype=np.int32),
        conn_mode=np.array([1], dtype=np.int8),
        **dict(zip(
            ("fp_indptr", "fp_target", "fp_dur"),
            footpath_csr(4, {(1, 2): 60, (2, 3): 90}),
        )),
        sources={0: 0},
    )
    assert list(kernel_arrivals(net)) == [0, 200, 260, 350]


def test_walk_chains_stop_at_the_walking_budget():
    """Same chain, but a budget that only pays for the first footpath."""
    net = ToyNet(
        n_stops=4, n_trips=1,
        dep_stop=np.array([0], dtype=np.int32),
        arr_stop=np.array([1], dtype=np.int32),
        dep_time=np.array([100], dtype=np.int32),
        arr_time=np.array([200], dtype=np.int32),
        trip=np.array([0], dtype=np.int32),
        conn_mode=np.array([1], dtype=np.int8),
        **dict(zip(
            ("fp_indptr", "fp_target", "fp_dur"),
            footpath_csr(4, {(1, 2): 60, (2, 3): 90}),
        )),
        sources={0: 0},
    )
    assert list(kernel_arrivals(net, walk_budget_s=30)) == [0, 200, 260, INF]


@pytest.mark.parametrize("seed", range(60))
def test_matches_reference_solver_under_mode_filters(seed: int):
    rng = np.random.default_rng(10_000 + seed)
    net = random_network(rng)
    mask = int(rng.integers(1, 32))
    assert list(kernel_arrivals(net, mask)) == list(reference_arrivals(net, mask))


# --- "arrive by": the same comparison, mirrored ------------------------------


def destinations(net: ToyNet, arrive_by: int) -> dict[int, int]:
    """Latest departure from each stop of the final walk to the destination."""
    return {s: arrive_by - (w - min(net.sources.values())) for s, w in net.sources.items()}


def reference_departures(
    net: ToyNet, arrive_by: int, mode_mask: int = int(ALL_MODES_MASK)
) -> np.ndarray:
    """Latest departures by relaxation to a fixpoint, mirror of the forward one."""
    dep = np.full(net.n_stops, NEG_INF, dtype=np.int64)
    alight = np.full(net.n_stops, NEG_INF, dtype=np.int64)
    for s, t in destinations(net, arrive_by).items():
        dep[s] = alight[s] = t
    t_min = arrive_by - T_MAX
    conns_of_trip = [np.nonzero(net.trip == tr)[0] for tr in range(net.n_trips)]

    changed = True
    while changed:
        changed = False
        for s in range(net.n_stops):
            if dep[s] == NEG_INF:
                continue
            for j in range(net.fp_indptr[s], net.fp_indptr[s + 1]):
                s2 = int(net.fp_target[j])
                cand = dep[s] - int(net.fp_dur[j])  # leave s2 early enough to walk to s
                if cand > dep[s2]:
                    dep[s2], changed = cand, True
                if cand > alight[s2]:
                    alight[s2], changed = cand, True
        for conns in conns_of_trip:
            onboard = False
            for i in conns[::-1]:  # backwards along the trip
                if net.arr_time[i] < t_min:
                    continue
                if not (mode_mask >> int(net.conn_mode[i])) & 1:
                    continue
                if alight[net.arr_stop[i]] >= net.arr_time[i]:
                    onboard = True
                if not onboard:
                    continue
                u = int(net.dep_stop[i])
                td = int(net.dep_time[i])
                if td > dep[u]:
                    dep[u], changed = td, True
                if td - BUFFER_S > alight[u]:
                    alight[u], changed = td - BUFFER_S, True
    return dep


def kernel_departures(
    net: ToyNet, arrive_by: int, mode_mask: int = int(ALL_MODES_MASK)
) -> np.ndarray:
    dep = np.full(net.n_stops, NEG_INF, dtype=np.int32)
    alight = np.full(net.n_stops, NEG_INF, dtype=np.int32)
    for s, t in destinations(net, arrive_by).items():
        dep[s] = alight[s] = t
    order_desc = np.argsort(net.arr_time, kind="stable").astype(np.int32)[::-1].copy()
    csa_scan_reverse(
        order_desc,
        net.dep_stop, net.arr_stop, net.dep_time, net.arr_time, net.trip, net.conn_mode,
        net.fp_indptr, net.fp_target, net.fp_dur,
        dep, alight, np.zeros(net.n_trips, dtype=np.bool_),
        np.empty(net.n_stops, dtype=np.int32), np.empty(net.n_stops, dtype=np.int32),
        np.zeros(net.n_stops, dtype=np.bool_),
        0, np.int32(arrive_by - T_MAX), np.int32(BUFFER_S), np.int32(mode_mask),
        np.int32(WALK_BUDGET_S),
    )
    return dep.astype(np.int64)


@pytest.mark.parametrize("seed", range(120))
def test_reverse_matches_reference_solver(seed: int):
    net = random_network(np.random.default_rng(seed))
    assert list(kernel_departures(net, ARRIVE_BY)) == list(reference_departures(net, ARRIVE_BY))


@pytest.mark.parametrize("seed", range(120))
def test_reverse_matches_reference_solver_with_footpath_chains(seed: int):
    net = random_network(np.random.default_rng(seed), chains=True)
    assert list(kernel_departures(net, ARRIVE_BY)) == list(reference_departures(net, ARRIVE_BY))
