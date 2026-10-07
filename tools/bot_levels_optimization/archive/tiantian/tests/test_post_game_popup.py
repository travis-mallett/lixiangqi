from pathlib import Path
import unittest
from unittest.mock import Mock

from bot_level_calibrator.controller import TiantianController
from bot_level_calibrator.models import WindowInfo
from bot_level_calibrator.runtime import cv2, np


class PostGamePopupTests(unittest.TestCase):
    def fixture(self, name):
        image = cv2.imread(str(Path(__file__).parent / "fixtures" / name))
        self.assertIsNotNone(image)
        return image

    def test_close_cross_with_scale_and_window_chrome(self):
        popup = self.fixture("tiantian-post-game-popup.png")
        for scale in (0.75, 1.0, 1.25):
            for chrome in (False, True):
                with self.subTest(scale=scale, chrome=chrome):
                    image = popup
                    if chrome:
                        image = cv2.copyMakeBorder(image, 50, 0, 0, 57, cv2.BORDER_CONSTANT, value=(230, 230, 230))
                    image = cv2.resize(image, None, fx=scale, fy=scale)
                    point = TiantianController._post_game_popup_close(image)
                    self.assertIsNotNone(point)
                    self.assertAlmostEqual(point[0], 734 * scale, delta=2)
                    self.assertAlmostEqual(point[1], (257 + (50 if chrome else 0)) * scale, delta=2)

    def test_no_click_on_setup_or_overlay_without_cross(self):
        setup = self.fixture("tiantian-level-one-setup.png")
        self.assertIsNone(TiantianController._post_game_popup_close(setup))
        popup = self.fixture("tiantian-post-game-popup.png")
        popup[235:280, 710:760] = 30
        self.assertIsNone(TiantianController._post_game_popup_close(popup))

    def controller(self, frames):
        controller = TiantianController.__new__(TiantianController)
        controller.recognizer = Mock()
        window = WindowInfo(1, "Tiantian", (100, 50, 900, 1470))
        controller.recognizer.capture_window.side_effect = [(frame, window) for frame in frames]
        controller._check_stop = Mock()
        controller._click_visible = Mock()
        controller.log = Mock()
        return controller, window

    def test_capture_closes_popup_and_returns_fresh_result_frame(self):
        popup = self.fixture("tiantian-post-game-popup.png")
        result = np.zeros_like(popup)
        controller, window = self.controller([popup, result])
        image, actual_window = controller._capture()
        self.assertIs(image, result)
        self.assertEqual(actual_window, window)
        controller._click_visible.assert_called_once_with((734.0, 257.0), window, 0.5)

    def test_failed_dismissal_does_not_return_obscured_results(self):
        popup = self.fixture("tiantian-post-game-popup.png")
        controller, _ = self.controller([popup, popup])
        with self.assertRaisesRegex(RuntimeError, "did not close"):
            controller._capture()
        controller._click_visible.assert_called_once()
