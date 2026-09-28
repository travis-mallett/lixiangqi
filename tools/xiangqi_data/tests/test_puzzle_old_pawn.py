import unittest
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining import old_pawn
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish, EngineProtocolError
from tools.xiangqi_data.puzzle_mining.models import SearchContext
from tools.xiangqi_data.puzzle_mining.patterns import (
    TerminalPosition,
    matching_assessed_themes,
)
from tools.xiangqi_data.puzzle_mining.position import decode_position
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

FEN = "1P1k2b2/7NC/1c3a3/p6c1/2P1p4/9/2n1C1p2/4B4/4A4/4KAB2 w - - 0 1"


def trace(mirror=False, left=False):
    board = decode_position(FEN)
    if left:
        board = {
            chr(ord("a") + ord("i") - ord(s[0])) + s[1:]: p for s, p in board.items()
        }
    return trace_for(board, ("h10g10" if left else "b10c10",), mirror)


def terminal(mirror=False):
    return TerminalPosition(
        trace(mirror).terminal.fen, True, "red" if mirror else "black"
    )


class OldPawnTest(unittest.TestCase):
    def engine(self, t, checkers):
        engine = Mock()
        engine.checking_pieces.return_value = (t.terminal.fen, checkers)
        return engine

    def test_checking_back_rank_pawn_both_colors_and_additional_checkers(self):
        for mirror in (False, True):
            t = trace(mirror)
            pawn, horse = ("c1", "h2") if mirror else ("c10", "h9")
            for checkers, expected in (
                ((pawn,), "key"),
                ((pawn, horse), "key"),
                ((horse,), "not_key"),
                ((), "not_key"),
            ):
                engine = self.engine(t, checkers)
                record = old_pawn.assess(engine, t)
                self.assertEqual(record["outcome"], expected)
                self.assertEqual(
                    matching_assessed_themes(
                        terminal(mirror), {old_pawn.THEME: record}, {old_pawn.THEME}
                    ),
                    {old_pawn.THEME} if expected == "key" else set(),
                )
                engine.checking_pieces.assert_called_once()
                engine.analyse.assert_not_called()
            self.assertEqual(
                matching_assessed_themes(terminal(mirror), {}, {old_pawn.THEME}), set()
            )

    def test_wrong_rank_color_and_stalemate_need_no_inspection(self):
        for mirror in (False, True):
            base = decode_position(FEN)
            for piece in ("p", "N", "C"):
                changed = {**base, "b10": piece}
                t = trace_for(changed, ("b10c10",), mirror)
                position = t
                engine = Mock()
                self.assertEqual(
                    old_pawn.assess(engine, position)["outcome"], "not_key"
                )
                engine.checking_pieces.assert_not_called()
            changed = dict(base)
            changed["b9"] = changed.pop("b10")
            t = trace_for(changed, ("b9c9",), mirror)
            for position in (
                t,
                replace(
                    trace(mirror),
                    terminal=replace(trace(mirror).terminal, checked=False),
                ),
            ):
                engine = Mock()
                self.assertFalse(old_pawn.candidate(position))
                self.assertEqual(
                    old_pawn.assess(engine, position)["outcome"], "not_key"
                )
                engine.checking_pieces.assert_not_called()

    def test_stale_malformed_or_failed_evidence_is_inconclusive(self):
        t = trace()
        for checkers in (("c10", "c10"), ("d10",), ("a1",)):
            self.assertEqual(
                old_pawn.assess(self.engine(t, checkers), t)["outcome"], "inconclusive"
            )
        record = old_pawn.assess(self.engine(t, ("c10",)), t)
        for field, value in (
            ("logic_version", "1.0"),
            ("previous_fen", "old"),
            ("move", "old"),
            ("terminal_fen", "old"),
            ("terminal", {"fen": FEN, "checkers": ["b10"]}),
        ):
            self.assertIsNone(old_pawn.evidence_outcome(t, {**record, field: value}))
        engine = Mock()
        engine.checking_pieces.side_effect = EngineProtocolError("failed")
        self.assertEqual(old_pawn.assess(engine, t)["outcome"], "inconclusive")

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_theme_lesson_both_colors(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            for left in (False, True):
                t = trace(mirror, left)
                self.assertIn(
                    t.moves[-1], engine.inspect(t.decisions[-1].context).legal_moves
                )
                self.assertTrue(
                    engine.inspect(SearchContext(t.terminal.fen, ())).checkmate
                )
                self.assertEqual(old_pawn.assess(engine, t)["outcome"], "key")

    def test_forward_arrival_and_other_final_movers_are_rejected(self):
        for mirror in (False, True):
            board = decode_position(FEN)
            board["c9"] = board.pop("b10")
            forward = trace_for(board, ("c9c10",), mirror)
            board = decode_position(FEN)
            board["c10"] = board.pop("b10")
            other = trace_for(board, ("h9f8",), mirror)
            for t in (forward, other):
                engine = Mock()
                self.assertFalse(old_pawn.candidate(t))
                self.assertEqual(old_pawn.assess(engine, t)["outcome"], "not_key")
                engine.checking_pieces.assert_not_called()

    def test_the_same_final_moving_pawn_must_be_a_checker(self):
        t = trace_for({**decode_position(FEN), "f10": "P"}, ("b10c10",))
        self.assertEqual(
            old_pawn.assess(self.engine(t, ("f10",)), t)["outcome"], "not_key"
        )
        self.assertEqual(
            old_pawn.assess(self.engine(t, ("c10", "f10")), t)["outcome"], "key"
        )

    def test_missing_or_mismatched_previous_board_is_inconclusive(self):
        t = trace()
        for bad in (
            replace(t, decisions=()),
            replace(t, decisions=(replace(t.decisions[0], selected_move="b10a10"),)),
            replace(t, decisions=(replace(t.decisions[0], position_fen=""),)),
            replace(
                t,
                decisions=(
                    replace(t.decisions[0], position_fen=FEN.replace("1P1k", "1R1k")),
                ),
            ),
        ):
            engine = Mock()
            self.assertIsNone(old_pawn.candidate(bad))
            self.assertEqual(old_pawn.assess(engine, bad)["outcome"], "inconclusive")
            engine.checking_pieces.assert_not_called()

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
        t = trace()
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
            k: v for k, v in versions.items() if k in {old_pawn.THEME, "__consensus__"}
        }
        self.assertEqual(pool_counts(f.connection, selected)["pending_checks"], 1)
        engine = self.engine(trace(), ("c10",))
        outcome, proofs = _evaluate_category(
            f.connection,
            current,
            (t,),
            TacticalClassifier(),
            old_pawn.THEME,
            engine,
            None,
        )
        self.assertEqual(outcome, "match")
        self.assertTrue(
            _save_category(
                f.connection, current, old_pawn.THEME, versions, outcome, proofs
            )
        )
        self.assertEqual(pool_counts(f.connection, selected)["pending_checks"], 0)
        reused, _ = _evaluate_category(
            f.connection,
            current,
            (t,),
            TacticalClassifier(),
            old_pawn.THEME,
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
            old_pawn.THEME,
            None,
            None,
        )
        self.assertEqual(conflict, "conflict")


if __name__ == "__main__":
    unittest.main()
