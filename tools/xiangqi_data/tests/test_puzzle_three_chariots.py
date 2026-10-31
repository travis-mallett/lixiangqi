import copy
import unittest
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining import three_chariots as detector
from tools.xiangqi_data.puzzle_mining.attack_evidence import geometric_attack
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish, EngineProtocolError
from tools.xiangqi_data.puzzle_mining.models import SearchContext, fen_side
from tools.xiangqi_data.puzzle_mining.position import decode_position
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

CAPTURE = {
    "f1": "K",
    "e10": "k",
    "e9": "a",
    "f10": "a",
    "e8": "P",
    "d9": "P",
    "h9": "R",
}
CAPTURE_MOVES = ("e8e9", "f10e9", "d9e9", "e10d10", "h9h10")
PIN = {
    "f1": "K",
    "e10": "k",
    "e9": "a",
    "d9": "P",
    "f9": "P",
    "h8": "R",
}
PIN_MOVES = ("h8h10", "e9f10", "f9e9")
THREE_PAWNS = {s: p for s, p in CAPTURE.items() if s not in {"h9", "f1"}}
THREE_PAWNS.update({"d1": "K", "g9": "P"})
CASES = (
    (CAPTURE, CAPTURE_MOVES),
    ({**CAPTURE, "d9": "R"}, CAPTURE_MOVES),
    (PIN, PIN_MOVES),
    (THREE_PAWNS, (*CAPTURE_MOVES[:3], "e10f10", "g9f9")),
)


def engine_stub():
    engine = Mock()

    def checking(context):
        fen = context.initial_fen
        board = decode_position(fen)
        red = fen_side(fen) == "red"
        king = next(s for s, p in board.items() if p == ("K" if red else "k"))
        return fen, tuple(
            s
            for s, p in board.items()
            if p.isupper() != red and geometric_attack(board, s, king)
        )

    engine.checking_pieces.side_effect = checking
    return engine


class ThreeChariotsTest(unittest.TestCase):
    def test_capture_sacrifice_and_pin_both_colors(self):
        for board, moves in CASES:
            for mirror in (False, True):
                with self.subTest(moves=moves, mirror=mirror):
                    trace = trace_for(board, moves, mirror)
                    record = detector.assess(engine_stub(), trace)
                    self.assertEqual(record["outcome"], "key")
                    self.assertEqual(detector.evidence_outcome(trace, record), "key")

    def test_pin_alone_does_not_replace_third_piece_check_or_capture(self):
        # The stationary chariot pins an advisor but has no historical check.
        board = {**PIN, "h10": "R", "f10": "a"}
        del board["h8"]
        del board["e9"]
        trace = trace_for(board, ("f9e9",))
        self.assertEqual(detector.assess(engine_stub(), trace)["outcome"], "not_key")

    def test_two_pieces_cannot_supply_three_identities(self):
        board = {s: p for s, p in CAPTURE.items() if s != "e8"}
        trace = trace_for(board, ("d9e9", "e10d10", "h9h10"))
        engine = engine_stub()
        self.assertEqual(detector.assess(engine, trace)["outcome"], "not_key")
        engine.checking_pieces.assert_not_called()

    def test_final_check_must_be_exclusively_chariot_or_pawn(self):
        # Horse c8 also checks d10 after the final chariot move.
        trace = trace_for({**CAPTURE, "c8": "N"}, CAPTURE_MOVES)
        self.assertEqual(detector.assess(engine_stub(), trace)["outcome"], "not_key")

    def test_missing_escape_control_rejects(self):
        trace = trace_for(PIN, PIN_MOVES)
        record = detector.assess(engine_stub(), trace)
        for escape in record["escapes"]:
            escape["checkers"] = []
        self.assertEqual(detector.evidence_outcome(trace, record), "not_key")

    def test_incomplete_stale_and_malformed_evidence(self):
        trace = trace_for(CAPTURE, CAPTURE_MOVES)
        record = detector.assess(engine_stub(), trace)
        for key, value in (("checks", []), ("escapes", []), ("logic_version", "old")):
            self.assertIsNone(detector.evidence_outcome(trace, {**record, key: value}))
        broken = copy.deepcopy(record)
        broken["checks"][0]["checkers"] = ["a1"]
        self.assertIsNone(detector.evidence_outcome(trace, broken))
        self.assertIsNone(detector.candidate(replace(trace, decisions=())))
        self.assertIsNone(
            detector.candidate(replace(trace, moves=("bad", *trace.moves[1:])))
        )
        engine = engine_stub()
        engine.checking_pieces.side_effect = EngineProtocolError("inspection failed")
        self.assertEqual(detector.assess(engine, trace)["outcome"], "inconclusive")

    def test_only_verified_checkmates(self):
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            taxonomy_versions,
        )

        self.assertIn(detector.THEME, taxonomy_versions())
        self.assertNotIn(
            detector.THEME, taxonomy_versions(candidate_type="tactic_candidate")
        )
        trace = trace_for(CAPTURE, CAPTURE_MOVES)
        for other in (
            replace(trace, verified=False),
            replace(trace, terminal=replace(trace.terminal, checked=False)),
            replace(trace, terminal=replace(trace.terminal, legal_moves=("d10d9",))),
        ):
            self.assertFalse(detector.candidate(other))

    def test_category_execution_and_saved_evidence(self):
        from tools.xiangqi_data.tests.test_puzzle_chariots_threatening_advisor import (
            ChariotsThreateningAdvisorTest,
        )
        from tools.xiangqi_data.puzzle_mining.classification import TacticalClassifier
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            _evaluate_category,
            _save_category,
            taxonomy_versions,
        )

        trace = trace_for(CAPTURE, CAPTURE_MOVES)
        helper = ChariotsThreateningAdvisorTest()
        self.addCleanup(helper.doCleanups)
        fixture = helper.fixture(trace)
        current = {
            "candidate_id": fixture.current()["id"],
            "current_verification_id": fixture.current()["current_verification_id"],
        }
        args = (
            fixture.connection,
            current,
            (trace,),
            TacticalClassifier(),
            detector.THEME,
        )
        outcome, proofs = _evaluate_category(*args, engine_stub(), None)
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

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_engine_legal_solutions_and_attack_inspections(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for board, moves in CASES:
            for mirror in (False, True):
                trace = trace_for(board, moves, mirror)
                for decision in trace.decisions:
                    self.assertIn(
                        decision.selected_move,
                        engine.inspect(decision.context).legal_moves,
                    )
                self.assertTrue(
                    engine.inspect(SearchContext(trace.terminal.fen, ())).checkmate
                )
                self.assertEqual(detector.assess(engine, trace)["outcome"], "key")
