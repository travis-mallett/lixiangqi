"""Repair category-only duplicate IDs without touching published identity/history."""

from contextlib import closing
from importlib import import_module
import json
from pathlib import Path
import sqlite3
import unittest

from tools.puzzle_catalog.catalog import PuzzleCatalog, _json
from tools.puzzle_catalog.live import reconcile, wire_digest
from tools.puzzle_catalog.test_catalog import puzzle
from tools.xiangqi_data.tests import test_puzzle_storage_lifecycle as lifecycle

repair = import_module("tools.data_migration.20260913_puzzle_solve_identity").repair


class IdentityRepairTest(unittest.TestCase):
    def setUp(self):
        self.fixture = lifecycle.PuzzleStorageLifecycleTest()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        f = self.fixture
        f.verify()
        f.classify(theme="testKill")
        original = dict(f.connection.execute("SELECT * FROM puzzles").fetchone())
        self.old_id = original["id"]
        f.classify(theme="anotherKill", version="2")
        latest = dict(f.connection.execute("SELECT * FROM puzzles").fetchone())
        self.new_id = "new01"
        with f.connection:
            f.connection.execute(
                "UPDATE puzzles SET verification_status='withdrawn',retirement_reason='assessment replaced publication' WHERE id=?",
                (self.old_id,),
            )
            latest["id"] = self.new_id
            f.connection.execute(
                "INSERT INTO puzzles("
                + ",".join(latest)
                + ") VALUES("
                + ",".join("?" for _ in latest)
                + ")",
                list(latest.values()),
            )
        self.root = Path(f.temp.name)
        self.catalog_path = self.root / "catalog.sqlite3"
        self.before = {
            **puzzle(self.old_id),
            "themes": json.loads(original["themes"]),
            "gameSource": {"type": "catalog", "database": "test"},
            "retirementReason": None,
        }
        self.after = {
            **self.before,
            "_id": self.new_id,
            "themes": json.loads(latest["themes"]),
        }
        with PuzzleCatalog(self.catalog_path) as catalog:
            reconcile(
                catalog,
                [
                    {
                        "puzzle": self.before,
                        "digest": wire_digest(self.before),
                        "revision": "live",
                    }
                ],
            )
            catalog.retire(self.old_id, "assessment replaced publication")
            with catalog.db:
                catalog.db.execute(
                    "INSERT INTO catalog_puzzles VALUES(?,?,?)",
                    (
                        self.new_id,
                        _json(self.after),
                        _json({"status": "verified", "assessmentId": 1}),
                    ),
                )
        self.outbox = self.root / "publication-outbox.json"
        self.request = {
            "operationId": "rejected-operation",
            "changes": [
                {
                    "puzzle": {
                        **self.before,
                        "retired": True,
                        "retirementReason": "assessment replaced publication",
                    }
                },
                {"puzzle": self.after},
            ],
        }
        self.outbox.write_text(
            _json(
                {
                    "schemaVersion": 2,
                    "requests": [self.request],
                    "completed": 0,
                    "total": 2,
                }
            ),
            encoding="utf-8",
        )

    def run_repair(self, apply=False):
        return repair(self.fixture.path, self.catalog_path, self.root, apply=apply)

    def test_repair_preserves_public_id_latest_evidence_and_recoverable_originals(self):
        preview = self.run_repair()
        self.assertEqual(preview["solves"], 1)
        self.assertTrue(self.outbox.exists())
        result = self.run_repair(apply=True)
        self.assertEqual(
            result["identities"], [{"keep": self.old_id, "remove": [self.new_id]}]
        )
        self.assertFalse(self.outbox.exists())
        rows = self.fixture.connection.execute("SELECT * FROM puzzles").fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], self.old_id)
        self.assertEqual(rows[0]["verification_status"], "active")
        self.assertIn("anotherKill", json.loads(rows[0]["themes"]))
        self.assertEqual(
            self.fixture.connection.execute(
                "SELECT count(*) FROM taxonomy_assessments"
            ).fetchone()[0],
            2,
        )
        with PuzzleCatalog(self.catalog_path) as catalog:
            self.assertEqual(catalog.puzzles(), [{**self.after, "_id": self.old_id}])
            self.assertEqual(
                catalog.db.execute("SELECT document FROM catalog_live").fetchone()[0],
                _json(self.before),
            )
        backup = Path(result["backup"])
        self.assertTrue((backup / "publication-outbox.json").is_file())
        with closing(sqlite3.connect(backup / "mining.sqlite3")) as db:
            self.assertEqual(
                db.execute("SELECT count(*) FROM puzzles").fetchone()[0], 2
            )
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        with closing(sqlite3.connect(backup / "catalog.sqlite3")) as db:
            self.assertEqual(
                db.execute("SELECT count(*) FROM catalog_puzzles").fetchone()[0], 2
            )
        self.assertEqual(self.run_repair(apply=True)["solves"], 0)

    def test_multiple_public_ids_fail_before_mutation(self):
        with PuzzleCatalog(self.catalog_path) as catalog:
            reconcile(
                catalog,
                [
                    {
                        "puzzle": self.after,
                        "digest": wire_digest(self.after),
                        "revision": "other-live",
                    }
                ],
            )
        with self.assertRaisesRegex(ValueError, "Multiple published IDs"):
            self.run_repair(apply=True)
        self.assertEqual(
            self.fixture.connection.execute("SELECT count(*) FROM puzzles").fetchone()[
                0
            ],
            2,
        )
        self.assertTrue(self.outbox.exists())

    def test_potentially_accepted_outbox_is_never_discarded(self):
        self.request["changes"].pop(0)
        self.outbox.write_text(_json({"requests": [self.request]}), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "potentially accepted outbox"):
            self.run_repair(apply=True)
        self.assertTrue(self.outbox.exists())
        self.assertEqual(
            self.fixture.connection.execute("SELECT count(*) FROM puzzles").fetchone()[
                0
            ],
            2,
        )

    def test_retry_finishes_outbox_after_database_commit(self):
        original_outbox = self.outbox.read_bytes()
        self.run_repair(apply=True)
        self.outbox.write_bytes(original_outbox)
        self.assertTrue(self.run_repair(apply=True)["outbox_repaired"])
        self.assertFalse(self.outbox.exists())


if __name__ == "__main__":
    unittest.main()
