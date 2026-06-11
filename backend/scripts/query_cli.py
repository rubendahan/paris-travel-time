"""Sanity-check CLI for the CSA engine.

  python -m scripts.query_cli --from 48.8588,2.3470 --at 08:30 --to "La Defense"
"""

import argparse
import time

from app import config
from app.core.csa import query_one_to_all
from app.core.network import load_network


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="sources", action="append", required=True, metavar="LAT,LNG")
    ap.add_argument("--at", default="08:30")
    ap.add_argument("--to", default=None, help="substring filter on stop names")
    ap.add_argument("--max", type=int, default=config.MAX_TRAVEL_MINS)
    args = ap.parse_args()

    net = load_network(config.DATA_DIR)
    sources = [tuple(map(float, s.split(","))) for s in args.sources]
    h, m = map(int, args.at.split(":"))
    depart = h * 3600 + m * 60

    t0 = time.perf_counter()
    idx, minutes = query_one_to_all(net, sources, depart, args.max)  # includes JIT compile
    first = time.perf_counter() - t0
    t0 = time.perf_counter()
    idx, minutes = query_one_to_all(net, sources, depart, args.max)
    warm = time.perf_counter() - t0
    print(f"\nreachable stops <= {args.max} min: {len(idx):,}")
    print(f"query time: {first * 1000:.0f} ms (first, incl. JIT) / {warm * 1000:.0f} ms (warm)\n")

    rows = sorted(zip(idx.tolist(), minutes.tolist()), key=lambda r: r[1])
    shown = 0
    for i, mins in rows:
        name = net.stop_names[i]
        if args.to and args.to.lower() not in name.lower():
            continue
        print(f"  {mins:6.1f} min  {name}  ({net.stop_ids[i]})")
        shown += 1
        if shown >= 20:
            break
    if not shown:
        print("  (no matching stop)")


if __name__ == "__main__":
    main()
