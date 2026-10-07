import unittest
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining import assisting_king as detector
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
from tools.xiangqi_data.puzzle_mining.models import SearchContext
from tools.xiangqi_data.puzzle_mining.position import decode_position
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

PIN = decode_position("2bk5/4P4/3cbc3/5R3/9/9/9/9/9/4K4 w - - 0 1")
PIN_MOVES = ("e1d1", "c10a8", "f7f8")
ESCAPE = {"f1": "K", "d10": "k", "c8": "R", "a7": "p"}
ESCAPE_MOVES = ("f1e1", "a7a6", "c8d8")


class AssistingKingTest(unittest.TestCase):
    def test_last_three_winning_moves_and_pin_geometry(self):
        for mirror in (False, True):
            self.assertTrue(detector.candidate(trace_for(PIN, PIN_MOVES, mirror)))
            board = {**PIN, "a7": "p"}
            third = ("e1d1", "c10a8", "f7g7", "a7a6", "g7g8")
            fourth = ("e1d1", "c10a8", "f7g7", "a7a6", "g7f7", "a6a5", "f7f8")
            self.assertTrue(detector.candidate(trace_for(board, third, mirror)))
            self.assertFalse(detector.candidate(trace_for(board, fourth, mirror)))
            self.assertFalse(
                detector.candidate(trace_for({**PIN, "d8": "C"}, PIN_MOVES, mirror))
            )
            self.assertFalse(
                detector.candidate(trace_for({**PIN, "d5": "p"}, PIN_MOVES, mirror))
            )
            vertical = {s: p for s, p in PIN.items() if s != "e1"}
            vertical["d1"] = "K"
            self.assertFalse(
                detector.candidate(
                    trace_for(vertical, ("d1d2", *PIN_MOVES[1:]), mirror)
                )
            )
            trace = trace_for(PIN, PIN_MOVES, mirror)
            self.assertIsNone(detector.candidate(replace(trace, decisions=())))
            self.assertFalse(detector.candidate(replace(trace, verified=False)))
            self.assertFalse(
                detector.candidate(
                    replace(
                        trace, terminal=replace(trace.terminal, legal_moves=("a7a6",))
                    )
                )
            )

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_checkmate_and_stalemate_both_colors(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            for board, moves, mate in (
                (
                    decode_position("2Rcka3/4a4/b8/9/6N2/9/9/9/9/3K5 w - - 0 1"),
                    ("d1e1", "a8c10", "g6f8"),
                    True,
                ),
                (ESCAPE, ESCAPE_MOVES, True),
                ({"f1": "K", "d10": "k", "c9": "R"}, ("f1e1",), False),
            ):
                trace = trace_for(board, moves, mirror)
                for decision in trace.decisions:
                    self.assertIn(
                        decision.selected_move,
                        engine.inspect(decision.context).legal_moves,
                    )
                terminal = engine.inspect(SearchContext(trace.terminal.fen, ()))
                self.assertTrue(terminal.terminal_win)
                self.assertEqual(terminal.checkmate, mate)
                trace = replace(trace, terminal=terminal)
                record = detector.assess(engine, trace)
                self.assertEqual(record["outcome"], "key")
                self.assertIsNone(
                    detector.evidence_outcome(trace, {**record, "logic_version": "old"})
                )
            competing = trace_for({**ESCAPE, "f10": "R"}, ESCAPE_MOVES, mirror)
            self.assertEqual(detector.assess(engine, competing)["outcome"], "not_key")
            blocked = trace_for({**ESCAPE, "e5": "P"}, ESCAPE_MOVES, mirror)
            self.assertFalse(detector.candidate(blocked))

    def test_cached_pin_proof_and_branch_consensus(self):
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
        trace = replace(trace, terminal=replace(trace.terminal, checked=False))
        helper = ChariotsThreateningAdvisorTest()
        fixture = helper.fixture(trace)
        self.addCleanup(helper.doCleanups)
        row = fixture.current()
        current = {
            "candidate_id": row["id"],
            "current_verification_id": row["current_verification_id"],
        }
        args = (
            fixture.connection,
            current,
            (trace,),
            TacticalClassifier(),
            detector.THEME,
        )
        engine = Mock()
        outcome, proofs = _evaluate_category(*args, engine, None)
        self.assertEqual(outcome, "match")
        engine.checking_pieces.assert_not_called()
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
        negative = trace_for({**PIN, "d8": "C"}, PIN_MOVES)
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
