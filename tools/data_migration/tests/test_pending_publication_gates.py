"""No-op deployments preserve pending journals; mutations still require recovery."""

from importlib import import_module
from pathlib import Path
import subprocess
import unittest
from unittest.mock import MagicMock


migration = import_module("tools.data_migration.20260912_puzzle_publication_v1")


class PendingPublicationGateTests(unittest.TestCase):
    def database(self, state):
        db = MagicMock()
        collections = {}
        db.get_collection.side_effect = lambda name: collections.setdefault(
            name, MagicMock()
        )
        db.get_collection("__lixiangqi_migrations").find_one.return_value = (
            {"_id": migration.MIGRATION, "state": state, "count": 2}
            if state
            else None
        )
        for name in (migration.BACKUP, migration.PLANS):
            db.get_collection(name).count_documents.return_value = 2
        db.puzzle2_publication.find_one.return_value = {
            "_id": "control",
            "operation": "pending",
        }
        db.puzzle2_puzzle.find_one.return_value = None
        db.puzzle2_puzzle.estimated_document_count.return_value = 3
        return db

    def test_completed_migration_is_read_only_with_pending_publication(self):
        db = self.database("complete")
        for check in (False, True):
            self.assertEqual(
                migration.migrate(db, "unused", "https://example.test", check=check),
                {"puzzles": 3, "alreadyApplied": True},
            )
        for call in db.mock_calls:
            self.assertFalse(
                any(word in call[0] for word in ("update", "insert", "delete"))
            )

    def test_unfinished_migrations_still_require_recovery(self):
        for state in (None, "preparing", "prepared"):
            with self.subTest(state=state):
                with self.assertRaisesRegex(ValueError, "pending publication"):
                    migration.migrate(
                        self.database(state), "unused", "https://example.test"
                    )

    def test_completed_migration_still_validates_backup_and_live_records(self):
        db = self.database("complete")
        db.get_collection(migration.BACKUP).count_documents.return_value = 1
        with self.assertRaisesRegex(ValueError, "recovery evidence"):
            migration.migrate(db, "unused", "https://example.test")
        db = self.database("complete")
        db.puzzle2_puzzle.find_one.return_value = {"_id": "invalid"}
        with self.assertRaisesRegex(ValueError, "incompatible"):
            migration.migrate(db, "unused", "https://example.test")

    def test_objective_migration_only_blocks_when_it_would_modify_puzzles(self):
        script = Path(migration.__file__).with_name(
            "20260925_supported_puzzle_objectives.js"
        )
        harness = r"""
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.argv[1], 'utf8');
for (const unsupported of [false, true]) {
  let journalReads = 0;
  const control = { _id: 'control', operation: 'pending' };
  const context = {
    print() {},
    db: {
      getCollection() { return {}; },
      puzzle2_puzzle: {
        findOne() { return unsupported ? { _id: 'bad' } : null; },
        find() { assert.equal(unsupported, false); return []; },
        countDocuments() { return 0; },
      },
      puzzle2_publication: { findOne() { journalReads++; return control; } },
    },
  };
  if (unsupported) assert.throws(() => vm.runInNewContext(source, context), /Recover pending/);
  else vm.runInNewContext(source, context);
  assert.equal(journalReads, unsupported ? 1 : 0);
  assert.deepEqual(control, { _id: 'control', operation: 'pending' });
}
"""
        subprocess.run(["node", "-e", harness, str(script)], check=True)
