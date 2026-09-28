import unittest
from dataclasses import replace

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining import double_ghosts
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
from tools.xiangqi_data.puzzle_mining.models import SearchContext
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

BASE = {"e1": "K", "d1": "R", "e10": "k", "e9": "a", "d9": "P", "f9": "P"}


class DoubleGhostsTest(unittest.TestCase):
    def test_tracked_pawn_can_capture_later_away_from_center(self):
        board = {"e1": "K", "e10": "k", "d9": "P", "f9": "P", "f10": "a", "a7": "p"}
        for mirror in (False, True):
            trace = trace_for(board, ("d9c9", "a7a6", "f9f10"), mirror)
            self.assertTrue(double_ghosts.candidate(trace))
            # A third pawn cannot substitute for either identified pawn.
            other = trace_for({**board, "f8": "P", "e8": "a"}, ("f8e8",), mirror)
            self.assertFalse(double_ghosts.candidate(other))
            # Capturing a participant and replacing it does not transfer identity.
            replacement = trace_for(
                {**board, "f8": "P", "g9": "r", "e9": "a"},
                ("d9c9", "g9f9", "f8f9", "a7a6", "f9e9"),
                mirror,
            )
            self.assertFalse(double_ghosts.candidate(replacement))
            # A successful capture remains sufficient if that pawn later dies.
            captured = trace_for(
                {**BASE, "g9": "r"},
                ("d9e9", "g9e9", "d1d10"),
                mirror,
            )
            self.assertTrue(double_ghosts.candidate(captured))

    def test_sequence_geometry_and_ledgers(self):
        for mirror in (False, True):
            trace = trace_for(BASE, ("d9e9",), mirror)
            self.assertTrue(double_ghosts.candidate(trace))
            delayed = {s: p for s, p in BASE.items() if s != "d9"}
            delayed.update({"d8": "P", "a7": "p"})
            self.assertTrue(
                double_ghosts.candidate(
                    trace_for(delayed, ("d8d9", "a7a6", "d9e9"), mirror)
                )
            )
            self.assertFalse(
                double_ghosts.candidate(
                    replace(trace, terminal=replace(trace.terminal, checked=False))
                )
            )
            self.assertIsNone(double_ghosts.candidate(replace(trace, decisions=())))
            self.assertFalse(double_ghosts.candidate(replace(trace, verified=False)))
            for square, piece in (("e9", "p"), ("e9", "A"), ("f9", "R"), ("f9", "p")):
                self.assertFalse(
                    double_ghosts.candidate(
                        trace_for({**BASE, square: piece}, ("d9e9",), mirror)
                    )
                )

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_mate_and_persistence(self):
        from tools.xiangqi_data.puzzle_mining.classification import TacticalClassifier
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            _evaluate_category,
            _save_category,
            taxonomy_versions,
        )

        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            trace = trace_for(BASE, ("d9e9",), mirror)
            self.assertIn(
                trace.moves[0], engine.inspect(trace.decisions[0].context).legal_moves
            )
            self.assertTrue(
                engine.inspect(SearchContext(trace.terminal.fen, ())).checkmate
            )
            record = double_ghosts.assess(engine, trace)
            self.assertEqual(record["outcome"], "key")
            self.assertIsNone(
                double_ghosts.evidence_outcome(
                    trace, {**record, "logic_version": "old"}
                )
            )
            competing = trace_for({**BASE, "h10": "R"}, ("d9e9",), mirror)
            self.assertEqual(double_ghosts.assess(None, competing)["outcome"], "key")

        from tools.xiangqi_data.tests.test_puzzle_chariots_threatening_advisor import (
            ChariotsThreateningAdvisorTest,
        )

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
            double_ghosts.THEME,
        )
        outcome, proofs = _evaluate_category(*args, engine, None)
        self.assertEqual(outcome, "match")
        self.assertTrue(
            _save_category(
                fixture.connection,
                current,
                double_ghosts.THEME,
                taxonomy_versions(),
                outcome,
                proofs,
            )
        )
        self.assertEqual(_evaluate_category(*args, None, None)[0], "match")
        self.assertEqual(
            _evaluate_category(
                fixture.connection,
                current,
                (trace, trace_for({**BASE, "e9": "p"}, ("d9e9",), mirror)),
                TacticalClassifier(),
                double_ghosts.THEME,
                engine,
                None,
            )[0],
            "conflict",
        )
