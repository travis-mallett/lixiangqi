import unittest

from tools.xiangqi_data.pikafish_rules import default_executable

from tools.xiangqi_data.puzzle_mining.patterns import (
    DOUBLE_CANNONS_THEME,
    TerminalPosition,
    classification_logic_version,
    double_cannons_mate,
    matching_assessed_themes,
)
from tools.xiangqi_data.puzzle_mining.position import encode_position


def terminal(pieces, losing="black", checkmate=True):
    return TerminalPosition(
        encode_position(pieces) + (" b" if losing == "black" else " w") + " - - 0 1",
        checkmate,
        losing,
        stalemate=not checkmate,
    )


class DoubleCannonsTest(unittest.TestCase):
    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_verified_mate_for_both_colors(self):
        from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
        from tools.xiangqi_data.puzzle_mining.models import SearchContext

        engine = OfflinePikafish(default_executable())
        try:
            base = {"e10": "k", "e7": "C", "e3": "C", "e1": "K", "d1": "R", "f1": "R"}
            for mirror in (False, True):
                board = (
                    {f"{s[0]}{11-int(s[1:])}": p.swapcase() for s, p in base.items()}
                    if mirror
                    else base
                )
                t = terminal(board, "red" if mirror else "black")
                status = engine.inspect(SearchContext(t.fen, ()))
                self.assertTrue(status.checkmate)
                self.assertTrue(double_cannons_mate(t))
        finally:
            engine.close()

    def test_both_colors_all_directions_and_spacing(self):
        for losing, general, cannon, origin in (
            ("black", "k", "C", "e9"),
            ("red", "K", "c", "e2"),
        ):
            for screen, attacker in (
                ("d" + origin[1:], "a" + origin[1:]),
                ("f" + origin[1:], "i" + origin[1:]),
                ("e5", "e4" if losing == "black" else "e6"),
            ):
                with self.subTest(losing=losing, attacker=attacker):
                    t = terminal(
                        {origin: general, screen: cannon, attacker: cannon}, losing
                    )
                    self.assertTrue(double_cannons_mate(t))
                    self.assertEqual(
                        matching_assessed_themes(t, {}),
                        {DOUBLE_CANNONS_THEME},
                    )
                    self.assertEqual(
                        matching_assessed_themes(t, {}, {"octagonalHorse"}), set()
                    )

    def test_rejects_wrong_screen_color_extra_blockers_and_nonmate(self):
        base = {"e10": "k", "e7": "C", "e3": "C", "d1": "K"}
        self.assertTrue(double_cannons_mate(terminal(base)))
        for change in (
            {"e7": "c"},
            {"e7": "P"},
            {"e3": "c"},
            {"e9": "p"},
            {"e5": "P"},
            {"e3": "R"},
        ):
            with self.subTest(change=change):
                self.assertFalse(double_cannons_mate(terminal({**base, **change})))
        for removed in ("e7", "e3", "e10"):
            self.assertFalse(
                double_cannons_mate(
                    terminal({s: p for s, p in base.items() if s != removed})
                )
            )
        self.assertFalse(double_cannons_mate(terminal(base, checkmate=False)))
        self.assertEqual(
            classification_logic_version({DOUBLE_CANNONS_THEME}), "doubleCannons@1.0"
        )

    def test_persisted_classification_version_refresh_and_branch_agreement(self):
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )
        from tools.xiangqi_data.puzzle_mining.solver import VerifiedBranch
        from tools.xiangqi_data.puzzle_mining.models import PositionStatus
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            reclassify_canonical,
        )

        fixture = PuzzleStorageLifecycleTest()
        fixture.setUp(themes=("doubleCannons",))
        self.addCleanup(fixture.tearDown)
        t = terminal({"e10": "k", "e7": "C", "e3": "C", "e1": "K"})
        branch = VerifiedBranch(("d7e7",), PositionStatus(t.fen, True, ()))
        fixture.verify(result=fixture.result(branches=(branch,)))
        result = reclassify_canonical(fixture.connection, fixture.key)
        self.assertEqual(result.themes, ("doubleCannons", "mate", "mateIn1"))
        self.assertEqual(
            reclassify_canonical(fixture.connection, fixture.key).status,
            "already_current",
        )
        with fixture.connection:
            fixture.connection.execute(
                "UPDATE taxonomy_assessments SET taxonomy_version=json_remove(taxonomy_version, '$.versions.doubleCannons')"
            )
        self.assertEqual(
            reclassify_canonical(fixture.connection, fixture.key).themes, result.themes
        )
        other = terminal({"e10": "k", "e7": "P", "e3": "C", "e1": "K"})
        fixture.verify(
            force=True,
            result=fixture.result(
                branches=(
                    branch,
                    VerifiedBranch(("e6e7",), PositionStatus(other.fen, True, ())),
                )
            ),
        )
        conflict = reclassify_canonical(fixture.connection, fixture.key)
        self.assertEqual(conflict.status, "category_conflict")
        self.assertFalse(conflict.themes)
