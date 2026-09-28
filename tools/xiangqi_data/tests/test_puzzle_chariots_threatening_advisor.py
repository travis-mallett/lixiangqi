import unittest
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining.chariots_threatening_advisor import candidate
from tools.xiangqi_data.puzzle_mining import chariots_threatening_advisor as detector
from tools.xiangqi_data.puzzle_mining.classification import TacticalClassifier
from tools.xiangqi_data.puzzle_mining.classification_job import (
    _evaluate_category,
    _save_category,
    taxonomy_versions,
)
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
from tools.xiangqi_data.puzzle_mining.models import SearchContext, fen_side
from tools.xiangqi_data.puzzle_mining.patterns import (
    CHARIOTS_THREATENING_ADVISOR_THEME as THEME,
    CHARIOTS_THREATENING_ADVISOR_LOGIC_VERSION as VERSION,
    TerminalPosition,
)
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

BASE = {"e1": "K", "e10": "k", "e9": "a", "d9": "R", "f9": "R"}
MOVES = ("d9e9", "e10d10", "f9f10")


def line(pieces=None, moves=MOVES, mirror=False):
    return trace_for(BASE if pieces is None else pieces, moves, mirror)


def terminal(trace):
    return TerminalPosition(
        trace.terminal.fen, trace.checkmate, fen_side(trace.terminal.fen)
    )


class ChariotsThreateningAdvisorTest(unittest.TestCase):
    def fixture(self, trace):
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )
        from tools.xiangqi_data.puzzle_mining.solver import VerifiedBranch

        fixture = PuzzleStorageLifecycleTest()
        fixture.setUp(themes=None)
        self.addCleanup(fixture.tearDown)
        branch = VerifiedBranch(trace.moves, trace.terminal, decisions=trace.decisions)
        fixture.verify(result=fixture.result(branches=(branch,)))
        return fixture

    def engine(self, competing=False):
        engine = Mock()

        def checking(context):
            # General on d9: e9 alone must block this empty palace escape.
            from tools.xiangqi_data.puzzle_mining.position import decode_position

            pieces = decode_position(context.initial_fen)
            checkers = ("e9", "e1") if competing else ("e9",)
            return context.initial_fen, (
                checkers if pieces.get("d9") == "k" else ("f10",)
            )

        engine.checking_pieces.side_effect = checking
        return engine

    def test_capture_anywhere_and_unbounded_continuation_both_colors(self):
        cases = (
            (BASE, MOVES),
            (BASE, ("f9e9", "e10f10", "d9d10")),
            (
                {**BASE, "a7": "p"},
                ("d9e9", "e10d10", "e9e8", "a7a6", "e8e9", "a6a5", "f9f10"),
            ),
            (
                {**{s: p for s, p in BASE.items() if s != "d9"}, "d8": "R", "a7": "p"},
                ("d8d9", "a7a6", *MOVES),
            ),
        )
        for pieces, moves in cases:
            for mirror in (False, True):
                with self.subTest(moves=moves, mirror=mirror):
                    self.assertTrue(candidate(line(pieces, moves, mirror)))

    def test_exact_geometry_and_capture_required(self):
        for square, piece in (
            ("e9", "p"),
            ("e9", "A"),
            ("d9", "C"),
            ("f9", "C"),
            ("f9", "r"),
        ):
            self.assertFalse(candidate(line({**BASE, square: piece})))
        pieces = {k: v for k, v in BASE.items() if k != "e9"}
        self.assertFalse(candidate(line(pieces)))
        self.assertFalse(candidate(line(moves=("d9d8", "e10d10", "f9f10"))))
        # The formation may break up before the advisor capture.
        self.assertTrue(
            candidate(
                line({**BASE, "a7": "p"}, ("d9d8", "a7a6", "f9e9", "e10d10", "d8d9"))
            )
        )
        self.assertFalse(candidate(replace(line(), verified=False)))
        self.assertFalse(
            candidate(replace(line(), terminal=replace(line().terminal, checked=False)))
        )

    def test_missing_and_incoherent_ledgers_fail_closed(self):
        trace = line()
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
                    *trace.decisions[:-1],
                    replace(trace.decisions[-1], selected_move="f9f8"),
                ),
            ),
            replace(
                trace,
                terminal=replace(
                    trace.terminal, fen=trace.terminal.fen.replace("4K4", "3K5")
                ),
            ),
        ):
            self.assertIsNone(candidate(broken))

    def test_terminal_proof_persistence_and_consensus(self):
        trace = line()
        fixture = self.fixture(trace)
        current = {
            "candidate_id": fixture.current()["id"],
            "current_verification_id": fixture.current()["current_verification_id"],
        }
        engine = self.engine(competing=True)
        args = (fixture.connection, current, (trace,), TacticalClassifier(), THEME)
        outcome, proofs = _evaluate_category(*args, engine, None)
        self.assertEqual(outcome, "match")
        engine.checking_pieces.assert_called_once()
        self.assertTrue(
            _save_category(
                fixture.connection, current, THEME, taxonomy_versions(), outcome, proofs
            )
        )
        self.assertEqual(_evaluate_category(*args, None, None)[0], "match")
        self.assertEqual(
            _evaluate_category(
                fixture.connection,
                current,
                (trace, line(moves=("d9d8", "e10d10", "f9f10"))),
                TacticalClassifier(),
                THEME,
                None,
                None,
            )[0],
            "conflict",
        )
        record = detector.assess(engine, trace)
        self.assertIsNone(
            detector.evidence_outcome(trace, {**record, "logic_version": "old"})
        )
        engine.checking_pieces.return_value = (trace.terminal.fen, ("e1",))
        engine.checking_pieces.side_effect = None
        self.assertEqual(detector.assess(engine, trace)["outcome"], "not_key")

    def test_later_capture_of_other_advisor_and_capture_order(self):
        for mirror in (False, True):
            board = {**BASE, "f10": "a", "a7": "p"}
            self.assertTrue(candidate(line(board, ("d9d8", "a7a6", "f9f10"), mirror)))
            # A pawn capture after the formation does not count.
            self.assertFalse(candidate(line({**BASE, "e8": "P"}, ("e8e9",), mirror)))
            # A capture before the formation cannot satisfy the later-capture rule.
            board = {**BASE, "d9": "a", "d8": "R", "f9": "R", "e9": "a", "a7": "p"}
            self.assertFalse(candidate(line(board, ("d8d9", "a7a6", "f9f8"), mirror)))
            # Neither both chariots nor the captured advisor need survive to mate.
            self.assertTrue(
                candidate(line({**BASE, "g9": "r"}, ("d9e9", "g9f9", "e9e10"), mirror))
            )

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_engine_terminal_and_delayed_sequences(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for moves in (
            MOVES,
            ("d9e9", "e10d10", "e9e8", "a7a6", "e8e9", "a6a5", "f9f10"),
        ):
            for mirror in (False, True):
                trace = line({**BASE, "a7": "p"}, moves, mirror)
                for decision in trace.decisions:
                    self.assertIn(
                        decision.selected_move,
                        engine.inspect(decision.context).legal_moves,
                    )
                self.assertTrue(
                    engine.inspect(SearchContext(trace.terminal.fen, ())).checkmate
                )
                self.assertTrue(candidate(trace))
                self.assertEqual(detector.assess(engine, trace)["outcome"], "key")
        # The central capture itself may be the terminal move.
        immediate = {
            "e1": "K",
            "e5": "P",
            "e8": "k",
            "d8": "r",
            "e9": "a",
            "d9": "R",
            "f9": "R",
        }
        for mirror in (False, True):
            trace = line(immediate, ("d9e9",), mirror)
            self.assertIn(
                trace.moves[0], engine.inspect(trace.decisions[0].context).legal_moves
            )
            self.assertTrue(
                engine.inspect(SearchContext(trace.terminal.fen, ())).checkmate
            )
            self.assertTrue(candidate(trace))
            self.assertEqual(detector.assess(engine, trace)["outcome"], "key")
