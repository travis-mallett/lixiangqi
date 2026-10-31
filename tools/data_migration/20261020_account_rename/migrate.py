"""Audit by default; prepare/apply require a stopped-writer maintenance gate.

No production access is implicit. URI and traffic key come from the execution
environment. Originals and the frozen plan live outside disposable releases.
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import hmac
import base64
import json
import os
from pathlib import Path
import sys
import uuid

from bson import BSON, decode_file_iter, json_util
from pymongo import MongoClient, IndexModel

from rules import IDENTITY, MIGRATION, Identity, archived, occurrences, transform, unexplained

MAIN = "lichess"
TRAFFIC = "lixiangqi_traffic"
MARKERS = "__lixiangqi_migrations"
PURE = {"puzzle2_path"}  # Shared puzzle-ID paths, never account-owned; >1M live documents.


class AnalyticsPending(Exception):
    pass


def now():
    return datetime.now(timezone.utc)


def fingerprint(doc):
    return hashlib.sha256(BSON.encode(doc)).hexdigest()


def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def code_hash():
    digest = hashlib.sha256()
    for name in ("rules.py", "migrate.py"):
        digest.update(Path(__file__).with_name(name).read_bytes())
    return digest.hexdigest()


def durable_json(path, data):
    temporary = path.with_suffix(path.suffix + ".partial")
    with temporary.open("wb") as stream:
        stream.write(json_util.dumps(data, indent=2).encode())
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    if os.name != "nt":
        fd = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def read_bson(path):
    with path.open("rb") as stream:
        yield from decode_file_iter(stream)


def write_bson(path, rows):
    with path.open("xb") as stream:
        for row in rows:
            stream.write(BSON.encode(row))
        stream.flush()
        os.fsync(stream.fileno())


def identities(key):
    if len(key) < 32:
        raise ValueError("Missing/invalid traffic identity key")
    def identity(kind, value):
        return base64.urlsafe_b64encode(
            hmac.new(key.encode(), f"{kind}:{value}".encode(), hashlib.sha256).digest()
        ).decode().rstrip("=")
    return {
        "old": identity("account", IDENTITY.old),
        "new": identity("account", IDENTITY.new),
        "registrationOld": identity("domain-event", f"registration/{IDENTITY.old}"),
        "registrationNew": identity("domain-event", f"registration/{IDENTITY.new}"),
        "check": identity("key-check", "traffic-v1"),
    }


def metadata(db, name):
    info = next(db.list_collections(filter={"name": name}))
    if info["type"] != "collection":
        raise ValueError(f"Unsupported collection type: {db.name}.{name}")
    return {"options": info.get("options", {}), "indexes": list(db[name].list_indexes())}


def traffic_transform(name, original, hashes):
    doc = dict(original)
    old, new = hashes["old"], hashes["new"]
    if name in {"traffic_event", "traffic_attempt", "traffic_browser", "traffic_subject_day"}:
        if doc.get("subject") == old:
            doc["subject"] = new
    if name in {"traffic_subject", "traffic_erasure"} and doc["_id"] == old:
        doc["_id"] = new
    if name in {"traffic_subject_day", "traffic_browser"} and doc["_id"].startswith(old + "/"):
        doc["_id"] = new + doc["_id"][len(old):]
    if name == "traffic_event" and doc["_id"] == hashes["registrationOld"]:
        if original.get("subject") != old or original.get("kind") != "user.registered":
            raise ValueError("Registration event identity does not match account")
        doc["_id"] = hashes["registrationNew"]
    return doc


def month_start(at):
    return at.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def instant_string(at):
    if at.tzinfo is None or at.utcoffset() is None:
        raise ValueError("Analytics job month must be timezone-aware")
    return at.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def preconditions(client, hashes):
    main, traffic = client[MAIN], client[TRAFFIC]
    if client.admin.command("hello").get("setName") != "lixiangqi":
        raise ValueError("Expected lixiangqi replica set")
    user = main.user4.find_one({"_id": IDENTITY.old})
    if not user or user.get("enabled") is not True:
        raise ValueError("Expected enabled source account")
    if main.user4.find_one({"_id": IDENTITY.new}):
        raise ValueError("Destination account exists; never merge accounts")
    if main.game5.find_one({"pl": IDENTITY.old}):
        raise ValueError("Finish all active games before the identity change")
    if main.puzzle2_publication.find_one({"status": {"$in": ["submitted", "applying"]}}):
        raise ValueError("Puzzle publications must finish before source snapshots change")
    official = main[MARKERS].find_one({"_id": "official-blogs-v1", "state": "complete"})
    if not official or "ROLE_PUBLISH_OFFICIAL_BLOG" not in user.get("roles", []):
        raise ValueError("Official-blog provisioning/permission prerequisite is missing")
    if main[MARKERS].find_one({"_id": MIGRATION}):
        raise ValueError("Migration marker exists; use the original backup to resume or verify")
    if traffic.traffic_state.find_one({"_id": "identity", "check": hashes["check"]}) is None:
        raise ValueError("Traffic key does not match persisted identity check")
    if traffic.traffic_rebuild.count_documents({}) or traffic.traffic_erasure.count_documents({"complete": False}):
        raise ValueError("Existing analytics maintenance must finish first")
    snapshot = traffic.traffic_state.find_one({"_id": "snapshot"})
    if snapshot and not snapshot.get("complete"):
        raise ValueError("Account census must finish before renaming a sort key")
    if traffic.traffic_event.find_one({"_id": hashes["registrationNew"]}):
        raise ValueError("Destination registration event exists")


def census(client, hashes):
    """Same converter drives preview and apply. Unrecognized old/target references block."""
    preconditions(client, hashes)
    changes, report, errors, months = [], [], [], set()
    reverse = Identity(IDENTITY.new, "__rename_collision__", "__rename_collision__")
    for dbname in (MAIN, TRAFFIC):
        db = client[dbname]
        for name in sorted(db.list_collection_names()):
            print(f"Inspecting {dbname}.{name}", file=sys.stderr, flush=True)
            row = {"database": dbname, "collection": name, "changes": 0, "retainedPaths": {}}
            if dbname == MAIN and (archived(name) or name in PURE):
                row["disposition"] = "immutable history" if archived(name) else "shared puzzle paths"
                row["documents"] = db[name].estimated_document_count()
                report.append(row)
                continue
            retained = Counter()
            row["documents"] = 0
            for original in db[name].find(batch_size=200):
                row["documents"] += 1
                if dbname == MAIN:
                    if transform(name, original, reverse) != original:
                        errors.append(f"Existing destination identity at {dbname}.{name}")
                    updated = transform(name, original)
                    unknown = set(unexplained(name, updated))
                    if unknown:
                        errors.extend(f"Unclassified reference: {dbname}.{name}.{p}" for p in unknown)
                    retained.update(occurrences(updated))
                else:
                    updated = traffic_transform(name, original, hashes)
                    for path in occurrences(updated, hashes["old"]):
                        errors.append(f"Unclassified hashed identity: {name}.{path}")
                    if any(occurrences(original, hashes["new"])):
                        errors.append(f"Existing destination traffic identity: {name}")
                    if name == "traffic_event" and original.get("subject") == hashes["old"]:
                        months.add(month_start(original["at"]))
                    # A completed census cursor is historical, not an account reference.
                    plain = set(occurrences(updated)) - (
                        {"cursor"} if name == "traffic_state" and original.get("complete") else set()
                    )
                    errors.extend(f"Unclassified traffic text identity: {name}.{p}" for p in plain)
                if updated != original:
                    if updated["_id"] != original["_id"] and db[name].find_one({"_id": updated["_id"]}):
                        errors.append(f"Destination document key already exists: {dbname}.{name}")
                    changes.append({"database": dbname, "collection": name, "before": original, "after": updated})
                    row["changes"] += 1
                if len(changes) > 100_000:
                    raise ValueError("One-account migration exceeds the reviewed size bound")
            row["retainedPaths"] = dict(retained)
            report.append(row)
    # Freeze all modifications before the first write; distinct source records must
    # never converge on the same destination key.
    keys = set()
    for change in changes:
        key = (change["database"], change["collection"], BSON.encode({"_id": change["after"]["_id"]}))
        if key in keys:
            errors.append("Multiple source documents converge on a destination key")
        keys.add(key)
    result = {
        "migration": MIGRATION, "capturedAt": now(), "onlineObservation": True,
        "collections": report, "totalChanges": len(changes),
        "analyticsMonths": sorted(months), "errors": sorted(set(errors)),
    }
    return changes, result


def restore_rehearsal(client, backup, manifest):
    """Restore originals, options and indexes to isolated scratch DBs and compare BSON."""
    names = {MAIN: "rename_restore_" + uuid.uuid4().hex, TRAFFIC: "rename_restore_" + uuid.uuid4().hex}
    try:
        for source, collections in manifest["metadata"].items():
            target = client[names[source]]
            for name, meta in collections.items():
                target.create_collection(name, **meta["options"])
        for change in read_bson(backup / "changes.bson"):
            if change["database"] == MAIN:
                client[names[MAIN]][change["collection"]].insert_one(change["before"])
        for row in read_bson(backup / "traffic.bson"):
            client[names[TRAFFIC]][row["collection"]].insert_one(row["document"])
        for source, collections in manifest["metadata"].items():
            for name, meta in collections.items():
                coll = client[names[source]][name]
                for spec in meta["indexes"]:
                    if spec["name"] != "_id_":
                        options = {k: v for k, v in spec.items() if k not in {"key", "v", "ns"}}
                        coll.create_indexes([IndexModel(list(spec["key"].items()), **options)])
        for change in read_bson(backup / "changes.bson"):
            if change["database"] == MAIN:
                doc = client[names[MAIN]][change["collection"]].find_one({"_id": change["before"]["_id"]})
                if fingerprint(doc) != fingerprint(change["before"]):
                    raise ValueError("Main backup restoration differs from original BSON")
        for row in read_bson(backup / "traffic.bson"):
            doc = client[names[TRAFFIC]][row["collection"]].find_one({"_id": row["document"]["_id"]})
            if fingerprint(doc) != fingerprint(row["document"]):
                raise ValueError("Traffic backup restoration differs from original BSON")
    finally:
        for name in names.values():
            client.drop_database(name)


def prepare(client, hashes, backup):
    if backup.exists():
        raise ValueError("Backup directory already exists; never replace originals")
    changes, report = census(client, hashes)
    if report["errors"]:
        raise ValueError("Audit has unresolved references; inspect the audit report")
    backup.mkdir(mode=0o700, parents=True)
    write_bson(backup / "changes.bson", changes)
    # Rebuilds touch other users' aggregate rows: protect the entire analytics DB.
    def traffic_rows():
        for name in sorted(client[TRAFFIC].list_collection_names()):
            for doc in client[TRAFFIC][name].find(batch_size=200):
                yield {"collection": name, "document": doc}
    write_bson(backup / "traffic.bson", traffic_rows())
    meta = {
        MAIN: {name: metadata(client[MAIN], name) for name in sorted(
            {c["collection"] for c in changes if c["database"] == MAIN}
        )},
        TRAFFIC: {name: metadata(client[TRAFFIC], name) for name in sorted(client[TRAFFIC].list_collection_names())},
    }
    manifest = {
        "migration": MIGRATION, "codeHash": code_hash(), "capturedAt": now(),
        "hashes": hashes, "metadata": meta, "audit": report,
        "files": {name: file_hash(backup / name) for name in ("changes.bson", "traffic.bson")},
    }
    restore_rehearsal(client, backup, manifest)
    manifest["restoreVerified"] = True
    manifest["audit"]["onlineObservation"] = False
    durable_json(backup / "manifest.json", manifest)
    return manifest


def load_backup(backup):
    manifest = json_util.loads(
        (backup / "manifest.json").read_text(),
        json_options=json_util.JSONOptions(tz_aware=True, tzinfo=timezone.utc),
    )
    if manifest["migration"] != MIGRATION or manifest["codeHash"] != code_hash() or not manifest["restoreVerified"]:
        raise ValueError("Backup provenance, code hash, or restore verification mismatch")
    for name, digest in manifest["files"].items():
        if file_hash(backup / name) != digest:
            raise ValueError("Original backup checksum mismatch")
    return manifest


def apply_change(client, change):
    coll = client[change["database"]][change["collection"]]
    before, after = change["before"], change["after"]
    current = coll.find_one({"_id": before["_id"]})
    target = coll.find_one({"_id": after["_id"]})
    if target is not None and fingerprint(target) == fingerprint(after):
        if before["_id"] != after["_id"] and current is not None:
            raise ValueError("Both source and destination exist")
        return
    if before["_id"] != after["_id"] and target is not None:
        raise ValueError("Destination key conflict")
    if current is not None and fingerprint(current) != fingerprint(before):
        raise ValueError("Source changed since frozen backup; writers must stay stopped")
    if before["_id"] == after["_id"]:
        if current is None:
            raise ValueError("Non-rekeyed source disappeared")
        coll.replace_one({"_id": before["_id"]}, after)
    else:
        # Mongo unique externalLogins entries may not be reused inside the same
        # transaction. Durable originals plus maintenance gating make this pair
        # recoverable even if the process stops after delete and before insert.
        if current is not None:
            coll.delete_one({"_id": before["_id"]})
        coll.insert_one(after)
    if fingerprint(coll.find_one({"_id": after["_id"]})) != fingerprint(after):
        raise ValueError("Read-after-write verification failed")


def apply(client, backup):
    manifest = load_backup(backup)
    markers = client[MAIN][MARKERS]
    marker = markers.find_one({"_id": MIGRATION})
    digest = file_hash(backup / "manifest.json")
    if marker and marker.get("manifestHash") != digest:
        raise ValueError("A different backup owns this migration")
    if marker and marker["state"] in {"complete", "awaitingAnalytics"}:
        return marker["state"]
    if not marker:
        # Validate every source again before any source write.
        for change in read_bson(backup / "changes.bson"):
            current = client[change["database"]][change["collection"]].find_one({"_id": change["before"]["_id"]})
            if current is None or fingerprint(current) != fingerprint(change["before"]):
                raise ValueError("Source changed after backup")
        markers.insert_one({"_id": MIGRATION, "state": "applying", "manifestHash": digest, "startedAt": now()})
    for change in read_bson(backup / "changes.bson"):
        apply_change(client, change)
    verify_documents(client, backup)
    cutoff = manifest["capturedAt"]
    for month in manifest["audit"]["analyticsMonths"]:
        job = {"_id": instant_string(month), "month": month, "phase": "clear", "cutoff": cutoff}
        coll = client[TRAFFIC].traffic_rebuild
        existing = coll.find_one({"_id": job["_id"]})
        if existing is not None and existing != job:
            raise ValueError("Unrelated or already-running analytics rebuild")
        coll.replace_one({"_id": job["_id"]}, job, upsert=True)
    markers.update_one({"_id": MIGRATION}, {"$set": {"state": "awaitingAnalytics", "accountVerifiedAt": now()}})
    return "awaitingAnalytics"


def verify_documents(client, backup):
    for change in read_bson(backup / "changes.bson"):
        coll = client[change["database"]][change["collection"]]
        doc = coll.find_one({"_id": change["after"]["_id"]})
        if doc is None or fingerprint(doc) != fingerprint(change["after"]):
            raise ValueError(f"Target preservation check failed: {change['collection']}")
        if change["before"]["_id"] != change["after"]["_id"] and coll.find_one({"_id": change["before"]["_id"]}):
            raise ValueError("Old source key remains")


def verify_references(client, hashes):
    for dbname in (MAIN, TRAFFIC):
        for name in client[dbname].list_collection_names():
            if dbname == MAIN and (archived(name) or name in PURE):
                continue
            for doc in client[dbname][name].find(batch_size=200):
                if dbname == MAIN and (transform(name, doc) != doc or list(unexplained(name, doc))):
                    raise ValueError(f"Unresolved source reference in {dbname}.{name}")
                if dbname == TRAFFIC and list(occurrences(doc, hashes["old"])):
                    raise ValueError(f"Unresolved source hash in {name}")


def finish(client, backup):
    """Called after the existing traffic worker drains its protected rebuild queue."""
    manifest = load_backup(backup)
    marker = client[MAIN][MARKERS].find_one({"_id": MIGRATION})
    if not marker or marker.get("manifestHash") != file_hash(backup / "manifest.json"):
        raise ValueError("Migration/backup identity mismatch")
    if marker["state"] == "complete":
        return "complete"
    if marker["state"] != "awaitingAnalytics":
        raise ValueError("Account conversion is incomplete")
    traffic = client[TRAFFIC]
    if traffic.traffic_rebuild.count_documents({}):
        raise AnalyticsPending("Analytics rebuild still pending")
    h = manifest["hashes"]
    for name in ("traffic_event", "traffic_attempt", "traffic_browser", "traffic_subject_day"):
        if traffic[name].find_one({"subject": h["old"]}):
            raise ValueError("Old analytics subject remains")
    if traffic.traffic_subject.find_one({"_id": h["old"]}):
        raise ValueError("Old analytics account remains")
    if client[MAIN].user4.find_one({"_id": IDENTITY.old}) or not client[MAIN].user4.find_one(
        {"_id": IDENTITY.new, "username": IDENTITY.display}
    ):
        raise ValueError("Final account identity mismatch")
    # Independently reconcile the worker's monthly all-dimension event counts.
    # Count only processed source events: pending normal ingestion is not a loss.
    for month in manifest["audit"]["analyticsMonths"]:
        end = month.replace(year=month.year + 1, month=1) if month.month == 12 else month.replace(month=month.month + 1)
        expected = Counter()
        for event in traffic.traffic_event.find(
            {"at": {"$gte": month, "$lt": end}, "processed": True},
            {"kind": 1, "registered": 1},
        ):
            expected[(event["registered"], event["kind"].startswith("game."), event["kind"].replace(".", "_"))] += 1
        rows = list(traffic.traffic_rollup.find({"grain": "month", "at": month, "dimension": "all", "key": "all"}))
        for (registered, global_event, metric), count in expected.items():
            found = [r for r in rows if r["registered"] == registered and r.get("global", False) == global_event]
            if len(found) != 1 or found[0].get("counts", {}).get(metric) != count:
                raise ValueError("Rebuilt analytics do not reconcile with processed source events")
    # Normal writers can update counters after activation; byte-for-byte checks
    # belong to the stopped-writer phase, not this completion phase.
    client[MAIN][MARKERS].update_one({"_id": MIGRATION}, {"$set": {"state": "complete", "completedAt": now()}})
    return "complete"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("audit", "prepare", "apply", "verify", "finish"), nargs="?", default="audit")
    parser.add_argument("--uri", default=os.environ.get("RENAME_MONGODB_URI", "mongodb://mongo:27017"))
    parser.add_argument("--backup", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--writers-stopped", action="store_true")
    args = parser.parse_args()
    if args.mode in {"prepare", "apply", "verify"} and not args.writers_stopped:
        parser.error("This mode requires --writers-stopped and the deployment maintenance gate")
    if args.mode != "audit" and args.backup is None:
        parser.error("--backup is required")
    client = MongoClient(
        args.uri, appname="account-rename-" + args.mode, tz_aware=True,
        serverSelectionTimeoutMS=10000, w="majority", journal=True,
    )
    try:
        if args.mode in {"audit", "prepare"}:
            hashes = identities(os.environ.get("LIXIANGQI_TRAFFIC_IDENTITY_KEY") or os.environ.get("PLAY_SECRET", ""))
        if args.mode == "audit":
            _, report = census(client, hashes)
            if args.output:
                durable_json(args.output, report)
            else:
                print(json_util.dumps(report))
            return 1 if report["errors"] else 0
        if args.mode == "prepare":
            manifest = prepare(client, hashes, args.backup)
            print(json.dumps({"prepared": manifest["audit"]["totalChanges"], "restoreVerified": True}))
        elif args.mode == "apply":
            print(apply(client, args.backup))
        elif args.mode == "verify":
            manifest = load_backup(args.backup)
            verify_documents(client, args.backup)
            verify_references(client, manifest["hashes"])
            print("Account documents verified")
        else:
            print(finish(client, args.backup))
        return 0
    except AnalyticsPending as error:
        print(str(error), file=sys.stderr)
        return 2
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
