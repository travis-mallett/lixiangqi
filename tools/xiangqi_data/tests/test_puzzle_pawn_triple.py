import unittest
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.puzzle_mining import pawn_triple as motif
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

BASE = {"e10": "k", "f1": "K", "d5": "P", "a7": "p", "h1": "R"}
MOVES = ("d5d6", "a7a6", "d6e6", "a6a5", "h1h2", "a5a4", "e6e7", "a4a3", "e7e8")


class PawnTripleTest(unittest.TestCase):
    def test_three_advances_ignore_horizontal_and_intervening_moves(self):
        for mirror in (False, True):
            t = trace_for(BASE, MOVES, mirror)
            engine = Mock()
            self.assertEqual(motif.assess(engine, t)["outcome"], "key")
            self.assertEqual(engine.mock_calls, [])
            self.assertFalse(
                motif.candidate(replace(t, terminal=replace(t.terminal, checked=False)))
            )
            self.assertFalse(motif.candidate(replace(t, verified=False)))

    def test_exactly_three_not_two_or_four(self):
        for mirror in (False, True):
            board = {**BASE, "d6": "P"}
            del board["d5"]
            two = trace_for(board, ("d6d7", "a7a6", "h1h2", "a6a5", "d7d8"), mirror)
            four = trace_for(BASE, (*MOVES, "a3a2", "e8e9"), mirror)
            self.assertFalse(motif.candidate(two))
            self.assertFalse(motif.candidate(four))

    def test_palace_boundaries(self):
        for mirror in (False, True):
            for file in "cdefg":
                for rank in (7, 8, 9, 10):
                    start = rank - 3
                    board = {"e10": "k", "f1": "K", file + str(start): "P", "a7": "p"}
                    # Keep the general away from a tested pawn destination.
                    board.pop("e10")
                    board["f9" if file != "f" else "d9"] = "k"
                    moves = (
                        file + str(start) + file + str(start + 1),
                        "a7a6",
                        file + str(start + 1) + file + str(start + 2),
                        "a6a5",
                        file + str(start + 2) + file + str(rank),
                    )
                    self.assertEqual(
                        motif.candidate(trace_for(board, moves, mirror)),
                        file in "def" and rank >= 8,
                    )

    def test_capture_replacement_cannot_inherit_advances(self):
        board = {"f10": "k", "f1": "K", "d5": "P", "e7": "P", "d10": "r", "a7": "p"}
        for mirror in (False, True):
            t = trace_for(
                board, ("d5d6", "a7a6", "d6d7", "d10d7", "e7d7", "a6a5", "d7d8"), mirror
            )
            self.assertFalse(motif.candidate(t))
            # Three total advances split between surviving pawns also do not qualify.
            t = trace_for(
                {"e10": "k", "f1": "K", "d6": "P", "f7": "P", "a7": "p"},
                ("d6d7", "a7a6", "f7f8", "a6a5", "d7d8"),
                mirror,
            )
            self.assertFalse(motif.candidate(t))

    def test_missing_stale_and_inconsistent_history(self):
        t = trace_for(BASE, MOVES)
        record = motif.assess(None, t)
        for key in ("logic_version", "terminal_fen", "positions", "moves"):
            self.assertIsNone(motif.evidence_outcome(t, {**record, key: "stale"}))
        for bad in (
            replace(t, decisions=()),
            replace(t, moves=(*t.moves[:-1], "bad")),
            replace(
                t,
                decisions=(
                    *t.decisions[:-1],
                    replace(t.decisions[-1], position_fen=t.decisions[0].position_fen),
                ),
            ),
        ):
            self.assertEqual(motif.assess(None, bad)["outcome"], "inconclusive")

    def test_real_mate_with_another_piece_finishing_both_colors(self):
        from tools.xiangqi_data.pikafish_rules import default_executable
        from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
        from tools.xiangqi_data.puzzle_mining.models import SearchContext

        if not default_executable().is_file():
            self.skipTest("local Pikafish required")
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        board = {"d8": "k", "d6": "P", "d1": "K", "d3": "A", "a7": "R"}
        moves = (
            "d6d7",
            "d8d9",
            "d7d8",
            "d9e9",
            "d8e8",
            "e9e10",
            "e8e9",
            "e10f10",
            "a7f7",
        )
        for mirror in (False, True):
            t = trace_for(board, moves, mirror)
            for move, decision in zip(t.moves, t.decisions):
                self.assertIn(move, engine.inspect(decision.context).legal_moves)
            self.assertTrue(engine.inspect(SearchContext(t.terminal.fen, ())).checkmate)
            self.assertEqual(motif.assess(None, t)["outcome"], "key")

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

        f = PuzzleStorageLifecycleTest()
        f.setUp(themes=None)
        self.addCleanup(f.tearDown)
        t = trace_for(BASE, MOVES)
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
        self.assertIn(motif.THEME, taxonomy_versions())
        self.assertNotIn(
            motif.THEME, taxonomy_versions(candidate_type="tactic_candidate")
        )
        result, proofs = _evaluate_category(
            f.connection, current, (t,), TacticalClassifier(), motif.THEME, None, None
        )
        self.assertEqual(result, "match")
        self.assertTrue(
            _save_category(
                f.connection, current, motif.THEME, taxonomy_versions(), result, proofs
            )
        )
        reused, _ = _evaluate_category(
            f.connection, current, (t,), TacticalClassifier(), motif.THEME, None, None
        )
        self.assertEqual(reused, "match")
        nonmatch = trace_for(BASE, (*MOVES, "a3a2", "e8e9"))
        conflict, _ = _evaluate_category(
            f.connection,
            current,
            (t, nonmatch),
            TacticalClassifier(),
            motif.THEME,
            None,
            None,
        )
        self.assertEqual(conflict, "conflict")
