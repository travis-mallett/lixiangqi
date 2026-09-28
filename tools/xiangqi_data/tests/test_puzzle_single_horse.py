import unittest
from copy import deepcopy
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
from tools.xiangqi_data.puzzle_mining.horse_roles import HorseRole
from tools.xiangqi_data.puzzle_mining.models import SearchContext, PositionStatus
from tools.xiangqi_data.puzzle_mining.patterns import (
    SINGLE_HORSE_THEME,
    horse_role_escape_positions,
    matching_assessed_themes,
)
from tools.xiangqi_data.tests.test_puzzle_double_cannons import terminal

BASE = {"d10": "k", "f10": "N", "e1": "K", "a5": "N"}
ROLE = HorseRole(SINGLE_HORSE_THEME)


def position(board=BASE, mirror=False):
    if mirror:
        board = {f"{s[0]}{11-int(s[1:])}": p.swapcase() for s, p in board.items()}
    return terminal(board, "red" if mirror else "black", checkmate=False)


class SingleHorseTest(unittest.TestCase):
    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_stalemates_and_exclusive_coverage_both_colors(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            for board in (BASE, {"d10": "k", "f8": "N", "f1": "K"}):
                with self.subTest(mirror=mirror, board=board):
                    t = position(board, mirror)
                    self.assertTrue(engine.inspect(SearchContext(t.fen, ())).stalemate)
                    record = ROLE.assess(engine, t)
                    self.assertEqual(record["outcome"], "key")
                    self.assertEqual(
                        matching_assessed_themes(t, {ROLE.theme: record}, {ROLE.theme}),
                        {ROLE.theme},
                    )
            for change in ({"i9": "R"}, {"b8": "N"}, {"f10": "r"}, {"e10": "P"}):
                self.assertEqual(
                    ROLE.assess(engine, position({**BASE, **change}, mirror))[
                        "outcome"
                    ],
                    "not_key",
                )
            # A protected capturable piece is allowed, but must not itself
            # contribute to attacks on any other escape square.
            self.assertEqual(
                ROLE.assess(engine, position({**BASE, "d9": "C"}, mirror))["outcome"],
                "key",
            )
            # Own occupants exclude an escape. With the only horse-controlled
            # escape excluded, flying-general control alone is insufficient.
            self.assertEqual(
                ROLE.assess(engine, position({**BASE, "d9": "p"}, mirror))["outcome"],
                "not_key",
            )

    def record(self, attacks):
        t = position()
        engine = Mock()
        engine.checking_pieces.side_effect = lambda ctx: (
            ctx.initial_fen,
            attacks.get(ctx.initial_fen, ()),
        )
        return ROLE.assess(engine, t)

    def test_complete_evidence_and_single_contributing_horse(self):
        t = position()
        escapes = dict(horse_role_escape_positions(t))
        for attack_sets, expected in (
            ((("e1",), ("f10",)), "key"),
            ((("e1", "f10"), ("f10",)), "key"),
            ((("f10",), ("a5",)), "not_key"),
            ((("f10", "a5"), ("f10",)), "not_key"),
            ((("e1",), ("e1",)), "not_key"),
            (((), ("f10",)), "not_key"),
        ):
            record = self.record(dict(zip(escapes.values(), attack_sets)))
            self.assertEqual(record["outcome"], expected)
        record = self.record({fen: ("f10",) for fen in escapes.values()})
        for mutate in (
            lambda r: r["escapes"].pop(),
            lambda r: r.update(logic_version="obsolete"),
            lambda r: r["escapes"][0].update(fen=t.fen),
            lambda r: r["escapes"].__setitem__(1, r["escapes"][0]),
        ):
            bad = deepcopy(record)
            mutate(bad)
            self.assertIsNone(ROLE.evidence_outcome(t, bad))
        self.assertFalse(ROLE.candidate(terminal(BASE)))
        self.assertFalse(ROLE.candidate(position({"d10": "k", "e1": "K"})))
        blocked = position({**BASE, "d9": "p", "e10": "p"})
        engine = Mock()
        engine.checking_pieces.side_effect = lambda ctx: (ctx.initial_fen, ())
        self.assertEqual(ROLE.assess(engine, blocked)["outcome"], "not_key")

    def test_persistence_new_category_and_branch_conflict(self):
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )
        from tools.xiangqi_data.puzzle_mining.solver import VerifiedBranch
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            reclassify_canonical,
        )

        f = PuzzleStorageLifecycleTest()
        f.setUp(themes=None)
        self.addCleanup(f.tearDown)
        t = position()
        branch = VerifiedBranch(("h9f10",), PositionStatus(t.fen, False, ()))
        f.verify(result=f.result(branches=(branch,)))
        escapes = dict(horse_role_escape_positions(t))
        attacks = {escapes["d10e10"]: ("e1",), escapes["d10d9"]: ("f10",)}
        engine = Mock()
        engine.checking_pieces.side_effect = lambda ctx: (
            ctx.initial_fen,
            attacks.get(ctx.initial_fen, ()),
        )
        result = reclassify_canonical(f.connection, f.key, engine=engine)
        self.assertIn(ROLE.theme, result.themes)
        self.assertEqual(
            reclassify_canonical(f.connection, f.key, force=True).themes, result.themes
        )
        engine.analyse.assert_not_called()
        with f.connection:
            f.connection.execute(
                "UPDATE category_assessments SET category_version='old' WHERE category=?",
                (ROLE.theme,),
            )
            f.connection.execute(
                "UPDATE motif_removal_evidence SET theme_version='old' WHERE theme=?",
                (ROLE.theme,),
            )
        self.assertEqual(
            reclassify_canonical(f.connection, f.key, engine=engine).themes,
            result.themes,
        )
        other = terminal(BASE)
        f.verify(
            force=True,
            result=f.result(
                branches=(
                    branch,
                    VerifiedBranch(("b3a5",), PositionStatus(other.fen, True, ())),
                )
            ),
        )
        conflict = reclassify_canonical(f.connection, f.key, engine=engine)
        self.assertNotIn(ROLE.theme, conflict.themes)
        self.assertEqual(
            f.connection.execute(
                "SELECT outcome FROM category_assessments WHERE category=? AND verification_assessment_id=?",
                (ROLE.theme, f.current()["current_verification_id"]),
            ).fetchone()[0],
            "conflict",
        )
