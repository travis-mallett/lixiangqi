import copy
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from tools.environment_data.preview_account import provision, USERNAME, TOKEN, ROLES
from tools.environment_data.snapshot import PREVIEW_DATABASE


class Collection:
    def __init__(self):
        self.docs = {}

    def find_one(self, query):
        return copy.deepcopy(self.docs.get(query["_id"]))

    def update_one(self, query, update, upsert=False):
        key = query["_id"]
        if key not in self.docs:
            self.docs[key] = {
                "_id": key,
                **copy.deepcopy(update.get("$setOnInsert", {})),
            }
        self.docs[key].update(copy.deepcopy(update["$set"]))
        for field in update.get("$unset", {}):
            self.docs[key].pop(field, None)

    def replace_one(self, query, value, upsert=False):
        self.docs[query["_id"]] = copy.deepcopy(value)


class PreviewAccountTests(unittest.TestCase):
    def test_repeatable_provisioning_retains_history_and_recoverable_original(self):
        db = SimpleNamespace(
            name=PREVIEW_DATABASE, user4=Collection(), oauth2_access_token=Collection()
        )
        db.user4.docs[USERNAME] = {
            "_id": USERNAME,
            "roles": [],
            "count": {"game": 42},
            "totp": b"old",
            "enabled": False,
        }
        with tempfile.TemporaryDirectory() as directory:
            first = provision(db, b"a" * 39, directory)
            original = json.loads(first.read_text())
            self.assertEqual(original["user"]["count"]["game"], 42)
            provision(db, b"b" * 39, directory)
            user = db.user4.docs[USERNAME]
            self.assertEqual(user["count"]["game"], 42)
            self.assertTrue(user["enabled"])
            self.assertEqual(user["roles"], ROLES)
            self.assertNotIn("totp", user)
            self.assertEqual(len(db.oauth2_access_token.docs), 1)
            token = next(iter(db.oauth2_access_token.docs.values()))
            self.assertEqual(token["plain"], TOKEN)
            self.assertEqual(token["scopes"], ["puzzle:publish"])
            self.assertEqual(len(list(Path(directory).glob("*.json"))), 2)

    def test_production_namespace_is_refused_before_any_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "only be installed"):
                provision(SimpleNamespace(name="lila"), b"a" * 39, directory)
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_startup_provisions_only_after_snapshot_restore(self):
        script = Path("scripts/windows/Start-Lixiangqi.ps1").read_text(encoding="utf-8")
        self.assertLess(
            script.index("-m tools.environment_data.remote"),
            script.index("-m tools.environment_data.snapshot refresh"),
        )
        self.assertLess(
            script.index("-m tools.environment_data.snapshot refresh"),
            script.index("-m tools.environment_data.preview_account"),
        )
        self.assertLess(
            script.index("-m tools.environment_data.preview_account"),
            script.index("if (-not (Test-Port 9663))"),
        )
