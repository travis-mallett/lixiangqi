import unittest
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining.iron_bolt import ASSESSORS
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish, EngineProtocolError
from tools.xiangqi_data.puzzle_mining.models import SearchContext
from tools.xiangqi_data.puzzle_mining.patterns import (
    TerminalPosition,
    matching_assessed_themes,
)
from tools.xiangqi_data.puzzle_mining.position import decode_position, encode_position
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

IRON, SMALL = ASSESSORS
IRON_FEN = "2bak4/4a4/4b4/4C4/9/3R5/9/9/4pr3/3K5 w - - 0 1"
BASE = {"e10": "k", "e9": "a", "e8": "b", "e7": "C", "f10": "a", "c10": "P", "d1": "K"}


def trace(role, mirror=False):
    return trace_for(
        decode_position(IRON_FEN) if role == IRON else BASE,
        ("d5d10",) if role == IRON else ("c10d10",),
        mirror,
    )


def terminal(t, mirror=False):
    return TerminalPosition(
        t.terminal.fen, t.checkmate, "red" if mirror else "black", t.stalemate
    )


class IronBoltTest(unittest.TestCase):
    def engine(self, t, checkers):
        e = Mock()
        e.checking_pieces.return_value = (t.fen, checkers)
        return e

    def test_required_checking_piece_and_multiple_check(self):
        for mirror in (False, True):
            board = {**BASE, "d10": "R", "f9": "P"}
            board.pop("c10")
            if mirror:
                board = {
                    s[0] + str(11 - int(s[1:])): p.swapcase() for s, p in board.items()
                }
            t = TerminalPosition(
                encode_position(board) + (" w" if mirror else " b") + " - - 0 1",
                True,
                "red" if mirror else "black",
            )
            rook, pawn, cannon = ("d1", "f2", "e4") if mirror else ("d10", "f9", "e7")
            for checkers, expected in (
                ((rook,), {IRON.theme}),
                ((pawn,), {SMALL.theme}),
                ((rook, pawn), {IRON.theme, SMALL.theme}),
                ((cannon,), set()),
                ((), set()),
            ):
                evidence = {
                    role.theme: role.assess(self.engine(t, checkers), t)
                    for role in ASSESSORS
                }
                self.assertEqual(
                    matching_assessed_themes(t, evidence, {IRON.theme, SMALL.theme}),
                    expected,
                )
            self.assertEqual(
                matching_assessed_themes(t, {}, {IRON.theme, SMALL.theme}), set()
            )

    def test_exact_enemy_screens_and_center_file_geometry(self):
        base = {**BASE, "d10": "R"}
        for mirror in (False, True):
            for screens in (("a", "b"), ("b", "a")):
                for changes, removed, expected in (
                    ({}, (), True),
                    ({"e6": "p"}, (), True),
                    ({"e8": "a", "e9": "a"}, (), None),
                    ({"e8": "B"}, (), False),
                    ({"e9": "A"}, (), False),
                    ({"e9": "p"}, (), None),
                    ({"e9": "n", "e8": "c"}, (), None),
                    ({"e9": "r", "e8": "p"}, (), None),
                    ({}, ("e8",), False),
                    ({"e7": "p", "e6": "C"}, (), False),
                    ({"d7": "C"}, ("e7",), False),
                    ({"d9": "k"}, ("e10",), False),
                    ({"e7": "c"}, (), False),
                ):
                    board = {**base, "e9": screens[0], "e8": screens[1], **changes}
                    for square in removed:
                        board.pop(square)
                    if mirror:
                        board = {
                            s[0] + str(11 - int(s[1:])): p.swapcase()
                            for s, p in board.items()
                        }
                    t = TerminalPosition(
                        encode_position(board)
                        + (" w" if mirror else " b")
                        + " - - 0 1",
                        True,
                        "red" if mirror else "black",
                    )
                    for role in ASSESSORS:
                        self.assertEqual(
                            role.candidate(t),
                            role == IRON if expected is None else expected,
                            (screens, changes, removed, mirror),
                        )
                        self.assertFalse(
                            role.candidate(replace(t, checkmate=False, stalemate=True))
                        )

    def test_second_winning_cannon_must_stay_off_enemy_back_rank(self):
        for mirror in (False, True):
            for role in ASSESSORS:
                original = terminal(trace(role, mirror), mirror)
                rank = 1 if mirror else 10
                cannon = "c" if mirror else "C"
                for file in "abghi":
                    board = decode_position(original.fen)
                    board[f"{file}{rank}"] = cannon
                    blocked = replace(
                        original,
                        fen=encode_position(board)
                        + (" w" if mirror else " b")
                        + " - - 0 1",
                    )
                    engine = Mock()
                    self.assertFalse(role.candidate(blocked))
                    self.assertEqual(role.assess(engine, blocked)["outcome"], "not_key")
                    engine.checking_pieces.assert_not_called()
                    # An enemy cannon on that rank does not trigger this condition.
                    board[f"{file}{rank}"] = cannon.swapcase()
                    self.assertTrue(
                        role.candidate(
                            replace(
                                blocked,
                                fen=encode_position(board)
                                + (" w" if mirror else " b")
                                + " - - 0 1",
                            )
                        )
                    )
                    # The second winning cannon is allowed one rank away.
                    del board[f"{file}{rank}"]
                    board[f"{file}{rank + (1 if mirror else -1)}"] = cannon
                    self.assertTrue(
                        role.candidate(
                            replace(
                                blocked,
                                fen=encode_position(board)
                                + (" w" if mirror else " b")
                                + " - - 0 1",
                            )
                        )
                    )
                self.assertTrue(role.candidate(original))  # No second cannon required.

    def test_stale_invalid_or_failed_inspections_are_inconclusive(self):
        for role in ASSESSORS:
            t = terminal(trace(role))
            for checkers in (("d10", "d10"), ("e9",), ("a1",)):
                self.assertEqual(
                    role.assess(self.engine(t, checkers), t)["outcome"], "inconclusive"
                )
            record = role.assess(self.engine(t, ("d10",)), t)
            for field, value in (
                ("logic_version", "1.0"),
                ("terminal_fen", "old"),
                ("terminal", {}),
            ):
                self.assertIsNone(role.evidence_outcome(t, {**record, field: value}))
            e = Mock()
            e.checking_pieces.side_effect = EngineProtocolError("failed")
            self.assertEqual(role.assess(e, t)["outcome"], "inconclusive")
            e.reset_mock()
            self.assertEqual(
                role.assess(e, replace(t, checkmate=False))["outcome"], "not_key"
            )
            e.checking_pieces.assert_not_called()

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_banzv_horse_and_cannon_screens(self):
        t = TerminalPosition(
            "2ba1kb2/4a4/n5n2/2p1p1p1p/9/P1P6/4c4/4C4/1r2N4/1NBAKrB2 w - - 0 6",
            True,
            "red",
        )
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        self.assertTrue(engine.inspect(SearchContext(t.fen, ())).checkmate)
        self.assertEqual(IRON.assess(engine, t)["outcome"], "key")
        record = IRON.assess(engine, t)
        self.assertIsNone(IRON.evidence_outcome(t, {**record, "logic_version": "1.1"}))

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_mates_both_colors(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            for role in ASSESSORS:
                t = trace(role, mirror)
                self.assertIn(
                    t.moves[-1], engine.inspect(t.decisions[-1].context).legal_moves
                )
                self.assertTrue(
                    engine.inspect(SearchContext(t.terminal.fen, ())).checkmate
                )
                self.assertEqual(
                    role.assess(engine, terminal(t, mirror))["outcome"], "key"
                )

    def test_category_persistence_and_branch_consensus(self):
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )
        from tools.xiangqi_data.puzzle_mining.solver import VerifiedBranch
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            _evaluate_category,
            _save_category,
            taxonomy_versions,
        )
        from tools.xiangqi_data.puzzle_mining.classification import TacticalClassifier

        for role in ASSESSORS:
            f = PuzzleStorageLifecycleTest()
            f.setUp(themes=None)
            self.addCleanup(f.tearDown)
            t = trace(role)
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
            e = self.engine(terminal(t), ("d10",))
            outcome, proofs = _evaluate_category(
                f.connection, current, (t,), TacticalClassifier(), role.theme, e, None
            )
            self.assertEqual(outcome, "match")
            self.assertTrue(
                _save_category(
                    f.connection,
                    current,
                    role.theme,
                    taxonomy_versions(),
                    outcome,
                    proofs,
                )
            )
            self.assertEqual(
                _evaluate_category(
                    f.connection,
                    current,
                    (t,),
                    TacticalClassifier(),
                    role.theme,
                    None,
                    None,
                )[0],
                "match",
            )
            e.checking_pieces.assert_called_once()
            stale = replace(t, terminal=replace(t.terminal, checked=False))
            self.assertEqual(
                _evaluate_category(
                    f.connection,
                    current,
                    (t, stale),
                    TacticalClassifier(),
                    role.theme,
                    None,
                    None,
                )[0],
                "conflict",
            )


if __name__ == "__main__":
    unittest.main()
