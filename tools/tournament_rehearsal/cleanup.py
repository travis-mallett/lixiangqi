"""Operator-only, recoverable cleanup. No gameplay or provisioning occurs here.

Stop application/websocket/worker writers before --apply or --restore. Dry-run is
the default. The manifest lists exact identities, never a prefix to delete.
"""

import argparse
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from itertools import combinations
import json
import os
from pathlib import Path
import re

from bson import BSON, decode_all, json_util
from pymongo import MongoClient


def identity(manifest):
    if manifest.get("schema") != 1 or manifest.get("durationMinutes") != 20:
        raise ValueError("Unrecognized rehearsal manifest")
    run = manifest["runId"]
    if not re.fullmatch(r"[a-z0-9]{10,16}", run):
        raise ValueError("Invalid run identity")
    expected = [f"tq{run}{i:02}" for i in range(1, 11)]
    names = [a["username"].lower() for a in manifest["accounts"]]
    if names != expected or manifest["tournamentName"] != f"Rehearsal {run}":
        raise ValueError("Manifest identities do not match this run")
    created = datetime.fromisoformat(manifest["createdAt"].replace("Z", "+00:00"))
    if created.tzinfo is None:
        raise ValueError("Missing creation timezone")
    return names, created


def assert_recent(document, field, since):
    value = document.get(field)
    if not isinstance(value, datetime):
        raise ValueError(f"Missing creation date in {document.get('_id')}")
    if value.replace(tzinfo=timezone.utc) < since - timedelta(seconds=60):
        raise ValueError(f"Refusing pre-existing record {document.get('_id')}")


def plan(db, manifest):
    users, created = identity(manifest)
    user_set = set(users)
    for user in db.user4.find({"_id": {"$in": users}}):
        assert_recent(user, "createdAt", created)
        if user.get("username", "").lower() != user["_id"]:
            raise ValueError("Unexpected account identity")
    recorded_tour = manifest.get("tournamentId")
    if recorded_tour and not re.fullmatch(r"[a-zA-Z0-9]{8}", recorded_tour):
        raise ValueError("Invalid recorded tournament ID")
    tours = list(db.tournament2.find({"$or": [
        {"createdBy": {"$in": users}}, {"_id": recorded_tour},
    ]}))
    for tour in tours:
        assert_recent(tour, "createdAt", created)
        if tour["name"] != manifest["tournamentName"] or tour.get("createdBy") not in user_set:
            raise ValueError("Test account owns an unexpected tournament")
    if len(tours) > 1:
        raise ValueError("Ambiguous rehearsal tournament")
    tour_ids = [t["_id"] for t in tours]
    if manifest.get("tournamentId") and tour_ids and tour_ids != [manifest["tournamentId"]]:
        raise ValueError("Tournament ID mismatch")
    # Include the recorded ID on resume after a partly completed cleanup.
    if manifest.get("tournamentId"):
        tour_ids = [manifest["tournamentId"]]
    for player in db.tournament_player.find({"$or": [{"tid": {"$in": tour_ids}}, {"uid": {"$in": users}}]}):
        if player["uid"] not in user_set or player["tid"] not in tour_ids:
            raise ValueError("Rehearsal membership crossed into another tournament or real player")
    recorded_games = [g["gameId"] for g in manifest["games"]]
    if any(not re.fullmatch(r"[a-zA-Z0-9]{8}", game) for game in recorded_games):
        raise ValueError("Invalid recorded game ID")
    games = list(db.game5.find({"$or": [
        {"tid": {"$in": tour_ids}}, {"us": {"$in": users}}, {"_id": {"$in": recorded_games}},
    ]}))
    for game in games:
        assert_recent(game, "ca", created)
        if len(game.get("us", [])) != 2 or not set(game["us"]) <= user_set or game.get("tid") not in tour_ids:
            raise ValueError(f"Refusing to remove game involving an outsider: {game['_id']}")
        if game.get("ra"):
            raise ValueError("Rated game found; review external rating effects before cleanup")
    pairings = list(db.tournament_pairing.find({"tid": {"$in": tour_ids}}))
    for pairing in pairings:
        if len(pairing.get("u", [])) != 2 or not set(pairing["u"]) <= user_set:
            raise ValueError("Pairing includes an outsider")
    # A missing game ID in a manifest is not proof of ownership of its chat or analysis.
    # An interrupted cleanup can always be recovered by restoring the verified archive first.
    game_ids = sorted({g["_id"] for g in games} | {p["_id"] for p in pairings})
    selectors = {
        name: {"_id": {"$in": users}}
        for name in (
            "user4", "user_perf", "history4", "pref", "notify_pref", "analysis_requester",
            "playban", "shutup", "learn_progress", "notation_score",
        )
    }
    selectors.update({
        "game5": {"_id": {"$in": game_ids}},
        "tournament2": {"_id": {"$in": tour_ids}},
        "tournament_player": {"tid": {"$in": tour_ids}},
        "tournament_pairing": {"tid": {"$in": tour_ids}},
        "tournament_leaderboard": {"t": {"$in": tour_ids}},
        "security": {"user": {"$in": users}},
        "modlog": {"user": {"$in": users}},
        "notify": {"notifies": {"$in": users}},
        "oauth2_access_token": {"userId": {"$in": users}},
        "oauth2_authorization": {"userId": {"$in": users}},
        "player_assessment": {"userId": {"$in": users}},
        "push_subscription": {"userId": {"$in": users}},
        "push_device": {"userId": {"$in": users}},
        "push_unifiedpush": {"userId": {"$in": users}},
        "analysis2": {"_id": {"$in": game_ids}},
        "chat": {"_id": {"$in": game_ids + tour_ids}},
        "chat_timeout": {"userId": {"$in": users}},
        "bookmark": {"u": {"$in": users}},
        "note": {"from": {"$in": users}},
        "relation": {"u1": {"$in": users}},
    })
    threads = list(db.msg_thread.find({"users": {"$in": users}}))
    # The normal signup welcome is sent by the system identity. Human conversations
    # are outside this rehearsal and need review rather than deleting shared content.
    if any(not set(thread.get("users", [])) <= user_set | {"lichess"} for thread in threads):
        raise ValueError("Rehearsal account has a conversation with an outsider")
    thread_ids = [thread["_id"] for thread in threads]
    selectors["msg_thread"] = {"_id": {"$in": thread_ids}}
    selectors["msg_msg"] = {"tid": {"$in": thread_ids}}
    for name, separator in (("activity2", ":"), ("perf_stat", "/"), ("ranking", ":")):
        selectors[name] = {"_id": {"$regex": "^(?:" + "|".join(map(re.escape, users)) + ")" + re.escape(separator)}}
    pairs = [f"{a}/{b}" for a, b in combinations(sorted(users), 2)]
    selectors["crosstable2"] = {"_id": {"$in": pairs}}
    selectors["matchup"] = {"_id": {"$in": pairs}}
    selectors["cache"] = {"_id": {"$in": [f"tournament:stats:{t}" for t in tour_ids]}}
    collections = set(db.list_collection_names())
    return {name: list(db[name].find(query)) for name, query in selectors.items() if name in collections}


def archive(directory, database, manifest, documents):
    directory.mkdir(mode=0o700, parents=False, exist_ok=False)
    metadata = {"schema": 1, "database": database, "runId": manifest["runId"], "files": {}}
    for collection, records in documents.items():
        if not records:
            continue
        data = b"".join(BSON.encode(doc) for doc in records)
        path = directory / f"{collection}.bson"
        path.write_bytes(data)
        path.chmod(0o600)
        metadata["files"][path.name] = {"count": len(records), "sha256": sha256(data).hexdigest()}
        if decode_all(path.read_bytes()) != records:
            raise ValueError("Backup round-trip verification failed")
    (directory / "backup.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    (directory / "run.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return metadata


def apply_cleanup(db, documents):
    # Validate the complete plan before the first deletion. A changed document is never silently removed.
    for collection, records in documents.items():
        for doc in records:
            if db[collection].find_one({"_id": doc["_id"]}) != doc:
                raise ValueError("Data changed after backup; stop writers and prepare a new backup")
    for collection, records in documents.items():
        if records:
            ids = [doc["_id"] for doc in records]
            result = db[collection].delete_many({"_id": {"$in": ids}})
            if result.deleted_count != len(ids) or db[collection].count_documents({"_id": {"$in": ids}}):
                raise ValueError(f"Incomplete cleanup of {collection}; retain backup and rerun")


def restore(db, directory):
    metadata = json.loads((directory / "backup.json").read_text(encoding="utf-8"))
    if metadata["database"] != db.name:
        raise ValueError("Restore database does not match backup")
    documents = {}
    for filename, info in metadata["files"].items():
        if not re.fullmatch(r"[a-zA-Z0-9_]+\.bson", filename):
            raise ValueError("Invalid archive path")
        data = (directory / filename).read_bytes()
        if sha256(data).hexdigest() != info["sha256"]:
            raise ValueError("Backup checksum mismatch")
        records = decode_all(data)
        if len(records) != info["count"]:
            raise ValueError("Backup count mismatch")
        collection = filename.removesuffix(".bson")
        documents[collection] = records
        for doc in records:
            current = db[collection].find_one({"_id": doc["_id"]})
            if current is not None and current != doc:
                raise ValueError("Restore would overwrite changed data")
    for collection, records in documents.items():
        for doc in records:
            db[collection].update_one({"_id": doc["_id"]}, {"$setOnInsert": doc}, upsert=True)
            if db[collection].find_one({"_id": doc["_id"]}) != doc:
                raise ValueError("Restore verification failed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--database", required=True)
    parser.add_argument("--backup", type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--quiesced", action="store_true", help="Confirm application, websocket and worker writers are stopped")
    parser.add_argument("--restore", type=Path)
    args = parser.parse_args()
    if (args.apply or args.restore) and not args.quiesced:
        parser.error("Stop writers and pass --quiesced before making changes")
    uri = os.environ.get("LIXIANGQI_REHEARSAL_MONGO_URI")
    if not uri:
        parser.error("Set LIXIANGQI_REHEARSAL_MONGO_URI; do not put credentials on the command line")
    with MongoClient(uri, serverSelectionTimeoutMS=10000) as client:
        db = client[args.database]
        if args.restore:
            restore(db, args.restore)
            print("Backup restored and verified. Restart services to clear caches.")
            return
        if not args.manifest:
            parser.error("--manifest is required")
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        documents = plan(db, manifest)
        counts = {name: len(docs) for name, docs in documents.items() if docs}
        print(json.dumps({"database": db.name, "runId": manifest["runId"], "counts": counts, "dryRun": not args.apply}, indent=2))
        if not args.apply:
            return
        if not args.backup:
            parser.error("--backup must be a new directory for a verified recovery archive")
        archive(args.backup, db.name, manifest, documents)
        apply_cleanup(db, documents)
        remaining = plan(db, manifest)
        if any(remaining.values()):
            raise ValueError("Records remain after cleanup")
        receipt = {"runId": manifest["runId"], "database": db.name, "counts": counts, "verifiedAt": datetime.now(timezone.utc).isoformat()}
        (args.backup / "cleanup-receipt.json").write_text(json_util.dumps(receipt, indent=2), encoding="utf-8")
        print("Cleanup verified. Keep the backup offline; restart services to discard cached identities and games.")


if __name__ == "__main__":
    main()
