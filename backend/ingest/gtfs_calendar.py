"""Service-calendar resolution: which service_ids run on a given date."""

import datetime as dt
import io
import zipfile

import pandas as pd

WEEKDAY_COLS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def _read_optional(zf: zipfile.ZipFile, name: str, **kwargs) -> pd.DataFrame | None:
    try:
        with zf.open(name) as f:
            return pd.read_csv(io.TextIOWrapper(f, encoding="utf-8-sig"), **kwargs)
    except KeyError:
        return None


def active_service_ids(zf: zipfile.ZipFile, date: dt.date) -> set[str]:
    """Services active on `date` per calendar.txt + calendar_dates.txt.

    Either file may be absent (some feeds are calendar_dates-only).
    """
    yyyymmdd = int(date.strftime("%Y%m%d"))
    active: set[str] = set()

    cal = _read_optional(
        zf, "calendar.txt",
        dtype={"service_id": str}, low_memory=False,
    )
    if cal is not None and len(cal):
        day_col = WEEKDAY_COLS[date.weekday()]
        mask = (
            (cal[day_col].astype(int) == 1)
            & (cal["start_date"].astype(int) <= yyyymmdd)
            & (cal["end_date"].astype(int) >= yyyymmdd)
        )
        active.update(cal.loc[mask, "service_id"])

    cdates = _read_optional(
        zf, "calendar_dates.txt",
        dtype={"service_id": str}, low_memory=False,
    )
    if cdates is not None and len(cdates):
        today = cdates[cdates["date"].astype(int) == yyyymmdd]
        added = today.loc[today["exception_type"].astype(int) == 1, "service_id"]
        removed = today.loc[today["exception_type"].astype(int) == 2, "service_id"]
        active.update(added)
        active.difference_update(removed)

    return active
