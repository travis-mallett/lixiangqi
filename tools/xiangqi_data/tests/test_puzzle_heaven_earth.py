import unittest
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.puzzle_mining import heaven_earth as motif
from tools.xiangqi_data.puzzle_mining.position import decode_position
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
from tools.xiangqi_data.puzzle_mining.models import SearchContext
from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

BASE = {
    "e10": "k",
    "e9": "a",
    "e8": "b",
    "e7": "C",
    "b10": "C",
    "c10": "b",
    "d10": "a",
    "d3": "R",
    "f1": "K",
}


class HeavenEarthTest(unittest.TestCase):
    def proof(self, t, checkers):
        engine = Mock()
        engine.checking_pieces.return_value = (t.terminal.fen, checkers)
        return motif.assess(engine, t)

    def test_both_colors_flanks_and_finishing_pieces(self):
        for mirror in (False, True):
            for right in (False, True):
                for piece, origin in (("R", "d3"), ("P", "d9")):
                    board = dict(BASE)
                    del board["d3"]
                    board[origin] = piece
                    move = origin + "d10"
                    if right:
                        reflect = lambda s: chr(ord("a") + ord("i") - ord(s[0])) + s[1:]
                        board = {reflect(s): p for s, p in board.items()}
                        move = reflect(origin) + "f10"
                    t = trace_for(board, (move,), mirror)
                    target = ("f" if right else "d") + ("1" if mirror else "10")
                    self.assertTrue(motif.candidate(t))
                    self.assertEqual(self.proof(t, (target,))["outcome"], "key")

    def test_palace_center_finish(self):
        for mirror in (False, True):
            for piece in ("R", "P"):
                board = dict(BASE)
                del board["d3"]
                board["d9"] = piece
                t = trace_for(board, ("d9e9",), mirror)
                self.assertTrue(motif.candidate(t))
                self.assertEqual(
                    self.proof(t, ("e2" if mirror else "e9",))["outcome"], "key"
                )

    def test_exactly_two_enemy_screens_on_both_axes(self):
        for square, piece in (
            ("c10", None),
            ("e8", None),
            ("c10", "P"),
            ("e8", "P"),
            ("e6", "p"),
        ):
            board = dict(BASE)
            if piece is None:
                del board[square]
            else:
                board[square] = piece
            if square == "e6":
                board["e5"] = board.pop("e7")
            t = trace_for(board, ("d3d10",))
            self.assertFalse(motif.candidate(t))
        board = {**BASE, "e8": "n", "c10": "p"}
        self.assertTrue(motif.candidate(trace_for(board, ("d3d10",))))

    def test_nearest_screen_and_same_final_checker_required(self):
        t = trace_for(BASE, ("d3d10",))
        self.assertEqual(self.proof(t, ("e7",))["outcome"], "not_key")
        self.assertEqual(self.proof(t, ("d10", "e7"))["outcome"], "key")
        self.assertFalse(motif.candidate(trace_for(BASE, ("d3c3",))))
        self.assertFalse(motif.candidate(trace_for(BASE, ("d3c10",))))
        board = dict(BASE)
        board["d9"] = board.pop("d10")
        self.assertFalse(motif.candidate(trace_for(board, ("d3d10",))))
        self.assertFalse(
            motif.candidate(replace(t, terminal=replace(t.terminal, checked=False)))
        )

    def test_missing_ledger_and_stale_evidence(self):
        t = trace_for(BASE, ("d3d10",))
        self.assertIsNone(motif.candidate(replace(t, decisions=())))
        record = self.proof(t, ("d10",))
        for field in ("logic_version", "previous_fen", "terminal_fen", "move"):
            self.assertIsNone(motif.evidence_outcome(t, {**record, field: "stale"}))

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_lesson_both_colors(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        board = decode_position("3ak4/4a4/b3b4/4C4/9/1C7/9/3R5/2r1p1p2/5K3 w - - 0 1")
        for mirror in (False, True):
            t = trace_for(board, ("b5b10", "a8c10", "d3d10"), mirror)
            self.assertIn(
                t.moves[-1], engine.inspect(t.decisions[-1].context).legal_moves
            )
            self.assertTrue(engine.inspect(SearchContext(t.terminal.fen, ())).checkmate)
            self.assertEqual(motif.assess(engine, t)["outcome"], "key")

    def test_saved_proof_reuse_queue_and_branch_consensus(self):
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            _evaluate_category,
            _save_category,
            taxonomy_versions,
        )
        from tools.xiangqi_data.puzzle_mining.classification import TacticalClassifier
        from tools.xiangqi_data.puzzle_mining.category_status import pool_counts
        from tools.xiangqi_data.puzzle_mining.solver import VerifiedBranch
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )

        f = PuzzleStorageLifecycleTest()
        f.setUp(themes=None)
        self.addCleanup(f.tearDown)
        t = trace_for(BASE, ("d3d10",))
        f.verify(
            result=f.result(
                branches=(VerifiedBranch(t.moves, t.terminal, decisions=t.decisions),)
            )
        )
        row = f.current()
        current = {
            "candidate_id": row["id"],
            "current_verification_id": row["current_verification_id"],
        }
        versions = taxonomy_versions()
        selected = {
            k: v for k, v in versions.items() if k in {motif.THEME, "__consensus__"}
        }
        self.assertEqual(pool_counts(f.connection, selected)["pending_checks"], 1)
        engine = Mock()
        engine.checking_pieces.return_value = (t.terminal.fen, ("d10",))
        outcome, proofs = _evaluate_category(
            f.connection,
            current,
            (t,),
            TacticalClassifier(),
            motif.THEME,
            engine,
            None,
        )
        self.assertEqual(outcome, "match")
        self.assertTrue(
            _save_category(
                f.connection, current, motif.THEME, versions, outcome, proofs
            )
        )
        self.assertEqual(pool_counts(f.connection, selected)["pending_checks"], 0)
        reused, _ = _evaluate_category(
            f.connection,
            current,
            (t,),
            TacticalClassifier(),
            motif.THEME,
            None,
            None,
        )
        self.assertEqual(reused, "match")
        engine.checking_pieces.assert_called_once()
        stale = replace(t, terminal=replace(t.terminal, checked=False))
        conflict, _ = _evaluate_category(
            f.connection,
            current,
            (t, stale),
            TacticalClassifier(),
            motif.THEME,
            None,
            None,
        )
        self.assertEqual(conflict, "conflict")
