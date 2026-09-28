import importlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from tools.xiangqi_data.puzzle_mining.storage import open_database
from tools.puzzle_catalog.catalog import PuzzleCatalog
from tools.puzzle_catalog.playback import validate_playback
from tools.puzzle_catalog.test_catalog import puzzle


class SupportedPuzzleKindsTest(unittest.TestCase):
    def test_legacy_kind_is_archived_with_dependents_and_supported_rows_survive(self):
        migration = importlib.import_module(
            "tools.data_migration.20260925_supported_puzzle_kinds_v20"
        )
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.executescript("""
          PRAGMA foreign_keys=ON;
          CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
          INSERT INTO metadata VALUES('schema_version','19');
          CREATE TABLE candidates(id INTEGER PRIMARY KEY, candidate_type TEXT CHECK (candidate_type IN ('checkmate_candidate', 'tactic_candidate', 'abandoned')), payload TEXT);
          CREATE TABLE verification_jobs(candidate_id INTEGER REFERENCES candidates(id), evidence TEXT);
          CREATE VIEW candidate_view AS SELECT * FROM candidates;
          CREATE INDEX candidate_kind ON candidates(candidate_type);
          INSERT INTO candidates VALUES(1,'tactic_candidate','keep'),(2,'abandoned','recover');
          INSERT INTO verification_jobs VALUES(1,'valid'),(2,'old');
        """)
        migration.migrate(db)
        self.assertEqual(
            db.execute("SELECT * FROM candidate_view").fetchall(),
            [(1, "tactic_candidate", "keep")],
        )
        self.assertEqual(
            db.execute("SELECT * FROM verification_jobs").fetchall(), [(1, "valid")]
        )
        self.assertEqual(
            db.execute("SELECT * FROM __retired_v20_candidates").fetchall(),
            [(2, "abandoned", "recover")],
        )
        self.assertEqual(
            db.execute("SELECT * FROM __retired_v20_verification_jobs").fetchall(),
            [(2, "old")],
        )
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO candidates VALUES(3,'abandoned','bad')")

    def test_migration_rolls_back_on_unexpected_constraint(self):
        migration = importlib.import_module(
            "tools.data_migration.20260925_supported_puzzle_kinds_v20"
        )
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.execute("CREATE TABLE candidates(id INTEGER PRIMARY KEY)")
        with self.assertRaisesRegex(RuntimeError, "constraint"):
            migration.migrate(db)
        self.assertEqual(db.execute("PRAGMA foreign_keys").fetchone()[0], 0)

    def test_full_schema_18_and_19_upgrade_and_reopen(self):
        for version in ("18", "19"):
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "mining.sqlite3"
                db = open_database(path)
                db.execute(
                    "UPDATE metadata SET value=? WHERE key='schema_version'", (version,)
                )
                db.commit()
                db.close()
                for _ in range(2):
                    db = open_database(path)
                    self.assertEqual(
                        db.execute(
                            "SELECT value FROM metadata WHERE key='schema_version'"
                        ).fetchone()[0],
                        "20",
                    )
                    self.assertEqual(
                        db.execute("PRAGMA foreign_key_check").fetchall(), []
                    )
                    db.close()

    def test_catalog_archives_unsupported_objective_once(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "catalog.sqlite3"
            with PuzzleCatalog(path) as catalog:
                db = catalog.db
                db.execute(
                    "DELETE FROM catalog_metadata WHERE key='supported_objectives_v1'"
                )
                abandoned = puzzle("old")
                abandoned["playback"]["objective"] = "abandoned"
                for p in (puzzle("keep"), abandoned):
                    db.execute(
                        "INSERT INTO catalog_puzzles VALUES(?,?,?)",
                        (p["_id"], json.dumps(p), "{}"),
                    )
                # A freshly created archive is empty; simulate the earlier schema.
                db.execute("DROP TABLE __retired_v1_catalog_puzzles")
                db.commit()
            for _ in range(2):
                with PuzzleCatalog(path) as catalog:
                    self.assertEqual([p["_id"] for p in catalog.puzzles()], ["keep"])
                    self.assertEqual(
                        catalog.db.execute(
                            "SELECT id FROM __retired_v1_catalog_puzzles"
                        ).fetchall()[0][0],
                        "old",
                    )
            with self.assertRaises(ValueError):
                validate_playback(abandoned["playback"], ["a7a6"])
