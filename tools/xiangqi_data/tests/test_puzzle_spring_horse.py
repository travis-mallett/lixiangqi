import unittest
from copy import deepcopy
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish, EngineProtocolError
from tools.xiangqi_data.puzzle_mining.models import PositionStatus, SearchContext
from tools.xiangqi_data.puzzle_mining.patterns import (
    TerminalPosition,
    classification_logic_version,
    matching_assessed_themes,
)
from tools.xiangqi_data.puzzle_mining.position import decode_position
from tools.xiangqi_data.puzzle_mining.spring_horse import (
    THEME,
    VERSION,
    assess,
    evidence_outcome,
    escape_positions,
    released_horses,
)
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

BASE = {"f1": "K", "d10": "k", "c8": "N", "c9": "R"}


def spring_trace(changes=None, moves=("c9e9",), mirror=False):
    return trace_for({**BASE, **(changes or {})}, moves, mirror)


class SpringHorseTest(unittest.TestCase):
    def engine(self, trace, checking=("c8",), blocking=("e9",)):
        engine = Mock()
        engine.checking_pieces.side_effect = lambda context: (
            context.initial_fen,
            checking if context.initial_fen == trace.terminal.fen else blocking,
        )
        return engine

    def test_both_colors_use_only_final_two_positions(self):
        for mirror in (False, True):
            trace = spring_trace(mirror=mirror)
            horse, chariot = ("c3", "e2") if mirror else ("c8", "e9")
            engine = self.engine(trace, (horse,), (chariot,))
            self.assertEqual(released_horses(trace), (horse,))
            self.assertEqual(assess(engine, trace)["outcome"], "key")
            self.assertEqual(engine.checking_pieces.call_count, 3)
            engine.analyse.assert_not_called()
        # Earlier decisions do not define this motif.
        trace = spring_trace({"c9": "r", "c6": "R"}, ("c6c9", "d10e10", "c9c7"))
        self.assertEqual(released_horses(trace), ())
        trace = trace_for(
            {"f1": "K", "d10": "k", "c8": "N", "a9": "R", "i7": "p"},
            ("a9c9", "i7i6", "c9e9"),
        )
        trace = replace(
            trace,
            decisions=(
                replace(trace.decisions[0], position_fen=""),
                *trace.decisions[1:],
            ),
        )
        self.assertEqual(assess(self.engine(trace), trace)["outcome"], "key")

    def test_only_released_horse_checks_and_same_chariot_exclusively_blocks(self):
        trace = spring_trace({"a1": "R", "b9": "N"})
        for checking, blocking, outcome in (
            (("c8",), ("e9",), "key"),
            (("b9",), ("e9",), "key"),
            (("c8", "b9"), ("e9",), "not_key"),
            (("c8", "e9"), ("e9",), "not_key"),
            (("e9",), ("e9",), "not_key"),
            ((), ("e9",), "not_key"),
            (("c8",), ("a1",), "not_key"),
            (("c8",), ("e9", "c8"), "not_key"),
            (("c8",), ("e9", "a1"), "not_key"),
            (("c8",), (), "not_key"),
        ):
            with self.subTest(checking=checking, blocking=blocking):
                self.assertEqual(
                    assess(self.engine(trace, checking, blocking), trace)["outcome"],
                    outcome,
                )
        # Shared coverage on another escape does not disqualify an exclusive one.
        engine = self.engine(trace)
        chosen = escape_positions(trace)[0][1]
        engine.checking_pieces.side_effect = lambda ctx: (
            ctx.initial_fen,
            (
                ("c8",)
                if ctx.initial_fen == trace.terminal.fen
                else ("e9",) if ctx.initial_fen == chosen else ("e9", "a1")
            ),
        )
        self.assertEqual(assess(engine, trace)["outcome"], "key")

    def test_empty_escape_semantics_and_occupied_destinations(self):
        for occupant in ("P", "p"):
            trace = spring_trace({"d9": occupant, "e10": occupant})
            self.assertEqual(escape_positions(trace), ())
            self.assertEqual(assess(self.engine(trace), trace)["outcome"], "not_key")
        trace = spring_trace()
        for move, fen in escape_positions(trace):
            board = decode_position(fen)
            self.assertNotIn("d10", board)
            self.assertEqual(board[move[3:]], "k")
            self.assertEqual(board["e9"], "R")

    def test_blocked_leg_required_immediately_before_mate(self):
        for trace in (
            spring_trace({"c9": "C"}),
            spring_trace({"c9": "r"}),
            spring_trace({"c8": "n"}),
            trace_for({"f1": "K", "d10": "k", "c8": "N", "a9": "R"}, ("a9e9",)),
            trace_for({"f1": "K", "d10": "k", "b7": "N", "e9": "R"}, ("b7c9",)),
            replace(spring_trace(), verified=False),
            replace(
                spring_trace(),
                terminal=PositionStatus(spring_trace().terminal.fen, False, ()),
            ),
        ):
            self.assertEqual(released_horses(trace), ())
            engine = self.engine(trace)
            self.assertEqual(assess(engine, trace)["outcome"], "not_key")
            engine.checking_pieces.assert_not_called()

    def test_incomplete_or_inconsistent_last_decision_fails_closed(self):
        trace = spring_trace()
        decision = trace.decisions[-1]
        for broken in (
            replace(trace, decisions=()),
            replace(
                trace,
                moves=("bad",),
                decisions=(replace(decision, selected_move="bad"),),
            ),
            replace(trace, decisions=(replace(decision, selected_move="c9e8"),)),
            replace(trace, decisions=(replace(decision, position_fen=""),)),
            replace(trace, decisions=(replace(decision, position_fen="invalid"),)),
            replace(
                trace,
                decisions=(
                    replace(
                        decision,
                        position_fen=decision.position_fen.replace(" w ", " b "),
                    ),
                ),
            ),
            replace(
                trace,
                terminal=replace(
                    trace.terminal, fen=trace.terminal.fen.replace("N", "C")
                ),
            ),
        ):
            self.assertIsNone(released_horses(broken))
            self.assertEqual(
                assess(self.engine(broken), broken)["outcome"], "inconclusive"
            )
        horse_move = trace_for({"f1": "K", "d10": "k", "a7": "N", "e9": "R"}, ("a7c8",))
        self.assertEqual(released_horses(replace(horse_move, decisions=())), ())

    def test_complete_versioned_evidence_binds_both_positions(self):
        trace = spring_trace()
        record = assess(self.engine(trace), trace)
        for field, value in (
            ("logic_version", "old"),
            ("previous_fen", "old"),
            ("terminal_fen", "old"),
            ("move", "a9e9"),
        ):
            self.assertIsNone(evidence_outcome(trace, {**record, field: value}))
        for damage in ("missing", "duplicate", "fen", "checkers", "terminal"):
            broken = deepcopy(record)
            if damage == "missing":
                broken["escapes"].pop()
            if damage == "duplicate":
                broken["escapes"][-1] = broken["escapes"][0]
            if damage == "fen":
                broken["escapes"][0]["fen"] = trace.terminal.fen
            if damage == "checkers":
                broken["escapes"][0]["checkers"] = ["e9", "e9"]
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

    def test_persisted_proof_reuse_new_category_queue_and_branch_consensus(self):
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
        trace = spring_trace()
        branch = VerifiedBranch(trace.moves, trace.terminal, decisions=trace.decisions)
        fixture.verify(result=fixture.result(branches=(branch,)))
        result = reclassify_canonical(
            fixture.connection, fixture.key, engine=self.engine(trace)
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
        engine = self.engine(trace)
        self.assertIn(
            THEME,
            reclassify_canonical(fixture.connection, fixture.key, engine=engine).themes,
        )
        engine.checking_pieces.assert_not_called()
        self.assertEqual(
            pool_counts(fixture.connection, taxonomy_versions())["pending_checks"], 0
        )
        current = {
            "candidate_id": fixture.current()["id"],
            "current_verification_id": fixture.current()["current_verification_id"],
        }
        # Same terminal board reached by a chariot that never blocked the horse.
        other = trace_for({"f1": "K", "d10": "k", "c8": "N", "a9": "R"}, ("a9e9",))
        self.assertEqual(
            decode_position(other.terminal.fen), decode_position(trace.terminal.fen)
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
        # Missing boards remain unresolved rather than silently removing a tag.
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
    def test_real_engine_both_colors_files_captures_and_exclusions(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            for changes, moves, expected in (
                ({}, ("c9e9",), "key"),
                ({"e9": "r"}, ("c9e9",), "key"),
                ({"e1": "R"}, ("c9e9",), "key"),
                ({"f8": "N"}, ("c9e9",), "not_key"),
                ({"b9": "N"}, ("c9e9",), "not_key"),
                ({"e9": "R"}, ("c9a9",), "not_key"),
                ({"d9": "p", "e10": "p"}, ("c9a9",), "not_key"),
            ):
                for reflect in (False, True):
                    pieces = {**BASE, **changes}
                    line = moves
                    if reflect:
                        pieces = {
                            chr(ord("i") - (ord(s[0]) - ord("a"))) + s[1:]: p
                            for s, p in pieces.items()
                        }
                        line = tuple(
                            "".join(
                                (
                                    chr(ord("i") - (ord(c) - ord("a")))
                                    if c in "abcdefghi"
                                    else c
                                )
                                for c in move
                            )
                            for move in moves
                        )
                    trace = trace_for(pieces, line, mirror)
                    with self.subTest(changes=changes, mirror=mirror, reflect=reflect):
                        self.assertIn(
                            trace.moves[-1],
                            engine.inspect(trace.decisions[-1].context).legal_moves,
                        )
                        self.assertTrue(
                            engine.inspect(
                                SearchContext(trace.terminal.fen, ())
                            ).checkmate
                        )
                        self.assertEqual(assess(engine, trace)["outcome"], expected)


if __name__ == "__main__":
    unittest.main()
