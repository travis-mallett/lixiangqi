import unittest
from copy import deepcopy
from unittest.mock import Mock
from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
from tools.xiangqi_data.puzzle_mining.horse_roles import HorseRole
from tools.xiangqi_data.puzzle_mining.models import SearchContext, PositionStatus
from tools.xiangqi_data.puzzle_mining.patterns import (
    DOUBLE_HORSES_THEME,
    classification_logic_version,
)
from tools.xiangqi_data.tests.test_puzzle_double_cannons import terminal

ROLE = HorseRole(DOUBLE_HORSES_THEME)
BASE = {"d10": "k", "c8": "N", "f8": "N", "f1": "K"}


class DoubleHorsesTest(unittest.TestCase):
    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_mate_both_colors_and_blocked_leg(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):

            def pos(changes):
                board = {**BASE, **changes}
                if mirror:
                    board = {
                        f"{s[0]}{11-int(s[1:])}": p.swapcase() for s, p in board.items()
                    }
                return terminal(board, "red" if mirror else "black")

            t = pos({})
            self.assertTrue(engine.inspect(SearchContext(t.fen, ())).checkmate)
            self.assertEqual(ROLE.assess(engine, t)["outcome"], "key")
            for changes in (
                {"c8": "p"},
                {"c9": "P"},
                {"f9": "P", "e8": "P"},
                {"e1": "R", "d8": "R"},
                {"d1": "R"},
                {"e10": "P", "d9": "P"},
                {"e10": "p", "d9": "p"},
            ):
                with self.subTest(mirror=mirror, changes=changes):
                    self.assertEqual(
                        ROLE.assess(engine, pos(changes))["outcome"], "not_key"
                    )

    def test_one_exclusive_empty_escape_is_sufficient(self):
        t = terminal(BASE)
        engine = Mock()
        chosen = ROLE.escape_positions(t)[0][1]
        engine.checking_pieces.side_effect = lambda ctx: (
            ctx.initial_fen,
            (
                ("c8",)
                if ctx.initial_fen == t.fen
                else ("f8",) if ctx.initial_fen == chosen else ("c8", "f8")
            ),
        )
        self.assertEqual(ROLE.assess(engine, t)["outcome"], "key")

    def test_exclusivity_and_complete_evidence(self):
        t = terminal(BASE)
        for checking, blocking, expected in (
            (("c8",), ("f8",), "key"),
            (("c8", "f8"), ("f8",), "not_key"),
            (("f1", "c8"), ("f8",), "not_key"),
            (("f1",), ("f8",), "not_key"),
            ((), ("f8",), "not_key"),
            (("c8",), ("c8",), "not_key"),
            (("c8",), ("f8", "f1"), "not_key"),
            (("c8",), (), "not_key"),
        ):
            engine = Mock()
            engine.checking_pieces.side_effect = lambda ctx: (
                ctx.initial_fen,
                checking if ctx.initial_fen == t.fen else blocking,
            )
            record = ROLE.assess(engine, t)
            self.assertEqual(record["outcome"], expected)
            for damage in ("missing", "duplicate", "fen", "version"):
                bad = deepcopy(record)
                if damage == "missing":
                    bad["escapes"].pop()
                if damage == "duplicate":
                    bad["escapes"][-1] = bad["escapes"][0]
                if damage == "fen":
                    bad["escapes"][0]["fen"] = t.fen
                if damage == "version":
                    bad["logic_version"] = "obsolete"
                self.assertIsNone(ROLE.evidence_outcome(t, bad))
        self.assertFalse(ROLE.candidate(terminal(BASE, checkmate=False)))
        self.assertFalse(ROLE.candidate(terminal({**BASE, "f8": "n"})))
        self.assertEqual(
            classification_logic_version({ROLE.theme}), "doubleHorsesMate@1.0"
        )

    def test_persisted_classification_and_reuse(self):
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )
        from tools.xiangqi_data.puzzle_mining.solver import VerifiedBranch
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            reclassify_canonical,
        )

        f = PuzzleStorageLifecycleTest()
        f.setUp(themes=(ROLE.theme,))
        self.addCleanup(f.tearDown)
        t = terminal({"e9": "k", "c8": "N", "f8": "N", "f1": "K"})
        f.verify(
            result=f.result(
                branches=(VerifiedBranch(("a8c9",), PositionStatus(t.fen, True, ())),)
            )
        )
        engine = Mock()
        engine.checking_pieces.side_effect = lambda ctx: (
            ctx.initial_fen,
            ("c8",) if ctx.initial_fen == t.fen else ("f8",),
        )
        result = reclassify_canonical(f.connection, f.key, engine=engine)
        self.assertIn(ROLE.theme, result.themes)
        self.assertEqual(
            reclassify_canonical(f.connection, f.key, force=True).themes, result.themes
        )
        engine.analyse.assert_not_called()
