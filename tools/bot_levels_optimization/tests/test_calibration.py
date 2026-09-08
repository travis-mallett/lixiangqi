from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import Mock, call, patch

from bot_level_calibrator.automator import TtxqAutomator
from bot_level_calibrator.app import CalibrationApp
from bot_level_calibrator.controller import GameFinished, MoveNotRegistered, TiantianController
from bot_level_calibrator.engine import PikafishEngine
from bot_level_calibrator.constants import START_POSITION_MAP
from bot_level_calibrator.models import (
    BoardState,
    DetectedPiece,
    MoveRecord,
    NoBoardChangeError,
    WindowInfo,
)
from bot_level_calibrator.optimizer import Observation, estimate_equal_strength
from bot_level_calibrator.runtime import cv2, np
from bot_level_calibrator.recognizer import XiangqiRecognizer
from bot_level_calibrator.progress_chart import (
    ParameterPoint,
    parameter_evidence,
    parameter_progress,
    rank_progress,
    recent_parameter_progress,
    score_progress,
)
from bot_level_calibrator.scheduler import (
    calibration_cohort_size,
    current_profile,
    is_plain_pikafish,
    seed_strength_profiles,
    select_profile,
    strength_progress,
)
from bot_level_calibrator.storage import CalibrationStore, GameResult
from bot_level_calibrator.strength import (
    initial_profile_for_level,
    profile_for_expected_rank,
    profile_for_strength,
)


class StrengthProfileTests(unittest.TestCase):
    def test_endpoints_match_deployed_model(self) -> None:
        weak = profile_for_strength(0.0)
        strong = profile_for_strength(1.0)
        self.assertAlmostEqual(weak.expected_rank, 128.0)
        self.assertEqual(weak.multi_pv, 128)
        self.assertEqual(strong.nodes, 25_000_000)
        self.assertEqual(strong.multi_pv, 1)

    def test_each_strength_regime_changes_monotonically(self) -> None:
        profiles = [profile_for_strength(index / 20) for index in range(21)]
        weak = [profile for profile in profiles if not profile.is_bestmove]
        strong = [profile for profile in profiles if profile.is_bestmove]

        # Weak play spends fixed analysis work and becomes stronger solely by
        # lowering expected move rank. Strong
        # play always selects bestmove and becomes stronger by adding work.
        self.assertEqual(
            [p.expected_rank for p in weak],
            sorted((p.expected_rank for p in weak), reverse=True),
        )
        self.assertEqual([p.nodes for p in strong], sorted(p.nodes for p in strong))

    def test_cross_level_starting_profiles_preserve_evidence_anchors(self) -> None:
        self.assertEqual(initial_profile_for_level(4).nodes, 149)
        self.assertAlmostEqual(initial_profile_for_level(4).expected_rank, 1.12170647737457)
        self.assertEqual(initial_profile_for_level(9).nodes, 7_849)

    def test_level_nine_uses_the_near_level_seven_experimental_seed(self) -> None:
        self.assertEqual(initial_profile_for_level(9).nodes, 7_849)

    def test_level_twelve_uses_the_log_linear_level_seven_to_nine_seed(self) -> None:
        self.assertEqual(initial_profile_for_level(12).nodes, 24_389)

class ProgressChartDataTests(unittest.TestCase):
    def test_chart_uses_non_overlapping_growing_cohorts(self) -> None:
        games = [
            Mock(score=1.0), Mock(score=0.0),
            Mock(score=0.5), Mock(score=0.5),
            Mock(score=0.0),
        ]
        points = score_progress(games)
        self.assertEqual([point.games for point in points], [1, 3, 5])
        self.assertEqual([point.target_games for point in points], [1, 2, 3])
        self.assertEqual([point.cohort_score for point in points], [1.0, 0.25, 0.25])
        self.assertEqual([point.complete for point in points], [True, True, False])

    def test_optimizer_cohort_schedule_grows_then_caps_at_thirty(self) -> None:
        self.assertEqual(
            [calibration_cohort_size(index) for index in range(11)],
            [1, 2, 3, 5, 8, 13, 21, 30, 30, 30, 30],
        )

    def test_chart_distinguishes_a_new_empty_active_cohort_from_history(self) -> None:
        games = [Mock(score=1.0), Mock(score=0.0), Mock(score=0.5)]

        points = score_progress(games, active_start=3, active_target=5)

        self.assertEqual(points[-1].start_games, 3)
        self.assertEqual(points[-1].cohort_games, 0)
        self.assertEqual(points[-1].target_games, 5)
        self.assertFalse(points[-1].complete)

    def test_rank_chart_places_policy_updates_after_completed_games(self) -> None:
        first = profile_for_expected_rank(1.5)
        second = profile_for_expected_rank(1.75)
        current = profile_for_expected_rank(2.0)
        games = [Mock(profile=first), Mock(profile=second)]

        points = rank_progress(games, current)

        self.assertEqual([point.games for point in points], [0, 1, 2])
        self.assertEqual(
            [point.expected_rank for point in points],
            [1.5, 1.75, 2.0],
        )

    def test_parameter_chart_displays_nodes_for_bestmove_profiles(self) -> None:
        first = profile_for_strength(0.5)
        second = profile_for_strength(0.6)
        games = [Mock(profile=first)]

        parameter, points = parameter_progress(games, second)

        self.assertEqual(parameter, "nodes")
        self.assertEqual([point.value for point in points], [first.nodes, second.nodes])

    def test_parameter_chart_displays_rank_for_rank_sampling_profiles(self) -> None:
        first = profile_for_expected_rank(1.5)
        second = profile_for_expected_rank(1.75)
        games = [Mock(profile=first)]

        parameter, points = parameter_progress(games, second)

        self.assertEqual(parameter, "rank")
        self.assertEqual([point.value for point in points], [1.5, 1.75])

    def test_parameter_chart_keeps_only_the_latest_four_complete_runs(self) -> None:
        points = [
            ParameterPoint(0, 200), ParameterPoint(1, 200),
            ParameterPoint(2, 2_000), ParameterPoint(3, 2_000),
            ParameterPoint(4, 6_325), ParameterPoint(5, 6_325),
            ParameterPoint(6, 8_434), ParameterPoint(7, 8_434),
            ParameterPoint(8, 7_304), ParameterPoint(9, 7_849),
        ]

        recent = recent_parameter_progress(points)

        self.assertEqual(recent[0], ParameterPoint(4, 6_325))
        self.assertEqual(recent[-1], ParameterPoint(9, 7_849))

    def test_evidence_plot_aggregates_all_games_at_each_recent_setting(self) -> None:
        older = profile_for_strength(0.6)
        current = profile_for_strength(0.7)
        games = [
            Mock(profile=older, score=0.0, result="loss", reason="test"),
            Mock(profile=current, score=1.0, result="win", reason="test"),
            Mock(profile=current, score=0.0, result="loss", reason="test"),
        ]

        parameter, points = parameter_evidence(games, current)

        self.assertEqual(parameter, "nodes")
        current_point = next(point for point in points if point.current)
        self.assertEqual(current_point.games, 2)
        self.assertEqual((current_point.wins, current_point.losses), (1, 1))
        self.assertEqual(current_point.score, 0.5)


class SimpleStrengthOptimizerTests(unittest.TestCase):
    def test_results_move_the_parity_estimate_in_the_expected_direction(self) -> None:
        wins = estimate_equal_strength(
            [Observation(0.4, 1.0) for _ in range(12)], prior_strength=0.4
        )
        losses = estimate_equal_strength(
            [Observation(0.6, 0.0) for _ in range(12)], prior_strength=0.6
        )
        draws = estimate_equal_strength(
            [Observation(0.5, 0.5) for _ in range(12)], prior_strength=0.5
        )
        self.assertLess(wins.strength, 0.4)
        self.assertGreater(losses.strength, 0.6)
        self.assertAlmostEqual(draws.strength, 0.5, delta=0.01)

    def test_engine_returns_bestmove_in_the_node_regime(self) -> None:
        engine = PikafishEngine(Path("missing.exe"))
        engine._ensure_started = Mock()  # type: ignore[method-assign]
        engine._send = Mock()  # type: ignore[method-assign]
        engine._read_until = Mock()  # type: ignore[method-assign]
        engine._read_line = Mock(side_effect=["info depth 1", "bestmove a0a1"])  # type: ignore[method-assign]

        move = engine.choose_move([], profile_for_strength(0.8))

        self.assertEqual(move, "a0a1")
        self.assertIn(call("setoption name MultiPV value 1"), engine._send.call_args_list)
        self.assertTrue(any(args.args[0].startswith("go nodes ") for args in engine._send.call_args_list))

    def test_storage_writes_only_plain_pikafish_controls(self) -> None:
        path = Path(__file__).with_name(".test_plain_storage.sqlite3")
        try:
            store = CalibrationStore(path)
            store.record(4, 1, "red", initial_profile_for_level(4), "draw", 80, "test")
            game = store.results(4)[0]
            self.assertTrue(is_plain_pikafish(game))
            self.assertEqual(game.multi_pv, 2)
            self.assertAlmostEqual(game.expected_rank, 1.12170647737457)
            self.assertEqual((game.temperature, game.random_move_chance), (0.0, 0.0))
            store.close()
        finally:
            for candidate in (path, path.with_name(path.name + "-wal"), path.with_name(path.name + "-shm")):
                candidate.unlink(missing_ok=True)

    def test_old_mixed_policy_games_are_preserved_but_excluded(self) -> None:
        path = Path(__file__).with_name(".test_plain_migration.sqlite3")
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
            seeded = seed_strength_profiles(store)
            progress = strength_progress(store, 4)
            self.assertIn(4, seeded)
            self.assertEqual(len(store.results(4)), 1)
            self.assertEqual(progress.compatible_games, 0)  # type: ignore[union-attr]
            store.close()
        finally:
            for candidate in (path, path.with_name(path.name + "-wal"), path.with_name(path.name + "-shm")):
                candidate.unlink(missing_ok=True)

    def test_each_completed_game_is_an_update_without_a_pair_gate(self) -> None:
        path = Path(__file__).with_name(".test_plain_scheduler.sqlite3")
        try:
            store = CalibrationStore(path)
            seed_strength_profiles(store)
            first = select_profile(store, 3)
            store.record(3, 1, "red", first.profile, "loss", 60, "test")
            second = select_profile(store, 3)
            self.assertEqual(store.policy_state(3)["decision_game_count"], 1)  # type: ignore[index]
            self.assertGreaterEqual(second.profile.strength, first.profile.strength)
            store.close()
        finally:
            for candidate in (path, path.with_name(path.name + "-wal"), path.with_name(path.name + "-shm")):
                candidate.unlink(missing_ok=True)


class UnfinishedGamePromptTests(unittest.TestCase):
    def test_selects_fixed_theme_new_game_button(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        controller._click_visible = Mock()
        controller.log = Mock()
        image = np.full((1420, 800, 3), 70, dtype=np.uint8)
        image[568:738, 120:680] = 220
        image[792:860, 424:654] = (107, 121, 191)
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1420))

        handled = controller._dismiss_unfinished_game_prompt(image, window)

        self.assertTrue(handled)
        point = controller._click_visible.call_args.args[0]
        self.assertAlmostEqual(point[0], 260.0, delta=2.0)
        self.assertAlmostEqual(point[1], 826.0, delta=2.0)

    def test_screen_fingerprint_rejects_a_different_nonboard_screen(self) -> None:
        first = np.zeros((1000, 800, 3), dtype=np.uint8)
        second = np.full((1000, 800, 3), 40, dtype=np.uint8)

        self.assertFalse(
            TiantianController._fingerprints_match(
                TiantianController._screen_fingerprint(first),
                TiantianController._screen_fingerprint(second),
            )
        )


class BoardSideAndSequenceTests(unittest.TestCase):
    def test_complete_first_board_observation_gets_stability_grace_after_slow_vision(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        image = np.zeros((1000, 900, 3), dtype=np.uint8)
        grid_x = [float(index * 100) for index in range(9)]
        grid_y = [float(index * 100) for index in range(10)]
        pieces = {
            coord: DetectedPiece(
                side,
                piece_type,
                ord(coord[0]) - ord("a"),
                int(coord[1]),
                (0.0, 0.0),
                40.0,
                1.0,
            )
            for coord, (side, piece_type) in START_POSITION_MAP.items()
        }
        state = BoardState(
            pieces,
            (0, 0, 900, 1000),
            grid_x,
            grid_y,
            image,
            [],
            [],
            image,
        )
        clock = [0.0]
        captures = [0]

        def capture():
            if captures[0] == 0:
                clock[0] = 20.0
            captures[0] += 1
            return image, WindowInfo(1, "Tiantian", (0, 0, 900, 1000))

        def wait(_seconds: float) -> bool:
            clock[0] += 0.5
            return False

        controller._capture = capture
        controller._detect_unobscured_board = Mock(
            return_value=((0, 0, 900, 1000), grid_x, grid_y)
        )
        controller.recognizer = Mock()
        controller.recognizer.recognize_initial_board.return_value = state
        controller.active_own_side = "red"
        controller.stop_event = Mock()
        controller.stop_event.is_set.return_value = False
        controller.stop_event.wait.side_effect = wait
        controller.preview = Mock()
        controller.log = Mock()

        with patch("bot_level_calibrator.controller.time.monotonic", side_effect=lambda: clock[0]):
            observed = controller._wait_for_board(15.0, allow_unfinished_prompt=False)

        self.assertIs(observed, state)
        self.assertEqual(controller.recognizer.recognize_initial_board.call_count, 2)

    def test_initial_board_uses_coin_occupancy_and_known_black_bottom_orientation(self) -> None:
        recognizer = XiangqiRecognizer.__new__(XiangqiRecognizer)
        recognizer.fixed_vision = Mock()
        image = np.zeros((1000, 900, 3), dtype=np.uint8)
        grid_x = [float(index * 100) for index in range(9)]
        grid_y = [float(index * 100) for index in range(10)]
        recognizer.fixed_vision.extract_intersection_patch.return_value = (
            np.zeros((80, 80, 3), dtype=np.uint8),
            40.0,
        )
        occupied = set(START_POSITION_MAP)
        occupied.remove("b2")
        occupied.add("b3")
        physical_occupancy = []
        for physical_row in range(10):
            for physical_col in range(9):
                canonical = f"{'abcdefghi'[8 - physical_col]}{physical_row}"
                physical_occupancy.append((canonical in occupied, 60.0))
        recognizer.fixed_vision.piece_present.side_effect = physical_occupancy
        recognizer._draw_overlay = Mock(return_value=image)

        observed = recognizer.recognize_initial_board(
            image,
            "black",
            ((0, 0, 900, 1000), grid_x, grid_y),
        )

        self.assertEqual(len(observed.pieces), 32)
        self.assertNotIn("b2", observed.pieces)
        self.assertEqual((observed.pieces["b3"].side, observed.pieces["b3"].piece_type), ("red", "p"))
        self.assertEqual(observed.pieces["a9"].side, "black")
        recognizer.fixed_vision.classify_piece.assert_not_called()

    @staticmethod
    def _state(red_y: float, black_y: float) -> BoardState:
        pieces = {
            "e0": DetectedPiece("red", "k", 4, 0, (400.0, red_y), 30.0, 1.0),
            "e9": DetectedPiece("black", "k", 4, 9, (400.0, black_y), 30.0, 1.0),
        }
        image = np.zeros((1000, 800, 3), dtype=np.uint8)
        return BoardState(pieces, (0, 0, 800, 1000), list(range(9)), list(range(10)), image, [], [], image)

    def test_bottom_side_uses_physical_piece_centers(self) -> None:
        self.assertEqual(TiantianController._bottom_side(self._state(900.0, 100.0)), "red")
        self.assertEqual(TiantianController._bottom_side(self._state(100.0, 900.0)), "black")

    def test_computer_colour_uses_fixed_theme_button_center(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        image = np.zeros((1000, 800, 3), dtype=np.uint8)
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1000))
        controller._capture = Mock(side_effect=((image, window), (image, window)))
        controller._read_computer_side = Mock(return_value="black")
        controller._click_visible = Mock()
        controller.log = Mock()

        controller._set_computer_side("black")

        controller._click_visible.assert_called_once_with((680.0, 360.0), window, 0.25)

    def test_computer_colour_verification_reads_darker_selected_segment(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        image = np.full((1000, 800, 3), 180, dtype=np.uint8)
        black_x, black_y = (680, 360)
        image[black_y - 28 : black_y + 29, black_x - 55 : black_x + 56] = 75

        self.assertEqual(controller._read_computer_side(image), "black")

    def test_level_uses_calibrated_discrete_slider_stop(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        image = np.zeros((1000, 800, 3), dtype=np.uint8)
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1000))
        controller._capture = Mock(return_value=(image, window))
        controller._click_visible = Mock()
        controller.log = Mock()

        controller._set_level(2)

        controller._click_visible.assert_called_once_with((216.0, 268.0), window, 0.3)

    def test_level_twenty_five_drags_detected_thumb_and_verifies_endpoint(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        image = np.zeros((1000, 800, 3), dtype=np.uint8)
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1000))
        controller._capture = Mock(return_value=(image, window))
        controller._find_level_slider_thumb = Mock(side_effect=((238.0, 341.0), (711.0, 341.0)))
        controller._drag_visible = Mock()
        controller.log = Mock()

        controller._set_level(25)

        controller._drag_visible.assert_called_once_with((238.0, 341.0), (712.0, 341.0), window, 0.65)
        self.assertIn("visually verified", controller.log.call_args.args[0])

    def test_level_twenty_five_refuses_slider_that_did_not_reach_endpoint(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        image = np.zeros((1000, 800, 3), dtype=np.uint8)
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1000))
        controller._capture = Mock(return_value=(image, window))
        controller._find_level_slider_thumb = Mock(side_effect=((238.0, 341.0), (238.0, 341.0)))
        controller._drag_visible = Mock()
        controller.log = Mock()

        with self.assertRaisesRegex(RuntimeError, "refusing to start or record"):
            controller._set_level(25)

    def test_level_twenty_five_accepts_slider_already_at_endpoint(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        image = np.zeros((1000, 800, 3), dtype=np.uint8)
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1000))
        controller._capture = Mock(return_value=(image, window))
        controller._find_level_slider_thumb = Mock(return_value=(711.0, 341.0))
        controller._drag_visible = Mock()
        controller.log = Mock()

        controller._set_level(25)

        controller._drag_visible.assert_not_called()
        self.assertIn("already visually verified", controller.log.call_args.args[0])

    def test_fixed_theme_level_slider_thumb_is_detected_from_green_ring(self) -> None:
        image = np.full((1420, 800, 3), 225, dtype=np.uint8)
        cv2.circle(image, (238, 341), 30, (100, 162, 110), 3)

        thumb = TiantianController._find_level_slider_thumb(image)

        self.assertIsNotNone(thumb)
        self.assertAlmostEqual(thumb[0], 238, delta=2)  # type: ignore[index]
        self.assertAlmostEqual(thumb[1], 341, delta=2)  # type: ignore[index]

    def test_fixed_theme_level_twenty_five_thumb_is_detected_from_filled_track(self) -> None:
        image = np.full((1420, 800, 3), 225, dtype=np.uint8)
        cv2.rectangle(image, (238, 330), (711, 352), (100, 162, 110), -1)
        cv2.circle(image, (712, 341), 30, (100, 162, 110), 3)

        thumb = TiantianController._find_level_slider_thumb(image)

        self.assertIsNotNone(thumb)
        self.assertAlmostEqual(thumb[0], 712, delta=3)  # type: ignore[index]
        self.assertAlmostEqual(thumb[1], 341, delta=3)  # type: ignore[index]

    def test_settled_snapshot_can_return_own_move_and_fast_reply(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        previous = self._state(900.0, 100.0)
        current = self._state(900.0, 100.0)
        image = current.source_image
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1000))
        controller.stop_event = Mock()
        controller.stop_event.is_set.return_value = False
        controller._capture = Mock(return_value=(image, window))
        controller._check_stop = Mock()
        controller.preview = Mock()
        controller.active_own_side = "red"
        controller.recognizer = Mock()
        controller.recognizer.recognize_transition_board.return_value = current
        controller.recognizer.detect_move_sequence_from_state.return_value = (
            [
                MoveRecord("red", "m", "g0", "e2", False),
                MoveRecord("black", "c", "b7", "a7", False),
            ],
            current,
        )

        moves, returned_state = controller._wait_for_move_sequence(previous, "red", 2, 1.0)

        self.assertEqual(moves, ["g0e2", "b7a7"])
        self.assertIs(returned_state, current)

    def test_clicked_move_is_constrained_before_accepting_fast_reply(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        previous = self._state(900.0, 100.0)
        previous.pieces["a0"] = DetectedPiece("red", "r", 0, 0, (0.0, 900.0), 30.0, 1.0)
        previous.pieces["b9"] = DetectedPiece("black", "r", 1, 9, (1.0, 100.0), 30.0, 1.0)
        after_own = self._state(900.0, 100.0)
        after_own.pieces["a1"] = DetectedPiece("red", "r", 0, 1, (0.0, 800.0), 30.0, 1.0)
        after_own.pieces["b9"] = previous.pieces["b9"]
        current = self._state(900.0, 100.0)
        current.pieces["a1"] = after_own.pieces["a1"]
        current.pieces["b8"] = DetectedPiece("black", "r", 1, 8, (1.0, 200.0), 30.0, 1.0)
        own = MoveRecord("red", "r", "a0", "a1", False)
        reply = MoveRecord("black", "r", "b9", "b8", False)
        controller.active_own_side = "red"
        controller.stop_event = Mock()
        controller._check_stop = Mock()
        controller._capture = Mock(return_value=(current.source_image, WindowInfo(1, "Tiantian", (0, 0, 800, 1000))))
        controller._detect_outcome = Mock(return_value=None)
        controller.preview = Mock()
        controller.recognizer = Mock()
        controller.recognizer.state_after_known_move.return_value = (own, after_own)
        controller.recognizer.recognize_transition_board.return_value = current
        controller.recognizer.reconcile_expected_position.return_value = None
        controller.recognizer.detect_exact_move_resilient.return_value = (reply, current)

        moves, returned_state = controller._wait_for_clicked_move(previous, "a0a1", 1.0)

        self.assertEqual(moves, ["a0a1", "b9b8"])
        self.assertIs(returned_state, current)
        self.assertGreaterEqual(controller.recognizer.detect_exact_move_resilient.call_count, 3)
        controller.recognizer.detect_exact_move_resilient.assert_called_with(
            after_own,
            current,
            expected_side="black",
            image=current.source_image,
        )

    def test_unclassified_destination_is_confirmed_by_stable_occupancy_fusion(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        previous = self._state(900.0, 100.0)
        previous.pieces["a0"] = DetectedPiece("red", "r", 0, 0, (0.0, 900.0), 30.0, 1.0)
        after = self._state(900.0, 100.0)
        after.pieces["a1"] = DetectedPiece("red", "r", 0, 1, (0.0, 800.0), 30.0, 1.0)
        # Full-board classification sees the source disappear but drops the
        # destination because its glyph is obscured by Tiantian's move effect.
        raw = self._state(900.0, 100.0)
        own = MoveRecord("red", "r", "a0", "a1", False)
        controller.active_own_side = "red"
        controller.stop_event = Mock()
        controller.stop_event.is_set.return_value = False
        controller._check_stop = Mock()
        controller._capture = Mock(
            return_value=(raw.source_image, WindowInfo(1, "Tiantian", (0, 0, 800, 1000)))
        )
        controller._detect_outcome = Mock(return_value=None)
        controller.preview = Mock()
        controller.recognizer = Mock()
        controller.recognizer.state_after_known_move.return_value = (own, after)
        controller.recognizer.recognize_transition_board.return_value = raw
        controller.recognizer.reconcile_expected_position.return_value = after

        moves, confirmed = controller._wait_for_clicked_move(previous, "a0a1", timeout=0.5)

        self.assertEqual(moves, ["a0a1"])
        self.assertIs(confirmed, after)
        self.assertGreaterEqual(controller.recognizer.reconcile_expected_position.call_count, 3)

    def test_exact_move_retains_canonical_types_despite_arbitrary_glyph_flicker(self) -> None:
        def board(piece_map: dict[str, tuple[str, str]]) -> BoardState:
            grid_x = [float(index * 100) for index in range(9)]
            grid_y = [float(index * 100) for index in range(10)]
            pieces = {
                coord: DetectedPiece(
                    side, piece_type, ord(coord[0]) - ord("a"), int(coord[1]),
                    (grid_x[ord(coord[0]) - ord("a")], grid_y[9 - int(coord[1])]),
                    30.0, 0.9,
                )
                for coord, (side, piece_type) in piece_map.items()
            }
            image = np.zeros((1000, 900, 3), dtype=np.uint8)
            return BoardState(pieces, (0, 0, 900, 1000), grid_x, grid_y, image, [], [], image)

        previous_map = dict(START_POSITION_MAP)
        current_map = dict(START_POSITION_MAP)
        current_map["d9"] = ("black", "m")
        current_map["f9"] = ("black", "m")
        current_map["a0"] = ("red", "n")
        current_map["h4"] = current_map.pop("h2")
        recognizer = XiangqiRecognizer.__new__(XiangqiRecognizer)

        move, returned = recognizer.detect_exact_move_from_state(
            board(previous_map), board(current_map), expected_side="red"
        )

        self.assertEqual(move.src + move.dst, "h2h4")
        self.assertEqual(returned.pieces["d9"].piece_type, "g")
        self.assertEqual(returned.pieces["a0"].piece_type, "r")
        self.assertIn("canonical identities were retained", returned.warnings[-1])

    def test_piece_type_flicker_alone_is_not_a_move(self) -> None:
        previous = self._state(900.0, 100.0)
        current = self._state(900.0, 100.0)
        current.pieces["e0"] = DetectedPiece("red", "m", 4, 0, (400.0, 900.0), 30.0, 1.0)
        recognizer = XiangqiRecognizer.__new__(XiangqiRecognizer)

        with self.assertRaisesRegex(NoBoardChangeError, "No board change"):
            recognizer.detect_exact_move_from_state(previous, current, expected_side="red")

    def test_transition_observer_reuses_grid_and_probes_only_changed_squares(self) -> None:
        grid_x = [50.0 + (index * 100.0) for index in range(9)]
        grid_y = [50.0 + (index * 100.0) for index in range(10)]
        before = np.zeros((1000, 900, 3), dtype=np.uint8)
        after = before.copy()
        # Black-at-bottom orientation: canonical a0/a1 appear at the upper-right.
        before[30:70, 830:870] = 220
        after[130:170, 830:870] = 220
        pieces = {
            "a0": DetectedPiece("red", "r", 0, 0, (850.0, 50.0), 30.0, 1.0),
            "e0": DetectedPiece("red", "k", 4, 0, (450.0, 50.0), 30.0, 1.0),
            "e9": DetectedPiece("black", "k", 4, 9, (450.0, 950.0), 30.0, 1.0),
        }
        reference = BoardState(
            pieces,
            (0, 0, 900, 1000),
            grid_x,
            grid_y,
            before,
            [],
            [],
            before,
        )
        recognizer = XiangqiRecognizer.__new__(XiangqiRecognizer)
        recognizer.fixed_vision = Mock()

        def extract(image: np.ndarray, x: float, y: float, _step: float):
            cx, cy = int(round(x)), int(round(y))
            return image[cy - 20 : cy + 20, cx - 20 : cx + 20].copy(), 30.0

        recognizer.fixed_vision.extract_intersection_patch.side_effect = extract
        recognizer.fixed_vision.piece_present.side_effect = (
            lambda patch, _radius: (float(patch.mean()) > 100.0, float(patch.mean()))
        )
        recognizer.fixed_vision.classify_piece.return_value = (
            "red",
            "r",
            0.95,
            [("glyph:r", 0.9)],
        )
        recognizer._draw_overlay = Mock(return_value=after)

        observed = recognizer.recognize_transition_board(reference, after)

        self.assertNotIn("a0", observed.pieces)
        self.assertIn("a1", observed.pieces)
        self.assertEqual(observed.pieces["a1"].side, "red")
        self.assertLessEqual(recognizer.fixed_vision.piece_present.call_count, 6)

    def test_transition_observer_audits_capture_replacement_below_top_changes(self) -> None:
        grid_x = [50.0 + (index * 100.0) for index in range(9)]
        grid_y = [50.0 + (index * 100.0) for index in range(10)]
        before = np.zeros((1000, 900, 3), dtype=np.uint8)
        after = before.copy()
        # Flipped geometry: d3 is at (550,350), d9 at (550,950).
        before[330:370, 530:570] = 220
        before[930:970, 530:570] = 80
        after[930:970, 530:570] = 220
        pieces = {
            "d3": DetectedPiece("red", "r", 3, 3, (550.0, 350.0), 30.0, 1.0),
            "d9": DetectedPiece("black", "r", 3, 9, (550.0, 950.0), 30.0, 1.0),
            "e0": DetectedPiece("red", "k", 4, 0, (450.0, 50.0), 30.0, 1.0),
            "e9": DetectedPiece("black", "k", 4, 9, (450.0, 950.0), 30.0, 1.0),
        }
        reference = BoardState(
            pieces,
            (0, 0, 900, 1000),
            grid_x,
            grid_y,
            before,
            [],
            [],
            before,
        )
        recognizer = XiangqiRecognizer.__new__(XiangqiRecognizer)
        recognizer.fixed_vision = Mock()
        recognizer._select_changed_coords = Mock(return_value=["d3"])

        def extract(image: np.ndarray, x: float, y: float, _step: float):
            cx, cy = int(round(x)), int(round(y))
            return image[cy - 20 : cy + 20, cx - 20 : cx + 20].copy(), 30.0

        recognizer.fixed_vision.extract_intersection_patch.side_effect = extract
        recognizer.fixed_vision.piece_present.side_effect = (
            lambda patch, _radius: (float(patch.mean()) > 20.0, float(patch.mean()))
        )
        recognizer.fixed_vision.classify_piece.side_effect = (
            lambda patch, _radius: (
                "red" if float(patch.mean()) > 150.0 else "black",
                "r",
                0.95,
                [("glyph:r", 0.9)],
            )
        )
        recognizer._draw_overlay = Mock(return_value=after)

        observed = recognizer.recognize_transition_board(reference, after)

        self.assertNotIn("d3", observed.pieces)
        self.assertEqual(observed.pieces["d9"].side, "red")

    def test_known_move_preserves_flipped_board_geometry(self) -> None:
        grid_x = [float(index * 100) for index in range(9)]
        grid_y = [float(index * 100) for index in range(10)]
        image = np.zeros((1000, 900, 3), dtype=np.uint8)
        pieces = {
            "e0": DetectedPiece("red", "k", 4, 0, (400.0, 0.0), 30.0, 1.0),
            "e9": DetectedPiece("black", "k", 4, 9, (400.0, 900.0), 30.0, 1.0),
            "a9": DetectedPiece("black", "r", 0, 9, (800.0, 900.0), 30.0, 1.0),
        }
        previous = BoardState(pieces, (0, 0, 900, 1000), grid_x, grid_y, image, [], [], image)
        recognizer = XiangqiRecognizer.__new__(XiangqiRecognizer)

        _move, after = recognizer.state_after_known_move(previous, "a9a8", "black")

        self.assertEqual(after.pieces["a8"].center, (800.0, 800.0))

    def test_expected_occupancy_repairs_unclassified_destination_coin(self) -> None:
        previous = self._state(900.0, 100.0)
        previous.pieces["a0"] = DetectedPiece("red", "r", 0, 0, (0.0, 900.0), 30.0, 1.0)
        expected = self._state(900.0, 100.0)
        expected.pieces["a1"] = DetectedPiece("red", "r", 0, 1, (0.0, 800.0), 30.0, 1.0)
        observed = self._state(900.0, 100.0)
        recognizer = XiangqiRecognizer.__new__(XiangqiRecognizer)
        recognizer.fixed_vision = Mock()
        recognizer.fixed_vision.extract_intersection_patch.return_value = (
            np.zeros((40, 40, 3), dtype=np.uint8),
            20.0,
        )
        recognizer.fixed_vision.piece_present.return_value = (True, 60.0)
        recognizer.refresh_state_image = Mock(return_value=expected)

        reconciled = recognizer.reconcile_expected_position(
            expected,
            observed,
            observed.source_image,
        )

        self.assertIs(reconciled, expected)
        self.assertIn("a1", reconciled.warnings[-1])

    def test_landing_animation_uses_strong_template_when_coin_coverage_narrowly_misses(self) -> None:
        expected = self._state(900.0, 100.0)
        expected.pieces["a1"] = DetectedPiece(
            "red", "r", 0, 1, (0.0, 800.0), 30.0, 1.0
        )
        observed = self._state(900.0, 100.0)
        recognizer = XiangqiRecognizer.__new__(XiangqiRecognizer)
        recognizer.fixed_vision = Mock()
        recognizer.fixed_vision.extract_intersection_patch.return_value = (
            np.zeros((40, 40, 3), dtype=np.uint8),
            20.0,
        )
        recognizer.fixed_vision.piece_present.return_value = (False, 40.0)
        recognizer.fixed_vision.classify_piece.return_value = (
            "red",
            "r",
            0.95,
            [("glyph:r", 0.95)],
        )
        recognizer.refresh_state_image = Mock(return_value=expected)

        reconciled = recognizer.reconcile_expected_position(
            expected, observed, observed.source_image
        )

        self.assertIsNotNone(reconciled)
        self.assertIn("landing-animation", reconciled.warnings[-1])

    def test_transition_template_fallback_rejects_low_confidence_artwork(self) -> None:
        expected = self._state(900.0, 100.0)
        expected.pieces["a1"] = DetectedPiece("red", "r", 0, 1, (0.0, 800.0), 30.0, 1.0)
        observed = self._state(900.0, 100.0)
        recognizer = XiangqiRecognizer.__new__(XiangqiRecognizer)
        recognizer.fixed_vision = Mock()
        recognizer.fixed_vision.extract_intersection_patch.return_value = (
            np.zeros((40, 40, 3), dtype=np.uint8),
            20.0,
        )
        recognizer.fixed_vision.piece_present.return_value = (False, 40.0)
        recognizer.fixed_vision.classify_piece.return_value = (
            "red",
            "r",
            0.69,
            [("glyph:r", 0.47)],
        )

        self.assertIsNone(
            recognizer.reconcile_expected_position(expected, observed, observed.source_image)
        )

    def test_clicked_move_finishes_three_observations_even_after_wall_deadline(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        previous = self._state(900.0, 100.0)
        previous.pieces["a0"] = DetectedPiece("red", "r", 0, 0, (0.0, 900.0), 30.0, 1.0)
        after = self._state(900.0, 100.0)
        after.pieces["a1"] = DetectedPiece("red", "r", 0, 1, (0.0, 800.0), 30.0, 1.0)
        own = MoveRecord("red", "r", "a0", "a1", False)
        clock = [0.0]

        def recognize(_reference: BoardState, _image: np.ndarray) -> BoardState:
            clock[0] += 3.0
            return after

        controller.active_own_side = "red"
        controller.stop_event = Mock()
        controller.stop_event.is_set.return_value = False
        controller._check_stop = Mock()
        controller._capture = Mock(
            return_value=(after.source_image, WindowInfo(1, "Tiantian", (0, 0, 800, 1000)))
        )
        controller.preview = Mock()
        controller.recognizer = Mock()
        controller.recognizer.state_after_known_move.return_value = (own, after)
        controller.recognizer.recognize_transition_board.side_effect = recognize
        controller.recognizer.reconcile_expected_position.return_value = after

        with patch("bot_level_calibrator.controller.time.monotonic", side_effect=lambda: clock[0]):
            moves, confirmed = controller._wait_for_clicked_move(
                previous,
                "a0a1",
                timeout=5.0,
            )

        self.assertEqual(moves, ["a0a1"])
        self.assertIs(confirmed, after)
        self.assertEqual(controller.recognizer.recognize_transition_board.call_count, 3)

    def test_ocr_runtime_is_hard_disabled(self) -> None:
        recognizer = XiangqiRecognizer.__new__(XiangqiRecognizer)

        with self.assertRaisesRegex(RuntimeError, "OCR is disabled"):
            recognizer._get_ocr()

    def test_unregistered_move_is_retried_without_advancing_state(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        previous = self._state(900.0, 100.0)
        confirmed = self._state(900.0, 100.0)
        controller._click_move = Mock(return_value=previous)
        controller._wait_for_clicked_move = Mock(
            side_effect=(
                MoveNotRegistered("unchanged"),
                MoveNotRegistered("still unchanged"),
                (["a0a1"], confirmed),
            )
        )
        controller.log = Mock()

        moves, state = controller._execute_verified_move("a0a1", previous)

        self.assertEqual(moves, ["a0a1"])
        self.assertIs(state, confirmed)
        self.assertEqual(controller._click_move.call_count, 2)
        self.assertFalse(controller._click_move.call_args_list[0].kwargs["destination_only"])
        self.assertTrue(controller._click_move.call_args_list[1].kwargs["destination_only"])

    def test_single_false_transition_frame_cannot_confirm_our_move(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        previous = self._state(900.0, 100.0)
        previous.pieces["a0"] = DetectedPiece("red", "r", 0, 0, (0.0, 900.0), 30.0, 1.0)
        after = self._state(900.0, 100.0)
        after.pieces["a1"] = DetectedPiece("red", "r", 0, 1, (0.0, 800.0), 30.0, 1.0)
        own = MoveRecord("red", "r", "a0", "a1", False)
        observations = iter((after, previous))

        def recognize(_reference: BoardState, _image: np.ndarray) -> BoardState:
            return next(observations, previous)

        controller.active_own_side = "red"
        controller.stop_event = Mock()
        controller._check_stop = Mock()
        controller._capture = Mock(
            return_value=(previous.source_image, WindowInfo(1, "Tiantian", (0, 0, 800, 1000)))
        )
        controller._detect_outcome = Mock(return_value=None)
        controller.preview = Mock()
        controller.recognizer = Mock()
        controller.recognizer.state_after_known_move.return_value = (own, after)
        controller.recognizer.recognize_transition_board.side_effect = recognize
        controller.recognizer.reconcile_expected_position.side_effect = (after, None)
        controller.recognizer.refresh_state_image.return_value = after

        with self.assertRaises(RuntimeError):
            controller._wait_for_clicked_move(previous, "a0a1", timeout=0.02)

    def test_late_move_confirmation_prevents_a_duplicate_retry_click(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        previous = self._state(900.0, 100.0)
        confirmed = self._state(900.0, 100.0)
        controller._click_move = Mock(return_value=previous)
        controller._wait_for_clicked_move = Mock(
            side_effect=(
                MoveNotRegistered("deadline race"),
                (["a0a1"], confirmed),
            )
        )
        controller.log = Mock()

        moves, state = controller._execute_verified_move("a0a1", previous)

        self.assertEqual(moves, ["a0a1"])
        self.assertIs(state, confirmed)
        controller._click_move.assert_called_once()

    def test_uncertain_confirmation_is_never_retried(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        previous = self._state(900.0, 100.0)
        controller._click_move = Mock(return_value=previous)
        controller._wait_for_clicked_move = Mock(side_effect=RuntimeError("incompatible board"))
        controller.log = Mock()

        with self.assertRaisesRegex(RuntimeError, "incompatible board"):
            controller._execute_verified_move("a0a1", previous)

        controller._click_move.assert_called_once()

    def test_click_refuses_enemy_piece_on_engine_source_square(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        state = self._state(900.0, 100.0)
        state.pieces["i4"] = DetectedPiece("black", "p", 8, 4, (700.0, 500.0), 30.0, 1.0)
        controller.active_own_side = "red"
        controller._capture = Mock(return_value=(state.source_image, WindowInfo(1, "Tiantian", (0, 0, 800, 1000))))
        controller._detect_outcome = Mock(return_value=None)
        controller._click_visible = Mock()
        controller.preview = Mock()
        controller.recognizer = Mock()
        controller._recognize_transition_board = Mock(return_value=state)

        with self.assertRaisesRegex(RuntimeError, "vision sees black's p on source square i4"):
            controller._click_move("i4e4", state)

        controller._click_visible.assert_not_called()

    def test_preclick_guard_repairs_a_transient_unclassified_piece(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        expected = self._state(900.0, 100.0)
        expected.pieces["a0"] = DetectedPiece("red", "r", 0, 0, (0.0, 900.0), 30.0, 1.0)
        observed = self._state(900.0, 100.0)
        after = self._state(900.0, 100.0)
        after.pieces["a1"] = DetectedPiece("red", "r", 0, 1, (0.0, 800.0), 30.0, 1.0)
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1000))
        controller.active_own_side = "red"
        controller._capture = Mock(return_value=(observed.source_image, window))
        controller._recognize_transition_board = Mock(return_value=observed)
        controller._click_visible = Mock()
        controller.preview = Mock()
        controller.log = Mock()
        controller.recognizer = Mock()
        controller.recognizer.reconcile_expected_position.return_value = expected
        controller.recognizer.state_after_known_move.return_value = (Mock(), after)
        controller.recognizer.refresh_state_image.return_value = expected

        returned = controller._click_move("a0a1", expected)

        self.assertIs(returned, expected)
        self.assertEqual(controller._click_visible.call_count, 2)
        controller.log.assert_called_once()

    def test_preclick_guard_requires_persistent_mismatches(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        expected = self._state(900.0, 100.0)
        expected.pieces["a0"] = DetectedPiece("red", "r", 0, 0, (0.0, 900.0), 30.0, 1.0)
        observed = self._state(900.0, 100.0)
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1000))
        controller._capture = Mock(return_value=(observed.source_image, window))
        controller._recognize_transition_board = Mock(return_value=observed)
        controller._click_visible = Mock()
        controller._check_stop = Mock()
        controller.stop_event = Mock()
        controller.stop_event.wait.return_value = False
        controller.preview = Mock()
        controller.recognizer = Mock()
        controller.recognizer.reconcile_expected_position.return_value = None

        with self.assertRaisesRegex(RuntimeError, "persistently differed"):
            controller._click_move("a0a1", expected)

        self.assertEqual(controller._capture.call_count, 6)
        controller._click_visible.assert_not_called()

    def test_cursor_tolerance_accepts_small_windows_position_error(self) -> None:
        automator = TtxqAutomator.__new__(TtxqAutomator)
        automator._get_cursor_pos = Mock(return_value=(540, 397))

        self.assertTrue(automator._cursor_near(544, 399))

    def test_controller_foregrounds_tiantian_before_every_physical_click(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        controller.automator = Mock()
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1420))

        controller._click_visible((100.0, 200.0), window, 0.5)

        self.assertEqual(
            controller.automator.method_calls,
            [
                call._bring_to_front(window),
                call.click_visible_point((100.0, 200.0), window, after=0.5),
            ],
        )

    def test_fixed_screen_classifiers_separate_setup_result_and_game(self) -> None:
        setup = np.full((1471, 857, 3), 70, dtype=np.uint8)
        setup[1310:1413, 103:703] = 205
        result = np.full((1471, 857, 3), 70, dtype=np.uint8)
        result[1192:1309, 60:386] = 205
        result[1192:1309, 454:797] = 205
        game = np.full((1471, 857, 3), 70, dtype=np.uint8)

        self.assertTrue(TiantianController._setup_screen_is_open(setup))
        self.assertFalse(TiantianController._result_screen_is_open(setup))
        self.assertTrue(TiantianController._result_screen_is_open(result))
        self.assertFalse(TiantianController._setup_screen_is_open(result))
        self.assertFalse(TiantianController._setup_screen_is_open(game))
        self.assertFalse(TiantianController._result_screen_is_open(game))

    def test_game_exit_uses_menu_exit_and_confirmation(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        image = np.zeros((1000, 800, 3), dtype=np.uint8)
        menu_image = np.ones((1000, 800, 3), dtype=np.uint8)
        confirm_image = np.full((1000, 800, 3), 70, dtype=np.uint8)
        confirm_image[400:520, 120:680] = 220
        confirm_image[560:610, 424:654] = (107, 121, 191)
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1000))
        controller._click_visible = Mock()
        controller._wait_for_visual_capture = Mock(
            side_effect=((menu_image, window), (confirm_image, window))
        )
        controller.log = Mock()

        handled = controller._leave_game_via_menu(image, window)

        self.assertTrue(handled)
        calls = [args.args for args in controller._click_visible.call_args_list]
        self.assertEqual(calls[:2], [
            ((93.60000000000001, 958.0), window, 0.55),
            ((177.6, 595.0), window, 0.6),
        ])
        self.assertAlmostEqual(calls[2][0][0], 539.0, delta=2.0)
        self.assertAlmostEqual(calls[2][0][1], 585.0, delta=2.0)
        self.assertEqual(calls[2][1:], (window, 0.8))

    def test_result_screen_wins_race_while_game_menu_is_opening(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        game = np.zeros((1000, 800, 3), dtype=np.uint8)
        result = np.full((1000, 800, 3), 70, dtype=np.uint8)
        result[810:890, 56:360] = 205
        result[810:890, 424:744] = 205
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1000))
        controller._click_visible = Mock()
        controller._wait_for_visual_capture = Mock(return_value=(result, window))
        controller.log = Mock()

        handled = controller._leave_game_via_menu(game, window)

        self.assertTrue(handled)
        self.assertEqual(
            [args.args for args in controller._click_visible.call_args_list],
            [
                ((93.60000000000001, 958.0), window, 0.55),
                ((216.0, 845.0), window, 0.7),
            ],
        )
        self.assertIn("while its menu was opening", controller.log.call_args_list[-2].args[0])

    def test_result_screen_wins_race_before_exit_confirmation(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        game = np.zeros((1000, 800, 3), dtype=np.uint8)
        menu = np.ones((1000, 800, 3), dtype=np.uint8)
        result = np.full((1000, 800, 3), 70, dtype=np.uint8)
        result[810:890, 56:360] = 205
        result[810:890, 424:744] = 205
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1000))
        controller._click_visible = Mock()
        controller._wait_for_visual_capture = Mock(
            side_effect=((menu, window), (result, window))
        )
        controller.log = Mock()

        handled = controller._leave_game_via_menu(game, window)

        self.assertTrue(handled)
        self.assertEqual(
            [args.args for args in controller._click_visible.call_args_list],
            [
                ((93.60000000000001, 958.0), window, 0.55),
                ((177.6, 595.0), window, 0.6),
                ((216.0, 845.0), window, 0.7),
            ],
        )

    def test_fixed_exit_points_land_inside_measured_theme_hitboxes(self) -> None:
        # Controller captures may include Tiantian's 51px title bar and 57px
        # right tool strip. The modal controls must be derived from its content,
        # not by normalizing against that variable wrapper.
        width, height = 857, 1471
        dialog = np.full((height, width, 3), 40, dtype=np.uint8)
        dialog[619:789, 120:680] = 220
        dialog[843:911, 424:654] = (107, 121, 191)
        menu_x, menu_y = (
            width * TiantianController.GAME_MENU_POINT[0],
            height * TiantianController.GAME_MENU_POINT[1],
        )
        exit_x, exit_y = (
            width * TiantianController.GAME_EXIT_POINT[0],
            height * TiantianController.GAME_EXIT_POINT[1],
        )
        dialog_points = TiantianController._two_button_dialog_points(dialog)
        self.assertIsNotNone(dialog_points)
        _cancel, (confirm_x, confirm_y) = dialog_points

        self.assertTrue(50 <= menu_x <= 165 and 1358 <= menu_y <= 1465)
        self.assertTrue(42 <= exit_x <= 353 and 830 <= exit_y <= 938)
        self.assertTrue(423 <= confirm_x <= 654 and 843 <= confirm_y <= 911)

    def test_exit_flow_requires_visual_menu_and_confirmation_states(self) -> None:
        image = np.full((1420, 800, 3), 190, dtype=np.uint8)
        menu = image.copy()
        menu[781:1150, 48:336] = 70
        confirmation = image.copy()
        confirmation[568:738, 120:680] = 220
        confirmation[795:860, 440:648] = (95, 110, 185)

        self.assertFalse(TiantianController._game_menu_is_open(image))
        self.assertTrue(TiantianController._game_menu_is_open(menu))
        self.assertFalse(TiantianController._two_button_dialog_is_open(image))
        self.assertTrue(TiantianController._two_button_dialog_is_open(confirmation))

    def test_attached_dialog_layout_requires_both_paper_body_and_red_action(self) -> None:
        dialog = np.full((1420, 800, 3), 70, dtype=np.uint8)
        dialog[568:738, 120:680] = 220
        dialog[792:860, 424:654] = (107, 121, 191)
        red_patch_without_dialog = np.full((1420, 800, 3), 70, dtype=np.uint8)
        red_patch_without_dialog[792:860, 424:654] = (107, 121, 191)

        self.assertTrue(TiantianController._two_button_dialog_is_open(dialog))
        self.assertFalse(TiantianController._two_button_dialog_is_open(red_patch_without_dialog))
        padded = cv2.copyMakeBorder(
            dialog,
            51,
            0,
            0,
            57,
            cv2.BORDER_CONSTANT,
            value=(40, 40, 40),
        )
        base_points = TiantianController._two_button_dialog_points(dialog)
        padded_points = TiantianController._two_button_dialog_points(padded)
        self.assertIsNotNone(base_points)
        self.assertIsNotNone(padded_points)
        self.assertAlmostEqual(padded_points[0][0], base_points[0][0], delta=1.0)
        self.assertAlmostEqual(padded_points[0][1], base_points[0][1] + 51, delta=1.0)

    def test_return_to_setup_handles_blocking_dialog_before_board_detection(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        dialog = np.full((1420, 800, 3), 70, dtype=np.uint8)
        dialog[568:738, 120:680] = 220
        dialog[792:860, 424:654] = (107, 121, 191)
        setup = np.full((1420, 800, 3), 70, dtype=np.uint8)
        setup[1264:1364, 96:656] = 205
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1420))
        controller._capture = Mock(side_effect=((dialog, window), (setup, window)))
        controller._check_stop = Mock()
        controller._click_visible = Mock()
        controller._leave_game_via_menu = Mock()
        controller.recognizer = Mock()
        controller.log = Mock()

        controller.return_to_setup()

        point = controller._click_visible.call_args.args[0]
        self.assertAlmostEqual(point[0], 260.0, delta=2.0)
        self.assertAlmostEqual(point[1], 826.0, delta=2.0)
        controller.recognizer.detect_board.assert_not_called()
        controller._leave_game_via_menu.assert_not_called()

    def test_recovery_cancels_an_orphaned_exit_dialog_then_exits_deliberately(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        dialog = np.full((1420, 800, 3), 70, dtype=np.uint8)
        dialog[568:738, 120:680] = 220
        dialog[792:860, 424:654] = (107, 121, 191)
        game = np.full((1420, 800, 3), 70, dtype=np.uint8)
        setup = game.copy()
        setup[1264:1364, 96:656] = 205
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1420))
        controller._capture = Mock(side_effect=((dialog, window), (game, window), (setup, window)))
        controller._check_stop = Mock()
        controller._click_visible = Mock()
        controller._leave_game_via_menu = Mock(return_value=True)
        controller.recognizer = Mock()
        controller.recognizer.detect_board.return_value = ((0, 0, 800, 1420), [], [])
        controller.log = Mock()

        controller.return_to_setup()

        point = controller._click_visible.call_args.args[0]
        self.assertAlmostEqual(point[0], 260.0, delta=2.0)
        self.assertAlmostEqual(point[1], 826.0, delta=2.0)
        controller._leave_game_via_menu.assert_called_once_with(game, window)

    def test_result_screen_uses_upper_left_new_round_before_mini_board_detection(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        result = np.full((1420, 800, 3), 70, dtype=np.uint8)
        result[1150:1265, 56:360] = 205
        result[1150:1265, 424:744] = 205
        setup = np.full((1420, 800, 3), 70, dtype=np.uint8)
        setup[1264:1364, 96:656] = 205
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1420))
        controller._capture = Mock(side_effect=((result, window), (setup, window)))
        controller._check_stop = Mock()
        controller._click_visible = Mock()
        controller._leave_game_via_menu = Mock()
        controller.recognizer = Mock()
        controller.log = Mock()

        controller.return_to_setup()

        controller._click_visible.assert_called_once_with((216.0, 1199.8999999999999), window, 0.7)
        controller.recognizer.detect_board.assert_not_called()
        controller._leave_game_via_menu.assert_not_called()

    def test_result_screen_finishes_game_even_when_its_mini_board_is_detectable(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        previous = self._state(900.0, 100.0)
        previous.pieces["a0"] = DetectedPiece("red", "r", 0, 0, (0.0, 900.0), 30.0, 1.0)
        after = self._state(900.0, 100.0)
        after.pieces["a1"] = DetectedPiece("red", "r", 0, 1, (0.0, 800.0), 30.0, 1.0)
        result = np.full((1000, 800, 3), 70, dtype=np.uint8)
        result[810:890, 56:360] = 205
        result[810:890, 424:744] = 205
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1000))
        own = MoveRecord("red", "r", "a0", "a1", False)
        finished = GameFinished("win", "result screen", ("a0a1",))
        controller.active_own_side = "red"
        controller.stop_event = Mock()
        controller._check_stop = Mock()
        controller._capture = Mock(
            side_effect=((after.source_image, window), (result, window), (result, window))
        )
        controller.preview = Mock()
        controller.recognizer = Mock()
        controller.recognizer.state_after_known_move.return_value = (own, after)
        controller.recognizer.recognize_transition_board.return_value = after
        controller.recognizer.reconcile_expected_position.return_value = after
        controller._finished_from_observed_moves = Mock(return_value=finished)

        with self.assertRaises(GameFinished) as raised:
            controller._wait_for_clicked_move(previous, "a0a1", timeout=1.0)

        self.assertIs(raised.exception, finished)
        controller._finished_from_observed_moves.assert_called_once_with(
            (), ("a0a1",), declared_result=None
        )

    def test_result_miniature_recovers_final_move_that_never_settled_live(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        previous = self._state(900.0, 100.0)
        previous.pieces["a0"] = DetectedPiece("red", "r", 0, 0, (0.0, 900.0), 30.0, 1.0)
        after = self._state(900.0, 100.0)
        after.pieces["a1"] = DetectedPiece("red", "r", 0, 1, (0.0, 800.0), 30.0, 1.0)
        result = np.full((1000, 800, 3), 70, dtype=np.uint8)
        result[810:890, 56:360] = 205
        result[810:890, 424:744] = 205
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1000))
        own = MoveRecord("red", "r", "a0", "a1", False)
        finished = GameFinished("draw", "result screen", ("a0a1",))
        controller.active_own_side = "red"
        controller.stop_event = Mock()
        controller._check_stop = Mock()
        controller._capture = Mock(
            side_effect=((previous.source_image, window), (result, window), (result, window))
        )
        controller.preview = Mock()
        controller.log = Mock()
        controller.recognizer = Mock()
        controller.recognizer.state_after_known_move.return_value = (own, after)
        controller.recognizer.recognize_transition_board.return_value = previous
        controller.recognizer.recognize_board.return_value = after
        controller._finished_from_observed_moves = Mock(return_value=finished)

        with self.assertRaises(GameFinished) as raised:
            controller._wait_for_clicked_move(previous, "a0a1", timeout=1.0)

        self.assertIs(raised.exception, finished)
        controller._finished_from_observed_moves.assert_called_once_with(
            (), ("a0a1",), declared_result=None
        )
        controller.recognizer.recognize_board.assert_called_once_with(result)

    def test_explicit_animated_result_records_verified_click_when_miniature_is_unreadable(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        previous = self._state(900.0, 100.0)
        previous.pieces["a0"] = DetectedPiece("red", "r", 0, 0, (0.0, 900.0), 30.0, 1.0)
        after = self._state(900.0, 100.0)
        after.pieces["a1"] = DetectedPiece("red", "r", 0, 1, (0.0, 800.0), 30.0, 1.0)
        first_result = np.full((1000, 800, 3), 70, dtype=np.uint8)
        second_result = first_result.copy()
        for image, brightness in ((first_result, 190), (second_result, 240)):
            image[810:890, 56:360] = 205
            image[810:890, 424:744] = 205
            image[105:195, 255:345] = brightness
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1000))
        own = MoveRecord("red", "r", "a0", "a1", False)
        finished = GameFinished("win", "explicit result", ("a0a1",))
        controller.active_own_side = "red"
        controller.stop_event = Mock()
        controller._check_stop = Mock()
        controller._capture = Mock(side_effect=((first_result, window), (second_result, window)))
        controller.recognizer = Mock()
        controller.recognizer.state_after_known_move.return_value = (own, after)
        controller.recognizer.recognize_board.side_effect = RuntimeError("miniature unreadable")
        controller._declared_result = Mock(return_value="win")
        controller._finished_from_observed_moves = Mock(return_value=finished)
        controller.log = Mock()

        with self.assertRaises(GameFinished) as raised:
            controller._wait_for_clicked_move(previous, "a0a1", timeout=1.0)

        self.assertIs(raised.exception, finished)
        controller._finished_from_observed_moves.assert_called_once_with(
            (), ("a0a1",), declared_result="win"
        )

    def test_result_declared_before_clicked_move_records_tracked_position(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        previous = self._state(900.0, 100.0)
        previous.pieces["a0"] = DetectedPiece("red", "r", 0, 0, (0.0, 900.0), 30.0, 1.0)
        after = self._state(900.0, 100.0)
        after.pieces["a1"] = DetectedPiece("red", "r", 0, 1, (0.0, 800.0), 30.0, 1.0)
        result = np.full((1000, 800, 3), 70, dtype=np.uint8)
        result[810:890, 56:360] = 205
        result[810:890, 424:744] = 205
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1000))
        own = MoveRecord("red", "r", "a0", "a1", False)
        finished = GameFinished("draw", "Tiantian declared draw", ())
        controller.active_own_side = "red"
        controller.stop_event = Mock()
        controller._check_stop = Mock()
        controller._capture = Mock(side_effect=((result, window), (result, window)))
        controller.recognizer = Mock()
        controller.recognizer.state_after_known_move.return_value = (own, after)
        controller.recognizer.recognize_board.return_value = previous
        controller._declared_result = Mock(return_value="draw")
        controller._finished_from_current_position = Mock(return_value=finished)
        controller.log = Mock()

        with self.assertRaises(GameFinished) as raised:
            controller._wait_for_clicked_move(
                previous,
                "a0a1",
                timeout=1.0,
                history=("b0c2",),
            )

        self.assertIs(raised.exception, finished)
        controller._finished_from_current_position.assert_called_once_with(
            ("b0c2",), declared_result="draw"
        )

    def test_fixed_result_badge_colors_report_tiantian_declaration(self) -> None:
        colors = {
            "win": (4, 220, 230),
            "draw": (45, 190, 210),
            "loss": (115, 210, 220),
        }
        for expected, hsv_color in colors.items():
            with self.subTest(expected=expected):
                image = np.full((1000, 800, 3), 70, dtype=np.uint8)
                bgr = cv2.cvtColor(
                    np.array([[hsv_color]], dtype=np.uint8),
                    cv2.COLOR_HSV2BGR,
                )[0, 0]
                cv2.fillConvexPoly(
                    image,
                    np.array([[300, 105], [345, 150], [300, 195], [255, 150]], dtype=np.int32),
                    tuple(int(value) for value in bgr),
                )

                self.assertEqual(TiantianController._declared_result(image), expected)

    def test_stable_result_without_opponent_move_finishes_tracked_position(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        previous = self._state(900.0, 100.0)
        result = np.full((1000, 800, 3), 70, dtype=np.uint8)
        result[810:890, 56:360] = 205
        result[810:890, 424:744] = 205
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1000))
        finished = GameFinished("win", "terminal tracked position", ())
        controller.stop_event = Mock()
        controller._check_stop = Mock()
        controller._capture = Mock(side_effect=((result, window), (result, window)))
        controller.log = Mock()
        controller._finished_from_current_position = Mock(return_value=finished)

        with self.assertRaises(GameFinished) as raised:
            controller._wait_for_move_sequence(
                previous,
                expected_side="red",
                max_moves=1,
                timeout=1.0,
                history=("a0a1",),
            )

        self.assertIs(raised.exception, finished)
        controller._finished_from_current_position.assert_called_once_with(
            ("a0a1",), declared_result=None
        )

    def test_modal_overlay_is_never_accepted_as_a_board(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        dialog = np.full((1420, 800, 3), 190, dtype=np.uint8)
        dialog[568:738, 120:680] = 220
        dialog[795:860, 440:648] = (95, 110, 185)
        controller.recognizer = Mock()

        with self.assertRaisesRegex(RuntimeError, "modal dialog is obscuring"):
            controller._recognize_unobscured_board(dialog)

        controller.recognizer.recognize_board.assert_not_called()

    def test_exit_flow_stops_when_menu_does_not_open(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        image = np.zeros((1000, 800, 3), dtype=np.uint8)
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1000))
        controller._click_visible = Mock()
        controller._wait_for_visual_capture = Mock(return_value=None)
        controller.log = Mock()

        self.assertFalse(controller._leave_game_via_menu(image, window))
        controller._click_visible.assert_called_once_with((93.60000000000001, 958.0), window, 0.55)

    def test_fixed_result_layout_is_loss_when_black_delivered_terminal_move(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        controller.engine = Mock()
        controller.engine.legal_moves.return_value = []
        controller.active_own_side = "red"

        finished = controller._finished_from_observed_moves([], ("a0a1", "a9a8"))

        self.assertEqual(finished.result, "loss")
        self.assertEqual(finished.moves, ("a0a1", "a9a8"))

    def test_fixed_result_layout_is_draw_when_legal_moves_remain(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        controller.engine = Mock()
        controller.engine.legal_moves.return_value = ["a0a1"]
        controller.active_own_side = "black"

        finished = controller._finished_from_observed_moves([], ("a0a1",))

        self.assertEqual(finished.result, "draw")

    def test_next_game_skips_unverifiable_rematch_and_returns_to_setup(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        controller._click_visible = Mock()
        controller._wait_for_board = Mock()
        controller.return_to_setup = Mock()
        controller.log = Mock()

        controller.prepare_next_game(2, "black")

        controller.return_to_setup.assert_called_once_with(await_completed_result=True)
        controller._click_visible.assert_not_called()
        controller._wait_for_board.assert_not_called()

    def test_rematch_that_preserves_colour_returns_to_setup(self) -> None:
        controller = TiantianController.__new__(TiantianController)
        image = np.zeros((1420, 800, 3), dtype=np.uint8)
        window = WindowInfo(1, "Tiantian", (0, 0, 800, 1420))
        state = self._state(900.0, 100.0)
        controller._capture = Mock(return_value=(image, window))
        controller._click_visible = Mock()
        controller._wait_for_board = Mock(return_value=state)
        controller.return_to_setup = Mock()
        controller.log = Mock()

        controller.prepare_next_game(2, "black")

        controller.return_to_setup.assert_called_once_with(await_completed_result=True)


class ApplicationRecoveryTests(unittest.TestCase):
    def test_recoverable_game_error_returns_to_setup_without_stopping_runner(self) -> None:
        app = CalibrationApp.__new__(CalibrationApp)
        app.events = Mock()
        app.stop_event = Mock()
        app.stop_event.is_set.return_value = False
        app.stop_event.wait.return_value = False
        controller = Mock()

        app._recover_after_game_error(
            controller,
            12,
            RuntimeError("transition timeout"),
            "traceback detail",
            committed=False,
        )

        controller.return_to_setup.assert_called_once_with(await_completed_result=True)
        messages = [entry.args[0] for entry in app.events.put.call_args_list]
        self.assertTrue(any("discarded without saving" in str(message) for message in messages))
        self.assertTrue(any("continuing the calibration loop" in str(message) for message in messages))
        app.stop_event.set.assert_not_called()

    def test_setup_recovery_has_no_three_attempt_kill_switch(self) -> None:
        app = CalibrationApp.__new__(CalibrationApp)
        app.events = Mock()
        app.stop_event = Mock()
        app.stop_event.is_set.return_value = False
        app.stop_event.wait.return_value = False
        controller = Mock()
        controller.return_to_setup.side_effect = [
            RuntimeError("unknown screen") for _ in range(5)
        ] + [None]

        app._recover_after_game_error(
            controller,
            12,
            RuntimeError("transition timeout"),
            "traceback detail",
            committed=False,
        )

        self.assertEqual(controller.return_to_setup.call_count, 6)
        self.assertEqual(
            [call.args[0] for call in app.stop_event.wait.call_args_list],
            [0.5, 1.0, 2.0, 4.0, 8.0],
        )
        messages = [entry.args[0] for entry in app.events.put.call_args_list]
        self.assertTrue(any("runner remains active" in str(message) for message in messages))


class DrawAdjudicationTests(unittest.TestCase):
    @staticmethod
    def _oscillate(first: str, second: str, count: int) -> list[str]:
        return [first if index % 2 == 0 else second for index in range(count)]

    def test_natural_limit_is_exactly_120_captureless_plies(self) -> None:
        moves = self._oscillate("a0a1", "a1a0", 120)

        self.assertIsNone(TiantianController._script_draw_reason(moves[:119]))
        self.assertIn("60-round natural limit", TiantianController._script_draw_reason(moves))

    def test_capture_resets_natural_limit_counter(self) -> None:
        moves = ["a0a9"] + self._oscillate("a9a8", "a8a9", 119)

        self.assertEqual(TiantianController._captureless_plies(moves), 119)
        self.assertIsNone(TiantianController._script_draw_reason(moves))
        self.assertIn(
            "60-round natural limit",
            TiantianController._script_draw_reason(moves + ["a8a9"]),
        )

    def test_182_total_plies_draw_only_after_120_since_last_capture(self) -> None:
        before_capture = self._oscillate("a0a1", "a1a0", 62)
        moves = before_capture + ["a0a9"] + self._oscillate("a9a8", "a8a9", 119)

        self.assertEqual(len(moves), 182)
        self.assertEqual(TiantianController._captureless_plies(moves), 119)
        self.assertIsNone(TiantianController._script_draw_reason(moves))
        reason = TiantianController._script_draw_reason(moves + ["a8a9"])
        self.assertIn("120 consecutive plies", reason)
        self.assertIn("183 total plies", reason)

    def test_absolute_limit_is_400_plies_even_with_late_captures(self) -> None:
        moves = self._oscillate("a0a1", "a1a0", 99)
        moves += ["a1a6"]
        moves += self._oscillate("a6a5", "a5a6", 99)
        moves += ["a5a9"]
        moves += self._oscillate("a9a8", "a8a9", 99)
        moves += ["a8i9"]
        moves += self._oscillate("i9i8", "i8i9", 100)

        self.assertEqual(len(moves), 400)
        self.assertIsNone(TiantianController._script_draw_reason(moves[:399]))
        self.assertIn("200-round absolute safety limit", TiantianController._script_draw_reason(moves))


if __name__ == "__main__":
    unittest.main()
