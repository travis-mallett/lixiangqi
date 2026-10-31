"""Forward repair of the UTC job-key defect; retain the original converter/backup.

Run with application writers stopped, under the deployment lock. This helper
imports the installed migrate.py so its original code-hash check remains intact.
It never changes the frozen manifest, account documents, or source events.
"""

import argparse
from datetime import timezone
from pathlib import Path

from bson import BSON
from pymongo import MongoClient
from pymongo.read_concern import ReadConcern
from pymongo.write_concern import WriteConcern

import migrate


def repair(client, backup, journal):
    manifest = migrate.load_backup(backup)
    marker_collection = client[migrate.MAIN][migrate.MARKERS]
    marker = marker_collection.find_one({"_id": migrate.MIGRATION})
    manifest_hash = migrate.file_hash(backup / "manifest.json")
    if not marker or marker.get("manifestHash") != manifest_hash:
        raise ValueError("Migration/backup mismatch")
    if marker.get("rebuildKeyRepair"):
        if not journal.exists() or marker["rebuildKeyRepair"]["journalHash"] != migrate.file_hash(journal):
            raise ValueError("Repair journal mismatch")
        for row in migrate.read_bson(journal):
            if client[migrate.TRAFFIC].traffic_rebuild.find_one({"_id": row["before"]["_id"]}):
                raise ValueError("Malformed job reappeared after repair")
        return "already repaired"
    if marker.get("state") != "awaitingAnalytics":
        raise ValueError("Expected verified account awaiting analytics")
    if client.admin.command("hello").get("setName") != "lixiangqi":
        raise ValueError("Unexpected replica set")
    rows = []
    jobs = client[migrate.TRAFFIC].traffic_rebuild
    for month in manifest["audit"]["analyticsMonths"]:
        # Old installed converter decodes Extended JSON as naive UTC.
        utc = month.replace(tzinfo=timezone.utc) if month.tzinfo is None else month.astimezone(timezone.utc)
        new_key = utc.strftime("%Y-%m-%dT%H:%M:%SZ")
        old_key = new_key[:-1]
        before = jobs.find_one({"_id": old_key})
        expected = {"_id": old_key, "month": month, "phase": "clear", "cutoff": manifest["capturedAt"]}
        if before is None or migrate.fingerprint(before) != migrate.fingerprint(expected):
            raise ValueError("Expected untouched malformed clear-stage job")
        if jobs.find_one({"_id": new_key}):
            raise ValueError("Correctly keyed job already exists; inspect before merging")
        rows.append({"before": before, "after": {**before, "_id": new_key}})
    if not rows:
        raise ValueError("No affected months")
    if journal.exists():
        if [BSON.encode(row) for row in migrate.read_bson(journal)] != [BSON.encode(row) for row in rows]:
            raise ValueError("Existing repair journal does not match the frozen repair")
    else:
        migrate.write_bson(journal, rows)
        # Make the new directory entry durable as well as the BSON contents.
        import os
        if os.name != "nt":
            fd = os.open(journal.parent, os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
    journal_hash = migrate.file_hash(journal)

    def transaction(session):
        current_marker = marker_collection.find_one({"_id": migrate.MIGRATION}, session=session)
        if current_marker != marker:
            raise ValueError("Migration marker changed during repair")
        for row in rows:
            current = jobs.find_one({"_id": row["before"]["_id"]}, session=session)
            if current is None or migrate.fingerprint(current) != migrate.fingerprint(row["before"]):
                raise ValueError("Job changed during repair")
            jobs.insert_one(row["after"], session=session)
            jobs.delete_one({"_id": row["before"]["_id"]}, session=session)
        marker_collection.update_one(
            {"_id": migrate.MIGRATION},
            {"$set": {"rebuildKeyRepair": {"journalHash": journal_hash, "at": migrate.now()}}},
            session=session,
        )

    with client.start_session() as session:
        session.with_transaction(
            transaction, read_concern=ReadConcern("snapshot"),
            write_concern=WriteConcern("majority", j=True),
        )
    for row in rows:
        if jobs.find_one({"_id": row["before"]["_id"]}):
            raise ValueError("Old job key remains")
        if migrate.fingerprint(jobs.find_one({"_id": row["after"]["_id"]})) != migrate.fingerprint(row["after"]):
            raise ValueError("Repaired job verification failed")
    return f"Repaired {len(rows)} job IDs; original backup and converter unchanged"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup", type=Path, required=True)
    parser.add_argument("--journal", type=Path, required=True)
    parser.add_argument("--writers-stopped", action="store_true", required=True)
    args = parser.parse_args()
    with MongoClient(
        "mongodb://mongo:27017", appname="account-rename-rebuild-key-repair",
        tz_aware=True, serverSelectionTimeoutMS=10000, w="majority", journal=True,
    ) as client:
        print(repair(client, args.backup, args.journal))
