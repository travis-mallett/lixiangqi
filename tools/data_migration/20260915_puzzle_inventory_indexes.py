"""Install additive local puzzle inventory indexes, without data copies/migrations.

Existing puzzle rows are untouched. SQLite maintains the indexes for every
writer, including workers already running when installation finishes. Re-running
is safe. This is local tool maintenance, not a live-site deployment migration.
"""

import argparse
from contextlib import closing
from pathlib import Path
import sqlite3
import time


def install(mining, catalog):
    from tools.xiangqi_data.puzzle_mining.inventory import install as mining_indexes
    from tools.puzzle_catalog.inventory import install as catalog_indexes

    for path, build in (
        (Path(mining), mining_indexes),
        (Path(catalog), catalog_indexes),
    ):
        if not path.exists():
            continue
        start = time.monotonic()
        print(f"Preparing inventory indexes: {path}", flush=True)
        with closing(sqlite3.connect(path, timeout=30)) as db:
            build(db)
        print(f"Inventory indexes ready in {time.monotonic() - start:.2f}s", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mining", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True)
    args = parser.parse_args()
    install(args.mining, args.catalog)
