"""Tactics share the same versioned category execution as mating puzzles."""

from dataclasses import replace
import json
import unittest
from unittest.mock import patch
from tools.xiangqi_data.puzzle_mining.candidate_classification import (
    classify_candidates,
)
from tools.xiangqi_data.puzzle_mining.classification import Motif, MotifRegistry
from tools.xiangqi_data.puzzle_mining.classification_job import TaxonomyResult
from tools.xiangqi_data.puzzle_mining.storage import insert_candidate
from tools.xiangqi_data.puzzle_mining.position import encode_position
from tools.xiangqi_data.tests import test_puzzle_storage_lifecycle as lifecycle


class CandidateClassificationTests(unittest.TestCase):
    def setUp(self):
        self.f = lifecycle.PuzzleStorageLifecycleTest()
        self.f.setUp()
        self.addCleanup(self.f.tearDown)
        self.f.verify()
        self.db = self.f.connection
        with self.db:
            self.db.execute("UPDATE candidates SET candidate_type='tactic_candidate'")

    def classify(self, registry):
        return classify_candidates(
            self.db, candidate_type="tactic_candidate", registry=registry
        )

    def test_versions_and_negative_results_are_reused(self):
        calls = []
        motif = Motif("fork", lambda _: calls.append("fork") or False, "1")
        registry = MotifRegistry([motif])
        self.assertEqual(self.classify(registry).queued, 1)
        self.assertEqual(self.classify(registry).current, 1)
        with self.db:
            self.db.execute(
                "UPDATE candidates SET discovery_revision='new-discovery',status='rejected'"
            )
        self.assertEqual(self.classify(registry).current, 1)
        self.assertEqual(calls, ["fork"])
        registry.register(
            "skewer", lambda _: calls.append("skewer") or True, version="1"
        )
        self.assertEqual(self.classify(registry).queued, 1)
        self.assertEqual(calls, ["fork", "skewer"])

    def test_current_solution_is_not_reconstructed(self):
        proof = self.f.current()["current_verification_id"]
        registry = MotifRegistry([Motif("fork", lambda _: True)])
        self.classify(registry)
        line = self.db.execute(
            "SELECT line FROM puzzles WHERE verification_status='active'"
        ).fetchone()[0]
        self.assertEqual(json.loads(line), ["a4a5", "a7a6"])
        self.assertEqual(self.f.current()["current_verification_id"], proof)
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM candidate_assessments").fetchone()[0],
            1,
        )

    def test_unverified_candidate_has_no_category_verdict(self):
        with self.db:
            self.db.execute("UPDATE candidates SET current_verification_id=NULL")
        self.assertEqual(self.classify(MotifRegistry()).awaiting_verifier, 1)
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM category_assessments").fetchone()[0],
            0,
        )

    def test_verification_race_cannot_stamp_old_result(self):
        def race(_):
            with self.db:
                self.db.execute("UPDATE candidates SET current_verification_id=NULL")
            return True

        report = self.classify(MotifRegistry([Motif("aRace", race)]))
        self.assertEqual(report.changed, 0)
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM category_assessments").fetchone()[0],
            0,
        )

    def test_pagination_covers_more_than_one_page(self):
        squares = [
            f"{file}{rank}"
            for rank in range(1, 11)
            for file in "abcdefghi"
            if f"{file}{rank}" not in {"e1", "e5", "e10"}
        ]
        for i in range(105):
            # Admission deduplicates board + side, independent of source IDs.
            fen = encode_position(
                {"e1": "K", "e10": "k", "e5": "P", squares[i % len(squares)]: "R"}
            ) + (" w" if i < len(squares) else " b") + " - - 0 1"
            identifier = insert_candidate(
                self.db,
                replace(
                    self.f.candidate(),
                    candidate_key=f"extra-{i}",
                    game_id=f"g-{i}",
                    position_fen=fen,
                    candidate_type="tactic_candidate",
                ),
            )
            self.assertIsNotNone(identifier)
        with patch(
            "tools.xiangqi_data.puzzle_mining.candidate_classification.reclassify_canonical",
            return_value=TaxonomyResult("classified"),
        ) as classify:
            self.assertEqual(self.classify(MotifRegistry()).queued, 106)
            self.assertEqual(classify.call_count, 106)


if __name__ == "__main__":
    unittest.main()
