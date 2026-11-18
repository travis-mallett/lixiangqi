"""Exercise the real MongoDB migration, recovery copies, interruptions and retries."""
import importlib
import os
import unittest
from copy import deepcopy
from uuid import uuid4
from unittest.mock import patch

from pymongo import MongoClient

migration = importlib.import_module("tools.data_migration.20261115_signup_country_v1")


class CountryShapeTest(unittest.TestCase):
    def test_malformed_values_fail(self):
        for profile in [None, {}, {"flag": None}, {"flag": ""}, {"flag": 4}, {"flag": " CN"}, {"flag": "CN", "country": []}]:
            with self.subTest(profile=profile), self.assertRaises(ValueError):
                migration.repaired_profile(profile)


@unittest.skipUnless(os.environ.get("LIXIANGQI_MIGRATION_TEST_URI"), "MongoDB integration URI required")
class SignupCountryMigrationTest(unittest.TestCase):
    def setUp(self):
        uri = os.environ["LIXIANGQI_MIGRATION_TEST_URI"]
        if not uri.startswith("mongodb://127.0.0.1:"):
            raise ValueError("Isolated loopback MongoDB required")
        self.client = MongoClient(uri, serverSelectionTimeoutMS=10000)
        self.db = self.client["signup_country_test_" + uuid4().hex]

    def tearDown(self):
        self.client.drop_database(self.db.name)
        self.client.close()

    def apply(self):
        return migration.migrate(self.db, apply=True, writers_stopped=True)

    def test_preview_preservation_recovery_and_repeat(self):
        originals = [
            {"_id": "selected", "profile": {"flag": "CN", "bio": "hello"}, "credential": b"private"},
            {"_id": "changed", "profile": {"flag": "CN", "country": "US", "location": "somewhere"}},
            {"_id": "same", "profile": {"flag": "ES-GA", "country": "ES-GA"}},
            {"_id": "cleared", "profile": {"flag": "JP", "country": None}},
            {"_id": "optout"},
            {"_id": "existing", "profile": {"country": "IT"}},
        ]
        self.db.user4.insert_many(deepcopy(originals))
        self.assertEqual(migration.migrate(self.db)["affected"], 4)
        self.assertEqual(self.db[migration.BACKUP].count_documents({}), 0)
        self.assertEqual(list(self.db.user4.find()), originals)
        with self.assertRaisesRegex(ValueError, "Stop application writers"):
            migration.migrate(self.db, apply=True)
        result = self.apply()
        self.assertEqual(result["verified"], 4)
        self.assertEqual(result["preservedExisting"], 3)
        saved = list(self.db[migration.BACKUP].find())
        for original in originals:
            expected = deepcopy(original)
            if "flag" in original.get("profile", {}):
                self.assertEqual(self.db[migration.BACKUP].find_one({"_id": original["_id"]})["original"], original)
                expected["profile"] = migration.repaired_profile(original["profile"])
            self.assertEqual(self.db.user4.find_one({"_id": original["_id"]}), expected)
        self.assertEqual(self.apply()["mode"], "already-current")
        self.assertEqual(list(self.db[migration.BACKUP].find()), saved)
        # Demonstrate that recovery copies reconstruct intact original documents.
        for backup in saved:
            self.db.recovery.insert_one(backup["original"])
        self.assertEqual(list(self.db.recovery.find()), originals[:4])

    def test_preflight_blocks_all_accounts_before_writes(self):
        self.db.user4.insert_many([{"_id": "ok", "profile": {"flag": "CN"}}, {"_id": "bad", "profile": {"flag": 12}}])
        with self.assertRaises(ValueError):
            self.apply()
        self.assertEqual(self.db[migration.BACKUP].count_documents({}), 0)
        self.assertEqual(self.db.user4.count_documents(migration.SELECTOR), 2)

    def test_interrupted_updates_resume_without_overwriting_originals(self):
        originals = [{"_id": str(n), "profile": {"flag": "CN"}} for n in range(3)]
        self.db.user4.insert_many(deepcopy(originals))
        from pymongo.synchronous.collection import Collection
        real_update = Collection.update_one
        updates = 0

        def interrupt(collection, *args, **kwargs):
            nonlocal updates
            if collection.name == "user4":
                updates += 1
                if updates == 2:
                    raise RuntimeError("simulated interruption")
            return real_update(collection, *args, **kwargs)

        with patch.object(Collection, "update_one", interrupt), self.assertRaisesRegex(RuntimeError, "interruption"):
            self.apply()
        saved = list(self.db[migration.BACKUP].find())
        self.assertEqual(len(saved), 3)
        self.assertEqual(self.apply()["verified"], 3)
        self.assertEqual(list(self.db[migration.BACKUP].find()), saved)

    def test_existing_recovery_copy_must_match(self):
        self.db.user4.insert_one({"_id": "a", "profile": {"flag": "CN"}})
        self.db[migration.BACKUP].insert_one({"_id": "a", "original": {"_id": "a", "profile": {"flag": "US"}}})
        with self.assertRaisesRegex(ValueError, "Recovery copy differs"):
            self.apply()
        self.assertEqual(self.db.user4.count_documents(migration.SELECTOR), 1)

    def test_obsolete_writer_after_completion_is_rejected(self):
        self.apply()
        self.db.user4.insert_one({"_id": "late", "profile": {"flag": "CN"}})
        with self.assertRaisesRegex(ValueError, "obsolete signup writer"):
            self.apply()


if __name__ == "__main__":
    unittest.main()
