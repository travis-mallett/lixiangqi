"""Add verified playback branches without changing puzzle identity or player data.

Preparation exports only playback metadata and identity preconditions. Deployment
applies it with writers stopped. Every original document is retained, and plans
are durable before the first mutation. Interrupted applications resume safely.
"""

import argparse
import json
import re
import sqlite3
from pathlib import Path

from tools.puzzle_catalog.catalog import identity
from tools.puzzle_catalog.playback import from_evidence, validate_playback

MIGRATION = "puzzle-playback-v1"
BACKUP = "__lixiangqi_puzzle_playback_v1_backup"
PLANS = "__lixiangqi_puzzle_playback_v1_plans"


def export(catalog, output):
    records, unavailable, primary_only = [], [], []
    with sqlite3.connect(
        f"{Path(catalog).resolve().as_uri()}?mode=ro", uri=True
    ) as connection:
        # One read transaction gives a coherent snapshot while Studio is open.
        connection.execute("BEGIN")
        for document, evidence in connection.execute(
            "SELECT document,evidence FROM catalog_puzzles ORDER BY id"
        ):
            puzzle, evidence = json.loads(document), json.loads(evidence)
            try:
                if evidence.get("branches"):
                    playback = from_evidence(puzzle, evidence)
                elif any(
                    theme == "mate" or re.fullmatch(r"mateIn[1-9][0-9]*", theme)
                    for theme in puzzle["themes"]
                ):
                    # Historical published mates predate retained verifier trees.
                    # Migrate their already accepted line, without inventing ties.
                    playback = {
                        "objective": "mate",
                        "solutions": [puzzle["line"].split()[1:]],
                    }
                    validate_playback(playback, puzzle["line"].split()[1:])
                    primary_only.append(puzzle["_id"])
                else:
                    raise ValueError(
                        "historical puzzle lacks verified objective/baseline"
                    )
                records.append({"identity": identity(puzzle), "playback": playback})
            except (ValueError, KeyError, IndexError) as error:
                unavailable.append({"id": puzzle["_id"], "error": str(error)})
    Path(output).write_text(
        json.dumps(
            {
                "version": 1,
                "puzzles": records,
                "unavailable": unavailable,
                "primaryOnly": primary_only,
            },
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    return {
        "exported": len(records),
        "unavailable": len(unavailable),
        "primaryOnly": primary_only,
    }


def migrate(db, payload, *, check=False, interrupt=None):
    if payload.get("version") != 1:
        raise ValueError("unsupported playback migration payload")
    records = {record["identity"]["_id"]: record for record in payload["puzzles"]}
    if len(records) != len(payload["puzzles"]):
        raise ValueError("duplicate playback identity")
    puzzles = db.puzzle2_puzzle
    markers = db.get_collection("__lixiangqi_migrations")
    backup, plans = db.get_collection(BACKUP), db.get_collection(PLANS)
    marker = markers.find_one({"_id": MIGRATION})
    if marker and marker["state"] == "complete":
        if puzzles.count_documents({"playback": {"$exists": False}}):
            raise ValueError("new puzzles are missing playback metadata")
        return {"alreadyApplied": True}
    control = db.puzzle2_publication.find_one({"_id": "control"})
    if control and control.get("operation"):
        raise ValueError("pending publication must recover before migration")
    if not marker or marker["state"] == "preparing":
        pending, missing = [], []
        for original in puzzles.find({}).sort("_id", 1):
            record = records.get(original["_id"])
            if "playback" in original:
                playback = validate_playback(
                    original["playback"], original["line"].split()[1:]
                )
            elif record and identity(original) == record["identity"]:
                playback = validate_playback(
                    record["playback"], original["line"].split()[1:]
                )
            else:
                missing.append(original["_id"])
                continue
            pending.append((original, playback))
        if missing:
            raise ValueError(
                f"Verified playback unavailable or identity changed for {len(missing)} live puzzles: {', '.join(missing[:50])}. Refresh the authored verification evidence and prepare deployment again."
            )
        if check:
            return {
                "puzzles": len(pending),
                "requiresMigration": sum("playback" not in p for p, _ in pending),
            }
        if not marker:
            if backup.count_documents({}) or plans.count_documents({}):
                raise ValueError("unrecognized recovery evidence")
            markers.insert_one({"_id": MIGRATION, "state": "preparing"})
        for original, playback in pending:
            key = {"_id": original["_id"]}
            backup.update_one(key, {"$setOnInsert": original}, upsert=True)
            plan = {**key, "playback": playback}
            plans.update_one(key, {"$setOnInsert": plan}, upsert=True)
            if backup.find_one(key) != original or plans.find_one(key) != plan:
                raise ValueError("source changed during migration preparation")
        marker = {"state": "prepared", "count": len(pending)}
        markers.update_one({"_id": MIGRATION}, {"$set": marker})
    if marker["state"] != "prepared" or any(
        c.count_documents({}) != marker["count"] for c in (puzzles, backup, plans)
    ):
        raise ValueError("migration membership or recovery evidence changed")
    for plan in plans.find({}).sort("_id", 1):
        key = {"_id": plan["_id"]}
        original = backup.find_one(key)
        target = {**original, "playback": plan["playback"]}
        current = puzzles.find_one(key)
        if current != original and current != target:
            raise ValueError(f"Puzzle {plan['_id']} changed during migration")
        if not check:
            puzzles.update_one(key, {"$set": {"playback": plan["playback"]}})
            if interrupt:
                interrupt()
            if puzzles.find_one(key) != target:
                raise ValueError("playback migration preservation verification failed")
    if not check:
        markers.update_one({"_id": MIGRATION}, {"$set": {"state": "complete"}})
    return {"puzzles": marker["count"], "verified": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export-catalog", type=Path)
    parser.add_argument("--payload", type=Path, required=True)
    parser.add_argument("--uri", default="mongodb://mongo:27017/?directConnection=true")
    parser.add_argument("--database", default="lichess")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.export_catalog:
        print(export(args.export_catalog, args.payload))
        return
    from pymongo import MongoClient
    from pymongo.write_concern import WriteConcern

    with MongoClient(args.uri, serverSelectionTimeoutMS=10000) as client:
        db = client.get_database(
            args.database, write_concern=WriteConcern(w="majority", j=True)
        )
        print(
            migrate(
                db,
                json.loads(args.payload.read_text(encoding="utf-8")),
                check=args.check,
            )
        )


if __name__ == "__main__":
    main()
