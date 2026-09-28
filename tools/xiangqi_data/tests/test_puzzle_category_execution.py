"""Category work is retained and reused independently of publication and other motifs."""

from collections import Counter
import json
import unittest
from unittest.mock import patch

from tools.xiangqi_data.puzzle_mining.classification import Motif, MotifRegistry
from tools.xiangqi_data.puzzle_mining.classification_job import (
    classify_solutions,
    taxonomy_versions,
)
from tools.xiangqi_data.puzzle_mining.category_status import pool_counts
from tools.xiangqi_data.tests import test_puzzle_storage_lifecycle as lifecycle


class CategoryExecutionTest(unittest.TestCase):
    def setUp(self):
        self.f = lifecycle.PuzzleStorageLifecycleTest()
        self.f.setUp()
        self.addCleanup(self.f.tearDown)
        self.f.verify()
        self.calls = Counter()

    def motif(self, name, matches, version="1"):
        def detector(trace):
            self.calls[name] += 1
            return matches

        return Motif(name, detector, version)

    def run_categories(self, *motifs, force=False):
        self.registry = MotifRegistry(motifs)
        return classify_solutions(
            self.f.connection, registry=self.registry, force=force
        )

    def test_new_category_revisits_both_matches_and_nonmatches_without_repeating_old_logic(
        self,
    ):
        old = self.motif("pawnPattern", False)
        self.run_categories(old)
        self.assertEqual(self.run_categories(old), {})
        new = self.motif("boltPattern", True)
        self.run_categories(old, new)
        self.assertEqual(dict(self.calls), {"pawnPattern": 1, "boltPattern": 1})
        extra = self.motif("horsePattern", True)
        self.run_categories(old, new, extra)
        self.assertEqual(
            dict(self.calls), {"pawnPattern": 1, "boltPattern": 1, "horsePattern": 1}
        )
        self.assertIn("boltPattern", json.loads(self.f.current()["themes_json"]))
        self.assertIn("horsePattern", json.loads(self.f.current()["themes_json"]))
        stats = pool_counts(self.f.connection, taxonomy_versions(self.registry))
        self.assertEqual(
            (stats["pool"], stats["current"], stats["needs_checks"]), (1, 1, 0)
        )

    def test_progress_counts_checks_separately_from_retained_solutions(self):
        old = self.motif("pawnPattern", False)
        self.run_categories(old)
        versions = taxonomy_versions(
            MotifRegistry([old, self.motif("horsePattern", True)])
        )
        stats = pool_counts(self.f.connection, versions)
        self.assertEqual(
            (stats["pool"], stats["current"], stats["needs_checks"]), (1, 0, 1)
        )
        category_count = sum(not name.startswith("__") for name in versions)
        self.assertEqual(
            (stats["total_checks"], stats["completed_checks"], stats["pending_checks"]),
            (category_count, category_count - 1, 1),
        )
        self.assertEqual((stats["matched"], stats["unmatched"]), (0, 0))

    def test_one_version_change_only_runs_that_category(self):
        old = self.motif("pawnPattern", True)
        other = self.motif("horsePattern", True)
        self.run_categories(old, other)
        identifier = self.f.connection.execute(
            "SELECT id FROM puzzles WHERE verification_status='active'"
        ).fetchone()[0]
        self.run_categories(self.motif("pawnPattern", False, "2"), other)
        self.assertEqual(dict(self.calls), {"pawnPattern": 2, "horsePattern": 1})
        self.assertNotIn("pawnPattern", json.loads(self.f.current()["themes_json"]))
        self.assertEqual(
            self.f.connection.execute(
                "SELECT id FROM puzzles WHERE verification_status='active'"
            ).fetchone()[0],
            identifier,
        )

    def test_new_solution_invalidates_all_category_results(self):
        motifs = [self.motif("pawnPattern", True), self.motif("horsePattern", False)]
        self.run_categories(*motifs)
        self.f.verify(force=True, result=self.f.result(("b7b6",)))
        self.run_categories(*motifs)
        self.assertEqual(dict(self.calls), {"pawnPattern": 2, "horsePattern": 2})

    def test_inconclusive_category_does_not_discard_other_completed_checks(self):
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            _evaluate_category,
        )

        motifs = [self.motif("aPending", True), self.motif("zComplete", True)]

        def evaluate(*args):
            return (
                ("inconclusive", {})
                if args[4] == "aPending"
                else _evaluate_category(*args)
            )

        with patch(
            "tools.xiangqi_data.puzzle_mining.classification_job._evaluate_category",
            side_effect=evaluate,
        ):
            self.assertEqual(
                self.run_categories(*motifs), {"awaiting_classification_evidence": 1}
            )
        stats = pool_counts(self.f.connection, taxonomy_versions(self.registry))
        self.assertEqual(
            (stats["pool"], stats["pending_checks"], stats["inconclusive_checks"]),
            (1, 1, 1),
        )
        self.run_categories(*motifs)
        self.assertEqual(dict(self.calls), {"zComplete": 1, "aPending": 1})

    def test_interruption_resumes_only_unfinished_categories(self):
        completed = self.motif("aComplete", False)
        pending = Motif(
            "zPending", lambda _: (_ for _ in ()).throw(KeyboardInterrupt())
        )
        with self.assertRaises(KeyboardInterrupt):
            self.run_categories(completed, pending)
        self.assertFalse(self.f.connection.in_transaction)
        self.run_categories(completed, self.motif("zPending", True))
        self.assertEqual(dict(self.calls), {"aComplete": 1, "zPending": 1})

    def test_force_is_explicit_and_does_not_reconstruct(self):
        motif = self.motif("pawnPattern", True)
        self.run_categories(motif)
        proof = self.f.current()["current_verification_id"]
        self.run_categories(motif, force=True)
        self.assertEqual(self.calls["pawnPattern"], 2)
        self.assertEqual(self.f.current()["current_verification_id"], proof)

    def test_historical_processing_status_is_not_worker_activity_or_pool_membership(
        self,
    ):
        motif = self.motif("pawnPattern", False)
        with self.f.connection:
            self.f.connection.execute("UPDATE candidates SET status='processing'")
        self.run_categories(motif)
        stats = pool_counts(self.f.connection, taxonomy_versions(self.registry))
        self.assertEqual(
            (stats["pool"], stats["current"], stats["unmatched"]), (1, 1, 1)
        )
        self.assertEqual(self.f.current()["status"], "untagged")

    def test_consensus_policy_change_rechecks_categories(self):
        motif = self.motif("pawnPattern", True)
        self.run_categories(motif)
        original = taxonomy_versions
        with patch(
            "tools.xiangqi_data.puzzle_mining.classification_job.taxonomy_versions",
            side_effect=lambda registry=None, **kwargs: {
                **original(registry, **kwargs),
                "__consensus__": "3",
            },
        ):
            self.run_categories(motif)
        self.assertEqual(self.calls["pawnPattern"], 2)

    def test_migration_preserves_completed_matches_without_database_copy(self):
        from pathlib import Path
        from tools.xiangqi_data.puzzle_mining.storage import open_database

        motif = self.motif("pawnPattern", False)
        other = self.motif("horsePattern", True)
        self.run_categories(motif, other)
        db = self.f.connection
        with db:
            db.execute("DROP TABLE category_assessments")
            db.execute("CREATE TABLE candidate_theme_scans(old_result TEXT)")
            db.execute("INSERT INTO candidate_theme_scans VALUES('original history')")
            db.execute("UPDATE metadata SET value='12' WHERE key='schema_version'")
            db.execute(
                "UPDATE candidates SET status='processing',claimed_at='2026-09-11',claim_token='orphan'"
            )
        proof_id = self.f.current()["current_verification_id"]
        db.close()
        self.f.connection = open_database(self.f.path)
        self.assertEqual(self.f.current()["current_verification_id"], proof_id)
        self.assertEqual(self.f.current()["status"], "published")
        self.assertIsNone(self.f.current()["claim_token"])
        self.assertEqual(self.run_categories(motif, other), {})
        self.assertEqual(dict(self.calls), {"pawnPattern": 1, "horsePattern": 1})
        self.assertIsNone(
            self.f.connection.execute(
                "SELECT name FROM sqlite_master WHERE name='candidate_theme_scans'"
            ).fetchone()
        )
        self.assertEqual(list(Path(self.f.path).parent.glob("*.pre-v*.sqlite3")), [])

    def test_complete_proof_without_current_history_is_outside_the_pool(self):
        self.run_categories(self.motif("pawnPattern", False))
        with self.f.connection:
            self.f.connection.execute(
                "UPDATE candidate_assessments SET verification_settings_json='{}'"
            )
        stats = pool_counts(self.f.connection, taxonomy_versions(self.registry))
        self.assertEqual(stats["pool"], 0)
        self.assertEqual(self.run_categories(*self.registry.motifs), {})


if __name__ == "__main__":
    unittest.main()
