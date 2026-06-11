"""Download a GTFS zip. Defaults to the IDFM (Île-de-France) feed.

Usage: python -m ingest.download_gtfs [--url URL] [--out PATH] [--force]
"""

import argparse
from pathlib import Path

import requests

DEFAULT_URL = "https://eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip"
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "data" / "gtfs" / "IDFM-gtfs.zip"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    args.out.parent.mkdir(parents=True, exist_ok=True)
    if args.out.exists() and not args.force:
        print(f"{args.out} already exists ({args.out.stat().st_size / 1e6:.0f} MB), use --force to re-download")
        return

    print(f"downloading {args.url} ...")
    with requests.get(args.url, stream=True, timeout=60) as r:
        r.raise_for_status()
        done = 0
        with open(args.out, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                f.write(chunk)
                done += len(chunk)
                print(f"\r{done / 1e6:.0f} MB", end="", flush=True)
    print(f"\nsaved to {args.out}")


if __name__ == "__main__":
    main()
