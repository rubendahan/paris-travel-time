import json
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq


@dataclass
class Network:
    # connections, sorted by dep_time
    dep_stop: np.ndarray
    arr_stop: np.ndarray
    dep_time: np.ndarray
    arr_time: np.ndarray
    trip: np.ndarray
    conn_mode: np.ndarray  # mode group per connection (see csa.MODE_*)
    trip_route_name: list[str]
    trip_mode: np.ndarray
    # footpaths, CSR over stop idx
    fp_indptr: np.ndarray
    fp_target: np.ndarray
    fp_dur: np.ndarray
    # stop catalog (parallel arrays, index = stop idx)
    stop_ids: list[str]
    stop_names: list[str]
    stop_lats: np.ndarray
    stop_lons: np.ndarray
    meta: dict

    @property
    def n_stops(self) -> int:
        return len(self.stop_ids)

    @property
    def n_trips(self) -> int:
        return int(self.meta["n_trips"])

    @property
    def n_connections(self) -> int:
        return int(self.dep_stop.shape[0])


def load_network(data_dir: Path) -> Network:
    t0 = time.perf_counter()
    npz = np.load(data_dir / "network.npz", allow_pickle=False)
    stops = pq.read_table(data_dir / "stops.parquet")
    trips = pq.read_table(data_dir / "trips.parquet")
    meta = json.loads(str(npz["meta"][0]))
    net = Network(
        dep_stop=npz["dep_stop"],
        arr_stop=npz["arr_stop"],
        dep_time=npz["dep_time"],
        arr_time=npz["arr_time"],
        trip=npz["trip"],
        conn_mode=npz["conn_mode"],
        trip_route_name=trips.column("route_name").to_pylist(),
        trip_mode=trips.column("mode").to_numpy(),
        fp_indptr=npz["fp_indptr"],
        fp_target=npz["fp_target"],
        fp_dur=npz["fp_dur"],
        stop_ids=stops.column("stop_id").to_pylist(),
        stop_names=stops.column("name").to_pylist(),
        stop_lats=stops.column("lat").to_numpy(),
        stop_lons=stops.column("lon").to_numpy(),
        meta=meta,
    )
    print(
        f"network loaded: {net.n_stops} stops, {net.n_connections} connections, "
        f"{net.fp_target.shape[0]} footpaths, service date {meta['service_date']} "
        f"({time.perf_counter() - t0:.1f}s)"
    )
    return net
