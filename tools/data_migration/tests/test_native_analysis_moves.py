"""Run against an isolated MongoDB with LIXIANGQI_MIGRATION_TEST_URI."""
import copy
from importlib import import_module
import json
import os
from pathlib import Path
import tempfile
import unittest
import uuid
from unittest.mock import patch
from pymongo import MongoClient

migration = import_module("tools.data_migration.20260929_native_analysis_moves_v1")

@unittest.skipUnless(os.environ.get("LIXIANGQI_MIGRATION_TEST_URI"), "isolated MongoDB URI required")
class NativeAnalysisMigrationTests(unittest.TestCase):
    def setUp(self):
        self.client = MongoClient(os.environ["LIXIANGQI_MIGRATION_TEST_URI"])
        self.db = self.client["native_analysis_test_" + uuid.uuid4().hex]
        self.temp = tempfile.TemporaryDirectory()
        self.backup = Path(self.temp.name) / "original"
        self.position = {"initialFen": migration.START_FEN, "moves": ["a4a5"], "ruleset": "unrestricted-v1"}
        self.db.game5.insert_one({"_id": "game0001", "xg": self.position})
        self.original = {"_id": "game0001", "data": "12,,P9+1,a4a5", "unknown": b"precious", "ply": 0}
        self.study = {"_id": "chapter1", "studyId": "study001", "data": "unchanged study"}
        self.db.analysis2.insert_many([copy.deepcopy(self.original), copy.deepcopy(self.study)])
        self.db.analysis2.create_index("depth")
        self.db.fishnet_analysis.insert_one({"_id": "job1", "game": {"id": "game0001", "variant": 1, "moves": "a4a5"}})

    def tearDown(self):
        self.client.drop_database(self.db.name)
        self.client.close()
        self.temp.cleanup()

    def prepare(self):
        return migration.migrate(self.db, self.backup, None, None, writers_stopped=True, phase="prepare")

    def output(self):
        (self.backup / "output.ndjson").write_text(json.dumps({"id": "game0001", "data": "12,,a4a5,a4a5", "key": "xiangqi-v1:test"}) + "\n")

    def apply(self):
        return migration.migrate(self.db, self.backup, None, None, writers_stopped=True, phase="apply")

    def test_phases_backup_scope_and_rerun_guard(self):
        self.prepare()
        self.assertEqual(self.db.analysis2.find_one({"_id": "game0001"}), self.original)
        self.output()
        self.apply()
        changed = self.db.analysis2.find_one({"_id": "game0001"})
        self.assertEqual(changed["position"], self.position)
        self.assertEqual(changed["data"], "12,,a4a5,a4a5")
        self.assertEqual(changed["unknown"], self.original["unknown"])
        self.assertEqual(self.db.analysis2.find_one({"_id": "chapter1"}), self.study)
        self.assertEqual(self.db.fishnet_analysis.find_one({"_id": "job1"})["game"]["ruleset"], "unrestricted-v1")
        self.db.analysis2.insert_one({"_id": "new-game", "data": "new analysis"})
        self.assertTrue(self.apply()["alreadyComplete"])
        self.assertIsNotNone(self.db.analysis2.find_one({"_id": "new-game"}))

    def test_backup_preparation_retries_frozen_originals(self):
        helpers = migration.load_reset_helpers()
        original_write = helpers.durable_write
        def fail_manifest(path, data):
            if path.name == "manifest.json":
                raise RuntimeError("interrupted backup finalization")
            return original_write(path, data)
        with patch.object(migration, "load_reset_helpers", return_value=helpers), patch.object(helpers, "durable_write", side_effect=fail_manifest):
            with self.assertRaisesRegex(RuntimeError, "interrupted"):
                self.prepare()
        self.assertTrue((self.backup / "plan.json").exists())
        self.db.analysis2.update_one({"_id": "game0001"}, {"$set": {"data": "modified despite writer stop"}})
        self.prepare()
        frozen = json.loads((self.backup / "input.ndjson").read_text())
        self.assertEqual(frozen["data"], self.original["data"])
        self.output()
        with self.assertRaisesRegex(ValueError, "changed while"):
            self.apply()

    def test_missing_output_and_corrupt_backup_never_apply(self):
        self.prepare()
        with self.assertRaisesRegex(ValueError, "replay output"):
            self.apply()
        (self.backup / "analysis2.bson").write_bytes(b"corrupt")
        with self.assertRaisesRegex(ValueError, "checksum"):
            self.apply()
        self.assertEqual(self.db.analysis2.find_one({"_id": "game0001"}), self.original)

    def test_writers_and_missing_source_are_hard_errors(self):
        with self.assertRaisesRegex(ValueError, "stopped"):
            migration.migrate(self.db, self.backup, None, None)
        self.db.game5.delete_many({})
        with self.assertRaisesRegex(ValueError, "Missing native source"):
            self.prepare()
        self.assertEqual(self.db.analysis2.find_one({"_id": "game0001"}), self.original)
