import copy
import unittest
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.puzzle_mining import double_toast, cannon_sandwich
from tools.xiangqi_data.puzzle_mining.patterns import (
    TerminalPosition,
    double_cannons_mate,
    matching_assessed_themes,
)
from tools.xiangqi_data.puzzle_mining.models import SearchContext, fen_side
from tools.xiangqi_data.puzzle_mining.position import decode_position
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish, EngineProtocolError
from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

TOAST = "4kab2/4a1n2/4b4/6C2/6C2/9/9/4B4/4A4/2BAK4 w - - 0 1"
SANDWICH = "2ba5/4akCRC/4c4/9/2Pn4P/p6p1/6P2/n3B1N2/3pArc2/2B1KA3 w - - 0 1"


def toast(mirror=False):
    return trace_for(decode_position(TOAST), ("g7g10", "e8g10", "g6g10"), mirror)


def sandwich(mirror=False, cannon=False):
    if cannon:
        t = trace_for(
            {
                "f10": "k",
                "e10": "a",
                "g10": "C",
                "i7": "C",
                "h8": "R",
                "d1": "K",
                "a7": "p",
            },
            ("i7i10", "a7a6", "h8h9"),
            mirror,
        )
    else:
        board = decode_position(SANDWICH)
        board["i8"] = board.pop("i9")
        t = trace_for(board, ("i8i9", "a5a4", "h9h8", "f9f10", "h8h10"), mirror)
    return t, TerminalPosition(t.terminal.fen, True, fen_side(t.terminal.fen))


class CannonMotifsTest(unittest.TestCase):
    def toast_engine(self, t, first=True, last=True):
        target = "g1" if fen_side(t.terminal.fen) == "red" else "g10"
        engine = Mock()
        engine.checking_pieces.side_effect = lambda c: (
            c.initial_fen,
            (target,) if (last if c.initial_fen == t.terminal.fen else first) else (),
        )
        return engine

    def test_double_toast_both_checks_and_same_destination(self):
        for mirror in (False, True):
            t = toast(mirror)
            self.assertTrue(double_toast.candidate(t))
            for first, last, outcome in (
                (True, True, "key"),
                (False, True, "not_key"),
                (True, False, "not_key"),
            ):
                record = double_toast.assess(self.toast_engine(t, first, last), t)
                self.assertEqual(record["outcome"], outcome)
            self.assertFalse(
                double_toast.candidate(
                    replace(t, terminal=replace(t.terminal, checked=False))
                )
            )
        board = decode_position(TOAST)
        for square in ("g9", "g10"):
            bad = dict(board)
            del bad[square]
            self.assertFalse(
                double_toast.candidate(trace_for(bad, ("g7g10", "e8g10", "g6g10")))
            )
        bad = {**board, "g8": "p"}
        self.assertFalse(
            double_toast.candidate(trace_for(bad, ("g7g10", "e8g10", "g6g10")))
        )
        # Capturing another cannon instead is not the sacrifice-recapture chain.
        self.assertFalse(
            double_toast.candidate(trace_for(board, ("g7g10", "e8g6", "g10g6")))
        )
        # A different final capture does not qualify, even by the second cannon.
        self.assertFalse(
            double_toast.candidate(trace_for(board, ("g7g10", "e8g10", "g6g9")))
        )

    def test_double_toast_incomplete_stale_and_failed_evidence(self):
        t = toast()
        self.assertIsNone(double_toast.candidate(replace(t, decisions=())))
        self.assertIsNone(
            double_toast.candidate(
                replace(
                    t,
                    decisions=(
                        replace(t.decisions[0], position_fen=""),
                        *t.decisions[1:],
                    ),
                )
            )
        )
        record = double_toast.assess(self.toast_engine(t), t)
        for field in (
            "logic_version",
            "terminal_fen",
            "positions",
            "moves",
            "first_check",
        ):
            self.assertIsNone(
                double_toast.evidence_outcome(t, {**record, field: "stale"})
            )
        engine = Mock()
        engine.checking_pieces.side_effect = EngineProtocolError("test")
        self.assertEqual(double_toast.assess(engine, t)["outcome"], "inconclusive")

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_lessons_and_both_sandwich_roles_both_colors(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            t = toast(mirror)
            for move, decision in zip(t.moves, t.decisions):
                self.assertIn(move, engine.inspect(decision.context).legal_moves)
            self.assertTrue(engine.inspect(SearchContext(t.terminal.fen, ())).checkmate)
            self.assertEqual(double_toast.assess(engine, t)["outcome"], "key")
            for cannon in (False, True):
                t, terminal = sandwich(mirror, cannon)
                self.assertTrue(
                    engine.inspect(SearchContext(t.terminal.fen, ())).checkmate
                )
                record = cannon_sandwich.assess(engine, t)
                self.assertEqual(record["outcome"], "key")
                self.assertEqual(double_cannons_mate(terminal), cannon)
                self.assertEqual(
                    matching_assessed_themes(
                        terminal,
                        {cannon_sandwich.THEME: record},
                        {cannon_sandwich.THEME},
                    ),
                    {cannon_sandwich.THEME},
                )
                self.assertEqual(
                    cannon_sandwich.evidence_outcome(t, {**record, "escapes": []}),
                    None,
                )
                stale = copy.deepcopy(record)
                stale["escapes"][0]["fen"] = "stale"
                self.assertIsNone(cannon_sandwich.evidence_outcome(t, stale))
                self.assertEqual(
                    cannon_sandwich.assess(
                        engine, replace(t, terminal=replace(t.terminal, checked=False))
                    )["outcome"],
                    "not_key",
                )

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_sandwich_requires_exclusive_perpendicular_empty_escape(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        # An additional chariot shares control of the escape sealed by cannons.
        base, _ = sandwich()
        board = decode_position(base.decisions[0].position_fen)
        board["f7"] = "R"
        t = trace_for(board, base.moves)
        terminal = TerminalPosition(t.terminal.fen, True, "black")
        self.assertEqual(cannon_sandwich.assess(engine, t)["outcome"], "not_key")
        # A defending occupant makes that square ineligible as an empty escape.
        board = decode_position(SANDWICH)
        t = trace_for(board, ("h9h8", "f9f10", "h8h10"))
        board = decode_position(t.terminal.fen)
        board["f9"] = "a"
        from tools.xiangqi_data.puzzle_mining.position import encode_position

        terminal = TerminalPosition(
            encode_position(board) + " b - - 0 1", True, "black"
        )
        self.assertEqual(cannon_sandwich.assess(engine, t)["outcome"], "not_key")

    def test_saved_proof_reuse_and_branch_consensus(self):
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            _evaluate_category,
            _save_category,
            taxonomy_versions,
        )
        from tools.xiangqi_data.puzzle_mining.classification import TacticalClassifier
        from tools.xiangqi_data.puzzle_mining.solver import VerifiedBranch
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )

        for module, t in ((double_toast, toast()), (cannon_sandwich, sandwich()[0])):
            f = PuzzleStorageLifecycleTest()
            f.setUp(themes=None)
            self.addCleanup(f.tearDown)
            f.verify(
                result=f.result(
                    branches=(
                        VerifiedBranch(t.moves, t.terminal, decisions=t.decisions),
                    )
                )
            )
            row = f.current()
            current = {
                "candidate_id": row["id"],
                "current_verification_id": row["current_verification_id"],
            }
            engine = self.toast_engine(t) if module is double_toast else Mock()
            if module is cannon_sandwich:
                engine.checking_pieces.side_effect = lambda c: (
                    c.initial_fen,
                    ("h10",) if c.initial_fen == t.terminal.fen else ("i9",),
                )
            result, proofs = _evaluate_category(
                f.connection,
                current,
                (t,),
                TacticalClassifier(),
                module.THEME,
                engine,
                None,
            )
            self.assertEqual(result, "match")
            self.assertTrue(
                _save_category(
                    f.connection,
                    current,
                    module.THEME,
                    taxonomy_versions(),
                    result,
                    proofs,
                )
            )
            reused, _ = _evaluate_category(
                f.connection,
                current,
                (t,),
                TacticalClassifier(),
                module.THEME,
                None,
                None,
            )
            self.assertEqual(reused, "match")
            nonmate = replace(t, terminal=replace(t.terminal, checked=False))
            conflict, _ = _evaluate_category(
                f.connection,
                current,
                (t, nonmate),
                TacticalClassifier(),
                module.THEME,
                None,
                None,
            )
            self.assertEqual(conflict, "conflict")

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_sandwich_requires_both_exact_pieces_to_move_perpendicularly(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            # The original lesson has no cannon movement.
            t = trace_for(decode_position(SANDWICH), ("h9h8", "f9f10", "h8h10"), mirror)
            self.assertEqual(cannon_sandwich.assess(engine, t)["outcome"], "not_key")
            # Moving a cannon along the terminal checking ray cannot qualify.
            board = {
                "f10": "k",
                "e10": "a",
                "g10": "C",
                "h10": "C",
                "h8": "R",
                "d1": "K",
                "a7": "p",
            }
            t = trace_for(board, ("h10i10", "a7a6", "h8h9"), mirror)
            self.assertEqual(cannon_sandwich.assess(engine, t)["outcome"], "not_key")
            # A different chariot's perpendicular move cannot supply the role.
            board = {
                "f10": "k",
                "e10": "a",
                "g10": "C",
                "i8": "C",
                "h9": "R",
                "b1": "R",
                "d1": "K",
                "a7": "p",
            }
            t = trace_for(board, ("b1b2", "a7a6", "i8i10"), mirror)
            self.assertEqual(cannon_sandwich.assess(engine, t)["outcome"], "not_key")
            # A moved but captured cannon cannot lend its history to its replacement.
            board = {
                "f10": "k",
                "e10": "a",
                "g10": "C",
                "i8": "C",
                "i7": "r",
                "a10": "C",
                "h8": "R",
                "d1": "K",
            }
            t = trace_for(board, ("i8i9", "i7i9", "a10i10", "i9a9", "h8h9"), mirror)
            self.assertEqual(cannon_sandwich.assess(engine, t)["outcome"], "not_key")
            t, _ = sandwich(mirror)
            record = cannon_sandwich.assess(engine, t)
            self.assertEqual(record["outcome"], "key")
            self.assertEqual(
                cannon_sandwich.assess(engine, replace(t, decisions=()))["outcome"],
                "inconclusive",
            )
            for key in ("logic_version", "moves", "positions"):
                self.assertIsNone(
                    cannon_sandwich.evidence_outcome(t, {**record, key: "stale"})
                )

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_sandwich_vertical_check_requires_horizontal_moves(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            for origin, target, stationary in (("g6", "e6", "e8"), ("g8", "e8", "e6")):
                board = {
                    "e10": "k",
                    "f10": "a",
                    origin: "C",
                    stationary: "C",
                    "f7": "R",
                    "d1": "K",
                    "a7": "p",
                }
                t = trace_for(board, (origin + target, "a7a6", "f7d7"), mirror)
                self.assertTrue(
                    engine.inspect(SearchContext(t.terminal.fen, ())).checkmate
                )
                self.assertEqual(cannon_sandwich.assess(engine, t)["outcome"], "key")

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_sandwich_crossing_requires_clear_sight_at_that_move(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            base = {"f10": "k", "d10": "C", "a7": "C", "c8": "R", "e1": "K", "i7": "p"}
            for blocker in (None, "p", "P"):
                board = dict(base)
                if blocker:
                    board["b8"] = blocker
                t = trace_for(board, ("a7a10", "i7i6", "c8c9"), mirror)
                self.assertEqual(
                    cannon_sandwich.assess(engine, t)["outcome"],
                    "not_key" if blocker else "key",
                )
            # Removing the obstruction later cannot validate an earlier crossing.
            t = trace_for({**base, "b8": "n"}, ("a7a10", "b8d7", "c8c9"), mirror)
            self.assertEqual(cannon_sandwich.assess(engine, t)["outcome"], "not_key")
            # Starting on the rook's line and moving away does not pass through it.
            board = dict(base)
            board["a8"] = board.pop("a7")
            t = trace_for(board, ("a8a10", "i7i6", "c8c9"), mirror)
            self.assertEqual(cannon_sandwich.assess(engine, t)["outcome"], "not_key")
            record = cannon_sandwich.assess(engine, sandwich(mirror)[0])
            self.assertEqual(record["logic_version"], "1.3")
            self.assertIsNone(
                cannon_sandwich.evidence_outcome(
                    sandwich(mirror)[0], {**record, "logic_version": "1.1"}
                )
            )

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_sandwich_crossing_does_not_override_lineup_collision(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            board = {
                "e9": "k",
                "f8": "a",
                "g10": "C",
                "i7": "C",
                "i8": "R",
                "i10": "p",
                "d1": "K",
            }
            t = trace_for(board, ("i7i10", "e9f9", "i8i9"), mirror)
            for move, decision in zip(t.moves, t.decisions):
                self.assertIn(move, engine.inspect(decision.context).legal_moves)
            self.assertTrue(engine.inspect(SearchContext(t.terminal.fen, ())).checkmate)
            self.assertEqual(cannon_sandwich.assess(engine, t)["outcome"], "not_key")

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_ONEyN_blocked_alternative_lineup_rejects_motif(self):
        from tools.xiangqi_data.puzzle_mining.position import FenState

        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        state = FenState(
            "5a1C1/3k1C3/1cra1P3/1R6p/6b2/P8/8P/B2Ap4/4A1n2/5K3 b - - 12 47"
        )
        state.push("d9e9")
        moves = (
            "b7e7",
            "e9d9",
            "e7e10",
            "c8c1",
            "a3c1",
            "b8b1",
            "e2d1",
            "e3e2",
            "h10h9",
        )
        for mirror in (False, True):
            for blocked in (True, False):
                board = dict(state.position)
                if not blocked:
                    del board["f10"]
                t = trace_for(board, moves, mirror)
                self.assertTrue(
                    engine.inspect(SearchContext(t.terminal.fen, ())).checkmate
                )
                self.assertEqual(
                    cannon_sandwich.assess(engine, t)["outcome"],
                    "not_key" if blocked else "key",
                )

    def test_terminal_side_and_all_lineups_both_ray_directions(self):
        check = cannon_sandwich.terminal_lineups_clear
        for vertical in (False, True):
            # Transpose geometry to exercise both axes independently of check evidence.
            transform = (
                (
                    lambda s: chr(ord("a") + int(s[1:]) - 1)
                    + str(ord(s[0]) - ord("a") + 1)
                )
                if vertical
                else (lambda s: s)
            )
            trio = {transform(s) for s in ("f8", "h8", "g9")}
            general = transform("e9")
            board = {
                transform("f8"): "C",
                transform("h8"): "C",
                transform("g9"): "R",
                general: "k",
            }
            self.assertTrue(check(board, trio, general, vertical))
            # One obstructed alternative rejects even when the other line is clear.
            for blocker in ("a", "P"):
                self.assertFalse(
                    check({**board, transform("f9"): blocker}, trio, general, vertical)
                )
            # The particular chariot must be on the same strict side as both cannons.
            for rook in ("d9", "e9"):
                other = {transform("f8"), transform("h8"), transform(rook)}
                self.assertFalse(check(board, other, general, vertical))
            # A shared line requires at most one perpendicular step from every piece.
            far = {transform("f5"), transform("h5"), transform("g9")}
            self.assertFalse(check(board, far, general, vertical))
        # Board edges exclude nonexistent lineup destinations.
        self.assertTrue(
            check(
                {"f10": "C", "h10": "C", "g9": "R"}, {"f10", "h10", "g9"}, "e10", False
            )
        )
