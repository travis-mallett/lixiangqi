import copy
import importlib
import json
import os
import unittest
import uuid

from tools.puzzle_catalog.playback import from_evidence
from tools.puzzle_catalog.test_catalog import puzzle
from tools.puzzle_catalog.catalog import identity

migration = importlib.import_module("tools.data_migration.20260920_puzzle_playback")


class ProjectionTests(unittest.TestCase):
    def test_all_tied_branches_are_retained(self):
        p = puzzle()
        p["line"] = "a4a5 a7a6 b1c3 a6a5"
        lines = [
            ["a7a6", "b1c3", "a6a5"],
            ["a7a6", "b1c3", "a6b6"],
            ["c7c6", "b1c3", "c6c5"],
        ]
        evidence = {
            "branches": [
                {
                    "verification": {
                        "verified": True,
                        "objective": "mate",
                        "moves": moves,
                    }
                }
                for moves in lines
            ]
        }
        self.assertEqual(
            from_evidence(p, evidence), {"objective": "mate", "solutions": lines}
        )
        evidence["branches"][0]["verification"]["verified"] = False
        with self.assertRaisesRegex(ValueError, "verified branches"):
            from_evidence(p, evidence)

    def test_tactical_baseline_is_published_without_runtime_search(self):
        evidence = {
            "branches": [
                {
                    "verification": {
                        "verified": True,
                        "objective": "advantage",
                        "moves": ["a7a6"],
                        "decisions": [
                            {
                                "analysis": {
                                    "lines": [{"score": {"kind": "cp", "value": 825}}]
                                }
                            }
                        ],
                    }
                }
            ]
        }
        self.assertEqual(
            from_evidence(puzzle(), evidence),
            {"objective": "tactic", "startingCp": 825, "solutions": [["a7a6"]]},
        )


@unittest.skipUnless(
    os.environ.get("LIXIANGQI_MIGRATION_TEST_URI"), "isolated MongoDB URI required"
)
class MigrationTests(unittest.TestCase):
    def setUp(self):
        from pymongo import MongoClient

        self.client = MongoClient(os.environ["LIXIANGQI_MIGRATION_TEST_URI"])
        self.db = self.client["playback_test_" + uuid.uuid4().hex]
        self.originals = []
        self.payload = {"version": 1, "puzzles": []}
        for pid in ("00001", "00002"):
            p = puzzle(pid)
            playback = p.pop("playback")
            p.update(
                plays=19, glicko={"r": 1800}, votes=["precious"], unknown={"data": True}
            )
            self.originals.append(p)
            self.payload["puzzles"].append(
                {"identity": identity(p), "playback": playback}
            )
        self.db.puzzle2_puzzle.insert_many(copy.deepcopy(self.originals))

    def tearDown(self):
        self.client.drop_database(self.db.name)
        self.client.close()

    def test_resume_preserves_originals_and_does_not_replay_after_completion(self):
        def interrupt():
            raise RuntimeError("interrupted")

        with self.assertRaisesRegex(RuntimeError, "interrupted"):
            migration.migrate(self.db, self.payload, interrupt=interrupt)
        self.assertEqual(
            list(self.db[migration.BACKUP].find({}, sort=[("_id", 1)])), self.originals
        )
        migration.migrate(self.db, self.payload)
        for original in self.originals:
            target = self.db.puzzle2_puzzle.find_one({"_id": original["_id"]})
            target.pop("playback")
            self.assertEqual(target, original)
        self.db.puzzle2_puzzle.update_one({"_id": "00001"}, {"$inc": {"plays": 1}})
        self.assertTrue(migration.migrate(self.db, self.payload)["alreadyApplied"])
        self.assertEqual(self.db.puzzle2_puzzle.find_one({"_id": "00001"})["plays"], 20)

    def test_missing_or_mismatched_evidence_fails_before_any_mutation(self):
        self.payload["puzzles"][0]["identity"]["line"] = "a4a5 c7c6"
        with self.assertRaisesRegex(ValueError, "identity changed"):
            migration.migrate(self.db, self.payload)
        self.assertEqual(self.db[migration.BACKUP].count_documents({}), 0)
        self.assertEqual(
            list(self.db.puzzle2_puzzle.find({}, sort=[("_id", 1)])), self.originals
        )


if __name__ == "__main__":
    unittest.main()
