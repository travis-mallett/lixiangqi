"""Offline authoring utilities. Publish through Puzzle Studio."""

import argparse
import json
from pathlib import Path
from .catalog import PuzzleCatalog
from .authoring import admit_candidate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--catalog", type=Path, default=Path("data/local/puzzle-catalog.sqlite3")
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("status")
    p = commands.add_parser("import-inventory")
    p.add_argument("snapshot", type=Path)
    p.add_argument("--source-catalog", type=Path)
    p = commands.add_parser("admit")
    p.add_argument("--mining-db", type=Path, required=True)
    p.add_argument("--ids", nargs="+", required=True)
    p.add_argument("--source-catalog", type=Path)
    p = commands.add_parser("retire")
    p.add_argument("id")
    p.add_argument("--reason", required=True)
    p = commands.add_parser("reclassify")
    p.add_argument("--release", required=True)
    p.add_argument("--theme", required=True)
    p.add_argument("--engine", type=Path)
    p.add_argument("--nodes", type=int, default=2000000)
    a = parser.parse_args()
    with PuzzleCatalog(a.catalog) as catalog:
        if a.command == "status":
            print(
                json.dumps(
                    {
                        "puzzles": len(catalog.puzzles()),
                        "snapshotId": catalog._meta("snapshotId"),
                        "deployedReleaseId": catalog._meta("deployedReleaseId"),
                    }
                )
            )
        elif a.command == "import-inventory":
            print(catalog.import_inventory(a.snapshot, a.source_catalog))
        elif a.command == "admit":
            for pid in a.ids:
                print(admit_candidate(catalog, a.mining_db, pid, a.source_catalog))
        elif a.command == "retire":
            catalog.retire(a.id, a.reason)
        elif a.command == "reclassify":
            from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
            from tools.xiangqi_data.puzzle_mining.checkmate import CategorizerConfig
            from tools.xiangqi_data.pikafish import _default_executable

            config = CategorizerConfig(nodes=a.nodes)
            engine = OfflinePikafish(
                a.engine or _default_executable(),
                threads=config.engine_threads,
                hash_mb=config.hash_mb,
            )
            try:
                print(
                    json.dumps(
                        catalog.reclassify(
                            a.release,
                            a.theme,
                            engine,
                            config,
                        )
                    )
                )
            finally:
                engine.close()


if __name__ == "__main__":
    raise SystemExit(main())
