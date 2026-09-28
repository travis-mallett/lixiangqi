import copy
import unittest
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining.centroid_pawn import assess, evidence_outcome
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish, EngineProtocolError
from tools.xiangqi_data.puzzle_mining.models import SearchContext, PositionStatus
from tools.xiangqi_data.puzzle_mining.patterns import (
    TerminalPosition,
    centroid_pawn_escape_positions,
)
from tools.xiangqi_data.puzzle_mining.position import encode_position, decode_position

BASE = {"f1": "K", "d10": "k", "e9": "P"}


def terminal(board, losing="black", checked=True):
    return TerminalPosition(
        encode_position(board) + (" b" if losing == "black" else " w") + " - - 0 1",
        checked,
        losing,
        not checked,
    )


class CentroidPawnTest(unittest.TestCase):
    def test_two_steps_occupancy_and_captures_both_colors_and_corners(self):
        for mirror in (False, True):
            for flip in (False, True):

                def square(s):
                    return (
                        chr(ord("a") + ord("i") - ord(s[0])) if flip else s[0]
                    ) + str(11 - int(s[1:]) if mirror else int(s[1:]))

                def position(extra):
                    return terminal(
                        {
                            square(s): p.swapcase() if mirror else p
                            for s, p in {**BASE, **extra}.items()
                        },
                        "red" if mirror else "black",
                    )

                for target in ("e10", "d9"):
                    for piece in (
                        "p",
                        "r",
                        "n",
                        "c",
                        "a",
                        "b",
                        "P",
                        "R",
                        "N",
                        "C",
                        "A",
                        "B",
                    ):
                        with self.subTest(
                            mirror=mirror, flip=flip, target=target, piece=piece
                        ):
                            escapes = dict(
                                centroid_pawn_escape_positions(
                                    position({target: piece})
                                )
                            )
                            move = square("d10") + square(target)
                            self.assertEqual(move in escapes, piece.isupper())
                            if move in escapes:
                                board = decode_position(escapes[move])
                                self.assertNotIn(square("d10"), board)
                                self.assertEqual(
                                    board[square(target)], "K" if mirror else "k"
                                )
                                self.assertEqual(
                                    board[square("e9")], "p" if mirror else "P"
                                )
                self.assertEqual(len(centroid_pawn_escape_positions(position({}))), 2)
                self.assertFalse(
                    centroid_pawn_escape_positions(position({"d9": "p", "e10": "r"}))
                )

    def test_either_escape_is_sufficient_and_evidence_fails_closed(self):
        t = terminal({**BASE, "a10": "R", "d8": "R"})
        engine = Mock()
        for attacks, outcome in (
            ([("e9",), ("e9", "d8")], "key"),
            ([("e9", "a10"), ("e9",)], "key"),
            ([("e9", "a10"), ("e9", "d8")], "not_key"),
        ):
            answers = iter(attacks)
            engine.checking_pieces.side_effect = lambda c: (
                c.initial_fen,
                next(answers),
            )
            record = assess(engine, t)
            self.assertEqual(record["outcome"], outcome)
        for mutate in (
            lambda r: r.update(logic_version="1.3"),
            lambda r: r["escapes"].pop(),
            lambda r: r["escapes"].__setitem__(1, r["escapes"][0]),
            lambda r: r["escapes"][0].update(fen=t.fen),
            lambda r: r["escapes"][0].update(checkers=["d10"]),
            lambda r: r["escapes"][0].update(checkers=["e9", "e9"]),
        ):
            broken = copy.deepcopy(record)
            mutate(broken)
            self.assertIsNone(evidence_outcome(t, broken))
        engine.checking_pieces.side_effect = EngineProtocolError("bad inspection")
        self.assertEqual(assess(engine, t)["outcome"], "inconclusive")
        engine.analyse.assert_not_called()

    def test_persisted_evidence_refresh_consensus_and_terminal_cache(self):
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )
        from tools.xiangqi_data.puzzle_mining.solver import VerifiedBranch
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            reclassify_canonical,
        )

        fixture = PuzzleStorageLifecycleTest()
        fixture.setUp(themes=("centroidPawnMate",))
        self.addCleanup(fixture.tearDown)
        t = terminal({**BASE, "d8": "R"})
        branch = VerifiedBranch(("d7d8",), PositionStatus(t.fen, True, ()))
        fixture.verify(result=fixture.result(branches=(branch, branch)))
        engine = Mock()
        engine.checking_pieces.side_effect = lambda c: (c.initial_fen, ("e9",))
        result = reclassify_canonical(fixture.connection, fixture.key, engine=engine)
        self.assertEqual(result.themes, ("centroidPawnMate", "mate", "mateIn1"))
        self.assertEqual(engine.checking_pieces.call_count, 2)
        self.assertEqual(
            reclassify_canonical(fixture.connection, fixture.key, force=True).themes,
            result.themes,
        )
        with fixture.connection:
            fixture.connection.execute(
                "UPDATE taxonomy_assessments SET taxonomy_version=json_set(taxonomy_version, '$.versions.centroidPawnMate', '1.3')"
            )
            fixture.connection.execute(
                "UPDATE category_assessments SET category_version='1.3' WHERE category='centroidPawnMate'"
            )
            fixture.connection.execute(
                "UPDATE motif_removal_evidence SET theme_version='1.3' WHERE theme='centroidPawnMate'"
            )
        self.assertEqual(
            reclassify_canonical(fixture.connection, fixture.key).status,
            "awaiting_classification_evidence",
        )
        self.assertEqual(
            reclassify_canonical(fixture.connection, fixture.key, engine=engine).themes,
            result.themes,
        )
        other = terminal({**BASE, "d8": "R", "a10": "R"})
        fixture.verify(
            force=True,
            result=fixture.result(
                branches=(
                    branch,
                    VerifiedBranch(("a9a10",), PositionStatus(other.fen, True, ())),
                )
            ),
        )
        engine.checking_pieces.side_effect = lambda c: (
            c.initial_fen,
            (
                ("e9", "a10")
                if decode_position(c.initial_fen).get("a10") == "R"
                else ("e9",)
            ),
        )
        self.assertEqual(
            reclassify_canonical(fixture.connection, fixture.key, engine=engine).status,
            "category_conflict",
        )
        engine.analyse.assert_not_called()

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_engine_attacks_captures_and_discovered_lines(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        # Horizontal only, vertical only, both, neither; then screens, horse legs,
        # flying generals, friendly occupancy and captures. Every root is terminal.
        cases = [
            ({"d8": "R"}, "key"),
            ({"a10": "R"}, "key"),
            ({}, "key"),
            ({"d8": "R", "a10": "R"}, "not_key"),
            ({"d8": "R", "a10": "C", "c10": "P"}, "not_key"),
            ({"d8": "R", "g9": "N"}, "not_key"),
            ({"d8": "R", "g9": "N", "f9": "p"}, "key"),
            ({"d8": "R", "e1": "K", "f1": None, "e9": "P"}, "key"),
            ({"e10": "p", "d8": "R"}, "not_key"),
            ({"e10": "p", "a10": "R"}, "key"),
            ({"d9": "R", "a10": "R"}, "key"),
            ({"e10": "R", "d8": "R"}, "key"),
            ({"e10": "R", "d8": "R", "a10": "R"}, "not_key"),
        ]
        for extra, expected in cases:
            for mirror in (False, True):
                board = {s: p for s, p in {**BASE, **extra}.items() if p}
                if mirror:
                    board = {
                        f"{s[0]}{11-int(s[1:])}": p.swapcase() for s, p in board.items()
                    }
                t = terminal(board, "red" if mirror else "black")
                with self.subTest(extra=extra, mirror=mirror):
                    status = engine.inspect(SearchContext(t.fen, ()))
                    self.assertTrue(status.terminal_win)
                    self.assertEqual(assess(engine, t)["outcome"], expected)


if __name__ == "__main__":
    unittest.main()
