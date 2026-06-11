import numpy as np
import pandas as pd


def parse_gtfs_times(s: pd.Series) -> np.ndarray:
    """Vectorized "HH:MM:SS" -> seconds since service-day midnight (int32).

    GTFS times legitimately exceed 24:00:00 (e.g. "25:30:00" = 1:30 AM the
    next morning, still part of the same service day). Invalid/empty -> -1.
    """
    v = pd.to_numeric(s.str.replace(":", "", regex=False), errors="coerce")
    secs = (v // 10000) * 3600 + (v // 100 % 100) * 60 + (v % 100)
    return secs.fillna(-1).astype(np.int32).to_numpy()
