"""Only current usable verification authority enters the categorization pool."""

import json
import sqlite3
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from unittest.mock import patch

from tools.xiangqi_data.puzzle_mining.classification import Motif, MotifRegistry
from tools.xiangqi_data.puzzle_mining.classification_job import classify_solutions


class ClassificationQueueTest(unittest.TestCase):
    def test_contended_category_and_publication_writes_resume_or_cancel(self):
        from tools.xiangqi_data.puzzle_mining.workers import WorkerCancelled

        class ObservedStop(threading.Event):
            def __init__(self):
                super().__init__()
                self.waiting = threading.Event()

            def wait(self, timeout=None):
                self.waiting.set()
                return super().wait(timeout)

        self.fixture.verify()
        for projection_only in (False, True):
            for cancel in (True, False):
                with self.subTest(projection_only=projection_only, cancel=cancel):
                    with self.db:
                        self.db.execute(
                            "UPDATE candidates SET current_classification_id=NULL"
                        )
                        if not projection_only:
                            self.db.execute("DELETE FROM category_assessments")
                    stop = ObservedStop()

                    def classify():
                        with closing(
                            sqlite3.connect(
                                self.fixture.path, timeout=30 if cancel else 0.01
                            )
                        ) as db:
                            db.row_factory = sqlite3.Row
                            try:
                                return classify_solutions(
                                    db, registry=self.registry, stop_event=stop
                                )
                            finally:
                                self.assertFalse(db.in_transaction)
                                self.assertEqual(
                                    db.execute("PRAGMA busy_timeout").fetchone()[0],
                                    30000 if cancel else 10,
                                )

                    self.db.execute("BEGIN IMMEDIATE")
                    with ThreadPoolExecutor(max_workers=1) as pool:
                        future = pool.submit(classify)
                        try:
                            self.assertTrue(stop.waiting.wait(3))
                            self.assertFalse(future.done())
                            if cancel:
                                stop.set()
                                with self.assertRaises(WorkerCancelled):
                                    future.result(timeout=3)
                            else:
                                self.db.rollback()
                                self.assertEqual(
                                    future.result(timeout=3), {"classified": 1}
                                )
                        finally:
                            stop.set()
                            self.db.rollback()
                    if cancel:
                        self.assertIsNone(
                            self.db.execute(
                                "SELECT current_classification_id FROM candidates"
                            ).fetchone()[0]
                        )

    def setUp(self):
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )

        self.fixture = PuzzleStorageLifecycleTest()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.db = self.fixture.connection
        self.registry = MotifRegistry([Motif("testKill", lambda trace: True)])

    def test_blocked_assessments_never_reach_classifier_even_when_forced(self):
        self.fixture.verify()
        original = dict(
            self.db.execute("SELECT * FROM candidate_assessments").fetchone()
        )
        cases = [
            {"coverage": coverage} for coverage in ("legacy", "incomplete", "invalid")
        ] + [
            {"accepted": 0},
            {"solution_json": None},
            {"solution_plies": 0},
            {"branches_json": None},
        ]
        cases.extend(
            {"verification_settings_json": settings}
            for settings in (
                None,
                "{}",
                "not json",
                json.dumps({"history_policy": "old"}),
            )
        )
        for changes in cases:
            with self.subTest(changes=changes):
                assignments = ",".join(f"{field}=?" for field in changes)
                with self.db:
                    self.db.execute(
                        f"UPDATE candidate_assessments SET {assignments}",
                        tuple(changes.values()),
                    )
                with patch(
                    "tools.xiangqi_data.puzzle_mining.classification_job.reclassify_canonical",
                    side_effect=AssertionError("blocked work reached classifier"),
                ):
                    for force in (False, True):
                        self.assertEqual(
                            classify_solutions(
                                self.db, registry=self.registry, force=force
                            ),
                            {},
                        )
                        self.assertEqual(
                            classify_solutions(
                                self.db, registry=self.registry, force=force
                            ),
                            {},
                        )
                with self.db:
                    self.db.execute(
                        f"UPDATE candidate_assessments SET {assignments}",
                        tuple(original[field] for field in changes),
                    )
        self.assertEqual(
            classify_solutions(self.db, registry=self.registry), {"classified": 1}
        )

    def test_completed_large_solution_remains_eligible_without_reverification(self):
        result = self.fixture.result()
        self.fixture.verify(result=self.fixture.result(branches=result.branches * 9))
        row = self.db.execute(
            "SELECT id,branches_json,verification_settings_json FROM candidate_assessments"
        ).fetchone()
        settings = json.loads(row["verification_settings_json"])
        settings.update(max_branches=256, max_multipv=32)
        with self.db:
            self.db.execute(
                "UPDATE candidate_assessments SET verification_settings_json=?",
                (json.dumps(settings),),
            )
        for force in (False, True):
            self.assertEqual(
                classify_solutions(self.db, registry=self.registry, force=force),
                {"classified": 1},
            )
        self.assertEqual(self.fixture.classify(force=True).status, "classified")
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM candidate_assessments").fetchone()[0],
            1,
        )
        self.assertEqual(
            self.db.execute(
                "SELECT branches_json FROM candidate_assessments"
            ).fetchone()[0],
            row["branches_json"],
        )

    def test_removing_branch_count_preserves_solution_without_database_copy(self):
        from pathlib import Path
        from tools.xiangqi_data.puzzle_mining.storage import open_database

        result = self.fixture.result()
        self.fixture.verify(result=self.fixture.result(branches=result.branches * 9))
        original = dict(
            self.db.execute("SELECT * FROM candidate_assessments").fetchone()
        )
        with self.db:
            self.db.execute(
                "ALTER TABLE candidate_assessments ADD COLUMN branch_count INTEGER NOT NULL DEFAULT 9"
            )
            self.db.execute("UPDATE metadata SET value='14' WHERE key='schema_version'")
        self.db.close()
        self.db = self.fixture.connection = open_database(self.fixture.path)
        self.assertEqual(
            dict(self.db.execute("SELECT * FROM candidate_assessments").fetchone()),
            original,
        )
        self.assertEqual(
            classify_solutions(self.db, registry=self.registry, force=True),
            {"classified": 1},
        )
        self.assertEqual(
            list(Path(self.fixture.path).parent.glob("*.pre-v*.sqlite3")), []
        )

    def test_new_verification_enters_pool_and_new_taxonomy_reenters_pool(self):
        self.assertEqual(classify_solutions(self.db), {})
        self.fixture.verify(result=self.fixture.result(complete=False))
        self.assertEqual(classify_solutions(self.db), {})
        self.fixture.verify(force=True)
        self.assertEqual(
            classify_solutions(self.db, registry=self.registry), {"classified": 1}
        )
        self.assertEqual(classify_solutions(self.db, registry=self.registry), {})
        updated = MotifRegistry([Motif("testKill", lambda trace: True, version="2")])
        self.assertEqual(
            classify_solutions(self.db, registry=updated), {"classified": 1}
        )
        self.assertEqual(
            classify_solutions(self.db, registry=updated, force=True),
            {"classified": 1},
        )
        self.fixture.verify(force=True)
        self.assertEqual(
            classify_solutions(self.db, registry=updated), {"classified": 1}
        )

    def test_live_phases_and_worker_partitions_preserve_ready_work(self):
        self.fixture.verify()
        self.db.execute(
            "CREATE TEMP TABLE IF NOT EXISTS live_candidates(id INTEGER PRIMARY KEY)"
        )
        self.db.execute("INSERT INTO live_candidates SELECT id FROM candidates")
        self.db.commit()
        self.assertEqual(
            classify_solutions(self.db, registry=self.registry, published_only=False),
            {},
        )
        results = [
            classify_solutions(
                self.db,
                registry=self.registry,
                partitions=3,
                partition=i,
                published_only=True,
            )
            for i in range(3)
        ]
        self.assertEqual(sum(r.get("classified", 0) for r in results), 1)
        self.assertEqual(classify_solutions(self.db, registry=self.registry), {})


if __name__ == "__main__":
    unittest.main()
