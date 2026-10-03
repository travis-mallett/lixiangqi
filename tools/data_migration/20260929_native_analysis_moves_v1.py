"""Back up and convert retained analysis PVs and pending Fishnet work, with writers stopped.

The replay process is the staged application's canonical Xiangqi rules implementation.
No partial application is permitted until every input converts successfully. Retries
read the immutable backup, so partially migrated documents never become source data.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import uuid
from bson import BSON, decode_file_iter, json_util
from pymongo import MongoClient

MIGRATION = "native-analysis-moves-v1"
MOVE_FORMAT = "xiangqi-uci-v1"
START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"


def load_reset_helpers():
    spec = importlib.util.spec_from_file_location("native_study_reset", Path(__file__).with_name("20260929_native_study_v1.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def position(db, identifier, catalog):
    if identifier.startswith("catalog:"):
        if catalog is None:
            raise ValueError("Catalog analysis exists but --catalog was not supplied")
        from tools.games_database.identity import resolve_catalog_game
        game = resolve_catalog_game(catalog, identifier.removeprefix("catalog:"))
        if game is None:
            raise ValueError(f"Missing catalog game for analysis {identifier}")
        return {"initialFen": game["initial_fen"] or START_FEN,
                "moves": json.loads(game["moves"]), "ruleset": "unrestricted-v1"}
    game = db.game5.find_one({"_id": identifier}, {"xg": 1})
    if not game or "xg" not in game:
        raise ValueError(f"Missing native source game for analysis {identifier}")
    source = game["xg"]
    return {"initialFen": source["initialFen"], "moves": source["moves"],
            "ruleset": source.get("ruleset", "unrestricted-v1")}


def migrate(db, backup, java, classpath, catalog=None, writers_stopped=False, phase="all"):
    if not writers_stopped:
        raise ValueError("All application writers and background workers must be stopped")
    marker = db.schema_migration.find_one({"_id": MIGRATION})
    if marker and marker.get("complete"):
        return {"alreadyComplete": True}
    helpers = load_reset_helpers()
    backup = Path(backup).resolve()
    backup.mkdir(parents=True, exist_ok=True)
    manifest_path = backup / "manifest.json"
    if not manifest_path.exists():
        plan_path = backup / "plan.json"
        if plan_path.exists():
            plan = json_util.loads(plan_path.read_text())
            originals, jobs, inputs = plan["analyses"], plan["jobs"], plan["inputs"]
            job_rulesets, metadata = plan["jobRulesets"], plan["collections"]
        else:
            originals = list(db.analysis2.find({"studyId": {"$exists": False}, "$or": [{"moveFormat": {"$ne": MOVE_FORMAT}}, {"position": {"$exists": False}}]}))
            jobs = list(db.fishnet_analysis.find({"game.studyId": {"$exists": False}, "game.ruleset": {"$exists": False}}))
            inputs = []
            for doc in originals:
                source = position(db, doc["_id"], catalog)
                initial_ply = (int(source["initialFen"].split()[5]) - 1) * 2 + (source["initialFen"].split()[1] == "b")
                if doc.get("ply", 0) != initial_ply:
                    raise ValueError(f"Analysis starting ply differs from source: {doc['_id']}")
                inputs.append({"id": doc["_id"], "position": source, "data": doc["data"]})
            job_rulesets = {doc["_id"]: position(db, doc["game"]["id"], catalog)["ruleset"] for doc in jobs}
            metadata = {name: helpers.options_and_indexes(db, name) for name in ("analysis2", "fishnet_analysis")}
            plan = {"analyses": originals, "jobs": jobs, "inputs": inputs, "jobRulesets": job_rulesets, "collections": metadata}
            # The first durable write freezes all original documents and replay inputs.
            # Interrupted backup preparation resumes only from this recoverable plan.
            helpers.durable_write(plan_path, helpers.json_bytes(plan))
        for name, docs in (("analysis2", originals), ("fishnet_analysis", jobs)):
            helpers.durable_write(backup / (name + ".bson"), b"".join(BSON.encode(doc) for doc in docs))
        helpers.durable_write(backup / "input.ndjson", "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in inputs).encode())
        manifest = {"version": MIGRATION, "collections": metadata,
                    "counts": {"analysis2": len(originals), "fishnet_analysis": len(jobs)}, "jobRulesets": job_rulesets}
        manifest["checksums"] = {name: helpers.digest(backup / name) for name in ("analysis2.bson", "fishnet_analysis.bson", "input.ndjson", "plan.json")}
        helpers.durable_write(manifest_path, helpers.json_bytes(manifest))
    manifest = json_util.loads(manifest_path.read_text())
    for name, expected in manifest["checksums"].items():
        if helpers.digest(backup / name) != expected:
            raise ValueError(f"Backup checksum mismatch: {name}")
    # Real restore in an isolated namespace verifies BSON, identities and indexes.
    verification = db.client["native_analysis_verify_" + uuid.uuid4().hex]
    if verification.list_collection_names():
        raise ValueError("Backup verification namespace must be empty")
    try:
        for name in ("analysis2", "fishnet_analysis"):
            if not manifest["collections"][name]["exists"]:
                continue
            helpers.restore_collection(verification, name, manifest["collections"][name], backup / (name + ".bson"))
            restored = list(verification[name].find())
            original = list(helpers.documents(backup / (name + ".bson")))
            if sorted((BSON.encode(x) for x in restored)) != sorted((BSON.encode(x) for x in original)):
                raise ValueError(f"Restore verification mismatch for {name}")
            if helpers.normalized_indexes(list(verification[name].list_indexes())) != helpers.normalized_indexes(manifest["collections"][name]["indexes"]):
                raise ValueError(f"Restore index verification mismatch for {name}")
    finally:
        db.client.drop_database(verification.name)
    output = backup / "output.ndjson"
    if phase == "prepare":
        return {"prepared": True, "backup": str(backup), "input": str(backup / "input.ndjson"), "output": str(output)}
    if phase == "apply" and not output.exists():
        raise ValueError("Canonical Java replay output is required before applying the migration")
    if not output.exists():
        partial = backup / "output.partial.ndjson"
        if partial.exists():
            partial.unlink()
        subprocess.run([java, "-cp", classpath, "lila.tree.NativeAnalysisMigration", str(backup / "input.ndjson"), str(partial)], check=True)
        os.replace(partial, output)
    converted = {}
    for line in output.read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        if row["id"] in converted:
            raise ValueError("Duplicate converted analysis identity")
        converted[row["id"]] = row
    originals = list(helpers.documents(backup / "analysis2.bson"))
    if set(converted) != {doc["_id"] for doc in originals}:
        raise ValueError("Converted analysis identity mismatch")
    positions = {row["id"]: row["position"] for row in map(json.loads, (backup / "input.ndjson").read_text().splitlines())}
    for doc in originals:
        expected = {**doc, "data": converted[doc["_id"]]["data"], "hash": converted[doc["_id"]]["key"].encode("utf-8"), "moveFormat": MOVE_FORMAT, "position": positions[doc["_id"]]}
        current = db.analysis2.find_one({"_id": doc["_id"]})
        if current not in (doc, expected):
            raise ValueError(f"Analysis changed while writers should be stopped: {doc['_id']}")
        db.analysis2.replace_one({"_id": doc["_id"]}, expected)
        if db.analysis2.find_one({"_id": doc["_id"]}) != expected:
            raise ValueError(f"Analysis verification failed: {doc['_id']}")
    for doc in helpers.documents(backup / "fishnet_analysis.bson"):
        game = {key: value for key, value in doc["game"].items() if key != "variant"}
        game["ruleset"] = manifest["jobRulesets"][doc["_id"]]
        expected = {**doc, "game": game}
        current = db.fishnet_analysis.find_one({"_id": doc["_id"]})
        if current not in (doc, expected):
            raise ValueError(f"Fishnet work changed while stopped: {doc['_id']}")
        db.fishnet_analysis.replace_one({"_id": doc["_id"]}, expected)
        if db.fishnet_analysis.find_one({"_id": doc["_id"]}) != expected:
            raise ValueError(f"Fishnet work verification failed: {doc['_id']}")
    result = {"_id": MIGRATION, "complete": True, "backup": str(backup), "counts": manifest["counts"],
              "manifestSha256": helpers.digest(manifest_path), "outputSha256": helpers.digest(output)}
    db.schema_migration.replace_one({"_id": MIGRATION}, result, upsert=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uri", default=os.environ.get("MONGODB_URI", "mongodb://mongo:27017/lichess"))
    parser.add_argument("--backup", required=True)
    parser.add_argument("--java", default="java")
    parser.add_argument("--classpath")
    parser.add_argument("--phase", choices=("prepare", "apply", "all"), default="all")
    parser.add_argument("--catalog")
    parser.add_argument("--writers-stopped", action="store_true")
    args = parser.parse_args()
    if args.phase == "all" and not args.classpath:
        parser.error("--classpath is required with --phase all")
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    catalog = sqlite3.connect(f"{Path(args.catalog).resolve().as_uri()}?mode=ro", uri=True) if args.catalog else None
    if catalog:
        catalog.row_factory = sqlite3.Row
    try:
        with MongoClient(args.uri) as client:
            print(json.dumps(migrate(client.get_default_database(), args.backup, args.java, args.classpath, catalog, args.writers_stopped, args.phase)))
    finally:
        if catalog:
            catalog.close()

if __name__ == "__main__":
    main()
