import unittest
from dataclasses import replace

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining import white_horse as detector
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
from tools.xiangqi_data.puzzle_mining.models import SearchContext
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

BASE = {"e1": "K", "f10": "k", "f9": "a", "b9": "N", "f5": "R", "e7": "R", "a6": "p"}
MOVES = ("b9d8", "a6a5", "f5f9")


class WhiteHorseTest(unittest.TestCase):
    def test_origin_identity_and_complete_ledger(self):
        for mirror in (False, True):
            trace = trace_for(BASE, MOVES, mirror)
            self.assertTrue(detector.candidate(trace))
            self.assertIsNone(detector.candidate(replace(trace, decisions=())))
            self.assertFalse(detector.candidate(replace(trace, verified=False)))
            self.assertFalse(
                detector.candidate(
                    replace(trace, terminal=replace(trace.terminal, checked=False))
                )
            )
            wrong_origin = {s: p for s, p in BASE.items() if s != "b9"}
            wrong_origin["c6"] = "N"
            self.assertFalse(
                detector.candidate(trace_for(wrong_origin, ("c6d8",), mirror))
            )
            self.assertFalse(
                detector.candidate(
                    trace_for({**BASE, "d8": "N", "a1": "R"}, ("a1a10",), mirror)
                )
            )
            broken = replace(
                trace, decisions=(replace(trace.decisions[-1], selected_move="a1a2"),)
            )
            self.assertIsNone(detector.candidate(broken))

    def test_target_identity_blocked_leg_and_horse_stays(self):
        for mirror in (False, True):
            for board, moves in (
                (BASE, ("b9d8",)),  # Old immediate horse mate is insufficient.
                ({**BASE, "e8": "p"}, MOVES),  # Advisor is behind a blocked leg.
                ({**BASE, "d9": "a"}, ("b9d8", "a6a5", "e7d9")),
                (BASE, ("b9d8", "a6a5", "d8f9")),  # Horse captures it itself.
                (BASE, MOVES + ("a5a4", "d8b9", "a4a3", "b9d8")),
                ({**BASE, "b7": "N"}, MOVES + ("a5a4", "d8b9", "a4a3", "b7d8")),
            ):
                self.assertFalse(detector.candidate(trace_for(board, moves, mirror)))
            # Track the targeted advisor even if it moves before being captured.
            self.assertTrue(
                detector.candidate(trace_for(BASE, ("b9d8", "f9e8", "e7e8"), mirror))
            )
        trace = trace_for(BASE, MOVES)
        record = detector.assess(None, trace)
        self.assertEqual(record["outcome"], "key")
        self.assertIsNone(
            detector.evidence_outcome(trace, {**record, "logic_version": "old"})
        )
        self.assertIsNone(detector.evidence_outcome(trace, {**record, "positions": []}))
        self.assertIsNone(detector.evidence_outcome(trace, {**record, "moves": []}))

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_mate_all_corners_both_colors_and_persistence(self):
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
            for origin, file, enemy_file in (("b9", "d", "f"), ("h9", "f", "d")):
                for rank in (8, 10):
                    board = {
                        "e1": "K",
                        enemy_file + "10": "k",
                        enemy_file + "9": "a",
                        enemy_file + "5": "R",
                        "e7": "R",
                        "a6": "p",
                        origin: "N",
                    }
                    trace = trace_for(
                        board,
                        (
                            origin + file + str(rank),
                            "a6a5",
                            enemy_file + "5" + enemy_file + "9",
                        ),
                        mirror,
                    )
                    for decision in trace.decisions:
                        self.assertIn(
                            decision.selected_move,
                            engine.inspect(decision.context).legal_moves,
                        )
                    self.assertTrue(
                        engine.inspect(SearchContext(trace.terminal.fen, ())).checkmate
                    )
                    self.assertEqual(detector.assess(engine, trace)["outcome"], "key")
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
        negative = replace(trace, terminal=replace(trace.terminal, checked=False))
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
