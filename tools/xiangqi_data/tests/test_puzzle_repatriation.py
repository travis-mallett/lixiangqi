import unittest
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining import repatriation as detector
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
from tools.xiangqi_data.puzzle_mining.models import SearchContext
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

BASE = {"f1": "K", "d9": "k", "d7": "P", "c8": "N", "d10": "r", "f10": "r", "f5": "p"}
MOVES = ("d7d8", "d9e9", "d8e8", "e9e10", "e8e9")


class RepatriationTest(unittest.TestCase):
    def test_sequence_identity_direction_and_home(self):
        for mirror in (False, True):
            trace = trace_for(BASE, MOVES, mirror)
            self.assertTrue(detector.candidate(trace))
            self.assertIsNone(detector.candidate(replace(trace, decisions=())))
            self.assertFalse(detector.candidate(replace(trace, verified=False)))
            self.assertFalse(detector.candidate(trace_for(BASE, MOVES[:3], mirror)))
            # A different pawn cannot supply either subsequent check.
            self.assertFalse(
                detector.candidate(
                    trace_for(
                        {**BASE, "f8": "P"}, (*MOVES[:2], "f8e8", *MOVES[3:]), mirror
                    )
                )
            )
            self.assertFalse(
                detector.candidate(
                    trace_for({**BASE, "f9": "P"}, (*MOVES[:4], "f9e9"), mirror)
                )
            )
            self.assertFalse(
                detector.candidate(
                    trace_for(BASE, (*MOVES[:3], "e9f9", "e8e9"), mirror)
                )
            )
            # Forward general movement is forbidden even if the final square is home.
            forward = {"f1": "K", "e10": "k", "d8": "P"}
            self.assertFalse(
                detector.candidate(
                    trace_for(
                        forward, ("d8e8", "e10e9", "e8d8", "e9e10", "d8e8"), mirror
                    )
                )
            )
            # Earlier moves are permitted: only the final five must match.
            self.assertTrue(
                detector.candidate(
                    trace_for(
                        {**BASE, "a5": "P", "a7": "p"}, ("a5a6", "a7b7", *MOVES), mirror
                    )
                )
            )

    def test_each_check_must_come_from_the_tracked_pawn(self):
        trace = trace_for(BASE, MOVES)
        engine = Mock()
        positions = detector.check_positions(trace)
        for missing in range(3):
            engine.checking_pieces.side_effect = [
                (fen, () if i == missing else (move[2:],))
                for i, (_, fen, move) in enumerate(positions)
            ]
            self.assertEqual(detector.assess(engine, trace)["outcome"], "not_key")
        engine.checking_pieces.side_effect = [
            (fen, (move[2:],)) for _, fen, move in positions
        ]
        record = detector.assess(engine, trace)
        self.assertEqual(record["outcome"], "key")
        self.assertIsNone(
            detector.evidence_outcome(trace, {**record, "logic_version": "old"})
        )
        self.assertIsNone(
            detector.evidence_outcome(trace, {**record, "second_check": {}})
        )

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_mate_both_colors_and_persistence(self):
        from tools.xiangqi_data.tests.test_puzzle_chariots_threatening_advisor import (
            ChariotsThreateningAdvisorTest,
        )
        from tools.xiangqi_data.puzzle_mining.classification import TacticalClassifier
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            _evaluate_category,
            _save_category,
            taxonomy_versions,
        )

        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            trace = trace_for(BASE, MOVES, mirror)
            for decision in trace.decisions:
                self.assertIn(
                    decision.selected_move, engine.inspect(decision.context).legal_moves
                )
            self.assertTrue(
                engine.inspect(SearchContext(trace.terminal.fen, ())).checkmate
            )
            self.assertEqual(detector.assess(engine, trace)["outcome"], "key")
        # Both replies may be backward moves along the center file.
        retreat_board = {
            "e1": "K",
            "e8": "k",
            "d7": "P",
            "d10": "r",
            "f10": "r",
            "f5": "p",
        }
        retreat_moves = ("d7e7", "e8e9", "e7e8", "e9e10", "e8e9")
        for mirror in (False, True):
            retreat = trace_for(retreat_board, retreat_moves, mirror)
            for decision in retreat.decisions:
                self.assertIn(
                    decision.selected_move, engine.inspect(decision.context).legal_moves
                )
            self.assertTrue(
                engine.inspect(SearchContext(retreat.terminal.fen, ())).checkmate
            )
            self.assertEqual(detector.assess(engine, retreat)["outcome"], "key")
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
        invalid = replace(trace, terminal=replace(trace.terminal, checked=False))
        self.assertEqual(
            _evaluate_category(
                fixture.connection,
                current,
                (trace, invalid),
                TacticalClassifier(),
                detector.THEME,
                None,
                None,
            )[0],
            "conflict",
        )
