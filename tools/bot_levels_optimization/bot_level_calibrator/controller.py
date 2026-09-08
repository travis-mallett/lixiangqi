from __future__ import annotations

import json
import random
import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Sequence

from .automator import TtxqAutomator
from .constants import FILE_LETTERS, START_POSITION_MAP
from .engine import PikafishEngine
from .models import BoardState, DetectedPiece, MoveDetectionError, NoBoardChangeError, WindowInfo
from .paths import PROJECT_ROOT
from .recognizer import XiangqiRecognizer
from .runtime import cv2, np
from .strength import StrengthProfile


TIANTIAN_LEVELS = (2, 3, 4, 5, 7, 9, 12, 18, 25)
NO_CAPTURE_DRAW_PLIES = 120
HARD_DRAW_PLIES = 400
MOVE_CONFIRMATION_FRAMES = 3
TRANSITION_CONFIRMATION_SECONDS = 0.18
UNCHANGED_CONFIRMATION_SECONDS = 0.65
MOVE_POLL_INTERVAL = 0.04
CLICK_CONFIRMATION_TIMEOUT = 18.0
CLICK_RETRY_GRACE_TIMEOUT = 10.0
PRECLICK_VERIFICATION_FRAMES = 6


class CalibrationStopped(RuntimeError):
    pass


@dataclass(frozen=True)
class PlayedGame:
    result: str
    plies: int
    reason: str
    moves: tuple[str, ...] = ()


class GameFinished(RuntimeError):
    def __init__(self, result: str, reason: str, moves: Sequence[str] = ()) -> None:
        super().__init__(reason)
        self.result = result
        self.reason = reason
        self.moves = tuple(moves)


class MoveNotRegistered(RuntimeError):
    """A settled board repeatedly showed the exact pre-click position."""


class TiantianController:
    """Drive the Tiantian desktop app while reusing its proven fixed-theme vision."""

    START_BUTTON_POINT = (0.50, 0.923)
    LEVEL_SLIDER_START_X = 0.27
    LEVEL_SLIDER_END_X = 0.89
    LEVEL_SLIDER_Y = 0.268
    COMPUTER_SIDE_POINTS = {"red": (0.6875, 0.36), "black": (0.85, 0.36)}
    # Normalized against the fixed 857x1471 captured Tiantian window, which
    # includes its title bar and right-side tool strip.
    RESULT_NEW_ROUND_POINT = (0.27, 0.845)
    GAME_MENU_POINT = (0.117, 0.958)
    GAME_EXIT_POINT = (0.222, 0.595)

    def __init__(
        self,
        recognizer: XiangqiRecognizer,
        engine: PikafishEngine,
        stop_event: threading.Event,
        log: Callable[[str], None],
        preview: Callable[[np.ndarray], None],
    ) -> None:
        self.recognizer = recognizer
        self.engine = engine
        self.stop_event = stop_event
        self.log = log
        self.preview = preview
        self.active_own_side = "red"
        self.automator = TtxqAutomator(recognizer, log)
        self.diagnostic_dir = PROJECT_ROOT / "data" / "transition_diagnostics"

    def play_game(
        self,
        level: int,
        lixiangqi_side: str,
        profile: StrengthProfile,
        seed: int,
    ) -> PlayedGame:
        self._check_stop()
        self.active_own_side = lixiangqi_side
        tiantian_side = "black" if lixiangqi_side == "red" else "red"
        self._ensure_setup_screen()
        self._set_level(level)
        self._set_computer_side(tiantian_side)
        self._click_normalized(self.START_BUTTON_POINT, after=0.4)
        state = self._wait_for_board(15.0)
        baseline = self._starting_state_like(state)
        moves: list[str] = []
        move_rng = random.Random(seed)

        # If Tiantian was Red it may have moved before the first full detection.
        if self._position_signature(state) != self._position_signature(baseline):
            first, state = self.recognizer.detect_exact_move_from_state(
                baseline, state, expected_side="red"
            )
            if lixiangqi_side == "red":
                raise RuntimeError(
                    f"Tiantian made Red's first move ({first.src}{first.dst}) even though computer Black "
                    "was selected. The color click did not take effect; no Lixiangqi move was clicked."
                )
            first_move = first.src + first.dst
            moves.append(first_move)
            self.log(f"Tiantian: {first_move}")
        else:
            # The standard start map, not a video classifier, establishes all
            # piece identities for the game. Every later transition preserves
            # this canonical state through legal move application.
            if state.source_image is not None:
                baseline = self.recognizer.refresh_state_image(baseline, state.source_image)
            state = baseline
            if lixiangqi_side == "black":
                first, state = self._wait_for_move(state, "red", 20.0, history=moves)
                moves.append(first)
                self.log(f"Tiantian: {first}")

        while True:
            self._check_stop()
            captureless_plies = self._captureless_plies(moves)
            if captureless_plies in (60, 90, 110):
                self.log(
                    f"Natural draw clock: {captureless_plies}/{NO_CAPTURE_DRAW_PLIES} "
                    f"consecutive plies without a capture ({len(moves)} total plies)."
                )
            draw_reason = self._script_draw_reason(moves)
            if draw_reason is not None:
                self.log(f"Calibration adjudication: DRAW ({draw_reason}).")
                return PlayedGame("draw", len(moves), draw_reason, tuple(moves))
            side_to_move = "red" if len(moves) % 2 == 0 else "black"
            if side_to_move == lixiangqi_side:
                search_started = time.monotonic()
                selected = self.engine.choose_move(moves, profile, move_rng)
                if selected is None:
                    return PlayedGame("loss", len(moves), "Pikafish returned no move", tuple(moves))
                self.log(f"Lixiangqi: {selected} (computed in {time.monotonic() - search_started:.3f}s)")
                try:
                    observed_moves, state = self._execute_verified_move(selected, state, history=moves)
                except GameFinished as finished:
                    finished_moves = list(finished.moves) or [selected]
                    return PlayedGame(
                        finished.result,
                        len(moves) + len(finished_moves),
                        finished.reason,
                        tuple(moves + finished_moves),
                    )
                if not observed_moves or observed_moves[0] != selected:
                    observed_text = ", ".join(observed_moves) if observed_moves else "no move"
                    raise RuntimeError(
                        f"Clicked {selected}, but settled-board vision observed {observed_text}; "
                        "stopping to protect the calibration data."
                    )
                moves.extend(observed_moves)
                if len(observed_moves) == 2:
                    self.log(f"Tiantian replied before capture: {observed_moves[1]}")
            else:
                if not self.engine.legal_moves(moves):
                    return PlayedGame("win", len(moves), "Tiantian has no legal moves", tuple(moves))
                try:
                    detection_started = time.monotonic()
                    observed, state = self._wait_for_move(
                        state,
                        side_to_move,
                        30.0,
                        history=moves,
                    )
                except GameFinished as finished:
                    finished_moves = list(finished.moves)
                    return PlayedGame(
                        finished.result,
                        len(moves) + len(finished_moves),
                        finished.reason,
                        tuple(moves + finished_moves),
                    )
                self.log(
                    f"Tiantian: {observed} "
                    f"(detected in {time.monotonic() - detection_started:.3f}s including Tiantian think time)"
                )
                moves.append(observed)


    @staticmethod
    def _captureless_plies(moves: Sequence[str]) -> int | None:
        """Reconstruct the exact no-capture clock from canonical move history."""
        board = dict(START_POSITION_MAP)
        plies_without_capture = 0
        for move in moves:
            src, dst = move[:2], move[2:]
            piece = board.pop(src, None)
            if piece is None:
                # Move legality is verified elsewhere. Do not invent a draw from
                # a history that cannot be reconstructed.
                return None
            capture = dst in board
            board[dst] = piece
            plies_without_capture = 0 if capture else plies_without_capture + 1
        return plies_without_capture

    @staticmethod
    def _script_draw_reason(moves: Sequence[str]) -> str | None:
        """Apply objective fallback limits when Tiantian has not ended the game."""
        plies_without_capture = TiantianController._captureless_plies(moves)
        if plies_without_capture is None:
            return None
        if plies_without_capture >= NO_CAPTURE_DRAW_PLIES:
            return (
                "60-round natural limit "
                f"({NO_CAPTURE_DRAW_PLIES} consecutive plies without a capture; "
                f"{len(moves)} total plies)"
            )
        if len(moves) >= HARD_DRAW_PLIES:
            return f"200-round absolute safety limit ({len(moves)} total plies)"
        return None

    def prepare_next_game(self, level: int, lixiangqi_side: str) -> None:
        """Return through verified setup before every calibration game.

        Tiantian's rematch layout does not provide a non-text ownership signal.
        Board orientation is therefore insufficient to prove which side the
        optimizer controls, so the former rematch shortcut is deliberately not
        used for calibration evidence.
        """
        self.log(
            f"Returning through verified setup for level {level}, Lixiangqi {lixiangqi_side}; "
            "rematch ownership is intentionally not inferred from board orientation."
        )
        self.return_to_setup(await_completed_result=True)

    def return_to_setup(self, await_completed_result: bool = False) -> None:
        if await_completed_result:
            self.log("Waiting briefly for Tiantian's completed-game result screen before menu navigation.")
            result_capture = self._wait_for_visual_capture(
                lambda observed: self._result_screen_is_open(observed)
                or self._two_button_dialog_is_open(observed),
                timeout=2.0,
            )
            if result_capture is not None and self._result_screen_is_open(result_capture[0]):
                self._leave_result_screen(*result_capture)
        for _attempt in range(8):
            self._check_stop()
            image, window = self._capture()
            dialog_points = self._two_button_dialog_points(image)
            if dialog_points is not None:
                # The safe left action is New game on the unfinished-match
                # prompt and Cancel on an already-open exit confirmation.  In
                # both cases it removes the modal without continuing an old
                # game or confirming an untracked action.
                self.log(
                    "A fixed-theme dialog is blocking Tiantian; selecting its safe left action before navigation."
                )
                self._click_visible(
                    dialog_points[0],
                    window,
                    0.7,
                )
                continue
            if self._setup_screen_is_open(image):
                return
            if self._result_screen_is_open(image):
                self._leave_result_screen(image, window)
                continue
            try:
                self._detect_unobscured_board(image)
            except RuntimeError:
                raise RuntimeError(
                    "Tiantian is on an unrecognized non-board screen; refusing an unverified navigation click."
                )
            if self._leave_game_via_menu(image, window):
                continue
            raise RuntimeError("The Tiantian game menu did not expose an exit or return action.")
        raise RuntimeError("Could not return Tiantian to the human-vs-computer setup screen.")

    def _leave_result_screen(self, image: np.ndarray, window: WindowInfo) -> None:
        self.log("Leaving Tiantian's result screen through the upper-left New round button.")
        self._click_visible(
            self._normalized_point(image, self.RESULT_NEW_ROUND_POINT),
            window,
            0.7,
        )

    def _leave_game_via_menu(self, image: np.ndarray, window: WindowInfo) -> bool:
        self.log("Opening Tiantian's bottom-left game menu.")
        self._click_visible(self._normalized_point(image, self.GAME_MENU_POINT), window, 0.55)
        menu_capture = self._wait_for_visual_capture(
            lambda observed: self._result_screen_is_open(observed)
            or self._game_menu_is_open(observed),
            timeout=2.0,
        )
        if menu_capture is None:
            self.log("Tiantian's fixed-theme game menu did not visually open; refusing to click an unverified row.")
            return False
        menu_image, menu_window = menu_capture
        if self._result_screen_is_open(menu_image):
            self.log("Tiantian's result screen replaced the game while its menu was opening.")
            self._leave_result_screen(menu_image, menu_window)
            return True
        self.log("Clicking Exit in Tiantian's game menu.")
        self._click_visible(self._normalized_point(menu_image, self.GAME_EXIT_POINT), menu_window, 0.6)
        confirm_capture = self._wait_for_visual_capture(
            lambda observed: self._result_screen_is_open(observed)
            or self._two_button_dialog_is_open(observed),
            timeout=2.0,
        )
        if confirm_capture is None:
            self.log("Tiantian's exit confirmation did not visually open; refusing to click an unverified dialog.")
            return False
        confirm_image, confirm_window = confirm_capture
        if self._result_screen_is_open(confirm_image):
            self.log("Tiantian's result screen replaced the game before exit confirmation.")
            self._leave_result_screen(confirm_image, confirm_window)
            return True
        self.log("Confirming exit from the current Tiantian game.")
        dialog_points = self._two_button_dialog_points(confirm_image)
        if dialog_points is None:
            self.log("Tiantian's exit dialog disappeared before its action could be located.")
            return True
        self._click_visible(dialog_points[1], confirm_window, 0.8)
        return True

    def _wait_for_visual_capture(
        self,
        predicate: Callable[[np.ndarray], bool],
        timeout: float,
    ) -> tuple[np.ndarray, WindowInfo] | None:
        deadline = time.monotonic() + timeout
        while True:
            self._check_stop()
            image, window = self._capture()
            if predicate(image):
                return image, window
            if time.monotonic() >= deadline:
                return None
            time.sleep(0.12)

    @staticmethod
    def _game_menu_is_open(image: np.ndarray) -> bool:
        """Recognize the fixed dark menu panel without reading its text."""
        height, width = image.shape[:2]
        panel = image[
            round(height * 0.55) : round(height * 0.81),
            round(width * 0.06) : round(width * 0.42),
        ]
        if panel.size == 0:
            return False
        gray = cv2.cvtColor(panel, cv2.COLOR_BGR2GRAY)
        return float(gray.mean()) < 110.0 and float(np.mean(gray < 115)) > 0.82

    @staticmethod
    def _two_button_dialog_points(
        image: np.ndarray,
    ) -> tuple[tuple[float, float], tuple[float, float]] | None:
        """Locate the modal actions without assuming the window chrome size.

        Tiantian captures can include a title bar and right tool strip that are
        absent from screenshots exported by the app.  The red rounded action is
        therefore found in pixel space and verified against the bright paper
        body above it.  The paired left action has fixed geometry relative to
        that detected control.
        """
        height, width = image.shape[:2]
        if height < 100 or width < 100:
            return None
        blue, green, red = (channel.astype(np.int16) for channel in cv2.split(image))
        red_action = (
            (red - green > 40)
            & (red > 130)
            & (green < 165)
            & (blue < 145)
        ).astype(np.uint8) * 255
        close_kernel = np.ones(
            (max(3, round(height * 0.006)), max(5, round(width * 0.025))),
            dtype=np.uint8,
        )
        red_action = cv2.morphologyEx(red_action, cv2.MORPH_CLOSE, close_kernel)
        red_action = cv2.morphologyEx(
            red_action,
            cv2.MORPH_OPEN,
            np.ones((3, 5), dtype=np.uint8),
        )
        contours, _hierarchy = cv2.findContours(
            red_action,
            cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_SIMPLE,
        )
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        candidates: list[tuple[float, tuple[float, float], tuple[float, float]]] = []
        for contour in contours:
            x, y, button_width, button_height = cv2.boundingRect(contour)
            aspect = button_width / max(1, button_height)
            if not (
                width * 0.15 <= button_width <= width * 0.45
                and height * 0.02 <= button_height <= height * 0.12
                and 2.0 <= aspect <= 5.5
            ):
                continue
            paper_x1 = max(0, round(x - 1.3 * button_width))
            paper_x2 = min(width, round(x + 0.7 * button_width))
            paper_y1 = max(0, round(y - 3.6 * button_height))
            paper_y2 = max(0, round(y - 0.7 * button_height))
            paper = gray[paper_y1:paper_y2, paper_x1:paper_x2]
            if (
                paper.size == 0
                or float(paper.mean()) <= 190.0
                or float(np.mean(paper > 180)) <= 0.70
            ):
                continue
            right = (x + button_width / 2.0, y + button_height / 2.0)
            left = (right[0] - 1.215 * button_width, right[1])
            if left[0] <= 0:
                continue
            score = float(cv2.contourArea(contour))
            candidates.append((score, left, right))
        if not candidates:
            return None
        _score, left, right = max(candidates, key=lambda item: item[0])
        return left, right

    @staticmethod
    def _two_button_dialog_is_open(image: np.ndarray) -> bool:
        if image.size == 0:
            return False
        return TiantianController._two_button_dialog_points(image) is not None

    @staticmethod
    def _setup_screen_is_open(image: np.ndarray) -> bool:
        """Recognize the fixed setup screen by its large bright Start control."""
        if TiantianController._result_screen_is_open(image):
            return False
        height, width = image.shape[:2]
        button = image[
            round(height * 0.89) : round(height * 0.96),
            round(width * 0.12) : round(width * 0.82),
        ]
        if button.size == 0:
            return False
        gray = cv2.cvtColor(button, cv2.COLOR_BGR2GRAY)
        return float(gray.mean()) > 155.0 and float(np.mean(gray > 160)) > 0.55

    @staticmethod
    def _result_screen_is_open(image: np.ndarray) -> bool:
        """Recognize the fixed result screen by its paired bright action rows."""
        height, width = image.shape[:2]

        def bright_fraction(x1: float, x2: float) -> float:
            region = image[
                round(height * 0.81) : round(height * 0.89),
                round(width * x1) : round(width * x2),
            ]
            if region.size == 0:
                return 0.0
            gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
            return float(np.mean(gray > 150))

        return bright_fraction(0.07, 0.45) > 0.45 and bright_fraction(0.53, 0.93) > 0.45

    @staticmethod
    def _declared_result(image: np.ndarray) -> str | None:
        """Read Tiantian's fixed result badge by color, without OCR.

        The central calligraphic badge is red 胜, green 和, or blue 负 from
        the human/Lixiangqi perspective. Its position is bounded relative to
        the captured window but tolerates Tiantian's optional title and tool
        chrome. Shape constraints exclude the player portraits and score text.
        """
        if image.size == 0:
            return None
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        hue, saturation, value = cv2.split(hsv)
        height, width = hue.shape
        color_masks = {
            "win": (hue <= 10) | (hue >= 170),
            "draw": (hue >= 28) & (hue <= 75),
            "loss": (hue >= 95) & (hue <= 145),
        }
        candidates: list[tuple[float, str]] = []
        for result, color_mask in color_masks.items():
            mask = (
                color_mask
                & (saturation > 70)
                & (value > 70)
            ).astype(np.uint8) * 255
            mask = cv2.morphologyEx(
                mask,
                cv2.MORPH_CLOSE,
                np.ones(
                    (max(3, round(height * 0.005)), max(3, round(width * 0.010))),
                    dtype=np.uint8,
                ),
            )
            contours, _hierarchy = cv2.findContours(
                mask,
                cv2.RETR_EXTERNAL,
                cv2.CHAIN_APPROX_SIMPLE,
            )
            for contour in contours:
                x, y, badge_width, badge_height = cv2.boundingRect(contour)
                center_x = x + badge_width / 2.0
                center_y = y + badge_height / 2.0
                aspect = badge_width / max(1, badge_height)
                if not (
                    width * 0.05 <= badge_width <= width * 0.18
                    and height * 0.025 <= badge_height <= height * 0.10
                    and 0.50 <= aspect <= 1.60
                    and width * 0.25 <= center_x <= width * 0.60
                    and height * 0.07 <= center_y <= height * 0.23
                ):
                    continue
                candidates.append((float(cv2.contourArea(contour)), result))
        if not candidates:
            return None
        return max(candidates, key=lambda item: item[0])[1]

    def _detect_unobscured_board(
        self,
        image: np.ndarray,
    ) -> tuple[tuple[int, int, int, int], list[float], list[float]]:
        if self._two_button_dialog_is_open(image):
            raise RuntimeError("A fixed-theme modal dialog is obscuring the board.")
        return self.recognizer.detect_board(image)

    def _recognize_unobscured_board(self, image: np.ndarray) -> BoardState:
        if self._two_button_dialog_is_open(image):
            raise RuntimeError("A fixed-theme modal dialog is obscuring the board.")
        return self.recognizer.recognize_board(image)

    def _recognize_transition_board(self, reference: BoardState, image: np.ndarray) -> BoardState:
        if self._two_button_dialog_is_open(image):
            raise RuntimeError("A fixed-theme modal dialog is obscuring the board.")
        return self.recognizer.recognize_transition_board(reference, image)

    def _ensure_setup_screen(self) -> None:
        try:
            image, _window = self._capture()
            if self._two_button_dialog_is_open(image):
                self.return_to_setup()
                return
            if self._setup_screen_is_open(image):
                return
        except Exception:
            pass
        self.return_to_setup()

    def _set_level(self, level: int) -> None:
        if level not in TIANTIAN_LEVELS:
            raise ValueError(f"Unsupported Tiantian level: {level}")
        index = TIANTIAN_LEVELS.index(level)
        image, window = self._capture()
        if level == TIANTIAN_LEVELS[-1]:
            # Tiantian implements difficulty as a custom drag-only control: a
            # click or keyboard End leaves the thumb unchanged. Detect the
            # green selected thumb, drag it physically to the final stop, then
            # verify its new position before a game can be recorded.
            start = self._find_level_slider_thumb(image)
            if start is None:
                raise RuntimeError(
                    "Could not visually locate Tiantian's green difficulty slider thumb; "
                    "refusing to start or record an unverified Level 25 game."
                )
            if start[0] >= image.shape[1] * 0.82:
                self.log(
                    f"Tiantian level 25 already visually verified at slider x={start[0]:.0f}; "
                    "no additional drag is needed."
                )
                return
            end = (image.shape[1] * self.LEVEL_SLIDER_END_X, start[1])
            self._drag_visible(start, end, window, 0.65)
            selected, _selected_window = self._capture()
            selected_thumb = self._find_level_slider_thumb(selected)
            if (
                selected_thumb is None
                or selected_thumb[0] < selected.shape[1] * 0.82
                or selected_thumb[0] - start[0] < selected.shape[1] * 0.20
            ):
                raise RuntimeError(
                    "Tiantian Level 25 slider did not reach its visually verified rightmost stop; "
                    "refusing to start or record a mislabeled calibration game."
                )
            self.log(
                f"Tiantian level 25 visually verified at slider x={selected_thumb[0]:.0f} "
                f"after dragging from x={start[0]:.0f}."
            )
            return
        x = self.LEVEL_SLIDER_START_X + (0.61 * index / (len(TIANTIAN_LEVELS) - 1))
        self._click_visible((image.shape[1] * x, image.shape[0] * self.LEVEL_SLIDER_Y), window, 0.3)
        self.log(f"Tiantian level {level} selected at its calibrated fixed-theme slider stop.")

    @staticmethod
    def _find_level_slider_thumb(image: np.ndarray) -> tuple[float, float] | None:
        if image.size == 0:
            return None
        height, width = image.shape[:2]
        x1, x2 = int(width * 0.18), int(width * 0.94)
        y1, y2 = int(height * 0.17), int(height * 0.35)
        crop = image[y1:y2, x1:x2]
        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        green = cv2.inRange(hsv, (35, 20, 50), (95, 255, 255))
        count, _labels, stats, centers = cv2.connectedComponentsWithStats(green)
        candidates: list[tuple[int, float, float]] = []
        for component in range(1, count):
            local_x, local_y, component_width, component_height, area = stats[component]
            diameter = min(component_width, component_height)
            # At non-minimum levels, Tiantian fills the completed track green
            # and joins it to the circular thumb. The right edge of that long
            # component is the thumb's outer edge, so subtract its radius to
            # recover the selected stop center.
            if (
                area >= 300
                and component_width >= component_height * 2.0
                and diameter >= min(height, width) * 0.035
                and component_height <= min(height, width) * 0.13
            ):
                candidates.append(
                    (
                        int(area),
                        x1 + float(local_x + component_width - component_height / 2.0),
                        y1 + float(local_y + component_height / 2.0),
                    )
                )
                continue
            if (
                100 <= area <= 3000
                and diameter >= min(height, width) * 0.035
                and max(component_width, component_height) <= min(height, width) * 0.13
                and 0.65 <= component_width / max(component_height, 1) <= 1.45
            ):
                center_x, center_y = centers[component]
                candidates.append((int(area), x1 + float(center_x), y1 + float(center_y)))
        if not candidates:
            return None
        _area, center_x, center_y = max(candidates)
        return center_x, center_y

    def _set_computer_side(self, side: str) -> None:
        image, window = self._capture()
        point = self._normalized_point(image, self.COMPUTER_SIDE_POINTS[side])
        self._click_visible(point, window, 0.25)
        selected_image, selected_window = self._capture()
        selected = self._read_computer_side(selected_image)
        if selected != side:
            self.log(
                f"Computer-side toggle verification read {selected or 'unknown'} after requesting {side}; retrying once."
            )
            retry_point = self._normalized_point(selected_image, self.COMPUTER_SIDE_POINTS[side])
            self._click_visible(retry_point, selected_window, 0.3)
            selected_image, _selected_window = self._capture()
            selected = self._read_computer_side(selected_image)
        if selected != side:
            raise RuntimeError(
                f"Could not select Tiantian computer side {side}; visual toggle verification read {selected or 'unknown'}."
            )
        self.log(f"Tiantian computer side visually verified as {side}.")

    def _read_computer_side(self, image: np.ndarray) -> str | None:
        grayscale = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        def background_brightness(side: str) -> float:
            center_x, center_y = (
                int(round(value))
                for value in self._normalized_point(image, self.COMPUTER_SIDE_POINTS[side])
            )
            half_width = max(18, int(round(image.shape[1] * 0.064)))
            half_height = max(12, int(round(image.shape[0] * 0.019)))
            x1 = max(0, center_x - half_width)
            x2 = min(grayscale.shape[1], center_x + half_width + 1)
            y1 = max(0, center_y - half_height)
            y2 = min(grayscale.shape[0], center_y + half_height + 1)
            return float(np.median(grayscale[y1:y2, x1:x2]))

        red_brightness = background_brightness("red")
        black_brightness = background_brightness("black")
        if abs(red_brightness - black_brightness) < 20.0:
            return None
        return "red" if red_brightness < black_brightness else "black"

    def _wait_for_board(self, timeout: float, allow_unfinished_prompt: bool = True) -> BoardState:
        deadline = time.monotonic() + timeout
        last_error: Exception | None = None
        stable_key: tuple[object, ...] | None = None
        stable_since = 0.0
        initial_geometry: tuple[tuple[int, int, int, int], list[float], list[float]] | None = None
        geometry_announced = False
        stable_announced = False
        last_progress_log = 0.0
        prompt_dismissed = False
        while time.monotonic() < deadline:
            self._check_stop()
            capture_started = time.monotonic()
            image, window = self._capture()
            capture_elapsed = time.monotonic() - capture_started
            if capture_elapsed >= 2.0:
                self.log(f"Tiantian frame capture took {capture_elapsed:.2f}s; continuing with that frame.")
            try:
                if self._two_button_dialog_is_open(image):
                    if allow_unfinished_prompt and not prompt_dismissed:
                        self._dismiss_unfinished_game_prompt(image, window)
                        prompt_dismissed = True
                        deadline = max(deadline, time.monotonic() + timeout)
                        stable_key = None
                        stable_since = 0.0
                        initial_geometry = None
                    else:
                        last_error = RuntimeError("A fixed-theme modal dialog is obscuring the board.")
                    self.stop_event.wait(0.15)
                    continue
                if initial_geometry is None:
                    grid_started = time.monotonic()
                    initial_geometry = self._detect_unobscured_board(image)
                    grid_elapsed = time.monotonic() - grid_started
                    if grid_elapsed >= 2.0:
                        self.log(
                            f"Initial board grid detection took {grid_elapsed:.2f}s under system load."
                        )
                    if not geometry_announced:
                        self.log(
                            "Initial board grid detected; verifying the 32 canonical coin occupancies."
                        )
                        geometry_announced = True
                occupancy_started = time.monotonic()
                state = self.recognizer.recognize_initial_board(
                    image,
                    self.active_own_side,
                    initial_geometry,
                )
                occupancy_elapsed = time.monotonic() - occupancy_started
                if occupancy_elapsed >= 2.0:
                    self.log(
                        f"Initial board occupancy scan took {occupancy_elapsed:.2f}s under system load."
                    )
                self.preview(state.overlay_image)
                # A first move cannot capture from the standard position. Requiring
                # all 32 pieces avoids accepting a mid-animation frame.
                if len(state.pieces) == 32:
                    key: tuple[object, ...] = (
                        self.active_own_side,
                        tuple(sorted(self._position_signature(state).items())),
                    )
                    now = time.monotonic()
                    if key != stable_key:
                        stable_key = key
                        stable_since = now
                        # A wall-clock timeout may expire inside one capture or
                        # vision call when the machine is under heavy analysis
                        # load. Once a complete 32-coin observation exists,
                        # always permit the short second observation needed for
                        # animation safety instead of reporting a false timeout.
                        deadline = max(deadline, now + 1.0)
                        if not stable_announced:
                            self.log(
                                "Initial board occupancy verified at 32/32; waiting briefly for a stable frame."
                            )
                            stable_announced = True
                    elif now - stable_since >= 0.45:
                        return state
                else:
                    count = len(state.pieces)
                    last_error = RuntimeError(
                        f"opening occupancy contained {count} of 32 expected coins"
                    )
                    now = time.monotonic()
                    if now - last_progress_log >= 2.0:
                        self.log(
                            f"Waiting for initial board occupancy: {count}/32 coins detected; "
                            "retrying grid and animation verification."
                        )
                        last_progress_log = now
                    # A badly fitted grid produces very low occupancy. Refit it
                    # on the next fresh frame instead of burning the timeout on
                    # a cached false positive.
                    if count < 24:
                        initial_geometry = None
                    stable_key = None
                    stable_since = 0.0
                    stable_announced = False
            except RuntimeError as error:
                last_error = error
                initial_geometry = None
            self.stop_event.wait(0.15)
        raise RuntimeError(
            "Tiantian opening board did not become structurally verifiable: "
            f"{last_error or 'board occupancy was incomplete'}"
        )

    def _dismiss_unfinished_game_prompt(self, image: np.ndarray, window: WindowInfo) -> bool:
        self.log("Tiantian found an unfinished match; selecting New game for a clean calibration trial.")
        dialog_points = self._two_button_dialog_points(image)
        if dialog_points is None:
            raise RuntimeError("The unfinished-game dialog disappeared before New game could be located.")
        self._click_visible(dialog_points[0], window, 0.65)
        return True

    def _wait_for_move(
        self,
        previous: BoardState,
        expected_side: str,
        timeout: float,
        history: Sequence[str] = (),
    ) -> tuple[str, BoardState]:
        moves, state = self._wait_for_move_sequence(
            previous,
            expected_side,
            max_moves=1,
            timeout=timeout,
            history=history,
        )
        return moves[0], state

    def _execute_verified_move(
        self,
        selected: str,
        previous: BoardState,
        history: Sequence[str] = (),
    ) -> tuple[list[str], BoardState]:
        """Commit a GUI move only after vision proves its canonical transition.

        The first attempt clicks source then destination. If repeated settled
        observations still show the pre-click position, a destination-only
        retry safely completes a source selection whose first destination click
        was dropped. A final full click is allowed only after the board is again
        proven unchanged. Unknown or inconsistent positions are never retried
        and never advance the turn.
        """
        strategies = (
            (False, "source and destination"),
            (True, "destination only"),
            (False, "source and destination"),
        )
        last_error: Exception | None = None
        for attempt, (destination_only, _strategy) in enumerate(strategies, start=1):
            click_state = self._click_move(
                selected,
                previous,
                destination_only=destination_only,
            )
            confirmation_started = time.monotonic()
            try:
                moves, confirmed = self._wait_for_clicked_move(
                    click_state,
                    selected,
                    timeout=CLICK_CONFIRMATION_TIMEOUT,
                    history=history,
                )
                if attempt > 1:
                    self.log(f"Move {selected} was confirmed after click retry {attempt}/3.")
                self._log_confirmed_transition(
                    selected,
                    moves,
                    time.monotonic() - confirmation_started,
                )
                return moves, confirmed
            except MoveNotRegistered as error:
                last_error = error
                if attempt < len(strategies):
                    # Close the race where the GUI accepts a click immediately
                    # after the first confirmation deadline. Re-observe before
                    # sending any additional input; a late legal transition is
                    # committed, while an unknown transition still aborts.
                    try:
                        confirmation_started = time.monotonic()
                        moves, confirmed = self._wait_for_clicked_move(
                            click_state,
                            selected,
                            timeout=CLICK_RETRY_GRACE_TIMEOUT,
                            history=history,
                        )
                        self.log(f"Move {selected} was confirmed during the pre-retry board check.")
                        self._log_confirmed_transition(
                            selected,
                            moves,
                            time.monotonic() - confirmation_started,
                        )
                        return moves, confirmed
                    except MoveNotRegistered:
                        pass
                    self.log(
                        f"Move {selected} was not registered after attempt {attempt}/3; "
                        f"retrying with {strategies[attempt][1]}."
                    )
        raise RuntimeError(
            f"Tiantian did not register move {selected} after three verified click attempts: "
            f"{last_error or 'board remained unchanged'}"
        )

    def _log_confirmed_transition(
        self,
        selected: str,
        moves: Sequence[str],
        elapsed: float,
    ) -> None:
        if len(moves) == 1:
            self.log(
                f"Move {selected} confirmed on the board in {elapsed:.3f}s; "
                "it is now Tiantian's turn."
            )
        else:
            timing = getattr(self, "_last_transition_timing", None)
            timing_text = ""
            if timing is not None:
                first_seen, confirmed = timing
                timing_text = (
                    f" First legal reply candidate appeared {first_seen:.3f}s after our click; "
                    f"stable confirmation completed at {confirmed:.3f}s."
                )
            self.log(
                f"Move {selected} and Tiantian's fast reply {moves[1]} were both "
                f"confirmed on the board in {elapsed:.3f}s after our click."
                + timing_text
            )

    def _wait_for_clicked_move(
        self,
        previous: BoardState,
        selected: str,
        timeout: float,
        history: Sequence[str] = (),
    ) -> tuple[list[str], BoardState]:
        """Verify the known click, optionally followed by one very fast Tiantian reply."""
        _own_record, after_own = self.recognizer.state_after_known_move(
            previous,
            selected,
            self.active_own_side,
        )
        previous_map = self._position_signature(previous)
        reply_side = "black" if self.active_own_side == "red" else "red"
        wait_started = time.monotonic()
        self._last_transition_timing: tuple[float, float] | None = None
        deadline = time.monotonic() + timeout
        last_error: Exception | None = None
        pending: tuple[str, ...] | None = None
        pending_since = 0.0
        confirmations = 0
        observations = 0
        post_deadline_observations = 0
        unchanged_since: float | None = None
        nonboard_signature: np.ndarray | None = None
        nonboard_confirmations = 0
        result_confirmations = 0
        result_declaration: str | None = None
        diagnostic_frames: deque[tuple[np.ndarray, str, dict[str, str] | None]] = deque(maxlen=8)
        while True:
            iteration_started = time.monotonic()
            after_deadline = iteration_started >= deadline
            needs_minimum_sample = observations < MOVE_CONFIRMATION_FRAMES
            confirming_late_candidate = (
                pending is not None
                and confirmations < MOVE_CONFIRMATION_FRAMES
                and post_deadline_observations < MOVE_CONFIRMATION_FRAMES
            )
            if after_deadline and not needs_minimum_sample and not confirming_late_candidate:
                break
            if after_deadline:
                post_deadline_observations += 1
            self._check_stop()
            image, _window = self._capture()
            observations += 1
            if self._result_screen_is_open(image):
                diagnostic_frames.append((image.copy(), "result screen", None))
                declared_result = self._declared_result(image)
                if (
                    result_confirmations
                    and declared_result is not None
                    and result_declaration is not None
                    and declared_result != result_declaration
                ):
                    result_confirmations = 1
                else:
                    result_confirmations += 1
                if declared_result is not None:
                    result_declaration = declared_result
                if result_confirmations >= 2:
                    result_moves = pending
                    if result_moves is None:
                        result_moves = self._moves_from_result_miniature(
                            previous,
                            after_own,
                            selected,
                            reply_side,
                            image,
                        )
                    if result_moves is None and result_declaration is not None:
                        # The full-size board was verified immediately before
                        # this legal click. An explicit result appearing in
                        # response proves that Tiantian accepted the move even
                        # when its animated miniature cannot be reconstructed.
                        result_moves = (selected,)
                        self.log(
                            "Tiantian explicitly declared the result immediately after the verified "
                            "click; recording that legal move despite an unreadable result miniature."
                        )
                    if result_moves is not None:
                        if not result_moves:
                            self.log(
                                "Tiantian declared a result without registering the attempted move; "
                                "the miniature board confirmed the already-tracked position."
                            )
                            raise self._finished_from_current_position(
                                history,
                                declared_result=result_declaration,
                            )
                        if pending is None:
                            self.log(
                                "Tiantian replaced the animating live board with its result screen; "
                                "the miniature board confirmed the final canonical move sequence."
                            )
                        raise self._finished_from_observed_moves(
                            history,
                            result_moves,
                            declared_result=result_declaration,
                        )
                self.stop_event.wait(MOVE_POLL_INTERVAL)
                continue
            current: BoardState | None = None
            result_confirmations = 0
            result_declaration = None
            try:
                current = self._recognize_transition_board(previous, image)
                nonboard_signature = None
                nonboard_confirmations = 0
                self.preview(current.overlay_image)
                current_map = self._position_signature(current)
                if current_map == previous_map:
                    diagnostic_frames.append((current.overlay_image.copy(), "unchanged", current_map))
                    raise NoBoardChangeError(f"Tiantian has not registered clicked move {selected} yet.")
                canonical = self.recognizer.reconcile_expected_position(after_own, current, image)
                if canonical is not None:
                    observed = (selected,)
                    diagnostic_frames.append((current.overlay_image.copy(), "own-move candidate", current_map))
                else:
                    reply, canonical = self.recognizer.detect_exact_move_resilient(
                        after_own,
                        current,
                        expected_side=reply_side,
                        image=image,
                    )
                    observed = (selected, reply.src + reply.dst)
                    diagnostic_frames.append(
                        (current.overlay_image.copy(), "own-move plus reply candidate", current_map)
                    )
                unchanged_since = None
                now = time.monotonic()
                if observed == pending:
                    confirmations += 1
                else:
                    pending = observed
                    pending_since = now
                    confirmations = 1
                if (
                    confirmations >= MOVE_CONFIRMATION_FRAMES
                    and now - pending_since >= TRANSITION_CONFIRMATION_SECONDS
                ):
                    if len(observed) == 2:
                        self._last_transition_timing = (
                            pending_since - wait_started,
                            now - wait_started,
                        )
                    return list(observed), canonical
            except NoBoardChangeError as error:
                last_error = error
                now = time.monotonic()
                pending = None
                confirmations = 0
                if unchanged_since is None:
                    unchanged_since = now
                if now - unchanged_since >= UNCHANGED_CONFIRMATION_SECONDS:
                    raise MoveNotRegistered(
                        f"settled vision continuously showed the unchanged position after clicking {selected}"
                    )
            except MoveDetectionError as error:
                last_error = error
                observed_map = self._position_signature(current) if current is not None else None
                diagnostic_image = current.overlay_image if current is not None else image
                diagnostic_frames.append((diagnostic_image.copy(), f"invalid: {error}", observed_map))
                pending = None
                confirmations = 0
                unchanged_since = None
            except RuntimeError as error:
                last_error = error
                diagnostic_frames.append((image.copy(), f"recognition error: {error}", None))
                unchanged_since = None
                try:
                    self._detect_unobscured_board(image)
                except RuntimeError:
                    signature = self._screen_fingerprint(image)
                    if nonboard_signature is not None and self._fingerprints_match(
                        signature,
                        nonboard_signature,
                    ):
                        nonboard_confirmations += 1
                    else:
                        nonboard_signature = signature
                        nonboard_confirmations = 1
                    if pending is not None and nonboard_confirmations >= 2:
                        raise self._finished_from_observed_moves(history, pending)
                else:
                    pending = None
                    confirmations = 0
                    nonboard_signature = None
                    nonboard_confirmations = 0
            self.stop_event.wait(MOVE_POLL_INTERVAL)
        if unchanged_since is not None and time.monotonic() - unchanged_since >= UNCHANGED_CONFIRMATION_SECONDS:
            raise MoveNotRegistered(
                f"settled vision continuously showed the unchanged position after clicking {selected}"
            )
        diagnostic_path = self._save_transition_diagnostics(
            selected,
            previous,
            after_own,
            diagnostic_frames,
            last_error,
            history=history,
        )
        diagnostic_note = f" Diagnostic evidence: {diagnostic_path}" if diagnostic_path else ""
        error_detail = str(last_error or "no board change").rstrip()
        if not error_detail.endswith("."):
            error_detail += "."
        raise RuntimeError(
            f"Clicked {selected}, but Tiantian never produced a stable, structurally valid transition: "
            f"{error_detail}{diagnostic_note}"
        )

    def _moves_from_result_miniature(
        self,
        previous: BoardState,
        after_own: BoardState,
        selected: str,
        reply_side: str,
        image: np.ndarray,
    ) -> tuple[str, ...] | None:
        """Recover a final move hidden by the live-board-to-result transition.

        Tiantian can replace the board while a long sliding piece is still
        visually between intersections. The stable result layout contains a
        complete miniature of the final position, so use that independent
        structural evidence instead of requiring a settled full-size frame.
        """
        try:
            result_state = self.recognizer.recognize_board(image)
        except RuntimeError:
            return None
        result_map = self._position_signature(result_state)
        if result_map == self._position_signature(after_own):
            return (selected,)
        if result_map == self._position_signature(previous):
            # Tiantian may adjudicate its move-count, repetition, perpetual-
            # check, or dead-position rule before the attempted click lands.
            # An empty tuple is positive structural evidence that history is
            # already complete; None remains "miniature could not be proved."
            return ()
        try:
            reply, _canonical = self.recognizer.detect_exact_move_from_state(
                after_own,
                result_state,
                expected_side=reply_side,
            )
        except (MoveDetectionError, RuntimeError):
            return None
        return selected, reply.src + reply.dst

    def _save_transition_diagnostics(
        self,
        selected: str,
        previous: BoardState,
        expected: BoardState,
        frames: Sequence[tuple[np.ndarray, str, dict[str, str] | None]],
        error: Exception | None,
        *,
        history: Sequence[str] = (),
    ) -> Path | None:
        """Persist a forensic bundle without masking the original game error."""
        directory = getattr(self, "diagnostic_dir", None)
        if directory is None or not frames:
            return None
        try:
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S_%fZ")
            bundle = Path(directory) / f"{stamp}_{selected}"
            bundle.mkdir(parents=True, exist_ok=False)
            labels: list[dict[str, object]] = []
            for index, (frame, label, observed_map) in enumerate(frames):
                name = f"frame_{index:02d}.jpg"
                if not cv2.imwrite(str(bundle / name), frame):
                    raise RuntimeError(f"OpenCV could not write {name}")
                labels.append(
                    {
                        "frame": name,
                        "observation": label,
                        "observedOccupancy": observed_map,
                    }
                )
            metadata = {
                "selectedMove": selected,
                "ownSide": self.active_own_side,
                "confirmedHistory": list(history),
                "error": str(error) if error is not None else None,
                "previousOccupancy": self._position_signature(previous),
                "expectedOccupancy": self._position_signature(expected),
                "frames": labels,
            }
            (bundle / "metadata.json").write_text(
                json.dumps(metadata, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            self.log(f"Saved transition diagnostic bundle to {bundle}.")
            return bundle
        except Exception as diagnostic_error:
            self.log(f"Could not save transition diagnostics: {diagnostic_error}")
            return None

    def _wait_for_move_sequence(
        self,
        previous: BoardState,
        expected_side: str,
        max_moves: int,
        timeout: float,
        history: Sequence[str] = (),
    ) -> tuple[list[str], BoardState]:
        deadline = time.monotonic() + timeout
        last_error: Exception | None = None
        pending: tuple[str, ...] | None = None
        pending_since = 0.0
        confirmations = 0
        observations = 0
        post_deadline_observations = 0
        nonboard_signature: np.ndarray | None = None
        nonboard_confirmations = 0
        result_confirmations = 0
        result_declaration: str | None = None
        while True:
            iteration_started = time.monotonic()
            after_deadline = iteration_started >= deadline
            needs_minimum_sample = observations < MOVE_CONFIRMATION_FRAMES
            confirming_late_candidate = (
                pending is not None
                and confirmations < MOVE_CONFIRMATION_FRAMES
                and post_deadline_observations < MOVE_CONFIRMATION_FRAMES
            )
            if after_deadline and not needs_minimum_sample and not confirming_late_candidate:
                break
            if after_deadline:
                post_deadline_observations += 1
            self._check_stop()
            image, _window = self._capture()
            observations += 1
            if self._result_screen_is_open(image):
                declared_result = self._declared_result(image)
                if (
                    result_confirmations
                    and declared_result is not None
                    and result_declaration is not None
                    and declared_result != result_declaration
                ):
                    result_confirmations = 1
                else:
                    result_confirmations += 1
                if declared_result is not None:
                    result_declaration = declared_result
                if result_confirmations >= 2:
                    if pending is not None:
                        raise self._finished_from_observed_moves(
                            history,
                            pending,
                            declared_result=result_declaration,
                        )
                    self.log(
                        "Tiantian ended the game without making another board move; "
                        "adjudicating the already-tracked canonical position."
                    )
                    raise self._finished_from_current_position(
                        history,
                        declared_result=result_declaration,
                    )
                self.stop_event.wait(MOVE_POLL_INTERVAL)
                continue
            result_confirmations = 0
            result_declaration = None
            try:
                current = self._recognize_transition_board(previous, image)
                nonboard_signature = None
                nonboard_confirmations = 0
                if max_moves == 1:
                    record, current = self.recognizer.detect_exact_move_resilient(
                        previous,
                        current,
                        expected_side=expected_side,
                        image=image,
                    )
                    records = [record]
                else:
                    records, current = self.recognizer.detect_move_sequence_from_state(
                        previous,
                        current,
                        max_moves=max_moves,
                        expected_side=expected_side,
                    )
                self.preview(current.overlay_image)
                observed = tuple(record.src + record.dst for record in records)
                now = time.monotonic()
                if observed == pending:
                    confirmations += 1
                else:
                    pending = observed
                    pending_since = now
                    confirmations = 1
                if (
                    confirmations >= MOVE_CONFIRMATION_FRAMES
                    and now - pending_since >= TRANSITION_CONFIRMATION_SECONDS
                ):
                    return list(observed), current
            except NoBoardChangeError:
                pending = None
                confirmations = 0
            except MoveDetectionError as error:
                pending = None
                confirmations = 0
                last_error = error
            except RuntimeError as error:
                last_error = error
                try:
                    self._detect_unobscured_board(image)
                except RuntimeError:
                    signature = self._screen_fingerprint(image)
                    if nonboard_signature is not None and self._fingerprints_match(
                        signature,
                        nonboard_signature,
                    ):
                        nonboard_confirmations += 1
                    else:
                        nonboard_signature = signature
                        nonboard_confirmations = 1
                    if nonboard_confirmations >= 2:
                        if pending is not None:
                            raise self._finished_from_observed_moves(history, pending)
                else:
                    pending = None
                    confirmations = 0
                    nonboard_signature = None
                    nonboard_confirmations = 0
            self.stop_event.wait(MOVE_POLL_INTERVAL)
        raise RuntimeError(f"Timed out waiting for {expected_side}'s move: {last_error or 'no board change'}")

    def _click_move(self, move: str, state: BoardState, destination_only: bool = False) -> BoardState:
        expected_signature = self._position_signature(state)
        image: np.ndarray | None = None
        window: WindowInfo | None = None
        current: BoardState | None = None
        observed_signature: dict[str, str] = {}
        for attempt in range(PRECLICK_VERIFICATION_FRAMES):
            image, window = self._capture()
            try:
                # In-game coordinates and orientation belong to canonical move
                # history. Full-board recognition independently remaps the
                # physical grid and can invert or relabel a Black-bottom board.
                # The reference-aware transition observer preserves the exact
                # logical coordinate system used by the engine and clicker.
                observed = self._recognize_transition_board(state, image)
            except RuntimeError as error:
                if attempt == PRECLICK_VERIFICATION_FRAMES - 1:
                    raise RuntimeError(
                        "The board disappeared before Lixiangqi could click its move."
                    ) from error
                self._check_stop()
                self.stop_event.wait(0.10)
                continue
            self.preview(observed.overlay_image)
            observed_signature = self._position_signature(observed)
            if observed_signature == expected_signature:
                current = observed
                break
            reconciled = self.recognizer.reconcile_expected_position(state, observed, image)
            if reconciled is not None:
                current = reconciled
                self.log(
                    "Pre-click board verification repaired a transient piece-classification miss."
                )
                break
            if attempt < PRECLICK_VERIFICATION_FRAMES - 1:
                self._check_stop()
                self.stop_event.wait(0.10)
        if current is None or image is None or window is None:
            missing = sorted(set(expected_signature) - set(observed_signature))
            unexpected = sorted(set(observed_signature) - set(expected_signature))
            changed_side = sorted(
                coord for coord in set(expected_signature) & set(observed_signature)
                if expected_signature[coord] != observed_signature[coord]
            )
            raise RuntimeError(
                "The Tiantian board persistently differed from the tracked position across "
                f"{PRECLICK_VERIFICATION_FRAMES} pre-click frames. Refusing stale coordinates. "
                f"Missing={missing or 'none'}, unexpected={unexpected or 'none'}, "
                f"side changes={changed_side or 'none'}."
            )
        source = current.pieces.get(move[:2])
        if source is None:
            raise RuntimeError(f"Cannot click {move}: vision sees an empty source square {move[:2]}.")
        if source.side != self.active_own_side:
            raise RuntimeError(
                f"Cannot click {move}: vision sees {source.side}'s {source.piece_type} on source square {move[:2]}, "
                f"not a {self.active_own_side} piece. The recorded move history is out of sync."
            )
        _record, _expected = self.recognizer.state_after_known_move(state, move, self.active_own_side)
        canonical = self.recognizer.refresh_state_image(state, image)
        if not destination_only:
            self._click_visible(self._physical_point(current, move[:2]), window, 0.06)
        self._click_visible(self._physical_point(current, move[2:]), window, 0.04)
        return canonical

    def _physical_point(self, state: BoardState, coord: str) -> tuple[float, float]:
        col = FILE_LETTERS.index(coord[0])
        row = int(coord[1])
        flipped = self._is_flipped(state)
        physical_col = 8 - col if flipped else col
        physical_row = row if flipped else 9 - row
        return state.grid_x[physical_col], state.grid_y[physical_row]

    @staticmethod
    def _is_flipped(state: BoardState) -> bool:
        normal_error = 0.0
        flipped_error = 0.0
        for piece in state.pieces.values():
            physical_col = min(range(9), key=lambda index: abs(state.grid_x[index] - piece.center[0]))
            physical_row = min(range(10), key=lambda index: abs(state.grid_y[index] - piece.center[1]))
            normal_error += abs(physical_col - piece.col) + abs(physical_row - (9 - piece.row))
            flipped_error += abs(physical_col - (8 - piece.col)) + abs(physical_row - piece.row)
        return flipped_error < normal_error

    def _starting_state_like(self, state: BoardState) -> BoardState:
        step = float((np.median(np.diff(state.grid_x)) + np.median(np.diff(state.grid_y))) / 2.0)
        pieces: dict[str, DetectedPiece] = {}
        for coord, (side, piece_type) in START_POSITION_MAP.items():
            col = FILE_LETTERS.index(coord[0])
            row = int(coord[1])
            pieces[coord] = DetectedPiece(
                side=side,
                piece_type=piece_type,
                col=col,
                row=row,
                center=self._physical_point(state, coord),
                radius=step * 0.44,
                confidence=1.0,
            )
        overlay = self.recognizer.fixed_vision.draw_overlay(
            state.source_image if state.source_image is not None else state.overlay_image,
            state.board_bbox,
            state.grid_x,
            state.grid_y,
            pieces,
        )
        return BoardState(pieces, state.board_bbox, state.grid_x, state.grid_y, overlay, [], [], None)

    @staticmethod
    def _position_signature(state: BoardState) -> dict[str, str]:
        """Canonical-transition evidence: occupied square and piece colour only."""
        return {coord: piece.side for coord, piece in state.pieces.items()}

    @staticmethod
    def _bottom_side(state: BoardState) -> str:
        centers = {
            side: [piece.center[1] for piece in state.pieces.values() if piece.side == side]
            for side in ("red", "black")
        }
        if not centers["red"] or not centers["black"]:
            raise RuntimeError("Could not determine which side is at the bottom of the Tiantian board.")
        return max(centers, key=lambda side: float(np.median(centers[side])))

    def _finished_from_observed_moves(
        self,
        history: Sequence[str],
        observed: Sequence[str],
        *,
        declared_result: str | None = None,
    ) -> GameFinished:
        """Infer a fixed-layout result from canonical rules, never screen text.

        The result layout is accepted only after a legal transition candidate
        was seen and then two stable non-board frames replaced the board. If the
        canonical successor has no legal replies, the last mover won. Otherwise
        Tiantian ended a position that still has legal play, which is its draw
        adjudication (repetition, no-change, or dead position).
        """
        completed = list(history) + list(observed)
        if not observed:
            raise RuntimeError("Tiantian showed a result layout before vision captured the final move.")
        if declared_result in {"win", "draw", "loss"}:
            return GameFinished(
                declared_result,
                f"Tiantian explicitly declared {declared_result} on its fixed result badge",
                observed,
            )
        legal = self.engine.legal_moves(completed)
        if legal:
            result = "draw"
            reason = "Tiantian fixed-layout draw adjudication"
        else:
            last_side = "red" if len(completed) % 2 == 1 else "black"
            result = "win" if last_side == self.active_own_side else "loss"
            reason = "canonical no-legal-reply result confirmed by Tiantian's fixed result layout"
        return GameFinished(result, reason, observed)

    def _finished_from_current_position(
        self,
        history: Sequence[str],
        *,
        declared_result: str | None = None,
    ) -> GameFinished:
        """Adjudicate a stable result that appeared without one more board move."""
        if declared_result in {"win", "draw", "loss"}:
            return GameFinished(
                declared_result,
                f"Tiantian explicitly declared {declared_result} on its fixed result badge",
                (),
            )
        legal = self.engine.legal_moves(list(history))
        if legal:
            return GameFinished(
                "draw",
                "Tiantian fixed-layout draw adjudication on the tracked position",
                (),
            )
        if not history:
            raise RuntimeError("Tiantian showed a terminal result before any canonical move existed.")
        last_side = "red" if len(history) % 2 == 1 else "black"
        result = "win" if last_side == self.active_own_side else "loss"
        return GameFinished(
            result,
            "canonical no-legal-reply result confirmed by Tiantian's fixed result layout",
            (),
        )

    def _capture(self) -> tuple[np.ndarray, WindowInfo]:
        image, window = self.recognizer.capture_window()
        if window is None:
            raise RuntimeError("Live Tiantian window capture did not return window metadata.")
        return image, window

    @staticmethod
    def _normalized_point(
        image: np.ndarray,
        point: tuple[float, float],
    ) -> tuple[float, float]:
        return image.shape[1] * point[0], image.shape[0] * point[1]

    def _click_normalized(self, point: tuple[float, float], after: float) -> None:
        image, window = self._capture()
        self._click_visible(self._normalized_point(image, point), window, after)

    @staticmethod
    def _screen_fingerprint(image: np.ndarray) -> np.ndarray:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        return cv2.resize(gray, (32, 48), interpolation=cv2.INTER_AREA)

    @staticmethod
    def _fingerprints_match(first: np.ndarray, second: np.ndarray) -> bool:
        if first.shape != second.shape:
            return False
        return float(cv2.absdiff(first, second).mean()) <= 3.5

    def _click_visible(self, point: tuple[float, float], window: WindowInfo, after: float) -> None:
        # A fresh optimizer process may capture Tiantian while another window
        # still owns focus.  Without this foreground handoff, Windows consumes
        # the first physical click as activation and the intended control never
        # receives it.
        self.automator._bring_to_front(window)
        self.automator.click_visible_point(point, window, after=after)

    def _drag_visible(
        self,
        start: tuple[float, float],
        end: tuple[float, float],
        window: WindowInfo,
        duration: float,
    ) -> None:
        self.automator._bring_to_front(window)
        self.automator.drag_visible_point(start, end, window, duration=duration)

    def _check_stop(self) -> None:
        if self.stop_event.is_set():
            raise CalibrationStopped("Calibration stopped by user.")
