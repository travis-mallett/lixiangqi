import unittest
from copy import deepcopy
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
from tools.xiangqi_data.puzzle_mining.horse_roles import HorseRole
from tools.xiangqi_data.puzzle_mining.models import SearchContext, PositionStatus
from tools.xiangqi_data.puzzle_mining.patterns import (
    HORSE_CANNON_THEME,
    HORSE_ROLE_VERSIONS,
    horse_cannon_screens,
    horse_role_escape_positions,
)
from tools.xiangqi_data.tests.test_puzzle_double_cannons import terminal

ROLE = HorseRole(HORSE_CANNON_THEME)
BASE = {"e9": "k", "c9": "N", "a9": "C", "f1": "K"}


class HorseCannonTest(unittest.TestCase):
    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_mates_and_post_exclusion_both_colors(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for post, board in (
            ("elbowHorse", BASE),
            ("anglerHorse", {"e8": "k", "c8": "N", "a8": "C", "f1": "K"}),
            ("palcornerHorse", {"d10": "k", "d8": "N", "d5": "C", "f1": "K"}),
        ):
            for mirror in (False, True):
                pieces = (
                    {f"{s[0]}{11-int(s[1:])}": p.swapcase() for s, p in board.items()}
                    if mirror
                    else board
                )
                t = terminal(pieces, "red" if mirror else "black")
                with self.subTest(post=post, mirror=mirror):
                    self.assertTrue(engine.inspect(SearchContext(t.fen, ())).checkmate)
                    self.assertEqual(ROLE.assess(engine, t)["outcome"], "key")
                    self.assertEqual(
                        HorseRole(post).assess(engine, t)["outcome"], "not_key"
                    )
        for change, expected in (
            ({"e10": "C"}, "key"),  # protected capture
            ({"e10": "p", "e8": "p"}, "not_key"),
            ({"d9": "P"}, "not_key"),  # extra screen and blocked horse leg
            ({"c9": "n"}, "not_key"),
            ({"a9": "c"}, "not_key"),
        ):
            self.assertEqual(
                ROLE.assess(engine, terminal({**BASE, **change}))["outcome"], expected
            )
        self.assertFalse(ROLE.candidate(terminal(BASE, checkmate=False)))

    def test_exclusive_same_screen_proof_and_no_early_checking_horse_match(self):
        # A separate named-post horse also checks. Horse-cannon exclusion still
        # takes precedence, and complete escape evidence is mandatory.
        board = {**BASE, "c7": "N", "a1": "R"}
        t = terminal(board)
        escapes = dict(horse_role_escape_positions(t))
        for attackers, expected in (
            (("c9",), "key"),
            (("c7",), "not_key"),
            (("c9", "c7"), "not_key"),
            (("c9", "a1"), "not_key"),
            (("c9", "f1"), "not_key"),
        ):
            engine = Mock()
            engine.checking_pieces.side_effect = lambda ctx: (
                ctx.initial_fen,
                ("a9", "c7") if ctx.initial_fen == t.fen else attackers,
            )
            self.assertEqual(ROLE.assess(engine, t)["outcome"], expected)
            post = HorseRole("highAnglerHorse")
            record = post.assess(engine, t)
            self.assertEqual(len(record["escapes"]), len(escapes))
            self.assertEqual(
                record["outcome"], "not_key" if expected == "key" else "key"
            )
            missing = deepcopy(record)
            missing["escapes"].pop()
            self.assertIsNone(post.evidence_outcome(t, missing))
            old = deepcopy(record)
            old["logic_version"] = "1.0"
            self.assertIsNone(post.evidence_outcome(t, old))
        self.assertEqual(HORSE_ROLE_VERSIONS["singleHorseCapturesKing"], "1.0")

    def test_cannon_screen_geometry_all_directions(self):
        for horse, cannon in (("c9", "a9"), ("g9", "i9"), ("e7", "e1")):
            self.assertEqual(
                horse_cannon_screens(terminal({"e9": "k", horse: "N", cannon: "C"})),
                {cannon: horse},
            )
        self.assertEqual(
            horse_cannon_screens(terminal({"e8": "k", "e9": "N", "e10": "C"})),
            {"e10": "e9"},
        )

    def test_persisted_reclassification_replaces_old_post_category(self):
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )
        from tools.xiangqi_data.puzzle_mining.solver import VerifiedBranch
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            reclassify_canonical,
        )

        f = PuzzleStorageLifecycleTest()
        f.setUp(themes=(ROLE.theme, "elbowHorse"))
        self.addCleanup(f.tearDown)
        t = terminal(BASE)
        f.verify(
            result=f.result(
                branches=(VerifiedBranch(("a8a9",), PositionStatus(t.fen, True, ())),)
            )
        )
        engine = Mock()
        engine.checking_pieces.side_effect = lambda ctx: (
            ctx.initial_fen,
            ("a9",) if ctx.initial_fen == t.fen else ("c9",),
        )
        result = reclassify_canonical(f.connection, f.key, engine=engine)
        self.assertIn(ROLE.theme, result.themes)
        self.assertNotIn("elbowHorse", result.themes)
        with f.connection:
            f.connection.execute(
                "UPDATE category_assessments SET category_version='1.0',outcome='match' WHERE category='elbowHorse'"
            )
            f.connection.execute(
                "UPDATE motif_removal_evidence SET theme_version='1.0' WHERE theme='elbowHorse'"
            )
        self.assertEqual(
            reclassify_canonical(f.connection, f.key, engine=engine).themes,
            result.themes,
        )
        self.assertEqual(
            reclassify_canonical(f.connection, f.key, force=True).themes, result.themes
        )
        engine.analyse.assert_not_called()
