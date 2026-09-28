"""Run with LIXIANGQI_MIGRATION_TEST_URI pointing at disposable local MongoDB."""

import copy
from importlib import import_module
import os
import unittest
import uuid
from unittest.mock import patch

from tools.puzzle_catalog.test_catalog import puzzle

migration = import_module("tools.data_migration.20260912_puzzle_publication_v1")


@unittest.skipUnless(
    os.environ.get("LIXIANGQI_MIGRATION_TEST_URI"), "isolated MongoDB URI required"
)
class MigrationTests(unittest.TestCase):
    def setUp(self):
        from pymongo import MongoClient

        self.client = MongoClient(os.environ["LIXIANGQI_MIGRATION_TEST_URI"])
        self.db = self.client["deployment_migration_test_" + uuid.uuid4().hex]
        self.originals = []
        for pid in ("00001", "00002"):
            doc = puzzle(pid)
            for key in ("sourceSnapshot", "retired", "retirementReason"):
                doc.pop(key)
            doc.update(
                plays=42,
                vote=0.6,
                vu=17,
                vd=3,
                glicko={"r": 1700, "d": 65},
                unknown={"precious": "retain"},
            )
            self.originals.append(doc)
        self.db.puzzle2_puzzle.insert_many(copy.deepcopy(self.originals))
        self.db.game5.insert_one(
            {
                "_id": "g1",
                "xv": 1,
                "xg": {"initialFen": puzzle()["fen"], "moves": ["a4a5", "a7a6"]},
                "us": ["alice", "bob"],
            }
        )
        self.db.puzzle2_round.insert_one({"_id": "alice:00001", "win": True})

    def tearDown(self):
        self.client.drop_database(self.db.name)
        self.client.close()

    def run_migration(self, **kwargs):
        return migration.migrate(
            self.db, "unused.sqlite3", "https://example.test", **kwargs
        )

    def test_check_is_read_only(self):
        before = self.db.list_collection_names()
        self.assertEqual(self.run_migration(check=True)["requiresMigration"], 2)
        self.assertEqual(before, self.db.list_collection_names())
        self.assertEqual(list(self.db.puzzle2_puzzle.find({})), self.originals)

    def test_interruption_resumes_and_preserves_all_original_fields(self):
        def crash():
            raise RuntimeError("simulated interruption")

        with self.assertRaisesRegex(RuntimeError, "interruption"):
            self.run_migration(interrupt=crash)
        self.run_migration()
        for original in self.originals:
            key = {"_id": original["_id"]}
            self.assertEqual(self.db[migration.BACKUP].find_one(key), original)
            current = self.db.puzzle2_puzzle.find_one(key)
            self.assertEqual({k: current[k] for k in original}, original)
        self.assertEqual(self.db.puzzle2_round.find_one({})["win"], True)
        self.db.puzzle2_puzzle.update_one(
            {"_id": "00001"},
            {"$inc": {"plays": 1}, "$set": {"authorRevision": "later-publication"}},
        )
        self.assertTrue(self.run_migration()["alreadyApplied"])
        self.assertEqual(self.db.puzzle2_puzzle.find_one({"_id": "00001"})["plays"], 43)

    def test_backup_failure_cannot_change_puzzles(self):
        from pymongo.synchronous.collection import Collection

        real_update = Collection.update_one

        def fail_backup(collection, *args, **kwargs):
            if collection.name == migration.BACKUP:
                raise RuntimeError("backup failed")
            return real_update(collection, *args, **kwargs)

        with patch.object(Collection, "update_one", fail_backup):
            with self.assertRaisesRegex(RuntimeError, "backup failed"):
                self.run_migration()
        self.assertEqual(list(self.db.puzzle2_puzzle.find({})), self.originals)
        self.run_migration()

    def test_missing_source_validates_entire_inventory_before_writes(self):
        self.db.puzzle2_puzzle.update_one(
            {"_id": "00002"}, {"$set": {"gameId": "missing"}}
        )
        with self.assertRaisesRegex(ValueError, "00002"):
            self.run_migration()
        self.assertEqual(
            self.db.puzzle2_puzzle.count_documents(
                {"sourceSnapshot": {"$exists": True}}
            ),
            0,
        )
        self.assertNotIn(migration.BACKUP, self.db.list_collection_names())

    def test_changed_record_after_interruption_is_not_overwritten(self):
        with self.assertRaises(RuntimeError):
            self.run_migration(interrupt=lambda: (_ for _ in ()).throw(RuntimeError()))
        self.db.puzzle2_puzzle.update_one({"_id": "00001"}, {"$inc": {"plays": 1}})
        with self.assertRaisesRegex(ValueError, "changed during migration"):
            self.run_migration()
        self.assertEqual(self.db.puzzle2_puzzle.find_one({"_id": "00001"})["plays"], 43)


if __name__ == "__main__":
    unittest.main()
