"""Run against an isolated local MongoDB with REHEARSAL_TEST_MONGO_URI set."""

from datetime import datetime, timedelta
import os
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from pymongo import MongoClient
from tools.tournament_rehearsal.cleanup import identity, plan, archive, apply_cleanup, restore


def manifest():
    run = "audit1234567"
    return {
        "schema": 1, "durationMinutes": 20, "runId": run,
        "createdAt": "2026-10-29T00:00:00Z", "tournamentName": f"Rehearsal {run}",
        "accounts": [{"username": f"tq{run}{i:02}"} for i in range(1, 11)],
        "tournamentId": "audit001", "games": [{"gameId": "game0001"}],
    }


class IdentityTest(unittest.TestCase):
    def test_exact_identity(self):
        self.assertEqual(len(identity(manifest())[0]), 10)
        changed = manifest()
        changed["accounts"][0]["username"] = "existinguser"
        with self.assertRaises(ValueError):
            identity(changed)


@unittest.skipUnless(os.environ.get("REHEARSAL_TEST_MONGO_URI"), "isolated local MongoDB not configured")
class CleanupIntegrationTest(unittest.TestCase):
    def setUp(self):
        uri = os.environ["REHEARSAL_TEST_MONGO_URI"]
        if not uri.startswith("mongodb://127.0.0.1:"):
            raise ValueError("Cleanup tests only allow loopback MongoDB")
        self.client = MongoClient(uri)
        self.db = self.client["tournament_rehearsal_cleanup_test_" + uuid4().hex[:16]]
        self.manifest = manifest()
        self.users = identity(self.manifest)[0]
        self.date = datetime(2026, 10, 29)
        self.db.user4.insert_many([
            {"_id": user, "username": user, "createdAt": self.date, "secret": b"recoverable"}
            for user in self.users
        ])
        self.sentinel = {"_id": "existinguser", "username": "ExistingUser", "createdAt": self.date}
        self.db.user4.insert_one(self.sentinel)
        self.db.tournament2.insert_one({
            "_id": "audit001", "name": self.manifest["tournamentName"],
            "createdBy": self.users[0], "createdAt": self.date,
        })
        self.db.tournament_player.insert_many([
            {"_id": str(i), "uid": user, "tid": "audit001"} for i, user in enumerate(self.users)
        ])
        self.db.game5.insert_one({"_id": "game0001", "us": self.users[:2], "tid": "audit001", "ca": self.date})
        self.db.tournament_pairing.insert_one({"_id": "game0001", "tid": "audit001", "u": self.users[:2]})

    def tearDown(self):
        assert self.db.name.startswith("tournament_rehearsal_cleanup_test_")
        self.client.drop_database(self.db.name)
        self.client.close()

    def test_system_welcome_is_scoped_but_human_conversation_is_protected(self):
        self.db.msg_thread.insert_one({"_id": "welcome", "users": ["lichess", self.users[0]]})
        self.db.msg_msg.insert_one({"_id": "message", "tid": "welcome", "user": "lichess"})
        self.assertEqual(len(plan(self.db, self.manifest)["msg_msg"]), 1)
        self.db.msg_thread.insert_one({"_id": "human", "users": ["existinguser", self.users[0]]})
        with self.assertRaisesRegex(ValueError, "conversation with an outsider"):
            plan(self.db, self.manifest)

    def test_assessment_records_use_their_user_field(self):
        self.db.player_assessment.insert_one({"_id": "game0001/white", "userId": self.users[0]})
        self.db.player_assessment.insert_one({"_id": "othergame/white", "userId": "existinguser"})
        self.assertEqual([r["_id"] for r in plan(self.db, self.manifest)["player_assessment"]], ["game0001/white"])

    def test_backup_cleanup_restore_and_tamper_detection(self):
        documents = plan(self.db, self.manifest)
        with tempfile.TemporaryDirectory() as folder:
            backup = Path(folder) / "backup"
            archive(backup, self.db.name, self.manifest, documents)
            apply_cleanup(self.db, documents)
            self.assertFalse(any(plan(self.db, self.manifest).values()))
            self.assertEqual(self.db.user4.find_one({"_id": "existinguser"}), self.sentinel)
            restore(self.db, backup)
            for collection, records in documents.items():
                for doc in records:
                    self.assertEqual(self.db[collection].find_one({"_id": doc["_id"]}), doc)
            restore(self.db, backup)  # idempotent, no duplicate records
            (backup / "game5.bson").write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "checksum"):
                restore(self.db, backup)

    def test_existing_account_is_protected(self):
        self.db.user4.update_one({"_id": self.users[0]}, {"$set": {"createdAt": self.date - timedelta(days=1)}})
        with self.assertRaisesRegex(ValueError, "pre-existing"):
            plan(self.db, self.manifest)

    def test_modified_manifest_cannot_select_unrelated_tournament(self):
        self.db.tournament2.delete_one({"_id": "audit001"})
        self.db.tournament2.insert_one({"_id": "audit001", "name": self.manifest["tournamentName"], "createdBy": "existinguser", "createdAt": self.date})
        with self.assertRaisesRegex(ValueError, "unexpected tournament"):
            plan(self.db, self.manifest)

    def test_outsider_game_is_protected(self):
        self.db.game5.update_one({"_id": "game0001"}, {"$set": {"us": [self.users[0], "existinguser"]}})
        with self.assertRaisesRegex(ValueError, "outsider"):
            plan(self.db, self.manifest)

    def test_changes_after_backup_abort_before_deleting(self):
        documents = plan(self.db, self.manifest)
        self.db.game5.update_one({"_id": "game0001"}, {"$set": {"moves": b"new"}})
        with self.assertRaisesRegex(ValueError, "changed after backup"):
            apply_cleanup(self.db, documents)
        self.assertEqual(self.db.user4.count_documents({}), 11)

    def test_cross_tournament_membership_is_protected(self):
        self.db.tournament_player.insert_one({"_id": "outside", "uid": self.users[0], "tid": "other001"})
        with self.assertRaisesRegex(ValueError, "membership crossed"):
            plan(self.db, self.manifest)


if __name__ == "__main__":
    unittest.main()
