import json, sqlite3, tempfile, unittest
from contextlib import closing
from pathlib import Path
from tools.environment_data.snapshot import build_manifest
from tools.xiangqi_data.pikafish_rules import START_FEN
from tools.xiangqi_data.puzzle_mining.patterns import CENTROID_PAWN_LOGIC_VERSION
from .catalog import PuzzleCatalog, CatalogError


def puzzle(pid="00001", retired=False):
    return {
        "_id": pid,
        "gameId": "g1",
        "gameSource": {"type": "native", "origin": "https://example.test"},
        "fen": START_FEN,
        "line": "a4a5 a7a6",
        "playback": {"objective": "mate", "solutions": [["a7a6"]]},
        "themes": ["centroidPawnMate"],
        "retired": retired,
        "retirementReason": "review" if retired else None,
        "sourceSnapshot": {
            "initialFen": START_FEN,
            "moves": ["a4a5", "a7a6"],
            "players": [],
        },
    }


def verified_evidence(line="a4a5 a7a6"):
    return {
        "branches": [
            {
                "verification": {
                    "verified": True,
                    "objective": "mate",
                    "moves": line.split()[1:],
                }
            }
        ]
    }


def make_snapshot(root, ps):
    root.mkdir()
    (root / "mongo.archive.gz").write_bytes(b"x")
    (root / "native-games.jsonl").write_text("")
    (root / "puzzle-inventory.json").write_text(
        json.dumps({"schemaVersion": 1, "puzzles": ps, "native-games": []})
    )
    (root / "manifest.json").write_text(json.dumps(build_manifest(root, "snap")))


class Tests(unittest.TestCase):
    def setUp(self):
        # These tests mock the classifier itself. Evidence freshness is tested
        # against real staging records in the stage lifecycle suite.
        from unittest.mock import patch

        freshness = patch(
            "tools.puzzle_catalog.reclassification.current_audit_results",
            side_effect=lambda results: (
                (key, value["outcome"]) for key, value in results.items()
            ),
        )
        freshness.start()
        self.addCleanup(freshness.stop)
        self.t = tempfile.TemporaryDirectory()
        self.r = Path(self.t.name)
        self.s = self.r / "s"
        make_snapshot(self.s, [puzzle()])

    def tearDown(self):
        self.t.cleanup()

    def c(self):
        c = PuzzleCatalog(self.r / "c.db")
        c.import_inventory(self.s)
        return c

    def test_bootstrap_no_extra(self):
        c = self.c()
        self.assertEqual(len(c.puzzles()), 1)
        c.close()

    def test_existing_catalog_enables_concurrent_reads_without_changing_content(self):
        with self.c() as catalog:
            catalog.build_release()
            catalog.retire("00001", "review")
            before = list(catalog.db.iterdump())
        path = self.r / "c.db"
        with closing(sqlite3.connect(path)) as legacy:
            self.assertEqual(
                legacy.execute("PRAGMA journal_mode=DELETE").fetchone()[0], "delete"
            )
        with PuzzleCatalog(path) as catalog:
            self.assertEqual(
                catalog.db.execute("PRAGMA journal_mode").fetchone()[0], "wal"
            )
            self.assertEqual(list(catalog.db.iterdump()), before)

    def test_admit_requires_verified(self):
        c = self.c()
        with self.assertRaises(CatalogError):
            c.admit(puzzle("00002"), {})
        c.close()

    def test_admission_rejects_duplicate_solve_even_when_original_is_retired(self):
        with self.c() as c:
            for retired in (False, True):
                if retired:
                    c.retire("00001", "review")
                with self.assertRaisesRegex(
                    CatalogError, "Duplicate solve identity: 00002.*00001"
                ):
                    c.admit(puzzle("00002"), {"status": "verified", "assessmentId": 1})
                self.assertEqual(len(c.puzzles()), 1)

    def test_admission_allows_category_update_under_same_id(self):
        with self.c() as c:
            p = {**puzzle(), "themes": ["doubleCannons"]}
            c.admit(p, {"status": "verified", "assessmentId": 2})
            self.assertEqual(c.puzzles(), [p])

    def test_admission_distinguishes_source_origins(self):
        with self.c() as c:
            p = {
                **puzzle("00002"),
                "gameSource": {"type": "native", "origin": "https://another.test"},
            }
            c.admit(p, {"status": "verified", "assessmentId": 2})
            self.assertEqual(len(c.puzzles()), 2)

    def test_retire_identity(self):
        c = self.c()
        c.retire("00001", "review")
        self.assertEqual(c.puzzles()[0]["_id"], "00001")
        c.close()

    def test_identity_runtime(self):
        c = self.c()
        p = puzzle()
        p["plays"] = 1
        with self.assertRaises(CatalogError):
            c.admit(p, {"status": "verified", "assessmentId": "a"})
        p = puzzle()
        p["line"] = "a4a5 b7b6"
        with self.assertRaises(CatalogError):
            c.admit(p, {"status": "verified", "assessmentId": "a"})
        c.close()

    def test_unresolved_blocks(self):
        c = self.c()
        with self.assertRaises(CatalogError):
            c.admit(puzzle(), {"status": "unresolved", "assessmentId": "a"})
        c.close()

    def test_deterministic(self):
        c = self.c()
        a = c.build_release()
        b = c.build_release()
        self.assertEqual(a, b)
        c.close()

    def test_forged_inventory_rejected(self):
        c = PuzzleCatalog(self.r / "x.db")
        with self.assertRaises((CatalogError, ValueError, FileNotFoundError)):
            c.import_inventory({"verified": True})
        c.close()

    def test_frozen_release_audit_is_optional_resumable_and_ignores_later_admissions(
        self,
    ):
        from unittest.mock import patch

        with self.c() as catalog:
            parent = catalog.build_release()
            catalog.admit(
                {**puzzle("00002"), "gameId": "g2"},
                {"status": "verified", "assessmentId": 1},
            )
            result = {
                "outcome": "unresolved",
                "reason": "budget",
                "themeVersion": CENTROID_PAWN_LOGIC_VERSION,
                "evidence": verified_evidence(),
            }
            with patch(
                "tools.puzzle_catalog.reclassification.assess_puzzle",
                return_value=result,
            ) as assess:
                outcomes = catalog.reclassify(
                    parent["releaseId"],
                    "centroidPawnMate",
                    None,
                    None,
                )
            self.assertEqual(outcomes["total"], 1)
            self.assertEqual(outcomes["completed"], 0)
            self.assertEqual(outcomes["outcomes"]["unresolved"], 1)
            self.assertEqual(assess.call_count, 1)
            self.assertFalse(catalog.puzzles()[0]["retired"])
            # An inconclusive optional audit leaves the authored puzzle and
            # release validity unchanged.
            self.assertEqual(
                len(catalog.build_release(parent["releaseId"])["puzzles"]), 2
            )
            progress = []
            with patch(
                "tools.puzzle_catalog.reclassification.assess_puzzle",
                return_value=result,
            ) as assess:
                resumed = catalog.reclassify(
                    parent["releaseId"],
                    "centroidPawnMate",
                    None,
                    None,
                    progress=progress.append,
                )
            assess.assert_called_once()
            self.assertEqual(resumed["completed"], 0)
            self.assertEqual(resumed["remaining"], 1)
            self.assertEqual(progress[-1], resumed)

    def test_completed_category_change_updates_existing_id(self):
        from unittest.mock import patch

        result = {
            "outcome": "does_not_qualify",
            "reason": "changed category",
            "themeVersion": CENTROID_PAWN_LOGIC_VERSION,
            "categories": ["octagonalHorse"],
            "publicationId": "00001",
            "evidence": verified_evidence(),
        }
        with self.c() as catalog:
            parent = catalog.build_release()
            with patch(
                "tools.puzzle_catalog.reclassification.assess_puzzle",
                return_value=result,
            ):
                catalog.reclassify(parent["releaseId"], "centroidPawnMate", None, None)
            [new] = catalog.puzzles()
            self.assertFalse(new["retired"])
            self.assertEqual(new["_id"], "00001")
            self.assertEqual(new["themes"], ["octagonalHorse"])
            with patch(
                "tools.puzzle_catalog.reclassification.assess_puzzle",
                side_effect=AssertionError("already completed"),
            ):
                catalog.reclassify(parent["releaseId"], "centroidPawnMate", None, None)
            self.assertEqual(len(catalog.puzzles()), 1)

    def test_audit_rejects_second_id_for_same_solve_and_rolls_back_retirement(self):
        from unittest.mock import patch

        with self.c() as catalog:
            parent = catalog.build_release()
            result = {
                "outcome": "qualifies",
                "themeVersion": CENTROID_PAWN_LOGIC_VERSION,
                "categories": ["octagonalHorse"],
                "publicationId": "00002",
                "evidence": verified_evidence(),
            }
            with patch(
                "tools.puzzle_catalog.reclassification.assess_puzzle",
                return_value=result,
            ):
                with self.assertRaisesRegex(CatalogError, "Duplicate solve identity"):
                    catalog.reclassify(
                        parent["releaseId"], "centroidPawnMate", None, None
                    )
            self.assertEqual(catalog.puzzles(), [puzzle()])
            self.assertEqual(
                catalog.db.execute(
                    "SELECT count(*) FROM catalog_assessments"
                ).fetchone()[0],
                0,
            )

    def test_audit_changed_solution_then_return_updates_saved_ids(self):
        with self.c() as catalog:
            with catalog.db:
                catalog._apply_completed_assessment(
                    puzzle(),
                    1,
                    {
                        "categories": ["octagonalHorse"],
                        "publicationId": "00002",
                        "line": "a4a5 b7b6",
                        "evidence": verified_evidence("a4a5 b7b6"),
                    },
                )
            by_id = {p["_id"]: p for p in catalog.puzzles()}
            self.assertTrue(by_id["00001"]["retired"])
            self.assertFalse(by_id["00002"]["retired"])
            with catalog.db:
                catalog._apply_completed_assessment(
                    puzzle(),
                    2,
                    {
                        "categories": ["doubleCannons"],
                        "publicationId": "00001",
                        "line": puzzle()["line"],
                        "evidence": verified_evidence(),
                    },
                )
            by_id = {p["_id"]: p for p in catalog.puzzles()}
            self.assertEqual(len(by_id), 2)
            self.assertFalse(by_id["00001"]["retired"])
            self.assertEqual(by_id["00001"]["themes"], ["doubleCannons"])
            self.assertTrue(by_id["00002"]["retired"])

    def test_interrupted_audit_preserves_completed_results_and_resumes_remaining(self):
        from unittest.mock import patch

        negative = {
            "outcome": "does_not_qualify",
            "reason": "new logic",
            "categories": [],
            "themeVersion": CENTROID_PAWN_LOGIC_VERSION,
            "evidence": verified_evidence(),
        }
        positive = {
            "outcome": "qualifies",
            "reason": "theme_match",
            "categories": ["centroidPawnMate"],
            "publicationId": "00002",
            "themeVersion": CENTROID_PAWN_LOGIC_VERSION,
            "evidence": verified_evidence(),
        }
        with self.c() as catalog:
            catalog.admit(
                {**puzzle("00002"), "gameId": "g2"},
                {"status": "verified", "assessmentId": 2},
            )
            parent = catalog.build_release()
            with patch(
                "tools.puzzle_catalog.reclassification.assess_puzzle",
                side_effect=[negative, KeyboardInterrupt()],
            ):
                with self.assertRaises(KeyboardInterrupt):
                    catalog.reclassify(
                        parent["releaseId"], "centroidPawnMate", None, None
                    )
            self.assertTrue(
                next(item for item in catalog.puzzles() if item["_id"] == "00001")[
                    "retired"
                ]
            )
            self.assertEqual(
                catalog.audit_plan(parent["releaseId"], "centroidPawnMate")[
                    "remaining"
                ],
                1,
            )
            with patch(
                "tools.puzzle_catalog.reclassification.assess_puzzle",
                return_value=positive,
            ) as assess:
                catalog.reclassify(parent["releaseId"], "centroidPawnMate", None, None)
            assess.assert_called_once()
            by_id = {item["_id"]: item for item in catalog.puzzles()}
            self.assertTrue(by_id["00001"]["retired"])
            self.assertIn("centroidPawnMate", by_id["00001"]["themes"])
            self.assertIn("centroidPawnMate", by_id["00002"]["themes"])


if __name__ == "__main__":
    unittest.main()
