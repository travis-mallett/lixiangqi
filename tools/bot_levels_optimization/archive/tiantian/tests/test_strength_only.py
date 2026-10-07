from __future__ import annotations

import unittest
import random
from pathlib import Path
from unittest.mock import Mock, call

from bot_level_calibrator.engine import PikafishEngine
from bot_level_calibrator.optimizer import (
    Observation,
    balanced_expected_score,
    estimate_equal_strength,
    probability_balanced_equivalent,
)
from bot_level_calibrator.scheduler import (
    _same_profile,
    _select_bisection_profile,
    adaptive_calibration_cohort_size,
    is_plain_pikafish,
    seed_strength_profiles,
    select_profile,
    strength_progress,
)
from bot_level_calibrator.storage import CalibrationStore
from bot_level_calibrator.strength import (
    BESTMOVE_BOUNDARY,
    initial_profile_for_level,
    profile_for_expected_rank,
    profile_for_nodes,
    profile_for_strength,
)


class StrengthOnlyTests(unittest.TestCase):
    def _path(self, name: str) -> Path:
        return Path(__file__).with_name(name)

    def _clean(self, path: Path) -> None:
        for candidate in (
            path,
            path.with_name(path.name + "-wal"),
            path.with_name(path.name + "-shm"),
        ):
            candidate.unlink(missing_ok=True)

    def test_one_coordinate_spans_sampling_and_node_regimes(self) -> None:
        weak = profile_for_strength(0.0)
        boundary = profile_for_strength(BESTMOVE_BOUNDARY)
        strong = profile_for_strength(1.0)
        self.assertAlmostEqual(weak.expected_rank, 128.0)
        self.assertEqual(weak.multi_pv, 128)
        self.assertEqual(boundary.expected_rank, 1.0)
        self.assertEqual(boundary.multi_pv, 1)
        self.assertEqual(strong.nodes, 25_000_000)

    def test_bestmove_node_midpoint_is_geometric_from_shared_boundary(self) -> None:
        floor = profile_for_nodes(149)
        upper = profile_for_nodes(22_126)

        midpoint = profile_for_strength((floor.strength + upper.strength) / 2.0)

        self.assertEqual(floor.nodes, 149)
        self.assertAlmostEqual(midpoint.nodes, round((149 * 22_126) ** 0.5), delta=1)

    def test_seed_nodes_keep_calibrated_and_experimental_anchors(self) -> None:
        self.assertEqual(initial_profile_for_level(4).nodes, 149)
        self.assertEqual(initial_profile_for_level(9).nodes, 7_849)
        self.assertEqual(initial_profile_for_level(12).nodes, 24_389)
        levels = (2, 3, 4, 5, 7, 9, 12, 18, 25)
        for level in levels:
            profile = initial_profile_for_level(level)
            reconstructed = profile_for_strength(profile.strength)
            self.assertEqual(reconstructed.nodes, profile.nodes)
            self.assertEqual(reconstructed.multi_pv, profile.multi_pv)
            self.assertAlmostEqual(reconstructed.expected_rank, profile.expected_rank)

    def test_levels_two_to_seven_use_equal_strength_steps_with_double_final_gap(self) -> None:
        strengths = [initial_profile_for_level(level).strength for level in (2, 3, 4, 5, 7)]
        step = strengths[1] - strengths[0]
        self.assertAlmostEqual(strengths[2] - strengths[1], step)
        self.assertAlmostEqual(strengths[3] - strengths[2], step)
        self.assertAlmostEqual(strengths[4] - strengths[3], 2 * step)

    def test_draws_center_the_parity_estimate(self) -> None:
        estimate = estimate_equal_strength(
            [Observation(0.5, 0.5) for _ in range(12)], prior_strength=0.5
        )
        self.assertAlmostEqual(estimate.strength, 0.5, delta=0.01)

    def test_node_regime_stops_a_saturated_probe_after_three_games(self) -> None:
        profile = profile_for_nodes(7_849)
        games = [Mock(score=1.0) for _ in range(3)]
        self.assertEqual(adaptive_calibration_cohort_size(profile, games, 8), 3)

    def test_node_regime_expands_a_nonrail_probe_for_confirmation(self) -> None:
        profile = profile_for_nodes(7_849)
        mixed = [Mock(score=1.0), Mock(score=0.0), Mock(score=1.0)]
        drawn = [Mock(score=1.0), Mock(score=0.5), Mock(score=1.0)]
        self.assertEqual(adaptive_calibration_cohort_size(profile, mixed, 8), 12)
        self.assertEqual(adaptive_calibration_cohort_size(profile, drawn, 8), 12)

    def test_deployed_policy_equality_ignores_coordinate_rounding(self) -> None:
        current = profile_for_nodes(7_849)
        rounded_midpoint = profile_for_strength((0.66176595 + 0.66774449) / 2.0)
        self.assertEqual(rounded_midpoint.nodes, 7_849)
        self.assertTrue(_same_profile(current, rounded_midpoint))

    def test_results_move_parity_in_the_expected_direction(self) -> None:
        wins = estimate_equal_strength(
            [Observation(0.4, 1.0) for _ in range(12)], prior_strength=0.4
        )
        losses = estimate_equal_strength(
            [Observation(0.6, 0.0) for _ in range(12)], prior_strength=0.6
        )
        self.assertLess(wins.strength, 0.4)
        self.assertGreater(losses.strength, 0.6)

    def test_optimizer_learns_a_sharp_response_instead_of_fixing_width(self) -> None:
        observations = (
            [Observation(0.34, 0.0, "red"), Observation(0.34, 0.0, "black")] * 12
            + [Observation(0.38, 1.0, "red"), Observation(0.38, 1.0, "black")] * 12
        )
        estimate = estimate_equal_strength(observations, prior_strength=0.36)
        self.assertAlmostEqual(estimate.strength, 0.36, delta=0.015)
        self.assertLess(estimate.response_width, 0.075)

    def test_optimizer_models_color_without_requiring_pairs(self) -> None:
        observations = (
            [Observation(0.35, 0.0, "red"), Observation(0.35, 0.0, "black")] * 8
            + [Observation(0.45, 1.0, "red"), Observation(0.45, 1.0, "black")] * 8
            + [Observation(0.40, 1.0, "red"), Observation(0.40, 0.0, "black")] * 12
        )
        estimate = estimate_equal_strength(observations, prior_strength=0.40)
        self.assertAlmostEqual(estimate.strength, 0.40, delta=0.015)
        self.assertGreater(estimate.red_strength_shift, 0.0)
        self.assertAlmostEqual(
            balanced_expected_score(estimate, estimate.strength), 0.5, places=6
        )
        self.assertGreater(
            probability_balanced_equivalent(estimate, estimate.strength), 0.0
        )

    def test_engine_plays_bestmove_above_boundary(self) -> None:
        engine = PikafishEngine(Path("missing.exe"))
        engine._ensure_started = Mock()  # type: ignore[method-assign]
        engine._send = Mock()  # type: ignore[method-assign]
        engine._read_until = Mock()  # type: ignore[method-assign]
        engine._read_line = Mock(side_effect=["info depth 1", "bestmove a0a1"])  # type: ignore[method-assign]
        move = engine.choose_move([], profile_for_strength(0.8))
        self.assertEqual(move, "a0a1")
        self.assertIn(call("setoption name MultiPV value 1"), engine._send.call_args_list)
        self.assertTrue(any(item.args[0].startswith("go nodes ") for item in engine._send.call_args_list))

    def test_adjacent_rank_sampling_is_reproducible(self) -> None:
        candidates = {1: "a0a1", 2: "b0b1", 3: "c0c1"}
        first = PikafishEngine._sample_adjacent_rank(candidates, 1.6, random.Random(9))
        second = PikafishEngine._sample_adjacent_rank(candidates, 1.6, random.Random(9))
        self.assertEqual(first, second)
        self.assertIn(first, {"a0a1", "b0b1"})

    def test_duplicate_multipv_lines_do_not_abort_a_game(self) -> None:
        engine = PikafishEngine(Path("missing.exe"))
        engine._ensure_started = Mock()  # type: ignore[method-assign]
        engine._send = Mock()  # type: ignore[method-assign]
        engine._read_until = Mock()  # type: ignore[method-assign]
        engine._legal_moves_current_position = Mock(  # type: ignore[method-assign]
            return_value=["a0a1", "b0b1", "c0c1"]
        )
        engine._read_line = Mock(  # type: ignore[method-assign]
            side_effect=[
                "info depth 1 multipv 1 score cp 30 pv a0a1",
                "info depth 1 multipv 2 score cp 20 pv a0a1",
                "info depth 1 multipv 3 score cp 10 pv b0b1",
                "bestmove a0a1",
            ]
        )
        move = engine.choose_move([], profile_for_strength(0.0), random.Random(4))
        self.assertIn(move, {"a0a1", "b0b1", "c0c1"})

    def test_new_rows_are_plain_and_update_without_color_pairs(self) -> None:
        path = self._path(".test_strength_only.sqlite3")
        try:
            store = CalibrationStore(path)
            seed_strength_profiles(store)
            first = select_profile(store, 3)
            store.record(3, 1, "red", first.profile, "loss", 60, "test")
            second = select_profile(store, 3)
            game = store.results(3)[0]
            self.assertTrue(is_plain_pikafish(game))
            self.assertEqual(store.policy_state(3)["decision_game_count"], 1)  # type: ignore[index]
            self.assertGreaterEqual(second.profile.strength, first.profile.strength)
            store.close()
        finally:
            self._clean(path)

    def test_rank_is_frozen_until_the_growing_cohort_is_complete(self) -> None:
        path = self._path(".test_strength_cohorts.sqlite3")
        try:
            store = CalibrationStore(path)
            seed_strength_profiles(store)
            initial = select_profile(store, 2)

            store.record(2, 1, "red", initial.profile, "win", 60, "cohort 1")
            after_one = select_profile(store, 2)
            self.assertEqual(store.policy_state(2)["cohort_index"], 1)  # type: ignore[index]

            store.record(2, 2, "black", after_one.profile, "loss", 60, "cohort 2a")
            after_two = select_profile(store, 2)
            self.assertFalse(after_two.changed)
            self.assertAlmostEqual(after_two.profile.expected_rank, after_one.profile.expected_rank)
            self.assertEqual(store.policy_state(2)["cohort_index"], 1)  # type: ignore[index]

            store.record(2, 3, "red", after_two.profile, "draw", 60, "cohort 2b")
            select_profile(store, 2)
            state = store.policy_state(2)
            self.assertEqual(state["cohort_index"], 2)  # type: ignore[index]
            self.assertEqual(state["cohort_size"], 3)  # type: ignore[index]
            self.assertEqual(state["cohort_start_compatible_count"], 3)  # type: ignore[index]
            store.close()
        finally:
            self._clean(path)

    def test_confident_bounds_are_bisected_and_interval_halves(self) -> None:
        path = self._path(".test_strength_bisection.sqlite3")
        try:
            store = CalibrationStore(path)
            seed_strength_profiles(store)
            weak = profile_for_expected_rank(1.75)
            strong = profile_for_expected_rank(1.5)
            for seed in range(2):
                store.record(2, seed, "red" if seed == 0 else "black", weak, "loss", 60, "weak")
            for seed, result in enumerate(("win", "win", "win", "loss"), start=2):
                store.record(2, seed, "red" if seed % 2 == 0 else "black", strong, result, 60, "strong")

            first = select_profile(store, 2)
            state = store.policy_state(2)
            first_width = float(state["bracket_high"]) - float(state["bracket_low"])  # type: ignore[index]
            self.assertAlmostEqual(first.profile.strength, (weak.strength + strong.strength) / 2, places=7)

            for seed in range(6, 8):
                store.record(2, seed, "red" if seed % 2 == 0 else "black", first.profile, "win", 60, "midpoint strong")
            second = select_profile(store, 2)
            state = store.policy_state(2)
            second_width = float(state["bracket_high"]) - float(state["bracket_low"])  # type: ignore[index]

            self.assertAlmostEqual(second_width, first_width / 2.0, places=7)
            self.assertAlmostEqual(
                second.profile.strength,
                weak.strength + first_width / 4.0,
                places=7,
            )
            store.close()
        finally:
            self._clean(path)

    def test_single_decisive_game_does_not_poison_the_search_bracket(self) -> None:
        path = self._path(".test_strength_noisy_first_game.sqlite3")
        try:
            store = CalibrationStore(path)
            seed_strength_profiles(store)
            initial = select_profile(store, 2)
            store.record(2, 1, "red", initial.profile, "win", 60, "one noisy result")

            after_one = select_profile(store, 2)
            state = store.policy_state(2)

            self.assertAlmostEqual(after_one.profile.strength, initial.profile.strength)
            self.assertIsNone(state["bracket_low"])  # type: ignore[index]
            self.assertIsNone(state["bracket_high"])  # type: ignore[index]
            self.assertIn("direction remains uncertain", after_one.message)
            store.close()
        finally:
            self._clean(path)

    def test_nonmonotonic_noisy_bounds_are_held_instead_of_chased(self) -> None:
        path = self._path(".test_strength_conflicting_bounds.sqlite3")
        try:
            store = CalibrationStore(path)
            seed_strength_profiles(store)
            initial = select_profile(store, 2)
            lower_strength = profile_for_expected_rank(1.75)
            higher_strength = profile_for_expected_rank(1.5)
            for seed in range(2):
                store.record(2, seed, "red" if seed == 0 else "black", lower_strength, "win", 60, "noisy strong")
            for seed in range(2, 4):
                store.record(2, seed, "red" if seed == 2 else "black", higher_strength, "loss", 60, "noisy weak")

            decision = select_profile(store, 2)
            state = store.policy_state(2)

            self.assertAlmostEqual(decision.profile.strength, initial.profile.strength)
            self.assertTrue(state["bracket_conflict"])  # type: ignore[index]
            self.assertIn("non-monotonic", decision.message)
            store.close()
        finally:
            self._clean(path)

    def test_persisted_manual_seed_controls_the_diagnostic_prior(self) -> None:
        path = self._path(".test_manual_seed_prior.sqlite3")
        try:
            store = CalibrationStore(path)
            seed_strength_profiles(store)
            state = store.policy_state(5)
            state["seed_strength"] = 0.465  # type: ignore[index]
            store.save_policy_state(5, state)  # type: ignore[arg-type]

            decision = select_profile(store, 5)

            self.assertAlmostEqual(decision.estimate.strength, 0.465, delta=0.005)
            store.close()
        finally:
            self._clean(path)

    def test_local_expansion_step_is_not_silently_raised_to_point_zero_zero_five(self) -> None:
        current = profile_for_strength(0.465)
        games = [
            Mock(profile=current, score=1.0, result="win", reason="test"),
            Mock(profile=current, score=1.0, result="win", reason="test"),
        ]

        selected, _reason, _next_step = _select_bisection_profile(
            current,
            games,
            {"expansion_step": 0.002},
            None,
            current.strength,
            False,
        )

        self.assertAlmostEqual(selected.strength, 0.463, places=9)

    def test_version_eight_bestmove_evidence_survives_version_nine_migration(self) -> None:
        path = self._path(".test_v8_evidence.sqlite3")
        try:
            store = CalibrationStore(path)
            profile = profile_for_strength(0.7)
            store.save_policy_state(
                3,
                {
                    "version": 8,
                    "profile": {"strength": profile.strength, "nodes": profile.nodes},
                    "plain_start_game_count": 0,
                    "decision_game_count": 0,
                    "profile_start_game_count": 0,
                },
            )
            store.record(3, 1, "red", profile, "draw", 80, "v8 bestmove")
            seed_strength_profiles(store)
            progress = strength_progress(store, 3)
            self.assertEqual(progress.compatible_games, 1)  # type: ignore[union-attr]
            store.close()
        finally:
            self._clean(path)

    def test_level_two_floor_wins_seed_fitted_rank_without_curve_extrapolation(self) -> None:
        path = self._path(".test_level_two_v9.sqlite3")
        self._clean(path)
        try:
            store = CalibrationStore(path)
            floor = profile_for_strength(BESTMOVE_BOUNDARY)
            store.save_policy_state(
                2,
                {
                    "version": 9,
                    "profile": {"strength": floor.strength, "nodes": floor.nodes},
                    "strength_start_game_count": 0,
                    "decision_game_count": 0,
                    "profile_start_game_count": 0,
                },
            )
            for seed in range(6):
                store.record(2, seed, "red" if seed % 2 == 0 else "black", floor, "win", 60, "floor")
            seed_strength_profiles(store)
            progress = strength_progress(store, 2)
            state = store.policy_state(2)
            self.assertEqual(progress.compatible_games, 0)  # type: ignore[union-attr]
            self.assertAlmostEqual(
                float(dict(state["profile"])["expected_rank"]),
                initial_profile_for_level(2).expected_rank,
            )  # type: ignore[index]
            self.assertEqual(state["strength_start_game_count"], 6)  # type: ignore[index]
            store.close()
        finally:
            self._clean(path)

    def test_mixed_history_is_preserved_but_excluded(self) -> None:
        path = self._path(".test_strength_migration.sqlite3")
        try:
            store = CalibrationStore(path)
            profile = initial_profile_for_level(4)
            with store.lock, store.connection:
                store.connection.execute(
                    "INSERT INTO games(level,played_at,seed,side,strength,nodes,depth,multi_pv,"
                    "random_move_chance,temperature,opening_plies,opening_random_move_chance,"
                    "opening_temperature,moves_json,result,plies,reason) "
                    "VALUES(4,'now',1,'red',?,?,99,12,.2,.1,5,.1,.1,'[]','draw',80,'legacy')",
                    (profile.strength, profile.nodes),
                )
            seed_strength_profiles(store)
            progress = strength_progress(store, 4)
            self.assertEqual(len(store.results(4)), 1)
            self.assertEqual(progress.compatible_games, 0)  # type: ignore[union-attr]
            store.close()
        finally:
            self._clean(path)

    def test_superficially_plain_legacy_row_is_before_migration_boundary(self) -> None:
        path = self._path(".test_plain_legacy.sqlite3")
        try:
            store = CalibrationStore(path)
            profile = initial_profile_for_level(9)
            store.record(9, 1, "red", profile, "draw", 80, "legacy plain-looking row")
            seed_strength_profiles(store)
            progress = strength_progress(store, 9)
            self.assertEqual(len(store.results(9)), 1)
            self.assertEqual(progress.compatible_games, 0)  # type: ignore[union-attr]
            store.close()
        finally:
            self._clean(path)


if __name__ == "__main__":
    unittest.main()
