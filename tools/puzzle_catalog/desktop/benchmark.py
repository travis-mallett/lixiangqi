"""Measure Studio's real read paths without engines, migrations, or data copies."""

import argparse
from pathlib import Path
import statistics
import time

from .repository import ContentRepository


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--mining", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--iterations", type=int, default=5)
    args = parser.parse_args()
    if args.iterations < 1:
        parser.error("iterations must be positive")
    repo = ContentRepository(args.catalog, args.mining, args.state)
    try:
        first = repo.page(library=True)
        print(f"Library: {first['total']:,} puzzles; {len(first['rows'])} per page")
        queries = {
            "overview": repo.stats,
            "library/newest": lambda: repo.page(library=True),
            "library/anglerHorse": lambda: repo.page(library=True, theme="anglerHorse"),
            "library/length": lambda: repo.page(library=True, sort="length"),
            "facets": repo.facets,
            "publication": repo.publication,
        }
        if first["rows"]:
            key = first["rows"][0]["key"]
            queries["selected puzzle"] = lambda: repo.detail(key)
        repo.cached("overview", repo.stats)
        queries["unchanged overview"] = lambda: repo.cached("overview", repo.stats)
        for name, query in queries.items():
            elapsed, cpu = [], []
            for _ in range(args.iterations):
                start, cpu_start = time.perf_counter(), time.process_time()
                query()
                elapsed.append(1000 * (time.perf_counter() - start))
                cpu.append(1000 * (time.process_time() - cpu_start))
            print(
                f"{name:24} median {statistics.median(elapsed):8.2f} ms; "
                f"max {max(elapsed):8.2f} ms; CPU median {statistics.median(cpu):8.2f} ms",
                flush=True,
            )
    finally:
        repo.close()


if __name__ == "__main__":
    main()
