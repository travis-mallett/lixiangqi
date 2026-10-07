import unittest
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining import general_disrobing as detector
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
from tools.xiangqi_data.puzzle_mining.models import SearchContext
from tools.xiangqi_data.puzzle_mining.position import decode_position
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

PIN = decode_position("2Rcka3/4a4/b8/9/6N2/9/9/4B4/9/4K4 w - - 0 1")
PIN_MOVES = ("e3c1", "a8c10", "g6f8")
ESCAPE = {"e1": "K", "e2": "A", "d10": "k", "c8": "R", "a7": "p"}
ESCAPE_MOVES = ("e2f1", "a7a6", "c8d8")


class GeneralDisrobingTest(unittest.TestCase):
    def test_geometry_identity_and_three_winning_turn_limit(self):
        for mirror in (False, True):
            trace = trace_for(PIN, PIN_MOVES, mirror)
            self.assertTrue(detector.candidate(trace))
            self.assertIsNone(detector.candidate(replace(trace, decisions=())))
            self.assertFalse(detector.candidate(replace(trace, verified=False)))
            self.assertFalse(
                detector.candidate(trace_for({**PIN, "e3": "R"}, PIN_MOVES, mirror))
            )
            self.assertFalse(
                detector.candidate(trace_for({**PIN, "e5": "P"}, PIN_MOVES, mirror))
            )
            self.assertFalse(
                detector.candidate(trace_for({**PIN, "e9": "A"}, PIN_MOVES, mirror))
            )
            replaced = trace_for(
                {**PIN, "h9": "R"}, ("e3c1", "a8c10", "h9e9", "f10e9", "g6f8"), mirror
            )
            self.assertFalse(detector.candidate(replaced))
            # The pinned piece may move along the file and retain its identity.
            sliding = trace_for({**PIN, "e9": "r"}, ("e3c1", "e9e8", "g6f8"), mirror)
            self.assertTrue(detector.candidate(sliding))
            board = {**PIN, "a7": "p"}
            three = ("e3c1", "a7a6", "g6h4", "a6a5", "h4g6", "a5a4", "g6f8")
            four = (
                "e3c1",
                "a7a6",
                "g6h4",
                "a6a5",
                "h4g6",
                "a5a4",
                "g6h4",
                "a4a3",
                "h4f5",
            )
            self.assertTrue(detector.candidate(trace_for(board, three, mirror)))
            self.assertFalse(detector.candidate(trace_for(board, four, mirror)))
            # The escape-control case has no three-turn deadline.
            long_escape = (
                "e2f1",
                "a7a6",
                "c8b8",
                "a6a5",
                "b8c8",
                "a5a4",
                "c8b8",
                "a4a3",
                "b8d8",
            )
            self.assertTrue(detector.candidate(trace_for(ESCAPE, long_escape, mirror)))
            # Moving one guard does not qualify if another piece still blocks
            # the general's ray immediately after the move.
            self.assertFalse(
                detector.candidate(
                    trace_for({**ESCAPE, "e5": "P"}, ESCAPE_MOVES, mirror)
                )
            )

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_pin_and_escape_mates_both_colors(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            for board, moves in ((PIN, PIN_MOVES), (ESCAPE, ESCAPE_MOVES)):
                trace = trace_for(board, moves, mirror)
                for decision in trace.decisions:
                    self.assertIn(
                        decision.selected_move,
                        engine.inspect(decision.context).legal_moves,
                    )
                self.assertTrue(
                    engine.inspect(SearchContext(trace.terminal.fen, ())).checkmate
                )
                record = detector.assess(engine, trace)
                self.assertEqual(record["outcome"], "key")
                self.assertIsNone(
                    detector.evidence_outcome(trace, {**record, "logic_version": "old"})
                )
            checked = trace_for({**PIN, "a1": "r"}, PIN_MOVES, mirror)
            self.assertEqual(detector.assess(engine, checked)["outcome"], "not_key")
            # Another attacker controlling the escape defeats exclusivity.
            competing = trace_for({**ESCAPE, "f10": "R"}, ESCAPE_MOVES, mirror)
            self.assertEqual(detector.assess(engine, competing)["outcome"], "not_key")
            # Removing a guard behind the general never opens its forward ray.
            behind = {"e2": "K", "e1": "A", "d10": "k", "d7": "R", "a7": "p"}
            self.assertFalse(
                detector.candidate(trace_for(behind, ("e1f2", "a7a6", "d7d8"), mirror))
            )

    def test_persisted_evidence_and_all_branch_consensus(self):
        from tools.xiangqi_data.tests.test_puzzle_chariots_threatening_advisor import (
            ChariotsThreateningAdvisorTest,
        )
        from tools.xiangqi_data.puzzle_mining.classification import TacticalClassifier
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            _evaluate_category,
            _save_category,
            taxonomy_versions,
        )

        trace = trace_for(PIN, PIN_MOVES)
        helper = ChariotsThreateningAdvisorTest()
        fixture = helper.fixture(trace)
        self.addCleanup(helper.doCleanups)
        row = fixture.current()
        current = {
            "candidate_id": row["id"],
            "current_verification_id": row["current_verification_id"],
        }
        engine = Mock()
        engine.checking_pieces.side_effect = lambda context: (context.initial_fen, ())
        args = (
            fixture.connection,
            current,
            (trace,),
            TacticalClassifier(),
            detector.THEME,
        )
        outcome, proofs = _evaluate_category(*args, engine, None)
        self.assertEqual(outcome, "match")
        self.assertTrue(
            _save_category(
                fixture.connection,
                current,
                detector.THEME,
                taxonomy_versions(),
                outcome,
                proofs,
            )
        )
        self.assertEqual(_evaluate_category(*args, None, None)[0], "match")
        engine.checking_pieces.assert_called_once()
        negative = trace_for({**PIN, "e3": "R"}, PIN_MOVES)
        self.assertEqual(
            _evaluate_category(
                fixture.connection,
                current,
                (trace, negative),
                TacticalClassifier(),
                detector.THEME,
                None,
                None,
            )[0],
            "conflict",
        )
