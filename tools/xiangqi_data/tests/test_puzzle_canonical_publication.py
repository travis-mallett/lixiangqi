"""Classification cannot shorten a solve, including old stored projections."""

import json
import unittest

from tools.xiangqi_data.puzzle_mining.storage import open_database


class CanonicalPublicationTest(unittest.TestCase):
    def test_v16_shortened_publication_is_restored_without_changing_verification(self):
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )

        fixture = PuzzleStorageLifecycleTest()
        fixture.setUp()
        self.addCleanup(fixture.tearDown)
        moves = ("a7a6", "a5a6", "b10c8")
        fixture.verify(result=fixture.result(moves))
        fixture.classify()
        db = fixture.connection
        canonical = tuple(
            db.execute(
                "SELECT id,solution_json,branches_json FROM candidate_assessments"
            ).fetchone()
        )
        old_id = db.execute(
            "SELECT id FROM puzzles WHERE verification_status='active'"
        ).fetchone()[0]
        # Recreate the v16 projection left by a category choosing an earlier payoff.
        with db:
            db.execute(
                "ALTER TABLE taxonomy_assessments ADD COLUMN solution_plies INTEGER"
            )
            db.execute("UPDATE taxonomy_assessments SET solution_plies=1")
            db.execute(
                "UPDATE puzzles SET solution=?,line=?,solution_plies=1",
                (json.dumps(moves[:1]), json.dumps(["a4a5", *moves[:1]])),
            )
            db.execute("UPDATE metadata SET value='16' WHERE key='schema_version'")
        db.close()
        fixture.connection = db = open_database(fixture.path)
        self.assertIsNone(fixture.current()["current_classification_id"])
        self.assertNotIn(
            "solution_plies",
            {r[1] for r in db.execute("PRAGMA table_info(taxonomy_assessments)")},
        )
        self.assertEqual(fixture.current()["current_verification_id"], canonical[0])
        fixture.classify()
        self.assertEqual(
            tuple(
                db.execute(
                    "SELECT id,solution_json,branches_json FROM candidate_assessments"
                ).fetchone()
            ),
            canonical,
        )
        active = db.execute(
            "SELECT id,solution FROM puzzles WHERE verification_status='active'"
        ).fetchone()
        self.assertEqual(json.loads(active["solution"]), list(moves))
        self.assertNotEqual(active["id"], old_id)
        old = db.execute(
            "SELECT solution,verification_status FROM puzzles WHERE id=?", (old_id,)
        ).fetchone()
        self.assertEqual(json.loads(old["solution"]), list(moves[:1]))
        self.assertEqual(old["verification_status"], "withdrawn")
        fixture.classify(force=True)
        self.assertEqual(
            db.execute(
                "SELECT count(*) FROM puzzles WHERE verification_status='active'"
            ).fetchone()[0],
            1,
        )
        self.assertEqual(
            db.execute(
                "SELECT id FROM puzzles WHERE verification_status='active'"
            ).fetchone()[0],
            active["id"],
        )
