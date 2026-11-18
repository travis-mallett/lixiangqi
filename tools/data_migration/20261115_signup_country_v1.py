"""Repair signup's misplaced profile.flag using immutable full-account recovery copies.

The canonical BSON field is profile.country. Stop account writers before --apply.
Default mode is a read-only preview. Recovery copies live in the same durable MongoDB,
outside release directories; never expire them or restore whole accounts over newer data.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json

from pymongo import MongoClient
from pymongo.write_concern import WriteConcern

MIGRATION = "signup_country_v1"
BACKUP = "__signup_country_v1_user4"
SELECTOR = {"profile.flag": {"$exists": True}}


def repaired_profile(profile):
    if not isinstance(profile, dict):
        raise ValueError("Expected a profile document")
    flag = profile.get("flag")
    if not isinstance(flag, str) or not flag or flag.strip() != flag or len(flag) > 64:
        raise ValueError("Invalid misplaced country; no account writes permitted")
    if "country" in profile and profile["country"] is not None:
        country = profile["country"]
        if not isinstance(country, str) or not country or country.strip() != country:
            raise ValueError("Invalid canonical country; inspect before migration")
    result = deepcopy(profile)
    # Existing canonical data is authoritative, including an explicitly cleared value.
    if "country" not in result:
        result["country"] = flag
    del result["flag"]
    return result


def migrate(db, *, apply=False, writers_stopped=False):
    if apply and not writers_stopped:
        raise ValueError("Stop application writers before applying this migration")
    users = db.get_collection("user4", write_concern=WriteConcern(w="majority", j=True))
    backups = db.get_collection(BACKUP, write_concern=WriteConcern(w="majority", j=True))
    state = db.get_collection("schema_migration", write_concern=WriteConcern(w="majority", j=True))
    counts = {"affected": 0, "promoted": 0, "preservedExisting": 0}
    # Validate the entire candidate set before creating backups or changing any account.
    for doc in users.find(SELECTOR, {"profile": 1}):
        repaired_profile(doc["profile"])
        counts["affected"] += 1
        counts["preservedExisting" if "country" in doc["profile"] else "promoted"] += 1
    if not apply:
        return dict(counts, mode="preview")
    previous = state.find_one({"_id": MIGRATION})
    if previous and previous.get("completedAt"):
        if counts["affected"]:
            raise ValueError("Misplaced countries reappeared after completion; check for an obsolete signup writer")
        return dict(counts, mode="already-current")

    # All original account documents must be durable and reread successfully before
    # the first account update. Retries never replace an original recovery copy.
    for doc in users.find(SELECTOR):
        backups.update_one(
            {"_id": doc["_id"]},
            {"$setOnInsert": {"original": doc, "savedAt": datetime.now(timezone.utc), "migration": MIGRATION}},
            upsert=True,
        )
        saved = backups.find_one({"_id": doc["_id"]})
        if not saved or saved.get("original") != doc or saved.get("migration") != MIGRATION:
            raise ValueError("Recovery copy differs from source; stop and investigate before applying")

    updated = 0
    for doc in users.find(SELECTOR):
        result = users.update_one(
            {"_id": doc["_id"], "profile": {"$eq": doc["profile"]}},
            {"$set": {"profile": repaired_profile(doc["profile"]) }},
        )
        if result.modified_count != 1:
            raise ValueError("Profile changed during migration; writers must remain stopped")
        updated += 1

    # Verify complete documents, including credentials/settings, against originals.
    verified = 0
    for saved in backups.find({}):
        expected = deepcopy(saved["original"])
        expected["profile"] = repaired_profile(expected["profile"])
        if users.find_one({"_id": expected["_id"]}) != expected:
            raise ValueError("Migrated account differs from its expected recovery copy")
        verified += 1
    if users.count_documents(SELECTOR):
        raise ValueError("Misplaced countries remain; writers must remain stopped")
    state.update_one(
        {"_id": MIGRATION},
        {"$set": {"completedAt": datetime.now(timezone.utc), "backupCollection": BACKUP, "verified": verified}},
        upsert=True,
    )
    return dict(counts, mode="applied", updated=updated, verified=verified, backupCollection=BACKUP)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mongo-uri", required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--writers-stopped", action="store_true")
    args = parser.parse_args()
    with MongoClient(args.mongo_uri, serverSelectionTimeoutMS=10000) as client:
        print(json.dumps(migrate(client.get_default_database(), apply=args.apply, writers_stopped=args.writers_stopped)))


if __name__ == "__main__":
    main()
