import copy
import unittest
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish, EngineProtocolError
from tools.xiangqi_data.puzzle_mining.models import (
    PositionStatus,
    SearchContext,
    SearchResult,
    VerifiedDecision,
    VerifiedTrace,
    fen_side,
)
from tools.xiangqi_data.puzzle_mining.position import FenState, encode_position, UI_MOVE
from tools.xiangqi_data.puzzle_mining.throat_cutting import CHARIOT_MATE

candidate = CHARIOT_MATE.candidate
assess = CHARIOT_MATE.assess
evidence_outcome = CHARIOT_MATE.evidence_outcome
THEME = CHARIOT_MATE.theme


def trace_for(pieces=None, moves=None, mirror=False):
    pieces = pieces or {
        "e1": "K",
        "f10": "k",
        "e9": "a",
        "d10": "a",
        "e7": "R",
        "h9": "R",
        "h8": "N",
        "c9": "N",
    }
    moves = moves or ("e7e9", "d10e9", "h9f9")
    if mirror:
        pieces = {s[0] + str(11 - int(s[1:])): p.swapcase() for s, p in pieces.items()}
        moves = tuple(
            m[1] + str(11 - int(m[2])) + m[3] + str(11 - int(m[4]))
            for move in moves
            for m in [UI_MOVE.fullmatch(move)]
        )
    state = FenState(encode_position(pieces) + (" b" if mirror else " w") + " - - 0 1")
    decisions = []
    for move in moves:
        fen = state.fen()
        decisions.append(
            VerifiedDecision(
                SearchContext(fen, ()),
                fen_side(fen),
                (move,),
                move,
                SearchResult("test", "test", move, ()),
                position_fen=fen,
            )
        )
        state.push(move)
    return VerifiedTrace(
        moves, PositionStatus(state.fen(), True, ()), tuple(decisions), verified=True
    )


class ThroatCuttingTest(unittest.TestCase):
    def engine(self, checkers=("f9",)):
        engine = Mock()
        engine.checking_pieces.side_effect = lambda context: (
            context.initial_fen,
            checkers,
        )
        return engine

    def test_both_colors_and_sole_final_moving_chariot(self):
        for mirror in (False, True):
            trace = trace_for(mirror=mirror)
            self.assertTrue(candidate(trace))
            engine = self.engine(("f2",) if mirror else ("f9",))
            self.assertEqual(assess(engine, trace)["outcome"], "key")
            self.assertEqual(engine.checking_pieces.call_count, 1)
            engine.analyse.assert_not_called()
        for checkers in ((), ("e1",), ("f9", "e1")):
            self.assertEqual(
                assess(self.engine(checkers), trace_for())["outcome"], "not_key"
            )

    def test_wrong_exchange_and_final_piece(self):
        base = {
            "e1": "K",
            "f10": "k",
            "e9": "a",
            "d10": "a",
            "e7": "R",
            "h9": "R",
            "h8": "N",
            "c9": "N",
        }
        for square, piece in (("e9", "p"), ("d10", "k"), ("e7", "C"), ("h9", "C")):
            self.assertFalse(candidate(trace_for({**base, square: piece})))
        self.assertFalse(candidate(trace_for(moves=("e7d9", "d10d9", "h9f9"))))
        self.assertFalse(candidate(replace(trace_for(), moves=("h9f9",))))
        self.assertFalse(
            candidate(
                replace(
                    trace_for(),
                    terminal=PositionStatus(trace_for().terminal.fen, False, ()),
                )
            )
        )
        self.assertFalse(candidate(replace(trace_for(), verified=False)))

    def test_sequence_can_end_a_longer_solution(self):
        from tools.xiangqi_data.puzzle_mining.position import decode_position

        pieces = decode_position(trace_for().decisions[0].position_fen)
        pieces["e6"] = pieces.pop("e7")
        pieces["a7"] = "p"
        trace = trace_for(pieces, ("e6e7", "a7a6", "e7e9", "d10e9", "h9f9"))
        self.assertTrue(candidate(trace))
        self.assertEqual(assess(self.engine(), trace)["outcome"], "key")

    def test_missing_or_inconsistent_ledger_and_stale_attack_evidence(self):
        trace = trace_for()
        for broken in (
            replace(trace, decisions=()),
            replace(
                trace,
                decisions=(
                    replace(trace.decisions[0], position_fen=""),
                    *trace.decisions[1:],
                ),
            ),
            replace(
                trace,
                decisions=(
                    replace(trace.decisions[0], selected_move="e7a8"),
                    *trace.decisions[1:],
                ),
            ),
        ):
            self.assertIsNone(candidate(broken))
            self.assertEqual(assess(self.engine(), broken)["outcome"], "inconclusive")
        record = assess(self.engine(), trace)
        for field, value in (
            ("logic_version", "old"),
            ("moves", []),
            ("terminal_fen", "wrong"),
        ):
            self.assertIsNone(evidence_outcome(trace, {**record, field: value}))
        broken = copy.deepcopy(record)
        broken["terminal"]["checkers"] = ["a1"]
        self.assertIsNone(evidence_outcome(trace, broken))
        engine = self.engine()
        engine.checking_pieces.side_effect = EngineProtocolError("failed")
        self.assertEqual(assess(engine, trace)["outcome"], "inconclusive")

    def test_persisted_proof_and_branch_consensus(self):
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )
        from tools.xiangqi_data.puzzle_mining.solver import VerifiedBranch
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            _evaluate_category,
            reclassify_canonical,
        )
        from tools.xiangqi_data.puzzle_mining.classification import TacticalClassifier

        fixture = PuzzleStorageLifecycleTest()
        fixture.setUp(themes=(THEME,))
        self.addCleanup(fixture.tearDown)
        trace = trace_for()
        branch = VerifiedBranch(trace.moves, trace.terminal, decisions=trace.decisions)
        fixture.verify(result=fixture.result(branches=(branch,)))
        result = reclassify_canonical(
            fixture.connection, fixture.key, engine=self.engine()
        )
        self.assertIn(THEME, result.themes)
        self.assertEqual(
            reclassify_canonical(fixture.connection, fixture.key).status,
            "already_current",
        )
        self.assertEqual(
            reclassify_canonical(fixture.connection, fixture.key, force=True).themes,
            result.themes,
        )
        current = {
            "candidate_id": fixture.current()["id"],
            "current_verification_id": fixture.current()["current_verification_id"],
        }
        outcome, _ = _evaluate_category(
            fixture.connection,
            current,
            (trace, replace(trace, moves=("h9f9",))),
            TacticalClassifier(),
            THEME,
            None,
            None,
        )
        self.assertEqual(outcome, "conflict")

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_engine_legal_sequence_both_colors(self):
        from tools.xiangqi_data.puzzle_mining.position import decode_position

        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            trace = trace_for(mirror=mirror)
            for decision in trace.decisions:
                self.assertIn(
                    decision.selected_move, engine.inspect(decision.context).legal_moves
                )
            self.assertTrue(
                engine.inspect(SearchContext(trace.terminal.fen, ())).checkmate
            )
            self.assertEqual(assess(engine, trace)["outcome"], "key")
        # Moving the finishing chariot can also uncover a horse check.
        pieces = decode_position(trace_for().decisions[0].position_fen)
        pieces["g9"] = pieces.pop("h9")
        pieces["g8"] = "N"
        del pieces["h8"]
        pieces["f8"] = "P"
        for mirror in (False, True):
            trace = trace_for(pieces, ("e7e9", "d10e9", "g9f9"), mirror)
            for decision in trace.decisions:
                self.assertIn(
                    decision.selected_move, engine.inspect(decision.context).legal_moves
                )
            self.assertTrue(
                engine.inspect(SearchContext(trace.terminal.fen, ())).checkmate
            )
            self.assertEqual(assess(engine, trace)["outcome"], "not_key")
