import numpy as np

EARTH_RADIUS_M = 6_371_000.0


def haversine_m(lat1: float, lon1: float, lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    """Distance in meters from one point to arrays of points."""
    p1, p2 = np.radians(lat1), np.radians(lats)
    dphi = p2 - p1
    dlmb = np.radians(lons - lon1)
    a = np.sin(dphi / 2.0) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dlmb / 2.0) ** 2
    return 2.0 * EARTH_RADIUS_M * np.arcsin(np.sqrt(a))


def stops_within_radius(
    lat: float, lon: float, radius_m: float, stop_lats: np.ndarray, stop_lons: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Return (stop indices, distances in m) of stops within radius_m of (lat, lon).

    Brute-force vectorized haversine over all stops (~45k) takes ~1 ms; no
    spatial index needed. A cheap bounding-box prefilter skips most of the trig.
    """
    dlat = np.degrees(radius_m / EARTH_RADIUS_M)
    dlon = dlat / max(np.cos(np.radians(lat)), 0.01)
    box = (
        (stop_lats >= lat - dlat)
        & (stop_lats <= lat + dlat)
        & (stop_lons >= lon - dlon)
        & (stop_lons <= lon + dlon)
    )
    cand = np.nonzero(box)[0]
    if cand.size == 0:
        return cand, np.empty(0)
    d = haversine_m(lat, lon, stop_lats[cand], stop_lons[cand])
    keep = d <= radius_m
    return cand[keep], d[keep]
