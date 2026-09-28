"""Regression coverage for single-pass, fixed-budget equal-mate verification."""

from dataclasses import replace
from unittest.mock import patch
from types import SimpleNamespace
import unittest
from tools.xiangqi_data.puzzle_mining.models import (
    EngineScore,
    PositionStatus,
    SearchContext,
    SearchLine,
    SearchResult,
)
from tools.xiangqi_data.puzzle_mining.solver import (
    SolverConfig,
    solve_checkmate,
    SolutionReview,
    SolutionRejected,
)
from tools.xiangqi_data.puzzle_mining.engine import (
    EngineCancelled,
    ConstructionTimeout,
    construction_budget,
    check_deadline,
    OfflinePikafish,
)
from tools.xiangqi_data.tests.test_puzzle_mining_engine_discovery import (
    FakePikafish,
    _line,
)

FEN = "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1"


class TreeEngine:
    engine_version = "tree;threads=1;hash=128"
    nnue = "tree.nnue"

    def __init__(self, tree, overrides=None, history=("source",)):
        self.tree, self.overrides, self.history = (tree, overrides or {}, history)
        self.calls = []

    def inspect(self, context):
        assert context.moves[: len(self.history)] == self.history
        path = context.moves[len(self.history) :]
        if path not in self.tree:
            return PositionStatus(FEN.replace(" w ", " b "), True, ())
        side, lines = self.tree[path]
        return PositionStatus(
            FEN.replace(" w ", f" {side} "), False, tuple((move for move, _ in lines))
        )

    def analyse(self, context, *, nodes=None, depth=None, multi_pv):
        path = context.moves[len(self.history) :]
        self.calls.append((context, depth if depth is not None else nodes, multi_pv))
        values = self.overrides.get((path, multi_pv), self.tree[path][1])[:multi_pv]
        lines = tuple(
            (
                SearchLine(
                    i + 1,
                    depth or 20,
                    22,
                    nodes or 100,
                    1,
                    EngineScore(kind, value),
                    (move,),
                )
                for i, (move, (kind, value)) in enumerate(values)
            )
        )
        return SearchResult(self.engine_version, self.nnue, lines[0].moves[0], lines)


def run(engine, **limits):
    return solve_checkmate(
        engine, SearchContext(FEN, engine.history), "red", SolverConfig(**limits)
    )


class EqualMatesTest(unittest.TestCase):
    def linear_alternatives(self, predicted, actual):
        tree = {(): ("w", [(m, ("mate", n)) for m, n in predicted.items()])}
        for move, length in actual.items():
            path = (move,)
            for ply in range(1, 2 * length - 1):
                next_move = f"{move}{ply}"
                remaining = length - (ply + 1) // 2
                tree[path] = (
                    "b" if ply % 2 else "w",
                    [(next_move, ("mate", -remaining if ply % 2 else remaining))],
                )
                path = (*path, next_move)
        return tree

    def test_reconcile_longer_shorter_and_equal_completed_paths(self):
        for actual, expected in [
            ({"a": 5, "b": 4}, {"b"}),
            ({"a": 5, "b": 5}, {"a", "b"}),
            ({"a": 5, "b": 6}, {"a"}),
            ({"a": 3, "b": 4}, {"a"}),
        ]:
            with self.subTest(actual=actual):
                solved = run(
                    TreeEngine(self.linear_alternatives({"a": 4, "b": 4}, actual))
                )
                self.assertTrue(solved.complete)
                self.assertEqual({b.moves[0] for b in solved.branches}, expected)
                self.assertEqual(
                    {len(b.moves) for b in solved.branches},
                    {2 * min(actual.values()) - 1},
                )

    def test_reopens_worse_alternative_when_original_ties_lengthen(self):
        engine = TreeEngine(
            self.linear_alternatives(
                {"a": 4, "b": 4, "c": 5, "d": 7}, {"a": 6, "b": 6, "c": 5, "d": 7}
            )
        )
        solved = run(engine)
        self.assertEqual([b.moves[0] for b in solved.branches], ["c"])
        self.assertFalse(any(c.moves[1:2] == ("d",) for c, _, _ in engine.calls))
        self.assertGreater(solved.revisions, 0)

    def test_fresh_fork_search_can_reveal_previously_uncompetitive_move(self):
        class Updated(TreeEngine):
            def analyse(self, context, **kwargs):
                if context.moves == self.history and any(
                    c.moves != self.history for c, _, _ in self.calls
                ):
                    self.overrides[((), 2)] = [("c", ("mate", 2)), ("a", ("mate", 3))]
                return super().analyse(context, **kwargs)

        engine = Updated(
            self.linear_alternatives({"a": 3, "b": 3, "c": 9}, {"a": 2, "b": 3, "c": 2})
        )
        # Width four is clipped to all three legal alternatives at the first tie.
        original = engine.analyse

        def analyse(context, **kwargs):
            if context.moves == engine.history and any(
                c.moves != engine.history for c, _, _ in engine.calls
            ):
                engine.overrides[((), 3)] = [
                    ("c", ("mate", 2)),
                    ("a", ("mate", 3)),
                    ("b", ("mate", 3)),
                ]
            return original(context, **kwargs)

        engine.analyse = analyse
        solved = run(engine)
        self.assertEqual({b.moves[0] for b in solved.branches}, {"a", "c"})

    def test_budget_exhaustion_preserves_partial_evidence_without_approval(self):
        engine = TreeEngine(
            self.linear_alternatives({"a": 2, "b": 2}, {"a": 2, "b": 2})
        )
        original = engine.analyse

        def analyse(context, **kwargs):
            if context.moves[1:2] == ("b",):
                raise ConstructionTimeout()
            return original(context, **kwargs)

        engine.analyse = analyse
        solved = run(engine)
        self.assertFalse(solved.complete)
        self.assertEqual(solved.uncertainty, ("construction_time_limit",))
        self.assertEqual(len(solved.branches), 1)
        self.assertIsNone(engine.construction_deadline)

    def test_budget_is_shared_and_interrupts_waiting_for_engine_output(self):
        engine = SimpleNamespace(cancel_event=None)
        with patch(
            "tools.xiangqi_data.puzzle_mining.engine.time.monotonic", return_value=10
        ):
            with construction_budget(engine, 300):
                with construction_budget(engine, 3000):
                    self.assertEqual(engine.construction_deadline, 310)
                    with patch(
                        "tools.xiangqi_data.puzzle_mining.engine.time.monotonic",
                        return_value=311,
                    ):
                        with self.assertRaises(ConstructionTimeout):
                            OfflinePikafish._read_until(engine, float("inf"))
            self.assertIsNone(engine.construction_deadline)

    def test_missing_mate_is_discarded_without_retrying(self):
        engine = TreeEngine({(): ("w", [("a", ("cp", 40)), ("b", ("cp", 20))])})
        with self.assertRaisesRegex(SolutionRejected, "^mate_not_reproduced$"):
            run(engine)
        self.assertEqual(len(engine.calls), 1)

    def test_timing_reports_actual_search_work_without_changing_solution(self):
        tree = {(): ("w", [("a", ("mate", 1)), ("b", ("cp", 800))])}

        class MeasuredEngine(TreeEngine):
            def analyse(self, context, *, nodes=None, depth=None, multi_pv):
                result = super().analyse(
                    context, nodes=nodes, depth=depth, multi_pv=multi_pv
                )
                return replace(
                    result,
                    lines=tuple(
                        replace(line, nodes=100 + index * 50, depth=20 + index)
                        for index, line in enumerate(result.lines)
                    ),
                )

        events = []
        solved = solve_checkmate(
            MeasuredEngine(tree),
            SearchContext(FEN, ("source",)),
            "red",
            SolverConfig(),
            timing=lambda stage, details: events.append((stage, details)),
        )
        self.assertEqual(solved, run(MeasuredEngine(tree)))
        searches = [
            details for stage, details in events if stage == "engine.search.result"
        ]
        self.assertTrue(searches)
        self.assertTrue(any(details["lines"] == 2 for details in searches))
        for details in searches:
            self.assertEqual(details["nodes"], 100 + (details["lines"] - 1) * 50)
            self.assertEqual(details["depth"], 20 + details["lines"] - 1)
        self.assertEqual(solved.nodes, sum(details["nodes"] for details in searches))
        self.assertEqual(solved.depth, max(details["depth"] for details in searches))

    def test_mate_score_without_terminal_board_is_incomplete(self):
        engine = TreeEngine(
            {(): ("w", [("a", ("mate", 1))]), ("a",): ("b", [("d", ("cp", 0))])}
        )
        with self.assertRaisesRegex(
            SolutionReview, "reported_mate_without_terminal_position"
        ):
            run(engine)
        self.assertEqual(len(engine.calls), 1)

    def test_widening_metadata_does_not_reclassify_unchanged_primary(self):
        engine = TreeEngine({(): ("w", [("a", ("mate", 1)), ("b", ("cp", 800))])})
        solved = run(engine)
        self.assertEqual(solved.revisions, 0)
        self.assertEqual(solved.primary.decisions[0].analysis.requested_multipv, 2)

    def test_changed_mate_distance_continues_at_fixed_depth(self):
        for defense_distance in (-2, -5):
            with self.subTest(defense_distance=defense_distance):
                engine = TreeEngine(
                    {
                        (): ("w", [("a", ("mate", 4))]),
                        ("a",): ("b", [("d", ("mate", defense_distance))]),
                        ("a", "d"): ("w", [("x", ("mate", 1))]),
                    }
                )
                solved = run(engine)
                self.assertTrue(solved.complete)
                self.assertEqual(solved.primary.moves, ("a", "d", "x"))
                self.assertEqual([n for _, n, _ in engine.calls], [20, 20, 20])

    def test_unique_mainline_searches_each_position_once_with_two_pvs(self):
        engine = TreeEngine(
            {
                (): ("w", [("a", ("mate", 2)), ("b", ("mate", 3))]),
                ("a",): ("b", [("d", ("mate", -1)), ("e", ("cp", -900))]),
                ("a", "d"): ("w", [("x", ("mate", 1)), ("y", ("mate", 2))]),
            }
        )
        solved = run(engine)
        self.assertTrue(solved.complete)
        self.assertEqual(solved.primary.moves, ("a", "d", "x"))
        self.assertEqual([w for _, _, w in engine.calls], [2, 1, 2])
        self.assertEqual([n for _, n, _ in engine.calls], [20] * 3)

    def test_incomplete_search_retry_keeps_fixed_budget(self):
        engine = TreeEngine({(): ("w", [("a", ("mate", 1)), ("b", ("cp", 800))])})
        original = engine.analyse

        def bounded(context, *, nodes=None, depth=None, multi_pv):
            result = original(context, nodes=nodes, depth=depth, multi_pv=multi_pv)
            if len(engine.calls) == 1:
                return replace(
                    result,
                    lines=tuple(
                        replace(line, score=replace(line.score, bound="lowerbound"))
                        for line in result.lines
                    ),
                )
            return result

        engine.analyse = bounded
        self.assertTrue(run(engine).complete)
        self.assertEqual([(n, w) for _, n, w in engine.calls], [(20, 2)] * 2)

    def test_single_line_uses_only_one_pv_and_complete_history(self):
        engine = TreeEngine({(): ("w", [("a", ("mate", 1))])})
        solved = run(engine)
        self.assertTrue(solved.complete)
        self.assertEqual(solved.primary.moves, ("a",))
        self.assertEqual([c[2] for c in engine.calls], [1])
        self.assertEqual(engine.calls[0][1], 20)
        self.assertEqual(solved.primary.decisions[0].context.moves, ("source",))

    def test_persisted_completed_analysis_reuses_only_matching_context_and_settings(
        self,
    ):
        tree = {(): ("w", [("a", ("mate", 1)), ("b", ("cp", 100))])}
        engine = TreeEngine(tree)
        first = run(engine)
        engine.calls.clear()
        second = solve_checkmate(
            engine,
            SearchContext(FEN, engine.history),
            "red",
            SolverConfig(),
            seed_branches=first.branches,
        )
        self.assertTrue(second.complete)
        self.assertEqual(engine.calls, [])
        solve_checkmate(
            engine,
            SearchContext(FEN, engine.history),
            "red",
            SolverConfig(depth=30),
            seed_branches=first.branches,
        )
        self.assertTrue(engine.calls)
        self.assertTrue(all((nodes == 30 for _, nodes, _ in engine.calls)))

    def test_slower_attacking_mates_are_not_classified(self):
        engine = TreeEngine({(): ("w", [("a", ("mate", 1)), ("b", ("mate", 2))])})
        solved = run(engine)
        self.assertEqual(solved.completed_branches, 1)

    def test_only_longest_delaying_defenses_are_followed(self):
        engine = TreeEngine(
            {
                (): ("w", [("a", ("mate", 3))]),
                ("a",): ("b", [("d", ("mate", -2)), ("e", ("mate", -1))]),
                ("a", "d"): ("w", [("x", ("mate", 2))]),
                ("a", "d", "x"): ("b", [("z", ("mate", -1))]),
                ("a", "d", "x", "z"): ("w", [("y", ("mate", 1))]),
            }
        )
        solved = run(engine)
        self.assertEqual(solved.completed_branches, 1)
        self.assertEqual(solved.primary.moves, ("a", "d", "x", "z", "y"))

    def test_attacking_ties_expand_without_branch_or_position_cap(self):
        engine = TreeEngine({(): ("w", [(str(i), ("mate", 1)) for i in range(100)])})
        self.assertFalse(hasattr(SolverConfig(), "max_positions"))
        solved = run(engine)
        self.assertTrue(solved.complete)
        self.assertEqual(len(solved.branches), 100)
        self.assertEqual([w for _, _, w in engine.calls], [2, 4, 8, 16, 32, 64, 100])

    def test_attacking_ties_expand_later_in_solution(self):
        engine = TreeEngine(
            {
                (): ("w", [("a", ("mate", 2)), ("b", ("cp", 100))]),
                ("a",): ("b", [("d", ("mate", -1)), ("e", ("mate", -1))]),
                ("a", "d"): ("w", [("x", ("mate", 1)), ("y", ("mate", 1))]),
            }
        )
        solved = run(engine)
        self.assertEqual(
            [b.moves for b in solved.branches], [("a", "d", "x"), ("a", "d", "y")]
        )
        self.assertEqual([w for _, _, w in engine.calls], [2, 1, 2])

    def test_defender_ties_follow_only_engine_best_move(self):
        engine = TreeEngine(
            {
                (): ("w", [("a", ("mate", 2))]),
                ("a",): ("b", [("e", ("mate", -1)), ("d", ("mate", -1))]),
                ("a", "e"): ("w", [("x", ("mate", 1)), ("y", ("mate", 2))]),
            }
        )
        solved = run(engine)
        self.assertTrue(solved.complete)
        self.assertEqual(solved.completed_branches, 1)
        self.assertEqual(solved.primary.moves, ("a", "e", "x"))
        self.assertEqual([w for _, _, w in engine.calls], [1, 1, 2])
        self.assertEqual(solved.primary.decisions[1].certainty, "best_defense")

    def test_terminal_win_does_not_require_predicted_mate_distance(self):
        engine = TreeEngine({(): ("w", [("a", ("mate", 2))])})
        solved = run(engine)
        self.assertTrue(solved.complete)
        self.assertEqual(solved.primary.moves, ("a",))

    def test_cancellation_and_timeouts_cannot_return_an_approval(self):
        for error in (EngineCancelled, TimeoutError):
            engine = TreeEngine({(): ("w", [("a", ("mate", 1)), ("b", ("mate", 1))])})
            original = engine.analyse

            def cancelled(context, *, nodes=None, depth=None, multi_pv):
                if multi_pv > 1:
                    raise error()
                return original(context, nodes=nodes, depth=depth, multi_pv=multi_pv)

            engine.analyse = cancelled
            with self.assertRaises(error):
                run(engine)

    def test_explicit_reset_preserves_search_state_between_positions(self):
        engine = FakePikafish(
            ["readyok"]
            + ["readyok", _line(1, 10, "a4a5"), "bestmove a4a5"] * 2
            + ["readyok"]
        )
        commands = []
        engine._send = commands.append
        context = SearchContext(FEN, ("a4a5",))
        engine.new_game()
        engine.analyse(context, nodes=20, multi_pv=1)
        engine.analyse(context, nodes=40, multi_pv=1)
        self.assertEqual(commands.count("ucinewgame"), 1)
        self.assertEqual(commands[:2], ["ucinewgame", "isready"])
        self.assertEqual(sum(c.startswith("position ") for c in commands), 2)
        engine.new_game()
        self.assertEqual(commands[-2:], ["ucinewgame", "isready"])
        self.assertEqual(commands.count("ucinewgame"), 2)


if __name__ == "__main__":
    unittest.main()
