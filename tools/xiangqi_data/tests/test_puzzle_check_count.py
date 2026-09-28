import unittest
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining.check_count import ASSESSORS, THEMES
from tools.xiangqi_data.puzzle_mining.engine import EngineProtocolError, OfflinePikafish
from tools.xiangqi_data.puzzle_mining.models import SearchContext
from tools.xiangqi_data.puzzle_mining.patterns import (
    CHECK_COUNT_REQUIREMENTS,
    TerminalPosition,
    classification_logic_version,
    matching_assessed_themes,
)
from tools.xiangqi_data.puzzle_mining.position import (
    FenState,
    decode_position,
    encode_position,
)

# The existing Double, Triple, and Quadruple Check Theme-page lessons.
LESSONS = (
    (
        "3akab2/9/4b4/9/4N4/4C4/9/9/2nr5/3AKA3 w - - 0 1",
        "e6f8",
        {"e5", "f8"},
    ),
    (
        "2bakab2/5PNC1/9/4C4/9/9/9/4B4/4A4/4KAB2 w - - 0 1",
        "f9e9",
        {"e7", "e9", "g9"},
    ),
    (
        "2bakab2/1R3RN2/5N3/4C4/9/9/9/4B4/4A4/4KAB2 w - - 0 1",
        "f9e9",
        {"e7", "e9", "f8", "g9"},
    ),
)


def terminal(initial=LESSONS[-1][0], move=LESSONS[-1][1], mirror=False):
    state = FenState(initial)
    state.push(move)
    if mirror:
        board = {
            f"{s[0]}{11 - int(s[1:])}": p.swapcase() for s, p in state.position.items()
        }
        return TerminalPosition(encode_position(board) + " w - - 0 1", True, "red")
    return TerminalPosition(state.fen(), True, "black")


class CheckCountTest(unittest.TestCase):
    def engine(self, t, checkers):
        engine = Mock()
        engine.checking_pieces.return_value = (t.fen, tuple(checkers))
        return engine

    def test_exact_counts_are_distinct_for_both_colors(self):
        for mirror in (False, True):
            t = terminal(mirror=mirror)
            squares = ("e7", "e9", "f8", "g9", "b9")
            if mirror:
                squares = tuple(f"{s[0]}{11 - int(s[1:])}" for s in squares)
            for count in range(6):
                records = {}
                for role in ASSESSORS:
                    with self.subTest(mirror=mirror, count=count, theme=role.theme):
                        engine = self.engine(t, squares[:count])
                        record = role.assess(engine, t)
                        expected = (
                            "key"
                            if count == CHECK_COUNT_REQUIREMENTS[role.theme]
                            else "not_key"
                        )
                        self.assertEqual(record["outcome"], expected)
                        records[role.theme] = record
                        engine.checking_pieces.assert_called_once()
                        engine.inspect.assert_not_called()
                        engine.analyse.assert_not_called()
                self.assertEqual(
                    matching_assessed_themes(t, records, THEMES),
                    {
                        theme
                        for theme, required in CHECK_COUNT_REQUIREMENTS.items()
                        if required == count
                    },
                )
            self.assertEqual(matching_assessed_themes(t, {}, THEMES), set())

    def test_nonmate_and_insufficient_material_need_no_inspection(self):
        t = terminal()
        for role in ASSESSORS:
            engine = Mock()
            for other in (
                replace(t, checkmate=False),
                replace(t, checkmate=False, stalemate=True),
                TerminalPosition("4k4/9/9/9/9/9/9/9/9/3K5 b - - 0 1", True, "black"),
            ):
                self.assertFalse(role.candidate(other))
                self.assertEqual(role.assess(engine, other)["outcome"], "not_key")
                self.assertEqual(
                    matching_assessed_themes(other, {}, {role.theme}), set()
                )
            self.assertEqual(engine.mock_calls, [])

    def test_board_version_distinctness_and_enemy_identity_validation(self):
        t = terminal()
        for role in ASSESSORS:
            record = role.assess(self.engine(t, ("e7", "e9", "f8", "g9")), t)
            for field, value in (("logic_version", "old"), ("terminal_fen", "old")):
                self.assertIsNone(role.evidence_outcome(t, {**record, field: value}))
            self.assertIsNone(role.evidence_outcome(t, None))
            for inspection in (
                None,
                {"fen": t.fen, "checkers": ["e7", "e7"]},
                {"fen": t.fen, "checkers": ["e7", "d10"]},
                {"fen": t.fen, "checkers": ["e7", "i1"]},
                {"fen": t.fen.replace(" b ", " w "), "checkers": ["e7", "e9"]},
            ):
                self.assertIsNone(
                    role.evidence_outcome(t, {**record, "terminal": inspection})
                )
            # A saved outcome from a different count never overrides this count.
            expected = "key" if CHECK_COUNT_REQUIREMENTS[role.theme] == 4 else "not_key"
            self.assertEqual(
                role.evidence_outcome(t, {**record, "outcome": "key"}), expected
            )
            self.assertEqual(
                role.evidence_outcome(t, {**record, "outcome": "not_key"}), expected
            )
            engine = self.engine(t, ())
            engine.checking_pieces.side_effect = EngineProtocolError("unavailable")
            self.assertEqual(role.assess(engine, t)["outcome"], "inconclusive")
        self.assertEqual(
            classification_logic_version(THEMES),
            "doubleCheckMate@1.0,quadrupleCheckMate@1.0,tripleCheckMate@1.0",
        )

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_lesson_checkmates_and_nonmating_checks_for_both_colors(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for initial, move, expected in LESSONS:
            self.assertIn(move, engine.inspect(SearchContext(initial, ())).legal_moves)
            for mirror in (False, True):
                t = terminal(initial, move, mirror)
                status = engine.inspect(SearchContext(t.fen, ()))
                self.assertTrue(status.checkmate)
                _, checking = engine.checking_pieces(SearchContext(t.fen, ()))
                mirrored = (
                    {f"{s[0]}{11 - int(s[1:])}" for s in expected}
                    if mirror
                    else expected
                )
                self.assertEqual(set(checking), mirrored)
                for role in ASSESSORS:
                    self.assertEqual(
                        role.assess(engine, t)["outcome"],
                        (
                            "key"
                            if CHECK_COUNT_REQUIREMENTS[role.theme] == len(expected)
                            else "not_key"
                        ),
                    )
        # Two horses check a general that can still escape to f10.
        fen = "4k4/2N3N2/9/9/9/9/9/9/9/3K5 b - - 0 1"
        status = engine.inspect(SearchContext(fen, ()))
        self.assertTrue(status.checked)
        self.assertFalse(status.checkmate)
        self.assertEqual(
            set(engine.checking_pieces(SearchContext(fen, ()))[1]), {"c9", "g9"}
        )
        t = TerminalPosition(fen, status.checkmate, "black", status.stalemate)
        self.assertEqual(matching_assessed_themes(t, {}, THEMES), set())

    def test_persisted_inspection_is_shared_and_category_results_requeue(self):
        from tools.xiangqi_data.puzzle_mining.category_status import pool_counts
        from tools.xiangqi_data.puzzle_mining.classification import TacticalClassifier
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            _evaluate_category,
            _save_category,
            taxonomy_versions,
        )
        from tools.xiangqi_data.puzzle_mining.solver import VerifiedBranch
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )
        from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

        f = PuzzleStorageLifecycleTest()
        f.setUp(themes=None)
        self.addCleanup(f.tearDown)
        trace = trace_for(decode_position(LESSONS[-1][0]), (LESSONS[-1][1],))
        f.verify(
            result=f.result(
                branches=(
                    VerifiedBranch(
                        trace.moves, trace.terminal, decisions=trace.decisions
                    ),
                )
            )
        )
        current = {
            "candidate_id": f.current()["id"],
            "current_verification_id": f.current()["current_verification_id"],
        }
        t = TerminalPosition(trace.terminal.fen, True, "black")
        engine = self.engine(t, LESSONS[-1][2])
        versions = taxonomy_versions()
        selected_versions = {
            k: v for k, v in versions.items() if k in THEMES or k == "__consensus__"
        }
        self.assertEqual(
            pool_counts(f.connection, selected_versions)["pending_checks"], 3
        )
        for role in ASSESSORS:
            outcome, proofs = _evaluate_category(
                f.connection,
                current,
                (trace,),
                TacticalClassifier(),
                role.theme,
                engine,
                None,
            )
            self.assertEqual(
                outcome,
                "match" if CHECK_COUNT_REQUIREMENTS[role.theme] == 4 else "no_match",
            )
            self.assertTrue(
                _save_category(
                    f.connection, current, role.theme, versions, outcome, proofs
                )
            )
        engine.checking_pieces.assert_called_once()
        self.assertEqual(
            pool_counts(f.connection, selected_versions)["pending_checks"], 0
        )
        with f.connection:
            f.connection.execute(
                "DELETE FROM category_assessments WHERE category=?",
                ("quadrupleCheckMate",),
            )
            f.connection.execute(
                "DELETE FROM motif_removal_evidence WHERE theme=?",
                ("quadrupleCheckMate",),
            )
        self.assertEqual(
            pool_counts(f.connection, selected_versions)["pending_checks"], 1
        )
        outcome, proofs = _evaluate_category(
            f.connection,
            current,
            (trace,),
            TacticalClassifier(),
            "quadrupleCheckMate",
            None,
            None,
        )
        self.assertEqual(outcome, "match")
        self.assertTrue(
            _save_category(
                f.connection, current, "quadrupleCheckMate", versions, outcome, proofs
            )
        )
        self.assertEqual(
            pool_counts(f.connection, selected_versions)["pending_checks"], 0
        )
        # Stale or mismatched shared evidence cannot classify a terminal board.
        with f.connection:
            f.connection.execute(
                "UPDATE motif_removal_evidence SET evidence_json=json_set(evidence_json,'$.terminal_fen','stale')"
            )
        outcome, _ = _evaluate_category(
            f.connection,
            current,
            (trace,),
            TacticalClassifier(),
            "doubleCheckMate",
            None,
            None,
        )
        self.assertEqual(outcome, "inconclusive")
        # Different branch counts prevent the category from qualifying throughout.
        second = replace(
            trace, terminal=replace(trace.terminal, fen=terminal(*LESSONS[0][:2]).fen)
        )
        engine = Mock()
        engine.checking_pieces.side_effect = lambda ctx: (
            ctx.initial_fen,
            tuple(LESSONS[-1][2] if ctx.initial_fen == t.fen else LESSONS[0][2]),
        )
        outcome, _ = _evaluate_category(
            f.connection,
            current,
            (trace, second),
            TacticalClassifier(),
            "quadrupleCheckMate",
            engine,
            None,
        )
        self.assertEqual(outcome, "conflict")


if __name__ == "__main__":
    unittest.main()
