import unittest
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining.models import PositionStatus, SearchContext
from tools.xiangqi_data.puzzle_mining.patterns import (
    SERVANT_CROWDING_MASTER_THEME as THEME,
    TerminalPosition,
    classification_logic_version,
    matching_assessed_themes,
    servant_crowding_master_attack,
)
from tools.xiangqi_data.puzzle_mining.position import encode_position

BOXED = {"e10": "k", "d10": "a", "f10": "a", "e9": "n", "e1": "K"}


def terminal(pieces, *, mirror=False, checked=True):
    if mirror:
        pieces = {f"{s[0]}{11 - int(s[1:])}": p.swapcase() for s, p in pieces.items()}
    losing = "red" if mirror else "black"
    fen = encode_position(pieces) + (" w" if mirror else " b") + " - - 0 1"
    return TerminalPosition(fen, checked, losing, stalemate=not checked)


class ServantCrowdingMasterTest(unittest.TestCase):
    def test_all_palace_squares_both_colors_and_terminal_types(self):
        palace = {f"{file}{rank}" for file in "def" for rank in (8, 9, 10)}
        for origin in sorted(palace):
            targets = {
                target
                for target in palace
                if abs(ord(target[0]) - ord(origin[0]))
                + abs(int(target[1:]) - int(origin[1:]))
                == 1
            }
            for piece in "abnrcp":
                pieces = {origin: "k", "e1": "K", **{s: piece for s in targets}}
                for mirror in (False, True):
                    for checked in (False, True):
                        with self.subTest(
                            origin=origin, piece=piece, mirror=mirror, checked=checked
                        ):
                            t = terminal(pieces, mirror=mirror, checked=checked)
                            self.assertTrue(servant_crowding_master_attack(t))
                            self.assertEqual(
                                matching_assessed_themes(t, {}, {THEME}), {THEME}
                            )
                            for target in targets:
                                opened = {
                                    s: p for s, p in pieces.items() if s != target
                                }
                                self.assertFalse(
                                    servant_crowding_master_attack(
                                        terminal(opened, mirror=mirror, checked=checked)
                                    )
                                )
                                self.assertFalse(
                                    servant_crowding_master_attack(
                                        terminal(
                                            {**opened, target: piece.upper()},
                                            mirror=mirror,
                                            checked=checked,
                                        )
                                    )
                                )

    def test_attacks_do_not_substitute_for_defending_occupants(self):
        for mirror in (False, True):
            for checked in (False, True):
                # Both empty horizontal steps are attacked by chariots.
                pieces = {"e10": "k", "e9": "a", "d1": "R", "f1": "R", "e1": "K"}
                self.assertFalse(
                    servant_crowding_master_attack(
                        terminal(pieces, mirror=mirror, checked=checked)
                    )
                )
                # Even a general from the winning side is not a friendly blocker.
                self.assertFalse(
                    servant_crowding_master_attack(
                        terminal({**BOXED, "f10": "K"}, mirror=mirror, checked=checked)
                    )
                )

    def test_requires_terminal_defeat_and_a_general_inside_its_palace(self):
        t = terminal(BOXED)
        self.assertFalse(
            servant_crowding_master_attack(replace(t, checkmate=False, stalemate=False))
        )
        for origin in (None, "c10", "e7"):
            pieces = {s: p for s, p in BOXED.items() if s != "e10"}
            if origin:
                pieces[origin] = "k"
            self.assertFalse(servant_crowding_master_attack(terminal(pieces)))
        self.assertEqual(
            classification_logic_version({THEME}), "servantCrowdingMasterAttack@1.0"
        )

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_checkmate_and_stalemate_for_both_colors(self):
        from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish

        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            for checked, extras in (
                (True, {"h10": "C"}),
                (False, {"d9": "R", "f9": "R", "e8": "P"}),
            ):
                with self.subTest(mirror=mirror, checked=checked):
                    t = terminal({**BOXED, **extras}, mirror=mirror, checked=checked)
                    status = engine.inspect(SearchContext(t.fen, ()))
                    self.assertTrue(status.terminal_win)
                    self.assertEqual(status.checked, checked)
                    self.assertTrue(servant_crowding_master_attack(t))

    def test_branch_agreement_without_engine_inspections(self):
        from tools.xiangqi_data.puzzle_mining.classification import TacticalClassifier
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            _evaluate_category,
        )
        from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

        checked = trace_for({**BOXED, "h1": "C"}, ("h1h10",))
        stale = replace(checked, terminal=replace(checked.terminal, checked=False))
        opened = trace_for(
            {s: p for s, p in {**BOXED, "h1": "C"}.items() if s != "d10"},
            ("h1h10",),
        )
        db, engine = Mock(), Mock()
        for traces, expected in (
            ((checked, stale), "match"),
            ((checked, opened), "conflict"),
            ((opened,), "no_match"),
        ):
            self.assertEqual(
                _evaluate_category(
                    db,
                    {"current_verification_id": 1},
                    traces,
                    TacticalClassifier(),
                    THEME,
                    engine,
                    None,
                ),
                (expected, {}),
            )
        self.assertEqual(engine.mock_calls, [])
        self.assertEqual(db.mock_calls, [])

    def test_stored_stalemate_classification_reuse_and_queue(self):
        from tools.xiangqi_data.puzzle_mining.category_status import pool_counts
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            reclassify_canonical,
            taxonomy_versions,
        )
        from tools.xiangqi_data.puzzle_mining.solver import VerifiedBranch
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )

        fixture = PuzzleStorageLifecycleTest()
        fixture.setUp(themes=None)
        self.addCleanup(fixture.tearDown)
        t = terminal({**BOXED, "d9": "R", "f9": "R", "e8": "P"}, checked=False)
        branch = VerifiedBranch(("e7e8",), PositionStatus(t.fen, False, ()))
        fixture.verify(result=fixture.result(branches=(branch,)))
        result = reclassify_canonical(fixture.connection, fixture.key)
        self.assertEqual(result.themes, ("mate", "mateIn1", THEME, "stalemateMate"))
        self.assertEqual(
            reclassify_canonical(fixture.connection, fixture.key).status,
            "already_current",
        )
        with fixture.connection:
            fixture.connection.execute(
                "DELETE FROM category_assessments WHERE category=?", (THEME,)
            )
        self.assertEqual(
            pool_counts(fixture.connection, taxonomy_versions())["pending_checks"], 1
        )
        self.assertEqual(
            reclassify_canonical(fixture.connection, fixture.key).themes, result.themes
        )
        self.assertEqual(
            pool_counts(fixture.connection, taxonomy_versions())["pending_checks"], 0
        )


if __name__ == "__main__":
    unittest.main()
