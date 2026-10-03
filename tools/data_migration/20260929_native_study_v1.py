"""One-time native study reset, run by push-local-live with every writer stopped.

The immutable manifest freezes IDs before any deletion. BSON backups contain full
documents, collection options and indexes; verification restores into a disposable
database and checks every document and index before permitting destructive work.
An interrupted reset resumes from that manifest, never from the remaining data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import uuid

from bson import BSON, decode_file_iter, json_util
from pymongo import MongoClient, IndexModel
from pymongo.write_concern import WriteConcern

MIGRATION = "native-study-v1"
MARKERS = "schema_migration"
OWNED = (
    "study", "study_chapter_flat", "study_topic", "relay", "relay_tour",
    "relay_group", "relay_stats", "relay_delay", "eval_cache2",
    "study_chapter", "study_chapter_backup", "study_chapter_castling_diagnostic",
    "fide_player", "fide_player_rating", "fide_federation", "fide_player_follower",
)
PRESERVED_DIRECTORY = ("directory_player", "directory_player_rating", "directory_federation", "directory_player_follower")
RETIRED = ("study_chapter", "study_chapter_backup", "study_chapter_castling_diagnostic",
           "fide_player", "fide_player_rating", "fide_federation", "fide_player_follower")


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def durable_write(path, data):
    temporary = path.with_suffix(path.suffix + ".partial")
    with temporary.open("wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    durable_rename(temporary, path)


def durable_rename(temporary, path):
    os.replace(temporary, path)
    if os.name != "nt":
        descriptor = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def json_bytes(data):
    # Index key order is semantic. Sorting nested keys would corrupt compound indexes.
    return json_util.dumps(data, indent=2).encode("utf-8")


def documents(path):
    with path.open("rb") as stream:
        yield from decode_file_iter(stream)


def options_and_indexes(db, name):
    details = next(db.list_collections(filter={"name": name}), None)
    if details is None:
        return {"exists": False, "options": {}, "indexes": []}
    if details["type"] != "collection":
        raise ValueError(f"Expected collection at {name}")
    return {
        "exists": True,
        "options": details.get("options", {}),
        "indexes": list(db[name].list_indexes()),
    }


def scope(db):
    """Only typed references are selected from collections shared with other data."""
    study_ids = sorted(set(db.study.distinct("_id")) | set(db.relay.distinct("_id")))
    chapter_ids = db.study_chapter_flat.distinct("_id")
    # Orphan analysis still belongs to this version's study namespace.
    analysis_studies = db.analysis2.distinct("studyId", {"studyId": {"$type": "string"}})
    job_studies = db.fishnet_analysis.distinct("game.studyId", {"game.studyId": {"$type": "string"}})
    study_ids = sorted(set(study_ids + analysis_studies + job_studies))
    if any(not isinstance(value, str) for value in study_ids + chapter_ids):
        raise ValueError("Non-string study/chapter identity; refusing reset")
    ids = {"$in": study_ids}
    # Chat identities share the game namespace. A collision has no reliable
    # ownership discriminator, so never guess which user's conversation to clear.
    game_ids = db.game5.distinct("_id", {"_id": ids})
    collision = db.chat.find_one({"_id": {"$in": game_ids}}, {"_id": 1})
    if collision:
        raise ValueError(f"Ambiguous game/study chat identity: {collision['_id']}")
    queries = {name: {} for name in OWNED}
    queries.update({
        "analysis2": {"studyId": ids},
        "fishnet_analysis": {"game.studyId": ids},
        "chat": {"_id": ids},
        "chat_timeout": {"chat": ids},
        "activity2": {"t": ids},
        "timeline_entry": {"typ": "study-like", "data.studyId": ids},
        "notify": {"$or": [
            {"content.type": "invitedStudy", "content.studyId": ids},
            {"content.type": "broadcastRound", "content.url": {"$regex": "^/broadcast/"}},
        ]},
        "coach": {"profile.publicStudies": {"$type": "string"}},
        "flag": {"_id": "studyFeatured"},
        "external_engine": {},
        "user4": {"roles": "ROLE_FIDE_PLAYER"},
        "title_request": {},
        **{name: {} for name in PRESERVED_DIRECTORY},
    })
    collections = {}
    for name, query in queries.items():
        selected = list(db[name].find(query, {"_id": 1}))
        if name == "coach":
            selected = [
                {"_id": doc["_id"]} for doc in db[name].find(query)
                if coach_studies(doc, study_ids) != doc["profile"]["publicStudies"]
            ]
        collections[name] = {
            **options_and_indexes(db, name),
            "ids": [item["_id"] for item in selected],
        }
    return {"version": MIGRATION, "database": db.name, "studyIds": study_ids,
            "chapterIds": chapter_ids, "collections": collections}


def coach_studies(doc, study_ids):
    ids = set(study_ids)
    return "\n".join(
        line for line in doc["profile"]["publicStudies"].splitlines()
        if not any(value in ids for value in re.findall(r"/study/([\w-]+)", line))
    )


def expected_document(name, doc, manifest):
    if name in ("external_engine", "title_request", *PRESERVED_DIRECTORY):
        return doc
    if name == "user4":
        if not isinstance(doc.get("roles"), list):
            raise ValueError("Unexpected user role representation")
        roles = ["ROLE_DIRECTORY_PLAYER" if role == "ROLE_FIDE_PLAYER" else role for role in doc["roles"]]
        return {**doc, "roles": list(dict.fromkeys(roles))}
    if name == "activity2":
        return {**doc, "t": [value for value in doc["t"] if value not in manifest["studyIds"]]}
    if name == "coach":
        return {**doc, "profile": {**doc["profile"], "publicStudies": coach_studies(doc, manifest["studyIds"])}}
    if name == "flag":
        if not isinstance(doc["setting"], str):
            raise ValueError("Unexpected featured-study setting format")
        return {**doc, "setting": "\n".join(value for value in doc["setting"].splitlines()
                                                if value[-8:] not in manifest["studyIds"])}
    return None


def restore_collection(db, name, metadata, source):
    db.create_collection(name, **metadata["options"])
    batch = []
    for doc in documents(source):
        batch.append(doc)
        if len(batch) == 500:
            db[name].insert_many(batch, bypass_document_validation=True)
            batch = []
    if batch:
        db[name].insert_many(batch, bypass_document_validation=True)
    indexes = []
    for index in metadata["indexes"]:
        if index["name"] == "_id_":
            continue
        keys = list(index["key"].items())
        if "_fts" in index["key"]:
            keys = [(key, value) for key, value in keys if key not in {"_fts", "_ftsx"}]
            keys.extend((field, "text") for field in index["weights"])
        indexes.append(IndexModel(keys, **{key: value for key, value in index.items() if key not in {"key", "v", "ns"}}))
    if indexes:
        db[name].create_indexes(indexes)


def normalized_indexes(indexes):
    return sorted(json_util.dumps({key: list(value.items()) if key == "key" else value
                                   for key, value in index.items() if key not in {"v", "ns"}}, sort_keys=True)
                  for index in indexes)


def verify_backup(db, backup, manifest, checksums):
    """Read the actual archive back into MongoDB, including original validators/indexes."""
    temporary_name = "study_reset_verify_" + uuid.uuid4().hex
    scratch = db.client[temporary_name]
    try:
        for name, metadata in manifest["collections"].items():
            path = backup / f"{name}.bson"
            if digest(path) != checksums[name]:
                raise ValueError(f"Backup checksum mismatch: {name}")
            if not metadata["exists"]:
                if path.stat().st_size:
                    raise ValueError(f"Unexpected backup records for absent collection: {name}")
                continue
            restore_collection(scratch, name, metadata, path)
            if scratch[name].count_documents({}) != len(metadata["ids"]):
                raise ValueError(f"Backup count mismatch: {name}")
            for doc in documents(path):
                if scratch[name].find_one({"_id": doc["_id"]}) != doc:
                    raise ValueError(f"Backup restore differs: {name}/{doc['_id']}")
            if normalized_indexes(scratch[name].list_indexes()) != normalized_indexes(metadata["indexes"]):
                raise ValueError(f"Backup index mismatch: {name}")
            if scratch[name].options() != metadata["options"]:
                raise ValueError(f"Backup collection options mismatch: {name}")
    finally:
        db.client.drop_database(temporary_name)


def prepare_backup(db, backup, interrupt):
    manifest_path = backup / "manifest.json"
    if manifest_path.exists():
        manifest = json_util.loads(manifest_path.read_text("utf-8"))
        if manifest["version"] != MIGRATION or manifest["database"] != db.name:
            raise ValueError("Backup belongs to another database/schema")
    else:
        manifest = scope(db)
        durable_write(manifest_path, json_bytes(manifest))
    marker = db[MARKERS].find_one({"_id": MIGRATION})
    manifest_hash = digest(manifest_path)
    if marker.get("manifestSha256", manifest_hash) != manifest_hash:
        raise ValueError("Immutable manifest was changed")
    db[MARKERS].update_one({"_id": MIGRATION}, {"$set": {"manifestSha256": manifest_hash}})
    checksums_path = backup / "checksums.json"
    if checksums_path.exists():
        checksums = json.loads(checksums_path.read_text("utf-8"))
    else:
        checksums = {}
        for name, metadata in manifest["collections"].items():
            path = backup / f"{name}.bson"
            # No reset starts before every file is sealed. A partial file can be
            # rebuilt using only the original frozen IDs while writers are stopped.
            if not path.exists():
                temporary = path.with_suffix(".partial")
                with temporary.open("wb") as stream:
                    for identity in metadata["ids"]:
                        doc = db[name].find_one({"_id": identity})
                        if doc is None:
                            raise ValueError(f"Record disappeared before backup: {name}/{identity}")
                        stream.write(BSON.encode(doc))
                    stream.flush()
                    os.fsync(stream.fileno())
                durable_rename(temporary, path)
            checksums[name] = digest(path)
        durable_write(checksums_path, json.dumps(checksums, sort_keys=True, indent=2).encode())
    interrupt("backup-written")
    verify_backup(db, backup, manifest, checksums)
    db[MARKERS].update_one({"_id": MIGRATION}, {"$set": {"state": "prepared", "checksums": checksums}})
    interrupt("backup-verified")
    return manifest, checksums


def external_engine_validator():
    return {"$jsonSchema": {
        "bsonType": "object",
        "required": ["_id", "name", "maxThreads", "maxHash", "protocol", "officialPikafish",
                     "providerSelector", "userId", "clientSecret"],
        "properties": {
            **{field: {"bsonType": "string"} for field in ("_id", "name", "providerSelector", "userId", "clientSecret")},
            "protocol": {"enum": ["xiangqi-v1"]}, "officialPikafish": {"bsonType": "bool"},
            "maxThreads": {"bsonType": "int", "minimum": 1, "maximum": 65536},
            "maxHash": {"bsonType": "int", "minimum": 1, "maximum": 1048576},
        },
        "not": {"anyOf": [{"required": [field]} for field in ("variants", "officialStockfish")]},
    }}


def install_schema(db):
    # Chapter trees retain targeted flat document updates. Every node key is a
    # slash-separated sequence of literal native coordinates; '_' is the root.
    square = r"[a-i](?:10|[1-9])"
    move = square + square
    native_node = {
        "bsonType": "object", "required": ["p", "f", "o"],
        "properties": {"p": {"bsonType": "int", "minimum": 0}, "f": {"bsonType": "string"},
                       "u": {"bsonType": "string", "pattern": "^" + move + "$"},
                       "notation": {"bsonType": "string"}, "chineseNotation": {"bsonType": "string"},
                       "o": {"bsonType": "array", "items": {"bsonType": "string", "pattern": "^" + move + "$"}}},
        "not": {"anyOf": [{"required": [field]} for field in ("s", "c", "crazy", "variant")]},
    }
    root_node = {**native_node, "required": ["p", "f", "o", "ruleset"]}
    branch_node = {**native_node, "required": ["p", "f", "o", "u", "notation", "chineseNotation"]}
    validator = {"$jsonSchema": {
        "bsonType": "object", "required": ["_id", "studyId", "root", "setup"],
        "properties": {
            "_id": {"bsonType": "string"}, "studyId": {"bsonType": "string"},
            "setup": {"bsonType": "object", "required": ["orientation"],
                      "properties": {"orientation": {"enum": ["red", "black"]}},
                      "not": {"required": ["variant"]}},
            "relay": {"bsonType": "object", "properties": {
                "playerIds": {"bsonType": "array", "minItems": 2, "maxItems": 2,
                              "items": {"anyOf": [{"bsonType": "null"}, {"bsonType": "string", "pattern": "^[a-z][a-z0-9-]{1,15}:[A-Za-z0-9._-]{1,80}$"}]}}},
                      "not": {"required": ["fideIds"]}},
            "root": {"bsonType": "object", "required": ["_"],
                     "patternProperties": {"^_$": root_node, "^" + move + "(?:/" + move + ")*$": branch_node},
                     "additionalProperties": False},
        },
    }}
    if "study_chapter_flat" not in db.list_collection_names():
        db.create_collection("study_chapter_flat", validator=validator, validationLevel="strict", validationAction="error")
    else:
        db.command("collMod", "study_chapter_flat", validator=validator, validationLevel="strict", validationAction="error")
    db.study_chapter_flat.create_index([("studyId", 1), ("order", 1)])
    for index in db.study_chapter_flat.list_indexes():
        if "relay.fideIds" in index["key"]:
            db.study_chapter_flat.drop_index(index["name"])
    db.study_chapter_flat.create_index([("relay.playerIds", 1)], partialFilterExpression={"relay.playerIds": {"$exists": True}})
    for fields in [
        [("ownerId", 1), ("createdAt", -1)], [("likes", 1), ("createdAt", -1)],
        [("ownerId", 1), ("updatedAt", -1)], [("likes", 1), ("updatedAt", -1)],
        [("rank", -1)], [("createdAt", -1)], [("updatedAt", -1)], [("likers", 1)], [("uids", 1)],
    ]:
        db.study.create_index(fields)
    for field in ["rank", "createdAt", "updatedAt", "likes"]:
        db.study.create_index([("topics", 1), (field, -1)], partialFilterExpression={"topics": {"$exists": True}})
    db.study.create_index([("uids", 1), ("rank", -1)], partialFilterExpression={"topics": {"$exists": True}})
    db.study.create_index([(field, "text") for field in ("name", "topics", "description", "ownerId", "uids", "searchChapters")],
                          name="native_study_search", default_language="none",
                          weights={"name": 3, "topics": 2, "description": 1, "ownerId": 1, "uids": 1, "searchChapters": 1})
    cache_validator = {"$jsonSchema": {"bsonType": "object", "required": ["_id", "nbMoves", "evals", "usedAt", "updatedAt"],
        "properties": {"_id": {"bsonType": "string", "pattern": "^xiangqi-v1:[a-f0-9]{64}$"},
                       "nbMoves": {"bsonType": "int", "minimum": 1, "maximum": 200},
                       "evals": {"bsonType": "array"}, "usedAt": {"bsonType": "date"}, "updatedAt": {"bsonType": "date"}}}}
    if "eval_cache2" not in db.list_collection_names():
        db.create_collection("eval_cache2", validator=cache_validator)
    else:
        db.command("collMod", "eval_cache2", validator=cache_validator, validationLevel="strict", validationAction="error")
    if "external_engine" not in db.list_collection_names():
        db.create_collection("external_engine", validator=external_engine_validator())
    else:
        db.command("collMod", "external_engine", validator=external_engine_validator(), validationLevel="strict", validationAction="error")
    db.external_engine.create_index([("userId", 1)])
    db.external_engine.create_index([("providerSelector", 1)])
    db.directory_player.create_index([("tokens", 1)])
    for category in ("standard", "rapid", "blitz"):
        db.directory_player.create_index([("fed", 1), (category, -1)])
        db.directory_player.create_index([(category, -1)])
    for field, direction in (("name", 1), ("fed", 1), ("year", -1)):
        db.directory_player.create_index([(field, direction)])
    db.directory_player.create_index([("token", "text"), ("aliases", "text"), ("standard", -1)],
                                     default_language="none", name="native_player_search")
    db.directory_player_follower.create_index([("u", 1)])
    db.title_request.create_index([("data.playerId", 1), ("history.0.at", -1)],
                                  partialFilterExpression={"history.0.status.n": "approved", "data.playerId": {"$exists": True}})


def migrate(db, backup, *, writers_stopped, interrupt=lambda stage: None):
    if not writers_stopped:
        raise ValueError("All application writers and workers must be stopped")
    db = db.with_options(write_concern=WriteConcern(w="majority", j=True))
    marker = db[MARKERS].find_one({"_id": MIGRATION})
    if marker and marker["state"] == "complete":
        return {"alreadyApplied": True, "backup": marker["backup"]}
    incompatible_engine = db.external_engine.find_one({"$nor": [external_engine_validator()]}, {"_id": 1})
    if incompatible_engine:
        raise ValueError(f"Legacy or incompatible external-engine registration {incompatible_engine['_id']}; "
                         "settings are intact and require an explicit provider migration")
    backup = Path(backup).resolve()
    backup.mkdir(parents=True, exist_ok=True)
    if marker and marker["backup"] != str(backup):
        raise ValueError("Retry must use the original backup directory")
    if marker is None:
        if any(backup.iterdir()):
            raise ValueError("Unregistered backup directory is not empty; inspect before retrying")
        db[MARKERS].insert_one({"_id": MIGRATION, "state": "preparing", "backup": str(backup)})
        marker = db[MARKERS].find_one({"_id": MIGRATION})
    if marker["state"] == "preparing":
        manifest, checksums = prepare_backup(db, backup, interrupt)
    elif marker["state"] in {"prepared", "resetting"}:
        manifest_path = backup / "manifest.json"
        if digest(manifest_path) != marker["manifestSha256"]:
            raise ValueError("Immutable manifest was changed")
        manifest = json_util.loads(manifest_path.read_text("utf-8"))
        checksums = marker["checksums"]
        verify_backup(db, backup, manifest, checksums)
    else:
        raise ValueError(f"Unknown migration state: {marker['state']}")
    # Validate the whole remaining inventory before any changes, including retries.
    for name, metadata in manifest["collections"].items():
        if name in OWNED and set(db[name].distinct("_id")) - set(metadata["ids"]):
            raise ValueError(f"Unbacked records appeared in {name}; writers were not stopped")
        for original in documents(backup / f"{name}.bson"):
            current = db[name].find_one({"_id": original["_id"]})
            expected = expected_document(name, original, manifest)
            if current != original and current != expected:
                raise ValueError(f"Record changed since backup: {name}/{original['_id']}")
    db[MARKERS].update_one({"_id": MIGRATION}, {"$set": {"state": "resetting"}})
    for name in manifest["collections"]:
        for original in documents(backup / f"{name}.bson"):
            expected = expected_document(name, original, manifest)
            if expected is None:
                db[name].delete_one({"_id": original["_id"]})
            else:
                db[name].replace_one({"_id": original["_id"]}, expected)
        interrupt("reset:" + name)
    install_schema(db)
    interrupt("schema-installed")
    for name in manifest["collections"]:
        for original in documents(backup / f"{name}.bson"):
            if db[name].find_one({"_id": original["_id"]}) != expected_document(name, original, manifest):
                raise ValueError(f"Reset verification failed: {name}/{original['_id']}")
    for name in RETIRED:
        if db[name].count_documents({}):
            raise ValueError(f"Unbacked records appeared in retired collection {name}")
        db.drop_collection(name)
    db[MARKERS].update_one({"_id": MIGRATION}, {"$set": {"state": "complete", "schemaVersion": 1}})
    return {"alreadyApplied": False, "removedStudies": len(manifest["studyIds"]),
            "removedChapters": len(manifest["chapterIds"]), "backup": str(backup), "checksums": checksums}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uri", default=os.environ.get("MONGODB_URI", "mongodb://mongo:27017/lichess"))
    parser.add_argument("--backup", required=True)
    parser.add_argument("--writers-stopped", action="store_true")
    args = parser.parse_args()
    with MongoClient(args.uri) as client:
        print(json.dumps(migrate(client.get_default_database(), args.backup,
                                 writers_stopped=args.writers_stopped), indent=2))


if __name__ == "__main__":
    main()
