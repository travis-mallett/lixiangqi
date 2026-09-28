import unittest
from copy import deepcopy
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining.engine import EngineProtocolError, OfflinePikafish
from tools.xiangqi_data.puzzle_mining.models import PositionStatus, SearchContext
from tools.xiangqi_data.puzzle_mining.patterns import (
    TerminalPosition,
    classification_logic_version,
    matching_assessed_themes,
)
from tools.xiangqi_data.puzzle_mining.position import decode_position
from tools.xiangqi_data.puzzle_mining.smothered_cannon import (
    THEME,
    VERSION,
    advisor_screened_cannons,
    assess,
    candidate,
    escape_positions,
    evidence_outcome,
)
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

BOXED = {"e10": "k", "d10": "a", "e9": "a", "f10": "r", "d1": "K", "c9": "C"}
ONE_ESCAPE = {"e10": "k", "d10": "a", "e9": "a", "f1": "K", "c9": "C"}


class SmotheredCannonTest(unittest.TestCase):
    def engine(self, trace, checking=("c10",), blocking=("f1",)):
        engine = Mock()
        engine.checking_pieces.side_effect = lambda context: (
            context.initial_fen,
            checking if context.initial_fen == trace.terminal.fen else blocking,
        )
        return engine

    def test_fully_boxed_and_one_controlled_escape_for_both_colors(self):
        for mirror in (False, True):
            for pieces, move, checker, blocker, count in (
                (BOXED, "c9c10", "c1" if mirror else "c10", (), 0),
                (
                    ONE_ESCAPE,
                    "c9c10",
                    "c1" if mirror else "c10",
                    ("f10",) if mirror else ("f1",),
                    1,
                ),
            ):
                trace = trace_for(pieces, (move,), mirror)
                self.assertIs(candidate(trace), True)
                self.assertEqual(len(escape_positions(trace)), count)
                engine = self.engine(trace, (checker,), blocker)
                self.assertEqual(assess(engine, trace)["outcome"], "key")
                self.assertEqual(engine.checking_pieces.call_count, 1 + count)
                engine.analyse.assert_not_called()
                engine.inspect.assert_not_called()

    def test_escape_inspection_uses_previous_board_and_defending_turn(self):
        trace = trace_for(ONE_ESCAPE, ("c9c10",))
        ((move, fen),) = escape_positions(trace)
        self.assertEqual(move, "e10f10")
        self.assertEqual(fen.split()[1], "b")
        pieces = decode_position(fen)
        self.assertNotIn("e10", pieces)
        self.assertEqual(pieces["f10"], "k")
        self.assertEqual(pieces["c9"], "C")
        self.assertNotIn("c10", pieces)
        trace = trace_for({**ONE_ESCAPE, "f10": "N"}, ("c9c10",))
        ((_, fen),) = escape_positions(trace)
        self.assertEqual(decode_position(fen)["f10"], "k")
        self.assertNotIn("N", decode_position(fen).values())

    def test_one_escape_needs_attack_but_not_exclusive_control(self):
        trace = trace_for({**ONE_ESCAPE, "f3": "R"}, ("c9c10",))
        for checking, blocking, expected in (
            (("c10",), ("f1",), "key"),
            (("c10",), ("f1", "f3"), "key"),
            (("c10", "f3"), ("f1",), "not_key"),
            (("c10",), (), "not_key"),
            (("f3",), ("f1",), "not_key"),
            ((), ("f1",), "not_key"),
        ):
            with self.subTest(checking=checking, blocking=blocking):
                self.assertEqual(
                    assess(self.engine(trace, checking, blocking), trace)["outcome"],
                    expected,
                )

    def test_final_checking_cannon_requires_a_losing_advisor_screen(self):
        for mirror in (False, True):
            checker = "c1" if mirror else "c10"
            blocker = "d10" if mirror else "d1"
            for screen in ("a", "A", "r", "n", "c", "b", "p", "R", "N", "C", "B", "P"):
                trace = trace_for({**BOXED, "d10": screen}, ("c9c10",), mirror)
                with self.subTest(mirror=mirror, screen=screen):
                    self.assertEqual(
                        assess(self.engine(trace, (checker,), (blocker,)), trace)[
                            "outcome"
                        ],
                        "key" if screen == "a" else "not_key",
                    )
            # An advisor-screened cannon that is not a checker cannot qualify
            # a different cannon whose screen is not an advisor.
            trace = trace_for({**BOXED, "d10": "n", "e7": "C"}, ("c9c10",), mirror)
            eligible = "e4" if mirror else "e7"
            self.assertEqual(advisor_screened_cannons(trace), {eligible})
            self.assertEqual(
                assess(self.engine(trace, (checker,)), trace)["outcome"], "not_key"
            )
            self.assertEqual(
                assess(self.engine(trace, (eligible,)), trace)["outcome"], "key"
            )
            self.assertEqual(
                assess(self.engine(trace, (checker, eligible)), trace)["outcome"],
                "not_key",
            )

    def test_rejects_double_and_triple_check_for_both_colors(self):
        for mirror in (False, True):
            trace = trace_for({**BOXED, "e7": "C", "d8": "N"}, ("c9c10",), mirror)
            cannon, other_cannon, horse = (
                ("c1", "e4", "d3") if mirror else ("c10", "e7", "d8")
            )
            for checking in (
                (cannon, horse),
                (cannon, other_cannon),
                (cannon, other_cannon, horse),
            ):
                with self.subTest(mirror=mirror, checking=checking):
                    self.assertEqual(
                        assess(self.engine(trace, checking), trace)["outcome"],
                        "not_key",
                    )

    def test_advisor_must_be_the_only_screen_on_the_checking_line(self):
        for mirror in (False, True):
            for extra in ({}, {"c10": "a"}, {"c10": "P"}, {"c10": "p"}):
                trace = trace_for(
                    {**BOXED, **extra}, ("c9a9", "f10f9", "a9a10"), mirror
                )
                self.assertEqual(
                    advisor_screened_cannons(trace),
                    {"a1" if mirror else "a10"} if not extra else set(),
                )

    def test_two_unoccupied_paths_excluded_even_if_both_are_attacked(self):
        pieces = {"e10": "k", "d10": "a", "f1": "K", "c9": "C", "e7": "R"}
        trace = trace_for(pieces, ("c9c10",))
        engine = self.engine(trace, blocking=("f1", "e7"))
        self.assertFalse(candidate(trace))
        self.assertEqual(assess(engine, trace)["outcome"], "not_key")
        engine.checking_pieces.assert_not_called()
        # Negative geometry remains conclusive in old ledgers without boards.
        self.assertFalse(candidate(replace(trace, decisions=())))

    def test_last_move_capturing_a_blocker_preserves_pre_move_confinement(self):
        trace = trace_for({**ONE_ESCAPE, "f10": "r", "e7": "C", "e8": "N"}, ("e8f10",))
        self.assertTrue(candidate(trace))
        self.assertEqual(escape_positions(trace), ())
        self.assertEqual(assess(self.engine(trace, ("e7",)), trace)["outcome"], "key")

    def test_missing_or_inconsistent_last_board_and_nonmate(self):
        trace = trace_for(ONE_ESCAPE, ("c9c10",))
        decision = trace.decisions[-1]
        for broken in (
            replace(trace, decisions=()),
            replace(trace, decisions=(replace(decision, position_fen=""),)),
            replace(trace, decisions=(replace(decision, position_fen="bad"),)),
            replace(
                trace,
                decisions=(
                    replace(
                        decision,
                        position_fen=decision.position_fen.replace(" w ", " b "),
                    ),
                ),
            ),
            replace(trace, decisions=(replace(decision, selected_move="c9c8"),)),
            replace(trace, moves=("bad",)),
            replace(
                trace,
                terminal=replace(
                    trace.terminal, fen=trace.terminal.fen.replace("2C", "C2")
                ),
            ),
        ):
            with self.subTest(broken=broken):
                self.assertIsNone(candidate(broken))
                self.assertEqual(
                    assess(self.engine(broken), broken)["outcome"], "inconclusive"
                )
        for broken in (
            replace(trace, verified=False),
            replace(trace, terminal=PositionStatus(trace.terminal.fen, False, ())),
            replace(
                trace, terminal=PositionStatus(trace.terminal.fen, True, ("e10f10",))
            ),
        ):
            self.assertFalse(candidate(broken))
        longer = trace_for(
            {**ONE_ESCAPE, "c9": "p", "c7": "C", "c8": "p", "i7": "p"},
            ("c7c9", "i7i6", "c9c10"),
        )
        longer = replace(
            longer,
            decisions=(
                replace(longer.decisions[0], position_fen=""),
                *longer.decisions[1:],
            ),
        )
        self.assertTrue(candidate(longer))

    def test_complete_versioned_evidence_binds_both_boards(self):
        trace = trace_for(ONE_ESCAPE, ("c9c10",))
        record = assess(self.engine(trace), trace)
        for field, value in (
            ("logic_version", "old"),
            ("logic_version", "1.0"),
            ("logic_version", "1.1"),
            ("previous_fen", "old"),
            ("terminal_fen", "old"),
            ("move", "a10c10"),
        ):
            self.assertIsNone(evidence_outcome(trace, {**record, field: value}))
        for damage in ("missing", "duplicate", "fen", "turn", "checkers", "terminal"):
            broken = deepcopy(record)
            if damage == "missing":
                broken["escapes"].clear()
            if damage == "duplicate":
                broken["escapes"].append(broken["escapes"][0])
            if damage == "fen":
                broken["escapes"][0]["fen"] = trace.terminal.fen
            if damage == "turn":
                broken["escapes"][0]["fen"] = broken["escapes"][0]["fen"].replace(
                    " b ", " w "
                )
            if damage == "checkers":
                broken["escapes"][0]["checkers"] = ["f1", "f1"]
            if damage == "terminal":
                broken["terminal"]["checkers"] = ["a1"]
            self.assertIsNone(evidence_outcome(trace, broken))
        engine = self.engine(trace)
        engine.checking_pieces.side_effect = EngineProtocolError("failed")
        self.assertEqual(assess(engine, trace)["outcome"], "inconclusive")
        terminal = TerminalPosition(trace.terminal.fen, True, "black")
        self.assertEqual(matching_assessed_themes(terminal, {}, {THEME}), set())
        self.assertEqual(
            matching_assessed_themes(terminal, {THEME: record}, {THEME}), {THEME}
        )
        self.assertEqual(classification_logic_version({THEME}), f"{THEME}@{VERSION}")

    def test_persistence_reuse_queue_and_branch_consensus(self):
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )
        from tools.xiangqi_data.puzzle_mining.solver import VerifiedBranch
        from tools.xiangqi_data.puzzle_mining.classification import TacticalClassifier
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            _evaluate_category,
            reclassify_canonical,
            taxonomy_versions,
        )
        from tools.xiangqi_data.puzzle_mining.category_status import pool_counts

        fixture = PuzzleStorageLifecycleTest()
        fixture.setUp(themes=(THEME,))
        self.addCleanup(fixture.tearDown)
        trace = trace_for(BOXED, ("c9c10",))
        fixture.verify(
            result=fixture.result(
                branches=(
                    VerifiedBranch(
                        trace.moves, trace.terminal, decisions=trace.decisions
                    ),
                )
            )
        )
        result = reclassify_canonical(
            fixture.connection, fixture.key, engine=self.engine(trace, ("c10",))
        )
        self.assertIn(THEME, result.themes)
        self.assertEqual(
            reclassify_canonical(fixture.connection, fixture.key).status,
            "already_current",
        )
        self.assertEqual(
            reclassify_canonical(fixture.connection, fixture.key, force=True).themes,
            result.themes,
        )
        with fixture.connection:
            fixture.connection.execute(
                "DELETE FROM category_assessments WHERE category=?", (THEME,)
            )
        self.assertEqual(
            pool_counts(fixture.connection, taxonomy_versions())["pending_checks"], 1
        )
        engine = self.engine(trace, ("c10",))
        self.assertIn(
            THEME,
            reclassify_canonical(fixture.connection, fixture.key, engine=engine).themes,
        )
        engine.checking_pieces.assert_not_called()
        self.assertEqual(
            pool_counts(fixture.connection, taxonomy_versions())["pending_checks"], 0
        )
        # The sole-checker restriction invalidates the prior category result and
        # its attack proof, so ordinary categorization checks it again.
        with fixture.connection:
            fixture.connection.execute(
                "UPDATE category_assessments SET category_version='1.1' WHERE category=?",
                (THEME,),
            )
            fixture.connection.execute(
                "UPDATE motif_removal_evidence SET theme_version='1.1' WHERE theme=?",
                (THEME,),
            )
        self.assertEqual(
            pool_counts(fixture.connection, taxonomy_versions())["pending_checks"], 1
        )
        self.assertIn(
            THEME,
            reclassify_canonical(fixture.connection, fixture.key, engine=engine).themes,
        )
        engine.checking_pieces.assert_called_once()
        current = {
            "candidate_id": fixture.current()["id"],
            "current_verification_id": fixture.current()["current_verification_id"],
        }
        other = trace_for(
            {s: p for s, p in BOXED.items() if s not in ("d10", "f10")}, ("c9c10",)
        )
        outcome, _ = _evaluate_category(
            fixture.connection,
            current,
            (trace, other),
            TacticalClassifier(),
            THEME,
            engine,
            None,
        )
        self.assertEqual(outcome, "conflict")
        outcome, _ = _evaluate_category(
            fixture.connection,
            current,
            (replace(trace, decisions=()),),
            TacticalClassifier(),
            THEME,
            engine,
            None,
        )
        self.assertEqual(outcome, "inconclusive")

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_engine_temporal_confinement_and_cannon_mates(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            for pieces, move, expected in (
                (BOXED, "c9c10", "key"),
                (
                    {
                        **{s: p for s, p in BOXED.items() if s != "d1"},
                        "e1": "K",
                        "d10": "c",
                        "d9": "n",
                    },
                    "c9c10",
                    "not_key",
                ),
                (ONE_ESCAPE, "c9c10", "key"),
                ({**ONE_ESCAPE, "f10": "N"}, "c9c10", "key"),
                (
                    {"e10": "k", "d10": "a", "e9": "a", "d1": "K", "c9": "C"},
                    "c9c10",
                    "not_key",
                ),
                (
                    {
                        "e10": "k",
                        "d10": "a",
                        "e9": "a",
                        "d1": "K",
                        "c9": "C",
                        "f10": "N",
                    },
                    "c9c10",
                    "not_key",
                ),
                (
                    {"e10": "k", "e3": "C", "d7": "C", "d1": "R", "f1": "R", "e1": "K"},
                    "d7e7",
                    "not_key",
                ),
                ({**BOXED, "c9": "P", "a10": "C", "b10": "R"}, "b10b8", "key"),
                (
                    {
                        **{s: p for s, p in BOXED.items() if s != "c9"},
                        "a10": "C",
                        "c10": "N",
                    },
                    "c10d8",
                    "not_key",
                ),
                (
                    {
                        **{s: p for s, p in BOXED.items() if s != "c9"},
                        "a7": "C",
                        "b7": "N",
                    },
                    "b7c9",
                    "not_key",
                ),
            ):
                trace = trace_for(pieces, (move,), mirror)
                with self.subTest(mirror=mirror, pieces=pieces, move=move):
                    self.assertIn(
                        trace.moves[-1],
                        engine.inspect(trace.decisions[-1].context).legal_moves,
                    )
                    self.assertTrue(
                        engine.inspect(SearchContext(trace.terminal.fen, ())).checkmate
                    )
                    self.assertEqual(assess(engine, trace)["outcome"], expected)


if __name__ == "__main__":
    unittest.main()
