"""Verify the restored production content before starting the disposable preview.

Publishing is owned by the application API. Preview startup only completes
required source metadata on the restored inventory, never installs a second
authored inventory. The verified archive remains the recovery source.
"""

from pathlib import Path
import argparse
import json
from .snapshot import PREVIEW_DATABASE, PREVIEW_URI, verify_snapshot
from tools.puzzle_catalog.catalog import catalog_source, validate_puzzle


def prepare(snapshot: Path, source_catalog=None, *, collection=None):
    verify_snapshot(snapshot)
    inventory = json.loads(
        (snapshot / "puzzle-inventory.json").read_text(encoding="utf-8")
    )
    for puzzle in inventory["puzzles"]:
        try:
            if puzzle.get("sourceSnapshot") is None and source_catalog is not None:
                source = puzzle["gameSource"]
                if source["type"] == "catalog":
                    puzzle["sourceSnapshot"] = catalog_source(
                        source_catalog, puzzle["gameId"], source["database"]
                    )
            validate_puzzle(puzzle)
        except ValueError as error:
            raise ValueError(f"Puzzle {puzzle['_id']}: {error}") from error
    if collection is not None:
        # Only enrich the freshly restored inventory. Never import local authored
        # content or replace runtime fields. The immutable Mongo archive retains
        # every original document; rerunning startup restores it before this step.
        if collection.count_documents({}) != len(inventory["puzzles"]):
            raise ValueError("restored puzzle membership differs from snapshot")
        plans = []
        for puzzle in inventory["puzzles"]:
            selector = {k: puzzle[k] for k in ("_id", "gameId", "fen", "line")}
            current = collection.find_one(selector)
            if current is None:
                raise ValueError(
                    f"Restored puzzle {puzzle['_id']} differs from snapshot"
                )
            fields = {}
            for key in ("sourceSnapshot", "gameSource", "retired", "retirementReason"):
                if key not in current or (
                    current[key] is None and puzzle[key] is not None
                ):
                    fields[key] = puzzle[key]
            normalized = {key: current.get(key) for key in puzzle}
            normalized.update(fields)
            normalized["themes"] = current.get("managedThemes", current["themes"])
            validate_puzzle(normalized)
            plans.append((selector, fields, puzzle))
        for selector, fields, puzzle in plans:
            if (
                fields
                and collection.update_one(selector, {"$set": fields}).matched_count != 1
            ):
                raise ValueError(
                    f"Restored puzzle {puzzle['_id']} changed during preparation"
                )
            current = collection.find_one(selector)
            normalized = {key: current.get(key) for key in puzzle}
            normalized["themes"] = current.get("managedThemes", current["themes"])
            validate_puzzle(normalized)
    return len(inventory["puzzles"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--source-catalog", type=Path, required=True)
    args = parser.parse_args()
    from pymongo import MongoClient

    with MongoClient(PREVIEW_URI, serverSelectionTimeoutMS=5000) as client:
        count = prepare(
            args.snapshot,
            args.source_catalog,
            collection=client[PREVIEW_DATABASE].puzzle2_puzzle,
        )
    print(f"Prepared and verified {count} restored puzzles")


if __name__ == "__main__":
    main()
