from __future__ import annotations

import itertools
import json
import math
import random
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from external.pikafish_worker.ai import STRENGTH_PROFILES, MoveWork, PikafishMoveEngine
from external.pikafish_worker.selection import Candidate, sample_candidate
from tools.bot_levels_optimization.calibration import (
    Config,
    calibrate,
    plans,
    tournament,
)
from tools.bot_levels_optimization.measurement import (
    isotonic,
    overall,
    redistribute,
    summarize,
)
from tools.bot_levels_optimization.native_rules import NativeRules
from tools.bot_levels_optimization.profiles import (
    SEED_COORDINATES,
    profile_at,
    validate_coordinates,
    validate_endpoints,
)
from tools.bot_levels_optimization.runtime import (
    CalibrationEngine,
    local_url,
    play_game,
)
from tools.bot_levels_optimization.storage import RunStore

FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"
OPENING = {
    "id": "master01",
    "sourceGameId": "master",
    "initialFen": FEN,
    "moves": ["h1g3", "h10g8"] * 10,
    "fen": FEN,
    "ply": 20,
}
SUITE = {"version": 1, "database": "masters", "openings": [OPENING]}


class ProfileTests(unittest.TestCase):
    def test_endpoints_and_monotonic_family(self):
        validate_endpoints()
        self.assertEqual(STRENGTH_PROFILES[0], profile_at(0))
        self.assertEqual(STRENGTH_PROFILES[8], profile_at(1))
        previous = profile_at(0)
        for n in range(1, 1001):
            current = profile_at(n / 1000)
            self.assertGreaterEqual(current.nodes, previous.nodes)
            self.assertLessEqual(current.multi_pv, previous.multi_pv)
            self.assertLessEqual(current.expected_rank, previous.expected_rank)
            if n < 1000:
                self.assertLessEqual(
                    current.max_candidate_loss, previous.max_candidate_loss
                )
            previous = current
        self.assertEqual(
            [16, 15, 13, 12, 10, 9, 7, 6, 1],
            [profile_at(s).multi_pv for s in SEED_COORDINATES],
        )
        for value in (-1, 1.1, math.nan, math.inf):
            with self.assertRaises(ValueError):
                profile_at(value)
        with self.assertRaises(ValueError):
            validate_coordinates([0] * 8 + [1])

    def test_endpoint_sampler_matches_production_with_missing_candidates(self):
        candidates = {1: Candidate("a0a1", "cp", 10), 2: Candidate("b0b1", "cp", 0)}
        engine = CalibrationEngine()
        kwargs = {"multi_pv": 16, "expected_rank": 9, "max_candidate_loss": 600}
        for seed in range(100):
            self.assertEqual(
                sample_candidate(candidates, **kwargs, rng=random.Random(seed)),
                engine._sample_candidate(candidates, **kwargs, rng=random.Random(seed)),
            )
        engine.available_count = True
        with patch(
            "tools.bot_levels_optimization.runtime.sample_candidate",
            return_value="a0a1",
        ) as choose:
            engine._sample_candidate(candidates, **kwargs, rng=random.Random(0))
            self.assertEqual(2, choose.call_args.kwargs["multi_pv"])
            self.assertEqual(2, choose.call_args.kwargs["expected_rank"])

    def test_endpoint_search_reuses_production_commands_and_choices(self):
        for s, level in ((0, 1), (1, 9)):
            choices, commands = [], []
            for cls in (PikafishMoveEngine, CalibrationEngine):
                engine = cls()
                engine._ensure_started = Mock()
                engine._send = Mock()
                engine._read_until = Mock()
                engine._read_line = Mock(
                    side_effect=[
                        "info depth 1 multipv 1 score cp 10 pv a0a1",
                        "info depth 1 multipv 2 score cp 0 pv b0b1",
                        "bestmove a0a1",
                    ]
                )
                work = MoveWork(
                    "same-seed", level, FEN, (), legal_moves=("a1a2", "b1b2")
                )
                choices.append(
                    engine.choose(work, s)
                    if cls is CalibrationEngine
                    else engine.best_move(work, profile_at(s))
                )
                commands.append(engine._send.call_args_list)
            self.assertEqual(choices[0], choices[1])
            self.assertEqual(commands[0], commands[1])


class MeasurementTests(unittest.TestCase):
    def test_smoothing_draws_and_score_orientation(self):
        self.assertEqual(0, summarize([(0.5, 0.5)])["interval"])
        for score in (0.0, 1.0):
            report = summarize([(score, score)] * 10)
            self.assertTrue(math.isfinite(report["interval"]))
            self.assertLess(report["confidence95"]["interval"][0], report["interval"])
            self.assertGreater(
                report["confidence95"]["interval"][1], report["interval"]
            )
        self.assertAlmostEqual(
            -summarize([(0, 0)])["interval"], summarize([(1, 1)])["interval"]
        )
        self.assertIsNone(summarize([])["interval"])

    def test_monotonic_fit_handles_reversals_and_flat_regions(self):
        self.assertEqual([0, 1.5, 1.5, 3], isotonic([0, 2, 1, 3]))
        values, fit = redistribute(SEED_COORDINATES, [20, -10, 0, 30, 20, -5, 20, 5], 1)
        self.assertEqual(0, values[0])
        self.assertEqual(1, values[-1])
        self.assertTrue(all(a <= b for a, b in itertools.pairwise(fit)))
        validate_coordinates(values)
        with self.assertRaises(ValueError):
            redistribute(SEED_COORDINATES, [0] * 8)

    def test_recovers_equal_intervals_on_nonlinear_strength_curve(self):
        coordinates = SEED_COORDINATES
        for _ in range(15):
            strengths = [500 * s * s for s in coordinates]
            deltas = [b - a for a, b in itertools.pairwise(strengths)]
            coordinates, _ = redistribute(coordinates, deltas)
        deltas = [500 * (b * b - a * a) for a, b in itertools.pairwise(coordinates)]
        self.assertLess(max(abs(d - 62.5) for d in deltas) / 62.5, 0.05)
        for index, coordinate in enumerate(coordinates):
            self.assertAlmostEqual(math.sqrt(index / 8), coordinate, delta=0.01)

    def test_zero_span_and_missing_games_cannot_converge(self):
        matches = [summarize([(0.5, 0.5)]) for _ in range(8)]
        self.assertFalse(overall(matches, 0.05, 2)["pointConverged"])
        matches = [summarize([(1, 1)]) for _ in range(8)]
        self.assertTrue(overall(matches, 0.05, 2)["pointConverged"])
        self.assertFalse(overall(matches, 0.05, 4)["pointConverged"])


class RuntimeTests(unittest.TestCase):
    def test_remote_explorers_are_rejected(self):
        for url in (
            "https://lixiangqi.com",
            "http://example.com",
            "http://localhost/evil",
            "http://user@localhost",
        ):
            with self.assertRaises(ValueError):
                local_url(url)
        self.assertEqual("http://127.0.0.1:1234", local_url("http://127.0.0.1:1234/"))

    def test_native_rules_request_includes_full_history_and_policy(self):
        rules = NativeRules(java="java")
        rules.start = Mock()
        rules.process = Mock()
        rules.output.put(
            json.dumps(
                {"fen": FEN, "turn": "red", "legalMoves": ["h1g3"], "gameResult": "*"}
            )
        )
        rules.position(FEN, ("h1g3",))
        self.assertEqual(
            {"initialFen": FEN, "moves": ["h1g3"]},
            json.loads(rules.process.stdin.write.call_args.args[0]),
        )

    def test_game_preserves_history_and_excludes_failures_and_move_caps(self):
        config = Config(games_per_pair=2)
        _, pair = next(plans(config, SUITE, 1, 1, 2))
        state = {"fen": FEN, "turn": "red", "legalMoves": ["h1g3"], "gameResult": "*"}
        rules = Mock()
        rules.position.side_effect = [state, {**state, "gameResult": "1-0"}]
        engine = Mock()
        engine.choose.return_value = "h1g3"
        record = play_game(
            pair[0],
            OPENING,
            SEED_COORDINATES,
            engine,
            rules,
            mode="calibrate",
            max_plies=2,
        )
        self.assertEqual("completed", record["status"])
        self.assertEqual(tuple(OPENING["moves"]), engine.choose.call_args.args[0].moves)
        self.assertEqual("1-0", record["result"])
        rules.position.side_effect = None
        rules.position.return_value = state
        engine.choose.side_effect = TimeoutError("search timeout")
        record = play_game(
            pair[0],
            OPENING,
            SEED_COORDINATES,
            engine,
            rules,
            mode="calibrate",
            max_plies=2,
        )
        self.assertEqual("failed", record["status"])
        self.assertTrue(record["searchTimeout"])
        self.assertIsNone(record["result"])
        engine.choose.side_effect = None
        record = play_game(
            pair[0],
            OPENING,
            SEED_COORDINATES,
            engine,
            rules,
            mode="calibrate",
            max_plies=1,
        )
        self.assertEqual("censored", record["status"])
        self.assertIsNone(record["result"])

    def test_complete_mode_calls_real_opening_boundary_without_prefix(self):
        _, pair = next(plans(Config(), SUITE, 1, 1, 2))
        state = {"fen": FEN, "turn": "red", "legalMoves": ["h1g3"], "gameResult": "*"}
        rules = Mock()
        rules.position.side_effect = [state, {**state, "gameResult": "1-0"}]
        engine = Mock()
        with patch(
            "tools.bot_levels_optimization.runtime.choose_opening_move",
            return_value="h1g3",
        ) as book:
            record = play_game(
                pair[0],
                OPENING,
                SEED_COORDINATES,
                engine,
                rules,
                mode="validate",
                max_plies=2,
            )
            self.assertEqual((), book.call_args.args[0].moves)
            engine.choose.assert_not_called()
            self.assertEqual("completed", record["status"])


class TournamentTests(unittest.TestCase):
    def setUp(self):
        self.directory = self.enterContext(tempfile.TemporaryDirectory())
        self.root = Path(self.directory)
        self.store = RunStore(self.root, {"test": True}, False)
        self.addCleanup(self.store.close)
        self.config = Config(
            games_per_pair=2, refinement_games=2, final_games=2, max_iterations=3
        )
        self.calls = []

    def higher_wins(self, plan, *args, **kwargs):
        self.calls.append(plan)
        return {
            **plan,
            "status": "completed",
            "result": "1-0" if plan["redLevel"] == plan["higherLevel"] else "0-1",
        }

    def test_pairs_reverse_colors_and_have_distinct_reproducible_seeds(self):
        schedule = list(plans(self.config, SUITE, 1, 1, 6))
        self.assertEqual(schedule, list(plans(self.config, SUITE, 1, 1, 6)))
        ids = []
        for _, (a, b) in schedule:
            self.assertEqual(a["redLevel"], b["blackLevel"])
            self.assertEqual(a["blackLevel"], b["redLevel"])
            ids.extend([a["gameId"], b["gameId"]])
        self.assertEqual(6, len(set(ids)))

    def test_phase_promotion_and_resume_do_not_replay_completed_games(self):
        result = calibrate(
            self.config,
            SUITE,
            SEED_COORDINATES,
            self.store,
            None,
            None,
            lambda _: None,
            self.higher_wins,
        )
        self.assertTrue(result["converged"])
        self.assertEqual(48, len(self.calls))
        self.assertEqual(
            list(SEED_COORDINATES),
            [level["strengthCoordinate"] for level in result["levels"]],
        )
        self.assertEqual(
            ["exploratory", "refinement", "verification"],
            [self.store.report(i)["phase"] for i in (1, 2, 3)],
        )
        calls = len(self.calls)
        resumed = calibrate(
            self.config,
            SUITE,
            SEED_COORDINATES,
            self.store,
            None,
            None,
            lambda _: None,
            self.higher_wins,
        )
        self.assertEqual(result, resumed)
        self.assertEqual(calls, len(self.calls))
        self.assertTrue((self.root / "games.jsonl").is_file())

    def test_one_failure_excludes_both_colors(self):
        def fail_half(plan, *args, **kwargs):
            game = self.higher_wins(plan)
            if plan["redLevel"] == plan["lowerLevel"]:
                game.update(status="failed", result=None)
            return game

        matches = tournament(
            self.config,
            SUITE,
            SEED_COORDINATES,
            1,
            2,
            self.store,
            None,
            None,
            lambda _: None,
            fail_half,
        )
        self.assertEqual(8, len(matches))
        for match in matches:
            self.assertEqual(0, match["totalGames"])
            self.assertEqual(1, match["failedGames"])
            self.assertEqual(1, match["excludedPairs"])
        for plan in self.calls:
            self.assertFalse(self.store.game(plan["gameId"])["includedInStatistics"])

    def test_resume_rejects_changed_manifest(self):
        self.store.close()
        with self.assertRaisesRegex(ValueError, "changed"):
            RunStore(self.root, {"test": False}, True)

    def test_concurrent_run_cannot_modify_checkpoint(self):
        with self.assertRaisesRegex(ValueError, "already in use"):
            RunStore(self.root, {"test": True}, True)

    def test_interrupted_pair_resumes_only_missing_color(self):
        _, pair = next(plans(self.config, SUITE, 1, 1, 2))
        self.store.save_game(self.higher_wins(pair[0]))
        self.calls.clear()
        tournament(
            self.config,
            SUITE,
            SEED_COORDINATES,
            1,
            2,
            self.store,
            None,
            None,
            lambda _: None,
            self.higher_wins,
        )
        self.assertEqual(15, len(self.calls))
        self.assertNotIn(pair[0]["gameId"], [p["gameId"] for p in self.calls])
        self.assertTrue(self.store.game(pair[0]["gameId"])["includedInStatistics"])

    def test_persistent_noise_stops_without_convergence(self):
        config = Config(
            games_per_pair=2,
            refinement_games=2,
            final_games=2,
            exploratory_iterations=1,
            max_iterations=10,
            patience=2,
        )

        def draws(plan, *args, **kwargs):
            return {**plan, "status": "completed", "result": "1/2-1/2"}

        result = calibrate(
            config,
            SUITE,
            SEED_COORDINATES,
            self.store,
            None,
            None,
            lambda _: None,
            draws,
        )
        self.assertEqual("statistical_noise_or_stalled_progress", result["status"])
        self.assertFalse(result["converged"])
        self.assertLess(result["iteration"], 10)

    def test_maximum_iterations_does_not_call_proposal_verified(self):
        config = Config(
            games_per_pair=2, refinement_games=2, final_games=2, max_iterations=1
        )
        result = calibrate(
            config,
            SUITE,
            SEED_COORDINATES,
            self.store,
            None,
            None,
            lambda _: None,
            self.higher_wins,
        )
        self.assertFalse(result["converged"])
        self.assertEqual("maximum_iterations", result["status"])

    def test_counts_and_tolerance_validation(self):
        for config in (
            Config(games_per_pair=3),
            Config(tolerance=0),
            Config(final_games=2),
        ):
            with self.assertRaises(ValueError):
                config.validate()


class NativeRulesIntegrationTests(unittest.TestCase):
    def test_native_history_cache_rebuilds_on_new_branch_and_after_error(self):
        try:
            rules = NativeRules()
            rules.artifacts()
        except FileNotFoundError:
            self.skipTest(
                "Build native staged JARs and install Java 21 for integration test"
            )
        self.addCleanup(rules.close)
        first = rules.position(FEN, ())
        self.assertIn("h1g3", first["legalMoves"])
        history = ("h1g3", "h10g8")
        after = rules.position(FEN, history)
        self.assertEqual("red", after["turn"])
        self.assertEqual(first, rules.position(FEN, ()))
        self.assertEqual(after, rules.position(FEN, history))
        with self.assertRaises(ValueError):
            rules.position(FEN, ("h1h2",))
        self.assertEqual(after, rules.position(FEN, history))


if __name__ == "__main__":
    unittest.main()
