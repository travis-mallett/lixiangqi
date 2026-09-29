import unittest
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining import three_immortals as detector
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
from tools.xiangqi_data.puzzle_mining.models import SearchContext
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

BASE = {"e1": "K", "d1": "R", "e10": "k", "e9": "a", "d9": "P", "f9": "P", "c7": "P"}


class ThreeImmortalsTest(unittest.TestCase):
    def test_palace_boundary_including_diagonals(self):
        for losing in ("red", "black"):
            for file in "abcdefghi":
                for rank in range(1, 11):
                    expected = "c" <= file <= "g" and (
                        rank >= 7 if losing == "black" else rank <= 4
                    )
                    self.assertEqual(
                        detector.near_palace(f"{file}{rank}", losing), expected
                    )

    def test_simultaneous_group_and_terminal_formation_both_colors(self):
        for mirror in (False, True):
            trace = trace_for(BASE, ("d9e9",), mirror)
            self.assertTrue(detector.candidate(trace))
            self.assertIsNone(detector.candidate(replace(trace, decisions=())))
            self.assertFalse(detector.candidate(replace(trace, verified=False)))
            for changes in ({"c7": "p"}, {"c7": "R"}):
                self.assertFalse(
                    detector.candidate(
                        trace_for({**BASE, **changes}, ("d9e9",), mirror)
                    )
                )
            board = {s: p for s, p in BASE.items() if s != "c7"}
            board["c6"] = "P"
            # The third pawn can first enter the area on the terminal move.
            self.assertTrue(detector.candidate(trace_for(board, ("c6c7",), mirror)))
            # Without entering the area there are only two pawns.
            self.assertFalse(detector.candidate(trace_for(board, ("d9e9",), mirror)))

    def test_identity_survives_movement_but_not_capture_or_replacement(self):
        board = {
            "e1": "K",
            "e10": "k",
            "d9": "P",
            "f9": "P",
            "c8": "P",
            "c6": "P",
            "g9": "r",
            "a7": "p",
        }
        for mirror in (False, True):
            trace = trace_for(board, ("c8b8", "g9f9", "c6c7", "a7a6", "c7d7"), mirror)
            expected = {"b3", "d2"} if mirror else {"b8", "d9"}
            self.assertEqual(detector.eligible_pawns(trace), expected)
            engine = Mock()
            engine.checking_pieces.return_value = (
                trace.terminal.fen,
                ("d4" if mirror else "d7",),
            )
            self.assertEqual(detector.assess(engine, trace)["outcome"], "not_key")
            engine.checking_pieces.return_value = (
                trace.terminal.fen,
                ("d2" if mirror else "d9",),
            )
            self.assertEqual(detector.assess(engine, trace)["outcome"], "key")
            engine.checking_pieces.return_value = (
                trace.terminal.fen,
                ("e10" if mirror else "e1",),
            )
            self.assertEqual(detector.assess(engine, trace)["outcome"], "not_key")

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_mate_and_versioned_branch_consensus(self):
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
            trace = trace_for(BASE, ("d9e9",), mirror)
            self.assertIn(
                trace.moves[0], engine.inspect(trace.decisions[0].context).legal_moves
            )
            self.assertTrue(
                engine.inspect(SearchContext(trace.terminal.fen, ())).checkmate
            )
            record = detector.assess(engine, trace)
            self.assertEqual(record["outcome"], "key")
            self.assertIsNone(
                detector.evidence_outcome(trace, {**record, "logic_version": "old"})
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
        missing = trace_for(
            {s: p for s, p in BASE.items() if s != "c7"}, ("d9e9",), True
        )
        self.assertEqual(
            _evaluate_category(
                fixture.connection,
                current,
                (trace, missing),
                TacticalClassifier(),
                detector.THEME,
                None,
                None,
            )[0],
            "conflict",
        )
