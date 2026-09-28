import unittest
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.puzzle_mining.pawn_mates import PawnMate
from tools.xiangqi_data.puzzle_mining.patterns import (
    TerminalPosition,
    matching_assessed_themes,
)
from tools.xiangqi_data.puzzle_mining.models import SearchContext, fen_side
from tools.xiangqi_data.puzzle_mining.position import decode_position
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish, EngineProtocolError
from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

CHILD = PawnMate("childWorshipsBuddha")
CROWN = PawnMate("crowningMate")
CHASE = PawnMate("eunuchChasingEmperorKill")
BASE = {"e10": "k", "d10": "a", "f10": "a", "e5": "C", "e8": "P", "d1": "K", "a9": "R"}
CHASE_BOARD = {"d8": "k", "d6": "P", "f1": "K"}
CHASE_MOVES = ("d6d7", "d8d9", "d7d8", "d9e9", "d8e8", "e9e10", "e8e9")


class PawnMatesTest(unittest.TestCase):
    def engine(self, t, checkers):
        engine = Mock()
        engine.checking_pieces.return_value = (t.terminal.fen, checkers)
        return engine

    def test_child_forward_same_file_both_colors_shared_check(self):
        for mirror in (False, True):
            t = trace_for(BASE, ("e8e9",), mirror)
            target, cannon = ("e2", "e6") if mirror else ("e9", "e5")
            for checkers, outcome in (
                ((target,), "key"),
                ((target, cannon), "key"),
                ((cannon,), "not_key"),
            ):
                record = CHILD.assess(self.engine(t, checkers), t)
                self.assertEqual(record["outcome"], outcome)
                terminal = TerminalPosition(
                    t.terminal.fen, True, fen_side(t.terminal.fen)
                )
                self.assertEqual(
                    matching_assessed_themes(
                        terminal, {CHILD.theme: record}, {CHILD.theme}
                    ),
                    {CHILD.theme} if outcome == "key" else set(),
                )
            board = {**BASE, "d9": "P"}
            del board["e8"]
            self.assertFalse(CHILD.candidate(trace_for(board, ("d9e9",), mirror)))
            board = {**BASE, "d10": "P"}
            self.assertFalse(CHILD.candidate(trace_for(board, ("d10f10",), mirror)))

    def test_child_not_restricted_to_general_back_rank(self):
        board = {"d9": "k", "d7": "P", "f1": "K"}
        for mirror in (False, True):
            self.assertTrue(CHILD.candidate(trace_for(board, ("d7d8",), mirror)))

    def test_crowning_pawn_or_chariot_same_screen_checks(self):
        for mirror in (False, True):
            for piece in ("P", "R"):
                t = trace_for({**BASE, "e8": piece}, ("e8e9",), mirror)
                target, cannon = ("e2", "e6") if mirror else ("e9", "e5")
                self.assertTrue(CROWN.candidate(t))
                self.assertEqual(
                    CROWN.assess(self.engine(t, (target, cannon)), t)["outcome"], "key"
                )
                self.assertEqual(
                    CROWN.assess(self.engine(t, (cannon,)), t)["outcome"], "not_key"
                )
                # Crowning does not require the screen to make the last move.
                board = dict(BASE)
                board["e9"] = board.pop("e8")
                board["a3"] = "R"
                other = trace_for(board, ("a3a4",), mirror)
                self.assertTrue(CROWN.candidate(other))
        for square, value in (
            ("d10", None),
            ("f10", "A"),
            ("e7", "p"),
            ("e5", None),
            ("e8", "N"),
        ):
            board = dict(BASE)
            if value is None:
                del board[square]
            else:
                board[square] = value
            self.assertFalse(CROWN.candidate(trace_for(board, ("e8e9",))))

    def test_chase_identity_and_distance_both_colors(self):
        for mirror in (False, True):
            t = trace_for(CHASE_BOARD, CHASE_MOVES, mirror)
            engine = Mock()
            self.assertEqual(CHASE.assess(engine, t)["outcome"], "key")
            engine.checking_pieces.assert_not_called()
            # Only one approach by each of two pawns cannot combine.
            t = trace_for(
                {"e10": "k", "c9": "P", "e7": "P", "f1": "K"},
                ("c9d9", "e10f10", "e7e8"),
                mirror,
            )
            self.assertFalse(CHASE.candidate(t))
            # Two approaches without a general retreat do not qualify.
            t = trace_for(
                {"e10": "k", "c9": "P", "a7": "p", "f1": "K"},
                ("c9d9", "a7a6", "d9e9"),
                mirror,
            )
            self.assertFalse(CHASE.candidate(t))
            # Forward-only reachability excludes a general behind the pawn.
            from tools.xiangqi_data.puzzle_mining.patterns import pawn_mate_squares

            board = {"e8": "k", "e9": "P", "f1": "K"}
            t = trace_for(board, ("e9d9",), mirror)
            self.assertEqual(
                pawn_mate_squares(
                    TerminalPosition(t.terminal.fen, True, fen_side(t.terminal.fen)),
                    CHASE.theme,
                ),
                set(),
            )

    def test_chase_rejects_inconsistent_history(self):
        t = trace_for(CHASE_BOARD, CHASE_MOVES)
        for bad in (
            replace(t, moves=("bad", *t.moves[1:])),
            replace(
                t,
                decisions=(
                    replace(t.decisions[0], selected_move="c8c9"),
                    *t.decisions[1:],
                ),
            ),
            replace(
                t,
                decisions=(
                    t.decisions[0],
                    replace(t.decisions[1], position_fen=t.decisions[0].position_fen),
                    *t.decisions[2:],
                ),
            ),
        ):
            self.assertIsNone(CHASE.candidate(bad))

    def test_capture_does_not_transfer_chase_credit(self):
        board = {"d9": "k", "c8": "P", "f1": "K", "f8": "P", "a8": "r"}
        t = trace_for(board, ("c8d8", "d9e9", "d8e8", "a8e8", "f8f9"))
        self.assertFalse(CHASE.candidate(t))

    def test_missing_stale_malformed_and_stalemate(self):
        for role, t in (
            (CHILD, trace_for(BASE, ("e8e9",))),
            (CROWN, trace_for(BASE, ("e8e9",))),
            (CHASE, trace_for(CHASE_BOARD, CHASE_MOVES)),
        ):
            self.assertFalse(
                role.candidate(replace(t, terminal=replace(t.terminal, checked=False)))
            )
            record = role.assess(self.engine(t, ("e9",)), t)
            for field in ("logic_version", "terminal_fen", "moves", "positions"):
                self.assertIsNone(role.evidence_outcome(t, {**record, field: "stale"}))
            if role != CROWN:
                self.assertIsNone(role.candidate(replace(t, decisions=())))
        t = trace_for(BASE, ("e8e9",))
        for checkers in (("e9", "e9"), ("e10",), ("a1",)):
            self.assertEqual(
                CHILD.assess(self.engine(t, checkers), t)["outcome"], "inconclusive"
            )
        engine = Mock()
        engine.checking_pieces.side_effect = EngineProtocolError("test")
        self.assertEqual(CHILD.assess(engine, t)["outcome"], "inconclusive")

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_child_and_crowning_both_colors(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        lesson = decode_position("2bakab2/2R3R2/9/9/9/4C4/9/9/3r1r3/2p1K1p2 w - - 0 1")
        for mirror in (False, True):
            for role, t in (
                (CHILD, trace_for(BASE, ("e8e9",), mirror)),
                (CROWN, trace_for(lesson, ("g9e9",), mirror)),
            ):
                self.assertIn(
                    t.moves[-1], engine.inspect(t.decisions[-1].context).legal_moves
                )
                self.assertTrue(
                    engine.inspect(SearchContext(t.terminal.fen, ())).checkmate
                )
                self.assertEqual(role.assess(engine, t)["outcome"], "key")

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_chase_both_colors(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        board = {**CHASE_BOARD, "a7": "R", "d1": "K", "d3": "A"}
        del board["f1"]
        moves = (*CHASE_MOVES, "e10f10", "a7f7")
        for mirror in (False, True):
            t = trace_for(board, moves, mirror)
            for move, decision in zip(t.moves, t.decisions):
                self.assertIn(move, engine.inspect(decision.context).legal_moves)
            self.assertTrue(engine.inspect(SearchContext(t.terminal.fen, ())).checkmate)
            self.assertEqual(CHASE.assess(engine, t)["outcome"], "key")

    def test_saved_proof_reuse_queue_and_branch_consensus(self):
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

        for role, t in (
            (CHILD, trace_for(BASE, ("e8e9",))),
            (CROWN, trace_for(BASE, ("e8e9",))),
            (CHASE, trace_for(CHASE_BOARD, CHASE_MOVES)),
        ):
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
            engine = self.engine(t, ("e9",))
            result, proofs = _evaluate_category(
                f.connection,
                current,
                (t,),
                TacticalClassifier(),
                role.theme,
                engine,
                None,
            )
            self.assertEqual(result, "match")
            self.assertTrue(
                _save_category(
                    f.connection,
                    current,
                    role.theme,
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
                role.theme,
                None,
                None,
            )
            self.assertEqual(reused, "match")
            stale = replace(t, terminal=replace(t.terminal, checked=False))
            conflict, _ = _evaluate_category(
                f.connection,
                current,
                (t, stale),
                TacticalClassifier(),
                role.theme,
                None,
                None,
            )
            self.assertEqual(conflict, "conflict")

    def test_chase_requires_immediate_retreats_for_all_but_one_approach(self):
        board = {"e9": "k", "c8": "P", "a7": "p", "a1": "R", "f1": "K"}
        cases = (
            # N=2 no longer meets the minimum.
            (("c8d8", "e9e10", "d8e8"), False),
            # N=3 with only horizontal approaches fails.
            (("c8d8", "e9e10", "d8e8", "e10f10", "e8f8"), False),
            # N=3: one immediate retreat is insufficient, even at distance one.
            (("c8d8", "e9e10", "d8e8", "a7a6", "e8e9"), False),
            # A retreat after an intervening winning rook move cannot count.
            (("c8d8", "a7a6", "a1a2", "e9e10", "d8e8"), False),
            # Moving the general closer in the immediate reply is not a retreat.
            (("c8d8", "e9d9", "d8e8"), False),
        )
        for mirror in (False, True):
            for moves, expected in cases:
                with self.subTest(mirror=mirror, moves=moves):
                    self.assertEqual(
                        CHASE.candidate(trace_for(board, moves, mirror)), expected
                    )
        t = trace_for(CHASE_BOARD, CHASE_MOVES)
        record = CHASE.assess(None, t)
        self.assertEqual(record["logic_version"], "1.3")
        self.assertIsNone(CHASE.evidence_outcome(t, {**record, "logic_version": "1.0"}))

    def test_every_move_of_the_same_chasing_pawn_must_approach(self):
        for mirror in (False, True):
            # The initial detour cannot be forgotten once two approaches follow.
            board = {"e9": "k", "d8": "P", "f1": "K"}
            t = trace_for(board, ("d8c8", "e9d9", "c8d8", "d9e9", "d8e8"), mirror)
            self.assertFalse(CHASE.candidate(t))
            # A later detour also fails, despite two approaches and one retreat.
            board = {"e10": "k", "c9": "P", "f1": "K"}
            t = trace_for(board, ("c9d9", "e10f10", "d9e9", "f10f9", "e9d9"), mirror)
            self.assertFalse(CHASE.candidate(t))
            # Another pawn's detour does not disqualify the tracked pawn.
            board = {**CHASE_BOARD, "b8": "P", "a7": "p"}
            t = trace_for(board, ("b8a8", "a7a6", *CHASE_MOVES), mirror)
            self.assertTrue(CHASE.candidate(t))
        t = trace_for(CHASE_BOARD, CHASE_MOVES)
        record = CHASE.assess(None, t)
        self.assertIsNone(CHASE.evidence_outcome(t, {**record, "logic_version": "1.1"}))

    def test_chase_three_moves_with_two_forward_advances(self):
        for mirror in (False, True):
            # Exactly three approaches, two forward, with both required replies.
            t = trace_for(CHASE_BOARD, CHASE_MOVES[:5], mirror)
            self.assertTrue(CHASE.candidate(t))
            # Three approaches and two replies, but only one forward move.
            board = {"d9": "k", "c8": "P", "f1": "K"}
            t = trace_for(board, ("c8d8", "d9e9", "d8e8", "e9e10", "e8e9"), mirror)
            self.assertFalse(CHASE.candidate(t))
            # Two forward moves cannot substitute for the three-move minimum.
            t = trace_for(CHASE_BOARD, CHASE_MOVES[:3], mirror)
            self.assertFalse(CHASE.candidate(t))
        t = trace_for(CHASE_BOARD, CHASE_MOVES)
        record = CHASE.assess(None, t)
        self.assertIsNone(CHASE.evidence_outcome(t, {**record, "logic_version": "1.2"}))
