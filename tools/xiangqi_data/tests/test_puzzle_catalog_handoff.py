"""Parallel classifiers hand off committed results to one catalog writer."""

import json
from dataclasses import replace
from pathlib import Path
import sqlite3
import subprocess
import sys
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from tools.puzzle_catalog.authoring import reconcile_assessments
from tools.puzzle_catalog.catalog import PuzzleCatalog
from tools.puzzle_catalog.desktop.repository import ContentRepository
from tools.puzzle_catalog.live import reconcile, wire_digest
from tools.puzzle_catalog.test_catalog import puzzle
from tools.xiangqi_data.puzzle_mining import checkmate


class CatalogHandoffTest(unittest.TestCase):
    def setUp(self):
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )

        self.fixture = PuzzleStorageLifecycleTest()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.fixture.verify()
        self.fixture.classify()
        self.original = self.fixture.connection.execute(
            "SELECT * FROM puzzles"
        ).fetchone()
        self.catalog_path = Path(self.fixture.temp.name) / "catalog.sqlite3"
        self.engine_path = self.catalog_path.parent / "unused-engine.exe"
        self.engine_path.write_bytes(
            b"not executable: this test must reuse stored evidence"
        )
        self.document = {
            **puzzle(self.original["id"]),
            "themes": ["centroidPawnMate"],
            "gameSource": {"type": "catalog", "database": "test"},
        }
        with PuzzleCatalog(self.catalog_path) as catalog:
            reconcile(
                catalog,
                [
                    {
                        "puzzle": self.document,
                        "digest": wire_digest(self.document),
                        "revision": "live-revision",
                    }
                ],
            )

    def test_worker_signals_without_opening_catalog(self):
        args = SimpleNamespace(
            database=self.fixture.path,
            catalog_db=self.catalog_path,
            nodes=100,
            engine=self.engine_path,
            hash_mb=16,
            force_reclassify_same_version=False,
            workers=20,
            continuous=False,
        )
        changed = threading.Event()
        with (
            patch.object(
                checkmate, "classify_solutions", return_value={"classified": 1}
            ),
            patch(
                "tools.puzzle_catalog.catalog.PuzzleCatalog",
                side_effect=AssertionError(
                    "a classifier worker must not write the catalog"
                ),
            ),
        ):
            checkmate._worker_main(3, args, threading.Event(), changed)
        self.assertTrue(changed.is_set())

    def test_engine_initialization_failure_closes_database(self):
        from tools.xiangqi_data.puzzle_mining.storage import open_database

        connection = open_database(self.fixture.path)
        args = SimpleNamespace(
            database=self.fixture.path, engine=self.engine_path, hash_mb=16
        )
        with (
            patch.object(checkmate, "open_database", return_value=connection),
            patch.object(
                checkmate, "OfflinePikafish", side_effect=OSError("engine unreadable")
            ),
        ):
            with self.assertRaisesRegex(OSError, "engine unreadable"):
                checkmate._worker_main(0, args, threading.Event(), threading.Event())
        with self.assertRaises(sqlite3.ProgrammingError):
            connection.execute("SELECT 1")

    def test_twenty_spawned_workers_flush_final_results_without_engine(self):
        from tools.xiangqi_data.puzzle_mining.storage import insert_candidate
        from tools.xiangqi_data.puzzle_mining.position import encode_position
        from tools.xiangqi_data.puzzle_mining.classification_job import taxonomy_versions

        # Give every partition work, so all twenty workers signal a handoff.
        for index in range(1, 20):
            square = f"{'abcdefghi'[index % 9]}{2 + index // 9}"
            identifier = insert_candidate(
                self.fixture.connection,
                replace(
                    self.fixture.candidate(),
                    candidate_key=f"handoff-{index}",
                    game_id=f"g{index + 1}",
                    position_fen=encode_position(
                        {"e1": "K", "e10": "k", "e5": "P", square: "R"}
                    ) + " b - - 0 1",
                ),
            )
            self.assertIsNotNone(identifier)
            self.fixture.verify()
        # This is a process/handoff test. Supply completed category verdicts
        # so child processes exercise canonical reprojection without requiring
        # native engine evidence for every production motif.
        self.fixture.scope_categories(None)
        versions = taxonomy_versions()
        with self.fixture.connection:
            self.fixture.connection.executemany(
                "INSERT INTO category_assessments VALUES(?,?,?,?,?,'no_match','fixture')",
                [
                    (
                        row["id"],
                        row["current_verification_id"],
                        theme,
                        version,
                        versions["__consensus__"],
                    )
                    for row in self.fixture.connection.execute("SELECT * FROM candidates")
                    for theme, version in versions.items()
                    if not theme.startswith("__")
                ],
            )
        root = Path(__file__).resolve().parents[3]
        result = subprocess.run(
            [
                sys.executable,
                str(root / "scripts/categorize-checkmate-puzzles.py"),
                "--database",
                str(self.fixture.path),
                "--catalog-db",
                str(self.catalog_path),
                "--engine",
                str(self.engine_path),
                "--workers",
                "20",
                "--poll-interval",
                "3600",
            ],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=90,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.count("'uncategorized': 1"), 20, result.stdout)
        with PuzzleCatalog(self.catalog_path) as catalog:
            self.assertEqual(catalog.puzzles()[0]["themes"], [])
            evidence = json.loads(
                catalog.db.execute("SELECT evidence FROM catalog_puzzles").fetchone()[0]
            )
        self.assertEqual(
            evidence["assessmentId"], self.original["canonical_assessment_id"]
        )
        self.assertNotEqual(
            evidence["taxonomyAssessmentId"], self.original["taxonomy_assessment_id"]
        )

        # A restart must recover projection even when no classification work
        # remains and therefore no worker emits a new change notification.
        with PuzzleCatalog(self.catalog_path) as catalog, catalog.db:
            catalog.db.execute(
                "UPDATE catalog_puzzles SET document=?,evidence='{}'",
                (json.dumps(self.document),),
            )
        with patch.object(
            checkmate,
            "parse_args",
            return_value=SimpleNamespace(
                database=self.fixture.path,
                candidate_type="checkmate_candidate",
                catalog_db=self.catalog_path,
                nodes=100,
                engine=self.engine_path,
                hash_mb=16,
                workers=1,
                continuous=False,
                poll_interval=3600,
                force_reclassify_same_version=False,
            ),
        ):
            self.assertEqual(checkmate.main(), 0)
        with PuzzleCatalog(self.catalog_path) as catalog:
            self.assertEqual(catalog.puzzles()[0]["themes"], [])

    def test_changes_arriving_during_projection_are_not_lost(self):
        changed = threading.Event()
        changed.set()
        args = SimpleNamespace(database=self.fixture.path, catalog_db=self.catalog_path)

        def concurrent_commit(catalog, mining_path):
            self.assertFalse(changed.is_set())
            changed.set()

        with patch(
            "tools.puzzle_catalog.authoring.reconcile_assessments",
            side_effect=concurrent_commit,
        ):
            checkmate._reconcile_catalog(args, changed)
        self.assertTrue(changed.is_set())

    def test_reconciliation_commits_while_studio_holds_a_read_snapshot(self):
        repository = ContentRepository(
            self.catalog_path,
            self.fixture.path,
            self.catalog_path.parent / "studio",
        )
        with repository._db() as reader:
            self.assertTrue(reader.in_transaction)
            before = reader.execute(
                "SELECT document,evidence FROM authored.catalog_puzzles"
            ).fetchone()
            with PuzzleCatalog(self.catalog_path) as catalog:
                # A Studio read may outlive any busy timeout. Reconciliation
                # must commit while that read remains open, without retries.
                catalog.db.execute("PRAGMA busy_timeout=0")
                reconcile_assessments(catalog, self.fixture.path)
                self.assertEqual(
                    catalog.puzzles()[0]["themes"], ["mate", "mateIn1", "testKill"]
                )
            self.assertEqual(
                tuple(
                    reader.execute(
                        "SELECT document,evidence FROM authored.catalog_puzzles"
                    ).fetchone()
                ),
                tuple(before),
            )
            reader.rollback()
            after = reader.execute(
                "SELECT document,evidence FROM authored.catalog_puzzles"
            ).fetchone()
            self.assertEqual(
                json.loads(after["document"])["themes"],
                ["mate", "mateIn1", "testKill"],
            )
            self.assertEqual(
                json.loads(after["evidence"])["taxonomyAssessmentId"],
                self.original["taxonomy_assessment_id"],
            )

    def test_reconciliation_cost_ignores_unrelated_mining_inventory(self):
        # Populate withdrawn history that has never been authored. It must not
        # lengthen the catalog write transaction or be parsed for publication.
        row = dict(self.original)
        columns = list(row)
        row["verification_status"] = "withdrawn"
        with self.fixture.connection:
            self.fixture.connection.executemany(
                f"INSERT INTO puzzles ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",
                [
                    tuple({**row, "id": f"unrelated-{i}"}[key] for key in columns)
                    for i in range(10000)
                ],
            )
        connect = sqlite3.connect
        steps = []

        def bounded_connection(*args, **kwargs):
            connection = connect(*args, **kwargs)

            def progress():
                steps.append(1)
                return int(len(steps) > 20)

            connection.set_progress_handler(progress, 100)
            return connection

        with PuzzleCatalog(self.catalog_path) as catalog:
            with patch(
                "tools.puzzle_catalog.authoring.sqlite3.connect",
                side_effect=bounded_connection,
            ):
                reconcile_assessments(catalog, self.fixture.path)
            self.assertEqual(
                catalog.puzzles()[0]["themes"], ["mate", "mateIn1", "testKill"]
            )
            self.assertFalse(catalog.puzzles()[0]["retired"])
        self.assertLessEqual(len(steps), 20)


if __name__ == "__main__":
    unittest.main()
