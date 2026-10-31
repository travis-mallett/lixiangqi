"""Run with LIXIANGQI_MIGRATION_TEST_URI and mongosh (PATH or LIXIANGQI_MONGOSH)."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest
import uuid

from pymongo import MongoClient
from pymongo.errors import OperationFailure


MONGOSH = os.environ.get("LIXIANGQI_MONGOSH") or shutil.which("mongosh")
MIGRATION = Path(__file__).resolve().parents[1] / "20261025_jieqi_indexes.js"
OLD_NAME = "native_variant_games_by_user"
NEW_NAME = "native_jieqi_games_by_user"
OLD_KEYS = [("us", 1), ("xg.states.0.variant", 1), ("ca", -1)]


@unittest.skipUnless(os.environ.get("LIXIANGQI_MIGRATION_TEST_URI") and MONGOSH,
                     "isolated MongoDB URI and mongosh required")
class JieqiIndexTests(unittest.TestCase):
    def setUp(self):
        self.client = MongoClient(os.environ["LIXIANGQI_MIGRATION_TEST_URI"])
        self.db = self.client["jieqi_indexes_test_" + uuid.uuid4().hex]

    def tearDown(self):
        self.client.drop_database(self.db.name)
        self.client.close()

    def migrate(self, success=True):
        result = subprocess.run(
            [MONGOSH, os.environ["LIXIANGQI_MIGRATION_TEST_URI"], "--quiet", "--eval",
             f"db = db.getSiblingDB({json.dumps(self.db.name)}); load({json.dumps(MIGRATION.as_posix())});"],
            capture_output=True, text=True, timeout=60,
        )
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)
        return result

    @staticmethod
    def game(identifier, variant, date):
        return {"_id": identifier, "us": ["red", "black"], "ca": date, "s": 30,
                "xg": {"states": [{"variant": variant}, {"variant": variant}]}}

    def test_populated_games_are_preserved_and_history_uses_the_partial_index(self):
        games = [self.game(f"x{i}", "xiangqi", i) for i in range(200)]
        games += [self.game(f"j{i}", "jieqi", i) for i in range(3)]
        self.db.game5.insert_many(games)
        self.db.game5.create_index([("us", 1), ("ca", -1)])
        account = {"_id": "red", "ranks": {"jieqi": {"s": 10, "nb": 1}}}
        self.db.user_perf.insert_one(account)
        # This is the production failure: even an explicit array offset is multikey.
        with self.assertRaises(OperationFailure) as raised:
            self.db.game5.create_index(OLD_KEYS, name=OLD_NAME)
        self.assertEqual(raised.exception.code, 171)
        self.migrate()
        self.migrate()
        self.assertEqual(list(self.db.game5.find().sort("_id", 1)), sorted(games, key=lambda g: g["_id"]))
        self.assertEqual(self.db.user_perf.find_one(), account)
        query = {"us": "red", "xg.states.0.variant": "jieqi", "s": {"$gte": 20}}
        cursor = self.db.game5.find(query).sort("ca", -1)
        self.assertEqual([g["_id"] for g in cursor], ["j2", "j1", "j0"])
        plan = self.db.game5.find(query).sort("ca", -1).explain()["queryPlanner"]["winningPlan"]
        self.assertIn(NEW_NAME, json.dumps(plan))
        self.assertNotIn('"stage": "SORT"', json.dumps(plan))
        self.db.game5.insert_one(self.game("j3", "jieqi", 3))
        self.db.game5.update_one({"_id": "j3"}, {"$push": {"xg.states": {"variant": "jieqi"}}})
        self.db.game5.insert_one(self.game("x201", "xiangqi", 201))

    def test_empty_database_with_old_index_is_repaired_before_game_writes(self):
        self.db.game5.create_index(OLD_KEYS, name=OLD_NAME)
        self.migrate()
        self.assertNotIn(OLD_NAME, self.db.game5.index_information())
        self.db.game5.insert_many([self.game("j1", "jieqi", 1), self.game("x1", "xiangqi", 2)])
        self.migrate()
        self.assertEqual(self.db.game5.count_documents({}), 2)

    def test_unexpected_old_index_is_not_removed(self):
        self.db.game5.create_index([("ca", 1)], name=OLD_NAME)
        result = self.migrate(success=False)
        self.assertIn("Unexpected definition", result.stdout + result.stderr)
        self.assertIn(OLD_NAME, self.db.game5.index_information())


if __name__ == "__main__":
    unittest.main()
