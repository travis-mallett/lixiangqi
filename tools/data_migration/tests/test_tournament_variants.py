"""Integration checks for the tournament variant migration on disposable local data."""
from datetime import datetime
import os
from pathlib import Path
import subprocess
import unittest
from uuid import uuid4

from pymongo import MongoClient


@unittest.skipUnless(os.environ.get("REHEARSAL_TEST_MONGO_URI") and os.environ.get("MONGOSH_PATH"), "local MongoDB and mongosh not configured")
class TournamentVariantMigrationTest(unittest.TestCase):
    def setUp(self):
        self.uri = os.environ["REHEARSAL_TEST_MONGO_URI"]
        if not self.uri.startswith("mongodb://127.0.0.1:"):
            raise ValueError("Tests require loopback MongoDB")
        self.client = MongoClient(self.uri)
        self.db = self.client["tournament_variant_test_" + uuid4().hex[:16]]
        self.original = {"_id": "legacy01", "name": "Unused Jieqi", "ruleset": "jieqi-v1", "status": 10, "nbPlayers": 0, "createdAt": datetime(2026, 10, 28)}
        self.db.tournament2.insert_one(self.original)

    def tearDown(self):
        assert self.db.name.startswith("tournament_variant_test_")
        self.client.drop_database(self.db.name)
        self.client.close()

    def run_migration(self):
        return subprocess.run([
            os.environ["MONGOSH_PATH"], "--quiet", f"{self.uri}/{self.db.name}",
            "--file", str(Path(__file__).resolve().parents[1] / "20261029_tournament_variants.js"),
        ], capture_output=True, text=True, timeout=30)

    def test_backup_and_idempotent_metadata_upgrade(self):
        result = self.run_migration()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.db.tournament2.find_one({"_id": "legacy01"}), {**self.original, "gameVariant": "jieqi"})
        backup = self.db["__tournament_variants_v1_backup"].find_one({"_id": "legacy01"})
        self.assertEqual(backup["original"], self.original)
        self.assertEqual(self.run_migration().returncode, 0)
        self.assertEqual(self.db["__tournament_variants_v1_backup"].count_documents({}), 1)

    def test_participant_or_game_history_stops_all_mutation(self):
        self.db.tournament2.insert_one({**self.original, "_id": "legacy02"})
        self.db.tournament_player.insert_one({"_id": "player01", "tid": "legacy02", "uid": "participant"})
        result = self.run_migration()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Deployment stopped", result.stdout + result.stderr)
        self.assertEqual(self.db.tournament2.find_one({"_id": "legacy01"}), self.original)
        self.assertEqual(self.db["__tournament_variants_v1_backup"].count_documents({}), 0)


if __name__ == "__main__":
    unittest.main()
