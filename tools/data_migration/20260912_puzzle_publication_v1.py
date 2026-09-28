"""Add publication metadata from live sources, without replacing published content.

Run only with application writers stopped. --check is read-only. The immutable
Mongo backup and per-record plans survive interruption and are never overwritten.
The conversion is additive: old code can read the result during code rollback.
"""

import argparse
import copy
from datetime import datetime, timezone
from pathlib import Path

from tools.puzzle_catalog.catalog import PUZZLE_KEYS, catalog_source, validate_puzzle

MIGRATION = "puzzle-publication-v1"
BACKUP = "__lixiangqi_puzzle_publication_v1_backup"
PLANS = "__lixiangqi_puzzle_publication_v1_plans"


def additions(original, catalog, native_game, origin):
    target = copy.deepcopy(original)
    source = target.setdefault("gameSource", {"type": "native", "origin": origin})
    if source.get("type") == "native":
        source.setdefault("origin", origin)
    if target.get("sourceSnapshot") is None:
        if source.get("type") == "catalog":
            wal = Path(str(catalog) + "-wal")
            if wal.exists() and wal.stat().st_size:
                raise ValueError(
                    "catalog WAL must be checkpointed with writers stopped"
                )
            target["sourceSnapshot"] = catalog_source(
                catalog, target["gameId"], source["database"], immutable=True
            )
        elif source.get("type") == "native":
            game = native_game(target["gameId"])
            if not game or game.get("xv") != 1 or not isinstance(game.get("xg"), dict):
                raise ValueError("missing canonical native source")
            target["sourceSnapshot"] = {
                "initialFen": game["xg"]["initialFen"],
                "moves": game["xg"]["moves"],
                "players": [
                    {"color": color, **({"userId": uid} if uid else {})}
                    for color, uid in zip(("red", "black"), game.get("us", []))
                ],
                "rated": game.get("ra") is True,
            }
        else:
            raise ValueError("unknown puzzle source")
    target.setdefault("retired", False)
    target.setdefault(
        "retirementReason",
        "Retired before publication migration" if target["retired"] else None,
    )
    target.setdefault("managedThemes", list(target["themes"]))
    target.setdefault(
        "communityThemes",
        [t for t in target["themes"] if t not in target["managedThemes"]],
    )
    if set(target["themes"]) != set(target["managedThemes"]) | set(
        target["communityThemes"]
    ):
        raise ValueError("theme ownership does not preserve effective themes")
    authored = {k: target[k] for k in PUZZLE_KEYS if k in target}
    authored["themes"] = target["managedThemes"]
    validate_puzzle(authored)
    # Identity, ratings, counters, votes, dates and all unknown fields stay intact.
    return {k: v for k, v in target.items() if k not in original or v != original[k]}


def migrate(db, catalog, origin, *, check=False, interrupt=None):
    puzzles = db.puzzle2_puzzle
    markers = db.get_collection("__lixiangqi_migrations")
    backup = db.get_collection(BACKUP)
    plans = db.get_collection(PLANS)
    control = db.puzzle2_publication.find_one({"_id": "control"})
    if control and control.get("operation"):
        raise ValueError("pending publication must recover before migration")
    marker = markers.find_one({"_id": MIGRATION})
    if marker and marker.get("state") not in {"preparing", "prepared", "complete"}:
        raise ValueError("unknown puzzle migration state")
    if marker and marker["state"] in {"prepared", "complete"}:
        count = marker["count"]
        if backup.count_documents({}) != count or plans.count_documents({}) != count:
            raise ValueError("puzzle migration recovery evidence is missing")
    if not marker or marker["state"] == "preparing":
        pending = []
        for original in puzzles.find({}).sort("_id", 1):
            try:
                fields = additions(
                    original,
                    catalog,
                    lambda gid: db.game5.find_one({"_id": gid}),
                    origin,
                )
            except Exception as error:
                raise ValueError(f"Puzzle {original['_id']}: {error}") from error
            pending.append((original, fields))
        if check:
            return {
                "puzzles": len(pending),
                "requiresMigration": sum(bool(f) for _, f in pending),
            }
        if not marker:
            if backup.count_documents({}) or plans.count_documents({}):
                raise ValueError(
                    "unrecognized puzzle recovery evidence; refusing overwrite"
                )
            markers.insert_one({"_id": MIGRATION, "state": "preparing"})
        # No live records are changed before every original and plan is durable.
        for original, fields in pending:
            key = {"_id": original["_id"]}
            backup.update_one(key, {"$setOnInsert": original}, upsert=True)
            plans.update_one(
                key, {"$setOnInsert": {**key, "fields": fields}}, upsert=True
            )
            if (
                backup.find_one(key) != original
                or plans.find_one(key)["fields"] != fields
            ):
                raise ValueError(
                    "source changed during interrupted backup; recovery required"
                )
        count = len(pending)
        if backup.count_documents({}) != count or plans.count_documents({}) != count:
            raise ValueError("backup membership differs from live inventory")
        markers.update_one(
            {"_id": MIGRATION}, {"$set": {"state": "prepared", "count": count}}
        )
        marker = {"state": "prepared", "count": count}
    if marker["state"] == "complete":
        # Later publications are authoritative; never replay the bootstrap plans.
        # Avoid transferring and parsing every historical source snapshot on
        # each future deployment; publication owns full content validation.
        invalid = puzzles.find_one(
            {
                "$or": [
                    {key: {"$not": {"$type": kind}}}
                    for key, kind in (
                        ("sourceSnapshot", "object"),
                        ("gameSource", "object"),
                        ("retired", "bool"),
                        ("managedThemes", "array"),
                        ("communityThemes", "array"),
                    )
                ]
            },
            {"_id": 1},
        )
        if invalid:
            raise ValueError("completed migration has incompatible new puzzle records")
        return {"puzzles": puzzles.estimated_document_count(), "alreadyApplied": True}
    if puzzles.count_documents({}) != marker["count"]:
        raise ValueError("puzzle membership changed during migration")
    for plan in plans.find({}).sort("_id", 1):
        key = {"_id": plan["_id"]}
        original = backup.find_one(key)
        target = {**original, **plan["fields"]}
        current = puzzles.find_one(key)
        if current != original and current != target:
            raise ValueError(
                f"Puzzle {plan['_id']} changed during migration; recovery required"
            )
        if not check and current != target:
            if puzzles.update_one(key, {"$set": plan["fields"]}).matched_count != 1:
                raise ValueError("puzzle disappeared during migration")
            if interrupt:
                interrupt()
        if not check and puzzles.find_one(key) != target:
            raise ValueError("puzzle preservation verification failed")
    if not check:
        markers.update_one(
            {"_id": MIGRATION},
            {"$set": {"state": "complete", "appliedAt": datetime.now(timezone.utc)}},
        )
    return {"puzzles": marker["count"], "verified": True, "check": check}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uri", default="mongodb://mongo:27017/?directConnection=true")
    parser.add_argument("--database", default="lichess")
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    from pymongo import MongoClient
    from pymongo.write_concern import WriteConcern

    with MongoClient(args.uri, serverSelectionTimeoutMS=10000) as client:
        db = client.get_database(
            args.database, write_concern=WriteConcern(w="majority", j=True)
        )
        print(migrate(db, args.catalog, args.origin, check=args.check))


if __name__ == "__main__":
    main()
