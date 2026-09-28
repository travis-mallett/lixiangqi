"""Overlapping categories are valid; each label still needs branch agreement."""

import json
import unittest
from unittest.mock import Mock

from tools.xiangqi_data.puzzle_mining.classification import (
    MotifRegistry,
)
from tools.xiangqi_data.puzzle_mining.classification_job import (
    classify_solutions,
    reclassify_canonical,
)
from tools.xiangqi_data.puzzle_mining.models import PositionStatus
from tools.xiangqi_data.puzzle_mining.position import encode_position
from tools.xiangqi_data.puzzle_mining.solver import VerifiedBranch
from tools.xiangqi_data.tests import test_puzzle_storage_lifecycle as lifecycle


class CategoryOverlapTest(unittest.TestCase):
    def setUp(self):
        self.fixture = lifecycle.PuzzleStorageLifecycleTest()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)

    def test_all_shared_categories_and_only_shared_categories(self):
        cases = (
            (({"a", "b"},), {"a", "b"}, "classified"),
            (({"a", "b"}, {"a", "b"}), {"a", "b"}, "classified"),
            (({"a", "b"}, {"b", "c"}), {"b"}, "classified"),
            (({"b", "c"}, {"a", "b"}), {"b"}, "classified"),
            (({"a"}, {"a", "b"}), {"a"}, "classified"),
            (({"a", "b"}, {"c"}), set(), "category_conflict"),
            (({"a", "b"}, {"b", "c"}, {"a", "c"}), set(), "category_conflict"),
            (({"a", "b"}, set()), set(), "category_conflict"),
            ((set(),), set(), "uncategorized"),
        )
        f = self.fixture
        for categories, expected, status in cases:
            with self.subTest(categories=categories):
                moves = ("a7a6", "b7b6", "c7c6")
                branches = tuple(
                    f.result((move,)).primary for move in moves[: len(categories)]
                )
                f.verify(force=True, result=f.result(branches=branches))
                registry = MotifRegistry()
                for theme in ("a", "b", "c"):
                    registry.register(
                        theme,
                        lambda trace, theme=theme: (
                            theme in categories[moves.index(trace.moves[0])]
                        ),
                    )
                result = reclassify_canonical(f.connection, f.key, registry=registry)
                expected_themes = (
                    tuple(sorted(expected | {"mate", "mateIn1"})) if expected else ()
                )
                self.assertEqual(result.status, status)
                self.assertEqual(result.themes, expected_themes)

    def test_white_faced_general_and_double_cannons_reclassify_old_uncategorized(self):
        self.fixture.scope_categories(("whiteFacedGeneral", "doubleCannons"))
        f = self.fixture
        # The d-file cannons check; only the e-file general prevents escape to e10.
        fen = (
            encode_position({"e1": "K", "d10": "k", "d8": "C", "d6": "C"})
            + " b - - 0 1"
        )
        f.verify(
            result=f.result(
                branches=(VerifiedBranch(("c8d8",), PositionStatus(fen, True, ())),)
            )
        )
        engine = Mock()
        engine.checking_pieces.side_effect = lambda context: (
            context.initial_fen,
            ("e1",),
        )
        result = reclassify_canonical(f.connection, f.key, engine=engine)
        self.assertEqual(
            result.themes, ("doubleCannons", "mate", "mateIn1", "whiteFacedGeneral")
        )
        verification_id = f.current()["current_verification_id"]
        # Simulate revision 1's rejection of this overlap, retaining its proof.
        with f.connection:
            f.connection.execute(
                "UPDATE taxonomy_assessments SET taxonomy_version=json_set(taxonomy_version, '$.versions.__consensus__', '1'), status='uncategorized', themes_json='[]'"
            )
            f.connection.execute(
                "UPDATE candidates SET status='untagged', themes_json='[]'"
            )
        self.assertEqual(classify_solutions(f.connection), {"classified": 1})
        self.assertEqual(json.loads(f.current()["themes_json"]), list(result.themes))
        self.assertEqual(f.current()["current_verification_id"], verification_id)
        self.assertEqual(classify_solutions(f.connection), {})
        engine.analyse.assert_not_called()
