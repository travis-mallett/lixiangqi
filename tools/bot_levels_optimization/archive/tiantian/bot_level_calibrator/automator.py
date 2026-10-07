from __future__ import annotations

import ctypes
import math
import time
from itertools import combinations
from typing import Callable, Sequence

from .constants import EDITOR_PALETTE_ORDER, FILE_LETTERS, START_POSITION_MAP, UI_TEXT_ALIASES
from .models import (
    ActionIcon,
    BoardState,
    DetectedPiece,
    MoveRecord,
    OcrTextMatch,
    PieceToken,
    TtxqAutomationError,
    WindowInfo,
)
from .notation import _normalize_ui_text, validate_notation_game
from .platform import _make_process_dpi_aware
from .recognizer import XiangqiRecognizer
from .runtime import ImageGrab, cv2, np, pyautogui, win32api, win32clipboard, win32con

class TtxqAutomator:
    def __init__(
        self,
        recognizer: XiangqiRecognizer,
        logger: Callable[[str], None],
        capture_debugger: Callable[[np.ndarray, WindowInfo, str], None] | None = None,
    ) -> None:
        _make_process_dpi_aware()
        self.recognizer = recognizer
        self.logger = logger
        self.capture_debugger = capture_debugger
        self.palette_cache: dict[tuple[str, str], tuple[PieceToken, WindowInfo]] = {}
        self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        self.user32.SetProcessDPIAware()

        self.INPUT_MOUSE = 0
        self.MOUSEEVENTF_MOVE = 0x0001
        self.MOUSEEVENTF_LEFTDOWN = 0x0002
        self.MOUSEEVENTF_LEFTUP = 0x0004
        self.MOUSEEVENTF_ABSOLUTE = 0x8000
        self.MOUSEEVENTF_VIRTUALDESK = 0x4000
        self.SW_RESTORE = 9
        self.WM_MOUSEMOVE = 0x0200
        self.WM_LBUTTONDOWN = 0x0201
        self.WM_LBUTTONUP = 0x0202
        self.MK_LBUTTON = 0x0001
        self.SM_XVIRTUALSCREEN = 76
        self.SM_YVIRTUALSCREEN = 77
        self.SM_CXVIRTUALSCREEN = 78
        self.SM_CYVIRTUALSCREEN = 79
        self.DESKTOP_READOBJECTS = 0x0001
        self.DESKTOP_WRITEOBJECTS = 0x0080
        self.DESKTOP_SWITCHDESKTOP = 0x0100
        self.DESKTOP_JOURNALPLAYBACK = 0x0020

        self.INPUT_KEYBOARD = 1
        self.KEYEVENTF_KEYUP = 0x0002
        self.KEYEVENTF_UNICODE = 0x0004
        self.VK_CONTROL = 0x11
        self.VK_BACK = 0x08
        self.VK_A = 0x41
        self.VK_V = 0x56

        class POINT(ctypes.Structure):
            _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

        class RECT(ctypes.Structure):
            _fields_ = [
                ("left", ctypes.c_long),
                ("top", ctypes.c_long),
                ("right", ctypes.c_long),
                ("bottom", ctypes.c_long),
            ]

        class KEYBDINPUT(ctypes.Structure):
            _fields_ = [
                ("wVk", ctypes.c_ushort),
                ("wScan", ctypes.c_ushort),
                ("dwFlags", ctypes.c_uint32),
                ("time", ctypes.c_uint32),
                ("dwExtraInfo", ctypes.c_void_p),
            ]

        class MOUSEINPUT(ctypes.Structure):
            _fields_ = [
                ("dx", ctypes.c_long),
                ("dy", ctypes.c_long),
                ("mouseData", ctypes.c_ulong),
                ("dwFlags", ctypes.c_uint32),
                ("time", ctypes.c_uint32),
                ("dwExtraInfo", ctypes.c_void_p),
            ]

        class INPUT_UNION(ctypes.Union):
            _fields_ = [("ki", KEYBDINPUT), ("mi", MOUSEINPUT)]

        class INPUT(ctypes.Structure):
            _fields_ = [("type", ctypes.c_uint32), ("union", INPUT_UNION)]

        self.POINT = POINT
        self.RECT = RECT
        self.KEYBDINPUT = KEYBDINPUT
        self.MOUSEINPUT = MOUSEINPUT
        self.INPUT = INPUT
        self.user32.GetCursorPos.argtypes = (ctypes.POINTER(self.POINT),)
        self.user32.GetCursorPos.restype = ctypes.c_bool
        self.user32.SetCursorPos.argtypes = (ctypes.c_int, ctypes.c_int)
        self.user32.SetCursorPos.restype = ctypes.c_bool
        self.user32.ClipCursor.argtypes = (ctypes.c_void_p,)
        self.user32.ClipCursor.restype = ctypes.c_bool
        self.user32.GetClipCursor.argtypes = (ctypes.POINTER(self.RECT),)
        self.user32.GetClipCursor.restype = ctypes.c_bool
        self.user32.OpenInputDesktop.argtypes = (ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32)
        self.user32.OpenInputDesktop.restype = ctypes.c_void_p
        self.user32.SetThreadDesktop.argtypes = (ctypes.c_void_p,)
        self.user32.SetThreadDesktop.restype = ctypes.c_bool
        self.user32.CloseDesktop.argtypes = (ctypes.c_void_p,)
        self.user32.CloseDesktop.restype = ctypes.c_bool
        self.user32.mouse_event.argtypes = (
            ctypes.c_uint32,
            ctypes.c_uint32,
            ctypes.c_uint32,
            ctypes.c_uint32,
            ctypes.c_void_p,
        )
        self.user32.mouse_event.restype = None
        self._input_desktop_attached = False
        self._input_desktop_handle: int | None = None

    def _log(self, text: str) -> None:
        self.logger(text)

    def _bring_to_front(self, window: WindowInfo) -> None:
        self.user32.ShowWindow(window.hwnd, self.SW_RESTORE)
        self.user32.SetForegroundWindow(window.hwnd)
        time.sleep(0.2)

    def capture_visible_window(self) -> tuple[np.ndarray, WindowInfo]:
        window = self.recognizer.find_window()
        self._bring_to_front(window)
        image = ImageGrab.grab(bbox=window.bbox, all_screens=True)
        bgr = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
        if self.capture_debugger is not None:
            try:
                self.capture_debugger(bgr, window, "automator_capture")
            except Exception as exc:
                self._log(f"Debug screenshot save failed: {exc}")
        return bgr, window

    def _get_cursor_pos(self) -> tuple[int, int]:
        if win32api is not None:
            try:
                x, y = win32api.GetCursorPos()
                return int(x), int(y)
            except Exception:
                pass
        point = self.POINT()
        if not self.user32.GetCursorPos(ctypes.byref(point)):
            return 0, 0
        return int(point.x), int(point.y)

    def _set_cursor_pos(self, x: int, y: int) -> bool:
        if win32api is not None:
            try:
                win32api.SetCursorPos((int(x), int(y)))
                return True
            except Exception as exc:
                self._log(f"win32api.SetCursorPos failed: {exc}")
        ctypes.set_last_error(0)
        return bool(self.user32.SetCursorPos(int(x), int(y)))

    def _ensure_input_desktop(self) -> None:
        if self._input_desktop_attached:
            return
        access = (
            self.DESKTOP_READOBJECTS
            | self.DESKTOP_WRITEOBJECTS
            | self.DESKTOP_SWITCHDESKTOP
            | self.DESKTOP_JOURNALPLAYBACK
        )
        ctypes.set_last_error(0)
        desktop = self.user32.OpenInputDesktop(0, 0, access)
        if not desktop:
            error_code = ctypes.get_last_error()
            self._log(f"OpenInputDesktop failed with Windows error {error_code}.")
            return
        ctypes.set_last_error(0)
        if self.user32.SetThreadDesktop(desktop):
            self._input_desktop_attached = True
            self._input_desktop_handle = int(desktop)
            self._log("Automation thread attached to the active input desktop.")
            return
        error_code = ctypes.get_last_error()
        self.user32.CloseDesktop(desktop)
        self._log(f"SetThreadDesktop failed with Windows error {error_code}.")

    def _cursor_near(self, x: int, y: int, tolerance: int = 8) -> bool:
        actual_x, actual_y = self._get_cursor_pos()
        return abs(actual_x - int(x)) <= tolerance and abs(actual_y - int(y)) <= tolerance

    def _virtual_screen_bounds(self) -> tuple[int, int, int, int]:
        left = int(self.user32.GetSystemMetrics(self.SM_XVIRTUALSCREEN))
        top = int(self.user32.GetSystemMetrics(self.SM_YVIRTUALSCREEN))
        width = int(self.user32.GetSystemMetrics(self.SM_CXVIRTUALSCREEN))
        height = int(self.user32.GetSystemMetrics(self.SM_CYVIRTUALSCREEN))
        return left, top, left + width - 1, top + height - 1

    def _clip_cursor_bounds(self) -> tuple[int, int, int, int] | None:
        rect = self.RECT()
        if not self.user32.GetClipCursor(ctypes.byref(rect)):
            return None
        return int(rect.left), int(rect.top), int(rect.right), int(rect.bottom)

    def _release_cursor_clip(self) -> None:
        ctypes.set_last_error(0)
        if self.user32.ClipCursor(None):
            return
        error_code = ctypes.get_last_error()
        self._log(f"ClipCursor(None) failed with Windows error {error_code}.")

    def _move_cursor_to(self, x: int, y: int) -> None:
        target_x = int(x)
        target_y = int(y)
        self._log(f"Mouse bounds: virtual={self._virtual_screen_bounds()}, clip={self._clip_cursor_bounds()}.")
        self._release_cursor_clip()
        if self._set_cursor_pos(target_x, target_y):
            time.sleep(0.08)
            if self._cursor_near(target_x, target_y):
                return
            actual_x, actual_y = self._get_cursor_pos()
            self._log(
                f"SetCursorPos returned success, but cursor stayed at ({actual_x}, {actual_y}) "
                f"instead of ({target_x}, {target_y})."
            )
        else:
            error_code = ctypes.get_last_error()
            self._log(f"SetCursorPos failed with Windows error {error_code}.")

        try:
            abs_x, abs_y = self._screen_to_absolute(target_x, target_y)
            move_flags = self.MOUSEEVENTF_MOVE | self.MOUSEEVENTF_ABSOLUTE | self.MOUSEEVENTF_VIRTUALDESK
            self._send_mouse_input(abs_x, abs_y, move_flags)
            time.sleep(0.08)
            if self._cursor_near(target_x, target_y):
                return
            actual_x, actual_y = self._get_cursor_pos()
            self._log(
                f"SendInput absolute move also left cursor at ({actual_x}, {actual_y}) "
                f"instead of ({target_x}, {target_y})."
            )
        except Exception as exc:
            self._log(f"SendInput absolute move failed: {exc}")

        if pyautogui is not None:
            try:
                pyautogui.moveTo(target_x, target_y, duration=0)
                time.sleep(0.08)
                if self._cursor_near(target_x, target_y):
                    return
                actual_x, actual_y = self._get_cursor_pos()
                self._log(
                    f"pyautogui.moveTo also left cursor at ({actual_x}, {actual_y}) "
                    f"instead of ({target_x}, {target_y})."
                )
            except Exception as exc:
                self._log(f"pyautogui.moveTo failed: {exc}")

        actual_x, actual_y = self._get_cursor_pos()
        raise TtxqAutomationError(
            "Windows refused to move the mouse cursor. "
            f"Cursor is still at ({actual_x}, {actual_y}); target was ({target_x}, {target_y}). "
            "Run this uploader at the same privilege level as Tiantian, or start both normally without administrator elevation."
        )

    def _screen_to_absolute(self, x: int, y: int) -> tuple[int, int]:
        left = self.user32.GetSystemMetrics(self.SM_XVIRTUALSCREEN)
        top = self.user32.GetSystemMetrics(self.SM_YVIRTUALSCREEN)
        width = self.user32.GetSystemMetrics(self.SM_CXVIRTUALSCREEN)
        height = self.user32.GetSystemMetrics(self.SM_CYVIRTUALSCREEN)
        if width <= 1 or height <= 1:
            return 0, 0
        abs_x = int(round((x - left) * 65535 / (width - 1)))
        abs_y = int(round((y - top) * 65535 / (height - 1)))
        return max(0, min(abs_x, 65535)), max(0, min(abs_y, 65535))

    def _send_mouse_input(self, dx: int, dy: int, flags: int) -> None:
        item = self.INPUT()
        item.type = self.INPUT_MOUSE
        item.union.mi = self.MOUSEINPUT(dx=dx, dy=dy, mouseData=0, dwFlags=flags, time=0, dwExtraInfo=None)
        array_type = self.INPUT * 1
        sent = self.user32.SendInput(1, array_type(item), ctypes.sizeof(self.INPUT))
        if sent != 1:
            raise RuntimeError("SendInput mouse event failed.")

    def _resolve_region(
        self,
        image: np.ndarray,
        region: tuple[float, float, float, float] | None,
    ) -> tuple[int, int, int, int]:
        if region is None:
            return 0, 0, image.shape[1], image.shape[0]
        x1, y1, x2, y2 = region
        if max(region) <= 1.0:
            return (
                int(round(x1 * image.shape[1])),
                int(round(y1 * image.shape[0])),
                int(round(x2 * image.shape[1])),
                int(round(y2 * image.shape[0])),
            )
        return int(x1), int(y1), int(x2), int(y2)

    def _ocr_matches(
        self,
        image: np.ndarray,
        region: tuple[float, float, float, float] | None = None,
    ) -> list[OcrTextMatch]:
        x1, y1, x2, y2 = self._resolve_region(image, region)
        crop = image[y1:y2, x1:x2]
        if crop.size == 0:
            return []
        result, _ = self.recognizer._get_ocr()(crop)
        matches: list[OcrTextMatch] = []
        for item in result or []:
            points, text, score = item
            xs = [int(round(point[0])) for point in points]
            ys = [int(round(point[1])) for point in points]
            matches.append(
                OcrTextMatch(
                    text=text,
                    score=float(score),
                    bbox=(x1 + min(xs), y1 + min(ys), x1 + max(xs), y1 + max(ys)),
                )
            )
        return matches

    def _aliases_for(self, name_or_aliases: str | Sequence[str]) -> tuple[str, ...]:
        if isinstance(name_or_aliases, str):
            return tuple(UI_TEXT_ALIASES.get(name_or_aliases, (name_or_aliases,)))
        return tuple(name_or_aliases)

    def _best_text_row_match(
        self,
        candidates: list[OcrTextMatch],
        normalized_aliases: Sequence[str],
        min_score: float,
    ) -> OcrTextMatch | None:
        rows: list[list[OcrTextMatch]] = []
        for match in sorted(candidates, key=lambda item: (item.center[1], item.center[0])):
            if match.score < min_score:
                continue
            matched_row: list[OcrTextMatch] | None = None
            match_height = max(1, match.bbox[3] - match.bbox[1])
            for row in rows:
                row_center = sum(item.center[1] for item in row) / len(row)
                row_height = max(1, max(item.bbox[3] - item.bbox[1] for item in row))
                if abs(match.center[1] - row_center) <= max(18.0, row_height * 0.65, match_height * 0.65):
                    matched_row = row
                    break
            if matched_row is None:
                rows.append([match])
            else:
                matched_row.append(match)

        best: tuple[float, OcrTextMatch] | None = None
        for row in rows:
            row = sorted(row, key=lambda item: item.center[0])
            row_text = "".join(item.text for item in row)
            normalized = _normalize_ui_text(row_text)
            for alias in normalized_aliases:
                if normalized != alias and alias not in normalized:
                    continue
                x1 = min(item.bbox[0] for item in row)
                y1 = min(item.bbox[1] for item in row)
                x2 = max(item.bbox[2] for item in row)
                y2 = max(item.bbox[3] for item in row)
                score = max(item.score for item in row)
                total = 900.0 + (score * 100.0) - (len(normalized) - len(alias)) * 0.5
                match = OcrTextMatch(text=row_text, score=score, bbox=(x1, y1, x2, y2))
                if best is None or total > best[0]:
                    best = (total, match)
        return best[1] if best is not None else None

    def _best_text_match(
        self,
        image: np.ndarray,
        aliases: str | Sequence[str],
        region: tuple[float, float, float, float] | None = None,
        min_score: float = 0.55,
        allow_partial: bool = True,
    ) -> OcrTextMatch | None:
        normalized_aliases = [_normalize_ui_text(alias) for alias in self._aliases_for(aliases)]
        candidates = self._ocr_matches(image, region=region)
        best: tuple[float, OcrTextMatch] | None = None
        for match in candidates:
            normalized = _normalize_ui_text(match.text)
            for alias in normalized_aliases:
                relation_score = 0.0
                if normalized == alias:
                    relation_score = 1000.0
                elif alias in normalized:
                    relation_score = 850.0
                elif allow_partial and normalized in alias:
                    relation_score = 650.0
                if relation_score == 0.0 or match.score < min_score:
                    continue
                total = relation_score + (match.score * 100.0)
                if best is None or total > best[0]:
                    best = (total, match)
        if best is not None and best[0] >= 850.0:
            return best[1]
        row_match = self._best_text_row_match(candidates, normalized_aliases, min_score)
        if row_match is not None:
            return row_match
        return best[1] if best is not None else None

    def wait_for_text(
        self,
        aliases: str | Sequence[str],
        region: tuple[float, float, float, float] | None = None,
        timeout: float = 6.0,
        min_score: float = 0.38,
    ) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            image, _window = self.capture_visible_window()
            if self._best_text_match(image, aliases, region=region, min_score=min_score) is not None:
                return True
            time.sleep(0.35)
        return False

    def _post_click(self, screen_x: int, screen_y: int) -> bool:
        point = self.POINT(screen_x, screen_y)
        hwnd = self.user32.WindowFromPoint(point)
        if hwnd == 0:
            return False
        client = self.POINT(screen_x, screen_y)
        self.user32.ScreenToClient(hwnd, ctypes.byref(client))
        lparam = (client.y & 0xFFFF) << 16 | (client.x & 0xFFFF)
        self.user32.SendMessageW(hwnd, self.WM_MOUSEMOVE, 0, lparam)
        self.user32.SendMessageW(hwnd, self.WM_LBUTTONDOWN, self.MK_LBUTTON, lparam)
        self.user32.SendMessageW(hwnd, self.WM_LBUTTONUP, 0, lparam)
        return True

    def _send_input_click(self, screen_x: int, screen_y: int) -> None:
        self._ensure_input_desktop()
        before_x, before_y = self._get_cursor_pos()
        self._move_cursor_to(int(screen_x), int(screen_y))
        moved_x, moved_y = self._get_cursor_pos()
        self._log(f"Physical click: ({before_x},{before_y}) -> ({moved_x},{moved_y}), target ({int(screen_x)}, {int(screen_y)}).")
        time.sleep(0.04)
        if win32api is not None and win32con is not None:
            win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN, int(screen_x), int(screen_y), 0, 0)
        else:
            self.user32.mouse_event(self.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, None)
        time.sleep(0.05)
        if win32api is not None and win32con is not None:
            win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP, int(screen_x), int(screen_y), 0, 0)
        else:
            self.user32.mouse_event(self.MOUSEEVENTF_LEFTUP, 0, 0, 0, None)

    def click_screen_point(self, screen_x: int, screen_y: int) -> None:
        self._send_input_click(int(screen_x), int(screen_y))

    def click_visible_point(
        self,
        point: tuple[float, float],
        window: WindowInfo,
        after: float = 0.45,
    ) -> None:
        x = int(round(window.bbox[0] + point[0]))
        y = int(round(window.bbox[1] + point[1]))
        self.click_screen_point(x, y)
        time.sleep(after)

    def drag_visible_point(
        self,
        start: tuple[float, float],
        end: tuple[float, float],
        window: WindowInfo,
        duration: float = 0.65,
        after: float = 0.35,
    ) -> None:
        """Physically drag a visible control between two window-relative points."""

        start_x = int(round(window.bbox[0] + start[0]))
        start_y = int(round(window.bbox[1] + start[1]))
        end_x = int(round(window.bbox[0] + end[0]))
        end_y = int(round(window.bbox[1] + end[1]))
        self._ensure_input_desktop()
        self._move_cursor_to(start_x, start_y)
        self._log(
            f"Physical drag: ({start_x}, {start_y}) -> ({end_x}, {end_y}) over {duration:.2f}s."
        )
        if win32api is not None and win32con is not None:
            mouse_down = lambda: win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN, start_x, start_y, 0, 0)
            mouse_up = lambda: win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP, end_x, end_y, 0, 0)
        else:
            mouse_down = lambda: self.user32.mouse_event(self.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, None)
            mouse_up = lambda: self.user32.mouse_event(self.MOUSEEVENTF_LEFTUP, 0, 0, 0, None)
        mouse_down()
        try:
            steps = max(8, int(round(duration / 0.035)))
            for step in range(1, steps + 1):
                fraction = step / steps
                x = round(start_x + (end_x - start_x) * fraction)
                y = round(start_y + (end_y - start_y) * fraction)
                if not self._set_cursor_pos(x, y):
                    raise TtxqAutomationError(
                        f"Windows refused slider drag movement at ({x}, {y})."
                    )
                time.sleep(duration / steps)
        finally:
            mouse_up()
        if not self._cursor_near(end_x, end_y, tolerance=10):
            actual_x, actual_y = self._get_cursor_pos()
            raise TtxqAutomationError(
                f"Slider drag ended at ({actual_x}, {actual_y}) instead of ({end_x}, {end_y})."
            )
        time.sleep(after)

    def click_relative(self, x_fraction: float, y_fraction: float, after: float = 0.45) -> None:
        image, window = self.capture_visible_window()
        point = (image.shape[1] * x_fraction, image.shape[0] * y_fraction)
        self.click_visible_point(point, window, after=after)

    def click_text(
        self,
        aliases: str | Sequence[str],
        region: tuple[float, float, float, float] | None = None,
        retries: int = 4,
        after: float = 0.65,
        fallback_points: list[tuple[float, float]] | None = None,
        allow_partial: bool = True,
    ) -> None:
        alias_text = "/".join(self._aliases_for(aliases))
        for _attempt in range(retries):
            image, window = self.capture_visible_window()
            match = self._best_text_match(image, aliases, region=region, allow_partial=allow_partial)
            if match is None:
                if fallback_points is not None:
                    x1, y1, x2, y2 = self._resolve_region(image, region)
                    index = min(_attempt, len(fallback_points) - 1)
                    fx, fy = fallback_points[index]
                    px = x1 + (x2 - x1) * fx
                    py = y1 + (y2 - y1) * fy
                    self._log(f"Could not OCR {alias_text}; fallback click at ({int(px)}, {int(py)}).")
                    self.click_visible_point((px, py), window, after=after)
                    if _attempt + 1 < retries:
                        time.sleep(0.35)
                        continue
                    return
                time.sleep(0.35)
                continue
            self._log(f"Clicking {alias_text} ({match.text}).")
            if fallback_points is not None:
                click_target = match.center
            else:
                click_target = match.center
            self._log(
                f"Click target {alias_text} resolved to ({int(round(click_target[0]))}, {int(round(click_target[1]))}) "
                f"on attempt {_attempt + 1}/{retries}."
            )
            self.click_visible_point(click_target, window, after=after)
            return
        raise TtxqAutomationError(f"Could not find text on screen: {alias_text}")

    def try_click_text(
        self,
        aliases: str | Sequence[str],
        region: tuple[float, float, float, float] | None = None,
        retries: int = 2,
        after: float = 0.5,
        allow_partial: bool = True,
    ) -> bool:
        try:
            self.click_text(aliases, region=region, retries=retries, after=after, allow_partial=allow_partial)
            return True
        except TtxqAutomationError:
            return False

    def _send_input(self, inputs: list[INPUT]) -> None:
        array_type = self.INPUT * len(inputs)
        self.user32.SendInput(len(inputs), array_type(*inputs), ctypes.sizeof(self.INPUT))

    def _key_input(self, vk: int, scan: int = 0, flags: int = 0) -> INPUT:
        item = self.INPUT()
        item.type = self.INPUT_KEYBOARD
        item.union.ki = self.KEYBDINPUT(vk, scan, flags, 0, None)
        return item

    def _press_virtual_key(self, vk: int) -> None:
        self._send_input(
            [
                self._key_input(vk),
                self._key_input(vk, flags=self.KEYEVENTF_KEYUP),
            ]
        )

    def _press_control_key(self, vk: int) -> None:
        self._send_input(
            [
                self._key_input(self.VK_CONTROL),
                self._key_input(vk),
                self._key_input(vk, flags=self.KEYEVENTF_KEYUP),
                self._key_input(self.VK_CONTROL, flags=self.KEYEVENTF_KEYUP),
            ]
        )

    def _paste_text(self, text: str) -> bool:
        if win32clipboard is None:
            return False
        try:
            win32clipboard.OpenClipboard()
            win32clipboard.EmptyClipboard()
            win32clipboard.SetClipboardText(text, win32con.CF_UNICODETEXT)
            win32clipboard.CloseClipboard()
        except Exception as exc:
            try:
                win32clipboard.CloseClipboard()
            except Exception:
                pass
            self._log(f"Clipboard paste setup failed: {exc}")
            return False
        self._press_control_key(self.VK_V)
        return True

    def _enter_text(self, text: str) -> None:
        if self._paste_text(text):
            time.sleep(0.3)
            return
        unicode_inputs: list[INPUT] = []
        for char in text:
            unicode_inputs.append(self._key_input(0, scan=ord(char), flags=self.KEYEVENTF_UNICODE))
            unicode_inputs.append(
                self._key_input(
                    0,
                    scan=ord(char),
                    flags=self.KEYEVENTF_UNICODE | self.KEYEVENTF_KEYUP,
                )
            )
        if unicode_inputs:
            self._send_input(unicode_inputs)
            time.sleep(0.3)

    def _replace_text(self, text: str) -> None:
        self._press_control_key(self.VK_A)
        time.sleep(0.05)
        self._press_virtual_key(self.VK_BACK)
        time.sleep(0.05)
        self._enter_text(text)

    def capture_board_state(self) -> tuple[BoardState, WindowInfo]:
        image, window = self.capture_visible_window()
        return self.recognizer.recognize_board(image), window

    def _board_step(self, state: BoardState) -> float:
        return float((np.median(np.diff(state.grid_x)) + np.median(np.diff(state.grid_y))) / 2.0)

    def _prime_palette_cache_from_state(self, state: BoardState, window: WindowInfo) -> None:
        if state.source_image is None:
            return
        step = self._board_step(state)
        tokens = self.detect_piece_tokens(state.source_image, state.board_bbox, state.grid_x, state.grid_y, step)
        self._refresh_palette_cache(tokens, window, step)

    def _extract_patch_at_point(
        self,
        image: np.ndarray,
        center_x: float,
        center_y: float,
        radius: float,
    ) -> np.ndarray | None:
        half = int(math.ceil(radius * 1.35))
        x1 = int(round(center_x)) - half
        y1 = int(round(center_y)) - half
        x2 = int(round(center_x)) + half
        y2 = int(round(center_y)) + half
        if x1 < 0 or y1 < 0 or x2 > image.shape[1] or y2 > image.shape[0]:
            return None
        return image[y1:y2, x1:x2].copy()

    def detect_piece_tokens(
        self,
        image: np.ndarray,
        board_bbox: tuple[int, int, int, int],
        grid_x: Sequence[float],
        grid_y: Sequence[float],
        step: float,
    ) -> list[PieceToken]:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        circles = cv2.HoughCircles(
            gray,
            cv2.HOUGH_GRADIENT,
            dp=1.2,
            minDist=max(18, int(round(step * 0.65))),
            param1=120,
            param2=23,
            minRadius=max(10, int(round(step * 0.22))),
            maxRadius=max(18, int(round(step * 0.60))),
        )
        if circles is None:
            return []

        tokens: list[PieceToken] = []
        board_x1, board_y1, board_x2, board_y2 = board_bbox
        search_x1 = max(0.0, board_x1 - (step * 1.4))
        search_x2 = min(float(image.shape[1]), board_x2 + (step * 1.4))
        top_palette_y1 = max(0.0, board_y1 - (step * 1.85))
        top_palette_y2 = max(0.0, board_y1 - (step * 0.20))
        bottom_palette_y1 = min(float(image.shape[0]), board_y2 + (step * 0.20))
        bottom_palette_y2 = min(float(image.shape[0]), board_y2 + (step * 1.35))
        for center_x, center_y, radius in np.round(circles[0, :]).astype(np.int32):
            if not (search_x1 <= center_x <= search_x2):
                continue
            in_top_palette = top_palette_y1 <= center_y <= top_palette_y2
            in_bottom_palette = bottom_palette_y1 <= center_y <= bottom_palette_y2
            if not (in_top_palette or in_bottom_palette):
                continue
            expected_side = "black" if in_top_palette else "red"
            token_radius = float(step * 0.44)
            patch = self._extract_patch_at_point(image, float(center_x), float(center_y), token_radius)
            if patch is None:
                continue
            classified = self.recognizer.fixed_vision.classify_palette_piece_for_side(
                patch,
                token_radius,
                expected_side,
            )
            if classified is None:
                side, piece_type, confidence = expected_side, "?", 0.0
            else:
                side, piece_type, confidence, _glyphs = classified
                if confidence < 0.54:
                    side, piece_type, confidence = expected_side, "?", float(confidence)
            nearest_dx = min(abs(center_x - grid_value) for grid_value in grid_x)
            nearest_dy = min(abs(center_y - grid_value) for grid_value in grid_y)
            on_board = nearest_dx <= step * 0.28 and nearest_dy <= step * 0.28
            if on_board:
                continue
            tokens.append(
                PieceToken(
                    side=side,
                    piece_type=piece_type,
                    center=(float(center_x), float(center_y)),
                    radius=token_radius,
                    confidence=float(confidence),
                    on_board=on_board,
                )
            )

        deduped: list[PieceToken] = []
        for token in sorted(tokens, key=lambda item: item.confidence, reverse=True):
            if any(math.hypot(token.center[0] - existing.center[0], token.center[1] - existing.center[1]) < step * 0.22 for existing in deduped):
                continue
            deduped.append(token)
        return deduped

    def click_board_coord(
        self,
        coord: str,
        state: BoardState,
        window: WindowInfo,
        after: float = 0.35,
    ) -> None:
        col = FILE_LETTERS.index(coord[0])
        row = int(coord[1])
        point = (state.grid_x[col], state.grid_y[9 - row])
        self.click_visible_point(point, window, after=after)

    def _move_general_if_needed(self, game: NotationGame, side: str) -> None:
        desired_coords = [
            coord for coord, value in game.setup_pieces.items() if value == (side, "k")
        ]
        if not desired_coords:
            return
        if len(desired_coords) > 1:
            raise TtxqAutomationError(f"Refusing to set up {side}: notation contains multiple generals at {desired_coords}.")
        desired_coord = desired_coords[0]
        desired_col, desired_row = self.recognizer._coord_to_tuple(desired_coord)
        if not self.recognizer._in_palace(side, desired_col, desired_row):
            raise TtxqAutomationError(
                f"Refusing to move the {side} general to illegal square {desired_coord}; "
                "generals must stay in their own palace."
            )
        state, window = self.capture_board_state()
        source_coord = next(
            (coord for coord, piece in state.pieces.items() if piece.side == side and piece.piece_type == "k"),
            None,
        )
        if source_coord is None or source_coord == desired_coord:
            return
        self._log(f"Moving {side} general from {source_coord} to {desired_coord}.")
        self.click_board_coord(source_coord, state, window, after=0.15)
        self.click_board_coord(desired_coord, state, window, after=0.55)

    def _find_palette_pieces(self, side: str, piece_type: str) -> list[tuple[PieceToken, WindowInfo]]:
        cached = self.palette_cache.get((side, piece_type))
        if cached is not None:
            return [cached]

        image, window = self.capture_visible_window()
        board_bbox, grid_x, grid_y = self.recognizer.detect_board(image)
        step = float((np.median(np.diff(grid_x)) + np.median(np.diff(grid_y))) / 2.0)
        tokens = self.detect_piece_tokens(image, board_bbox, grid_x, grid_y, step)
        self._refresh_palette_cache(tokens, window, step)
        cached = self.palette_cache.get((side, piece_type))
        if cached is not None:
            return [cached]

        ordered_token = self._palette_order_fallback(tokens, side, piece_type, step)
        matches = [token for token in tokens if not token.on_board and token.side == side and token.piece_type == piece_type]
        if ordered_token is not None:
            aligned_matches = [
                token
                for token in matches
                if math.hypot(token.center[0] - ordered_token.center[0], token.center[1] - ordered_token.center[1]) <= step * 0.45
            ]
            if aligned_matches:
                aligned_matches.sort(key=lambda item: item.confidence, reverse=True)
                return [(aligned_matches[0], window)]
            self._log(
                f"Using visually detected palette row for {side} {piece_type} at "
                f"({int(round(ordered_token.center[0]))}, {int(round(ordered_token.center[1]))}); "
                "glyph classifier did not agree on that slot."
            )
            return [(ordered_token, window)]
        if not matches:
            detected = ", ".join(
                f"{token.side} {token.piece_type}@({int(round(token.center[0]))},{int(round(token.center[1]))})"
                for token in tokens
                if not token.on_board
            )
            detail = f" Detected off-board tokens: {detected}" if detected else ""
            raise TtxqAutomationError(f"Could not find an off-board {side} {piece_type} token to place.{detail}")
        matches.sort(key=lambda item: (item.confidence, item.center[1]), reverse=True)
        result = [(match, window) for match in matches]
        self.palette_cache[(side, piece_type)] = result[0]
        return result

    def _refresh_palette_cache(self, tokens: Sequence[PieceToken], window: WindowInfo, step: float) -> None:
        for side in ("black", "red"):
            ordered = self._ordered_palette_row(tokens, side, step)
            if ordered is None:
                continue
            for piece_type, token in zip(EDITOR_PALETTE_ORDER, ordered):
                self.palette_cache[(side, piece_type)] = (
                    PieceToken(
                        side=side,
                        piece_type=piece_type,
                        center=token.center,
                        radius=token.radius,
                        confidence=max(0.50, token.confidence),
                        on_board=False,
                    ),
                    window,
                )

    def _palette_order_fallback(
        self,
        tokens: Sequence[PieceToken],
        side: str,
        piece_type: str,
        step: float,
    ) -> PieceToken | None:
        if piece_type not in EDITOR_PALETTE_ORDER:
            return None
        side_tokens = [token for token in tokens if not token.on_board and token.side == side]
        row_tokens = self._ordered_palette_row(side_tokens, side, step)
        if row_tokens is None:
            return None

        token = row_tokens[EDITOR_PALETTE_ORDER.index(piece_type)]
        return PieceToken(
            side=side,
            piece_type=piece_type,
            center=token.center,
            radius=token.radius,
            confidence=max(0.50, token.confidence),
            on_board=False,
        )

    def _ordered_palette_row(
        self,
        tokens: Sequence[PieceToken],
        side: str,
        step: float,
    ) -> list[PieceToken] | None:
        side_tokens = [token for token in tokens if not token.on_board and token.side == side]
        if len(side_tokens) < len(EDITOR_PALETTE_ORDER):
            return None

        best_row: list[PieceToken] | None = None
        best_score = float("-inf")
        expected_count = len(EDITOR_PALETTE_ORDER)
        for anchor in side_tokens:
            row = [
                token
                for token in side_tokens
                if abs(token.center[1] - anchor.center[1]) <= step * 0.22
            ]
            if len(row) < expected_count:
                continue
            row = sorted(row, key=lambda token: token.center[0])
            for candidate in combinations(row, expected_count):
                xs = [token.center[0] for token in candidate]
                gaps = np.diff(xs)
                if len(gaps) != expected_count - 1:
                    continue
                median_gap = float(np.median(gaps))
                if not (step * 1.05 <= median_gap <= step * 1.75):
                    continue
                regularity = float(np.std(gaps))
                y_spread = max(token.center[1] for token in candidate) - min(token.center[1] for token in candidate)
                confidence = float(sum(token.confidence for token in candidate))
                known_bonus = sum(0.18 for token in candidate if token.piece_type != "?")
                score = (
                    confidence
                    + known_bonus
                    - (6.0 * regularity / max(step, 1.0))
                    - (2.0 * y_spread / max(step, 1.0))
                )
                if score > best_score:
                    best_score = score
                    best_row = list(candidate)
        return best_row

    def _find_palette_piece(self, side: str, piece_type: str) -> tuple[PieceToken, WindowInfo]:
        return self._find_palette_pieces(side, piece_type)[0]

    def _observed_piece_label(self, observed: DetectedPiece | None) -> str:
        if observed is None:
            return "empty/unrecognized"
        return f"{observed.side} {observed.piece_type}"

    def _expected_piece_label(self, expected: tuple[str, str] | None) -> str:
        if expected is None:
            return "empty"
        return f"{expected[0]} {expected[1]}"

    def _piece_as_coord(self, piece: DetectedPiece, coord: str, state: BoardState) -> DetectedPiece:
        if piece.coord == coord:
            return piece
        col = FILE_LETTERS.index(coord[0])
        row = int(coord[1])
        return DetectedPiece(
            side=piece.side,
            piece_type=piece.piece_type,
            col=col,
            row=row,
            center=(state.grid_x[col], state.grid_y[9 - row]),
            radius=piece.radius,
            confidence=piece.confidence,
            glyphs=[("coord-corrected-for-replay", 1.0)] + list(piece.glyphs),
        )

    def _piece_as_type(self, piece: DetectedPiece, piece_type: str) -> DetectedPiece:
        if piece.piece_type == piece_type:
            return piece
        return DetectedPiece(
            side=piece.side,
            piece_type=piece_type,
            col=piece.col,
            row=piece.row,
            center=piece.center,
            radius=piece.radius,
            confidence=piece.confidence,
            glyphs=[("type-corrected-from-notation", 1.0)] + list(piece.glyphs),
        )

    def _notation_piece_at_coord(
        self,
        state: BoardState,
        coord: str,
        side: str,
        piece_type: str,
    ) -> DetectedPiece:
        col = FILE_LETTERS.index(coord[0])
        row = int(coord[1])
        step = self._board_step(state)
        return DetectedPiece(
            side=side,
            piece_type=piece_type,
            col=col,
            row=row,
            center=(state.grid_x[col], state.grid_y[9 - row]),
            radius=step * 0.44,
            confidence=0.0,
            glyphs=[("source-from-validated-notation", 1.0)],
        )

    def _recognized_board_detail(self, state: BoardState) -> str:
        if not state.pieces:
            return "none"
        return ", ".join(
            f"{coord}:{self._observed_piece_label(observed)}"
            for coord, observed in sorted(state.pieces.items())
        )

    def _live_legality_detail(
        self,
        move: MoveRecord,
        state: BoardState,
        piece: DetectedPiece,
        legal_destinations: Sequence[str],
    ) -> str:
        blockers = [
            f"{coord}:{self._observed_piece_label(state.pieces.get(coord))}"
            for coord in self.recognizer._pieces_between(state.pieces, move.src, move.dst)
        ]
        pieces = ", ".join(
            f"{coord}:{self._observed_piece_label(observed)}"
            for coord, observed in sorted(state.pieces.items())
        )
        details = [
            f"source key {move.src} holds {self._observed_piece_label(piece)} at internal coord {piece.coord}",
            f"legal destinations seen: {', '.join(legal_destinations) if legal_destinations else 'none'}",
        ]
        if blockers:
            details.append(f"between squares seen: {', '.join(blockers)}")
        details.append(f"recognized board: {pieces or 'none'}")
        return "; ".join(details)

    def _replay_source_piece(
        self,
        move_index: int,
        move: MoveRecord,
        state: BoardState,
        expected_board: dict[str, tuple[str, str]],
    ) -> DetectedPiece:
        expected_source = expected_board.get(move.src)
        if expected_source != (move.side, move.piece_type):
            raise TtxqAutomationError(
                f"Cannot replay move {move_index}: notation expects {move.side} {move.piece_type} "
                f"on {move.src}, but the validated replay board has "
                f"{self._expected_piece_label(expected_source)} there."
            )

        observed = state.pieces.get(move.src)
        if observed is None:
            if self._coord_looks_occupied(state, move.src):
                self._log(
                    f"Replay source {move.src} is visually occupied but unclassified; "
                    f"using validated notation source {move.side} {move.piece_type}."
                )
            else:
                self._log(
                    f"Replay source {move.src} was not recognized as occupied; "
                    f"using the validated replay board source {move.side} {move.piece_type}. "
                    f"Recognized board: {self._recognized_board_detail(state)}."
                )
            return self._notation_piece_at_coord(state, move.src, move.side, move.piece_type)

        if observed.side != move.side:
            self._log(
                f"Replay source {move.src} expected {move.side} {move.piece_type}; "
                f"live recognition saw {self._observed_piece_label(observed)}. "
                "Continuing from the validated replay board."
            )
            return self._notation_piece_at_coord(state, move.src, move.side, move.piece_type)

        if observed.piece_type != move.piece_type:
            self._log(
                f"Correcting replay source type at {move.src}: "
                f"{observed.side} {observed.piece_type} -> {move.piece_type} from validated notation."
            )
            return self._piece_as_type(observed, move.piece_type)

        return observed

    def _verify_replay_destination(
        self,
        move_index: int,
        move: MoveRecord,
        state: BoardState,
        expected_board: dict[str, tuple[str, str]],
    ) -> None:
        expected_dst = expected_board.get(move.dst)
        observed_dst = state.pieces.get(move.dst)

        if move.capture:
            if expected_dst is None or expected_dst[0] == move.side:
                raise TtxqAutomationError(
                    f"Cannot replay move {move_index}: {move.notation} is marked as a capture, "
                    f"but the validated replay board has {self._expected_piece_label(expected_dst)} on {move.dst}."
                )
            if observed_dst is None:
                self._log(
                    f"Replay capture destination {move.dst} was not recognized; "
                    f"validated replay board expects {self._expected_piece_label(expected_dst)} there."
                )
            elif observed_dst.side == move.side:
                self._log(
                    f"Replay capture destination {move.dst} expected an enemy piece from the validated replay board; "
                    f"live recognition saw friendly {self._observed_piece_label(observed_dst)}. Continuing."
                )
            return

        if expected_dst is not None:
            raise TtxqAutomationError(
                f"Cannot replay move {move_index}: {move.notation} is not marked as a capture, "
                f"but the validated replay board has {self._expected_piece_label(expected_dst)} on {move.dst}."
            )
        if observed_dst is not None:
            self._log(
                f"Replay destination {move.dst} was recognized as {self._observed_piece_label(observed_dst)}, "
                "but the validated replay board expects it to be empty. Continuing from notation."
            )

    def _observed_piece_matches(self, observed: DetectedPiece | None, side: str, piece_type: str) -> bool:
        return observed is not None and observed.side == side and observed.piece_type == piece_type

    def _coord_looks_occupied(self, state: BoardState, coord: str) -> bool:
        if state.pieces.get(coord) is not None:
            return True
        if state.source_image is None:
            return False
        col = FILE_LETTERS.index(coord[0])
        row = int(coord[1])
        step = self._board_step(state)
        patch, radius = self.recognizer._extract_intersection_patch(
            state.source_image,
            state.grid_x[col],
            state.grid_y[9 - row],
            step,
        )
        if patch is None:
            return False
        present, _edge_score = self.recognizer._piece_present(patch, radius)
        return bool(present)

    def _verified_coord_still_present(self, state: BoardState, coord: str, side: str) -> bool:
        observed = state.pieces.get(coord)
        if observed is not None:
            return observed.side == side
        return self._coord_looks_occupied(state, coord)

    def _place_piece_on_coord(self, coord: str, side: str, piece_type: str) -> str:
        candidates = self._find_palette_pieces(side, piece_type)
        last_observed = "not checked"
        for index, (token, token_window) in enumerate(candidates, start=1):
            state, window = self.capture_board_state()
            observed = state.pieces.get(coord)
            if self._observed_piece_matches(observed, side, piece_type):
                return "exact"
            target_was_occupied = self._coord_looks_occupied(state, coord)
            self._log(
                f"Placing {side} {piece_type} on {coord} using detected token "
                f"{index}/{len(candidates)} at ({int(round(token.center[0]))}, "
                f"{int(round(token.center[1]))}) confidence {token.confidence:.2f}."
            )
            self.click_visible_point(token.center, token_window, after=0.18)
            self.click_board_coord(coord, state, window, after=0.70)
            state, _window = self.capture_board_state()
            observed = state.pieces.get(coord)
            if self._observed_piece_matches(observed, side, piece_type):
                return "exact"
            last_observed = self._observed_piece_label(observed)
            if not target_was_occupied and self._coord_looks_occupied(state, coord):
                self._log(
                    f"{coord} is visually occupied after placing {side} {piece_type}; "
                    f"exact classifier saw {last_observed}. Accepting the placed piece."
                )
                return "occupied"
            if index < len(candidates):
                self._log(
                    f"{coord} did not become {side} {piece_type}; observed "
                    f"{last_observed}. Trying the next detected token."
                )
        raise TtxqAutomationError(
            f"Could not place {side} {piece_type} on {coord}. "
            f"Last observed at target: {last_observed}."
        )

    def _place_piece_on_coord_fast(
        self,
        coord: str,
        side: str,
        piece_type: str,
        state: BoardState,
        window: WindowInfo,
    ) -> None:
        token, token_window = self._find_palette_piece(side, piece_type)
        self._log(
            f"Fast placing {side} {piece_type} on {coord} using palette token "
            f"at ({int(round(token.center[0]))}, {int(round(token.center[1]))})."
        )
        self.click_visible_point(token.center, token_window, after=0.04)
        self.click_board_coord(coord, state, window, after=0.08)

    def _setup_mismatches(
        self,
        game: NotationGame,
        state: BoardState,
        visually_confirmed: set[str],
    ) -> list[tuple[str, str, str]]:
        mismatches: list[tuple[str, str, str]] = []
        for coord, (side, piece_type) in sorted(game.setup_pieces.items()):
            observed = state.pieces.get(coord)
            if observed is None or observed.side != side or observed.piece_type != piece_type:
                if (
                    piece_type == "k"
                    and observed is not None
                    and observed.side == side
                    and self.recognizer._in_palace(side, observed.col, observed.row)
                    and not any(piece.side == side and piece.piece_type == "k" for piece in state.pieces.values())
                ):
                    self._log(
                        f"Accepting {coord} as {side} general; classifier saw "
                        f"{self._observed_piece_label(observed)} in the general palace."
                    )
                    continue
                if coord in visually_confirmed and self._verified_coord_still_present(state, coord, side):
                    continue
                mismatches.append((coord, f"{side} {piece_type}", self._observed_piece_label(observed)))

        for coord, observed in sorted(state.pieces.items()):
            if coord not in game.setup_pieces:
                mismatches.append((coord, "empty", self._observed_piece_label(observed)))
        return mismatches

    def _format_setup_mismatches(self, mismatches: Sequence[tuple[str, str, str]]) -> list[str]:
        return [f"{coord} expected {expected}, saw {observed}" for coord, expected, observed in mismatches]

    def _retry_setup_mismatches(
        self,
        game: NotationGame,
        mismatches: Sequence[tuple[str, str, str]],
        visually_confirmed: set[str],
        *,
        max_passes: int = 3,
    ) -> list[tuple[str, str, str]]:
        current_mismatches = list(mismatches)
        for pass_index in range(1, max_passes + 1):
            retry_targets: list[tuple[str, str, str]] = []
            moved_generals = 0
            for coord, _expected, _observed in current_mismatches:
                desired = game.setup_pieces.get(coord)
                if desired is None:
                    continue
                side, piece_type = desired
                if piece_type == "k":
                    self._move_general_if_needed(game, side)
                    moved_generals += 1
                    continue
                retry_targets.append((coord, side, piece_type))

            if retry_targets:
                retry_detail = ", ".join(
                    f"{coord} {side} {piece_type}"
                    for coord, side, piece_type in retry_targets[:8]
                )
                self._log(
                    f"Whole-board verification pass {pass_index} found {len(current_mismatches)} mismatches; "
                    f"retrying {len(retry_targets)} piece placements: {retry_detail}."
                )
            elif moved_generals:
                self._log(
                    f"Whole-board verification pass {pass_index} found {len(current_mismatches)} mismatches; "
                    f"rechecking after moving {moved_generals} general{'s' if moved_generals != 1 else ''}."
                )
            else:
                return current_mismatches

            for coord, side, piece_type in retry_targets:
                placement_status = self._place_piece_on_coord(coord, side, piece_type)
                if placement_status in ("exact", "occupied"):
                    visually_confirmed.add(coord)

            current_mismatches = self._wait_for_setup_mismatches(
                game,
                visually_confirmed,
                timeout=2.4,
                interval=0.12,
            )
            if not current_mismatches:
                return []
        return current_mismatches

    def _wait_for_setup_mismatches(
        self,
        game: NotationGame,
        visually_confirmed: set[str] | None = None,
        timeout: float = 4.0,
        interval: float = 0.15,
    ) -> list[tuple[str, str, str]]:
        visually_confirmed = visually_confirmed or set()
        deadline = time.time() + timeout
        last_mismatches: list[tuple[str, str, str]] = []
        attempt = 0
        while True:
            attempt += 1
            state, _window = self.capture_board_state()
            mismatches = self._setup_mismatches(game, state, visually_confirmed)
            if not mismatches:
                if attempt > 1:
                    self._log(f"Board setup verified after {attempt} checks.")
                return []
            last_mismatches = mismatches
            remaining = deadline - time.time()
            if remaining <= 0:
                return last_mismatches
            time.sleep(min(interval, remaining))

    def _verify_setup(
        self,
        game: NotationGame,
        visually_confirmed: set[str] | None = None,
        timeout: float = 4.0,
    ) -> None:
        mismatches = self._wait_for_setup_mismatches(game, visually_confirmed, timeout=timeout)
        if not mismatches:
            return
        raise TtxqAutomationError(
            "The board editor did not settle on the requested setup. "
            f"Mismatched intersections: {', '.join(self._format_setup_mismatches(mismatches[:8]))}"
        )

    def _apply_setup_position(self, game: NotationGame) -> None:
        self.palette_cache.clear()
        state, _window = self.capture_board_state()
        if len(state.pieces) > 2:
            self.try_click_text("clear_board", region=(0.0, 0.70, 0.36, 1.0), after=0.55)
        self._move_general_if_needed(game, "red")
        self._move_general_if_needed(game, "black")
        state, window = self.capture_board_state()
        self._prime_palette_cache_from_state(state, window)

        pieces_to_add = [
            (coord, side, piece_type)
            for coord, (side, piece_type) in sorted(game.setup_pieces.items())
            if piece_type != "k"
        ]
        visually_confirmed: set[str] = set()
        fast_batch: list[tuple[str, str, str]] = []
        for coord, side, piece_type in pieces_to_add:
            existing = state.pieces.get(coord)
            if existing is not None and existing.side == side and existing.piece_type == piece_type:
                visually_confirmed.add(coord)
                continue
            fast_batch.append((coord, side, piece_type))

        if fast_batch:
            self._log(f"Fast placing {len(fast_batch)} setup pieces before whole-board verification.")
            for coord, side, piece_type in fast_batch:
                self._place_piece_on_coord_fast(coord, side, piece_type, state, window)
                visually_confirmed.add(coord)
            mismatches = self._wait_for_setup_mismatches(game, visually_confirmed, timeout=1.6, interval=0.12)
        else:
            mismatches = self._wait_for_setup_mismatches(game, visually_confirmed, timeout=1.0, interval=0.12)

        if not mismatches:
            return

        mismatches = self._retry_setup_mismatches(game, mismatches, visually_confirmed)
        if not mismatches:
            return
        self._verify_setup(game, visually_confirmed)

    def _replay_moves(self, game: NotationGame) -> None:
        expected_board = dict(game.setup_pieces)
        for index, move in enumerate(game.moves, start=1):
            state, window = self.capture_board_state()
            self._log(f"Replaying move {index}: {move.side} {move.notation}")
            piece = self._replay_source_piece(index, move, state, expected_board)
            self._verify_replay_destination(index, move, state, expected_board)
            legal_piece = self._piece_as_coord(piece, move.src, state)
            legal_destinations = self.recognizer._legal_destinations(legal_piece, state.pieces)
            if move.dst not in legal_destinations:
                detail = self._live_legality_detail(move, state, piece, legal_destinations)
                self._log(
                    f"Live board legality check rejected move {index} ({move.notation}); "
                    f"continuing from validated notation. {detail}"
                )
            self.click_board_coord(move.src, state, window, after=0.12)
            self.click_board_coord(move.dst, state, window, after=0.42)
            moving_piece = expected_board.pop(move.src, None)
            expected_board[move.dst] = moving_piece or (move.side, move.piece_type)

    def _click_tag_field(self) -> None:
        image, window = self.capture_visible_window()
        match = self._best_text_match(
            image,
            (
                "\u68cb\u8c31\u6807\u9898",
                "\u68cb\u8c31\u6807\u9898\u965020\u4e2a\u5b57",
                "\u965020\u4e2a\u5b57",
            ),
            region=(0.22, 0.22, 0.92, 0.35),
            min_score=0.35,
            allow_partial=False,
        )
        if match is None:
            self._log("Could not OCR the save dialog title placeholder; falling back to the expected field location.")
            self.click_relative(0.475, 0.263, after=0.75)
            return
        self._log(
            f"Clicking detected save dialog title field ({match.text}) "
            f"at ({int(round(match.center[0]))}, {int(round(match.center[1]))})."
        )
        self.click_visible_point(match.center, window, after=0.75)

    def _click_top_text_editor(self) -> None:
        self._log("Clicking top text editor field.")
        self.click_relative(0.12, 0.021, after=0.25)

    def _top_text_editor_is_visible_in_image(self, image: np.ndarray) -> bool:
        top_strip = image[0 : max(1, int(round(image.shape[0] * 0.055))), :, :]
        if top_strip.size == 0:
            return False
        done = self._best_text_match(
            image,
            ("\u5b8c\u6210",),
            region=(0.86, 0.0, 1.0, 0.07),
            min_score=0.35,
            allow_partial=False,
        )
        if done is not None:
            return True
        white_pixels = np.all(top_strip > 190, axis=2)
        green_pixels = (top_strip[:, :, 1] > 120) & (top_strip[:, :, 0] < 130) & (top_strip[:, :, 2] < 130)
        white_fraction = float(np.mean(white_pixels))
        green_fraction = float(np.mean(green_pixels))
        return white_fraction > 0.35 and green_fraction > 0.005

    def _top_text_editor_is_visible(self) -> bool:
        image, _window = self.capture_visible_window()
        return self._top_text_editor_is_visible_in_image(image)

    def _detect_bottom_text_editor(
        self,
        image: np.ndarray,
    ) -> tuple[tuple[float, float], tuple[float, float], tuple[int, int, int, int]] | None:
        height, width = image.shape[:2]
        y_start = int(round(height * 0.84))
        if y_start >= height:
            return None
        bottom = image[y_start:height, :, :]
        b_raw, g_raw, r_raw = cv2.split(bottom)
        b = b_raw.astype(np.int16)
        g = g_raw.astype(np.int16)
        r = r_raw.astype(np.int16)
        hsv = cv2.cvtColor(bottom, cv2.COLOR_BGR2HSV)
        hue = hsv[:, :, 0]
        saturation = hsv[:, :, 1]
        value = hsv[:, :, 2]
        green_mask = (
            (g >= 120)
            & (g >= r + 25)
            & (g >= b + 25)
            & (saturation >= 55)
            & (value >= 110)
            & (hue >= 35)
            & (hue <= 95)
        ).astype(np.uint8) * 255
        x_gate = np.zeros_like(green_mask)
        x_gate[:, int(round(width * 0.70)) :] = 255
        green_mask = cv2.bitwise_and(green_mask, x_gate)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (11, 7))
        green_mask = cv2.morphologyEx(green_mask, cv2.MORPH_CLOSE, kernel)
        contours, _hierarchy = cv2.findContours(green_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        candidates: list[tuple[float, tuple[int, int, int, int]]] = []
        image_area = float(width * height)
        done_text = self._best_text_match(
            image,
            ("\u5b8c\u6210",),
            region=(0.70, 0.84, 1.0, 1.0),
            min_score=0.25,
            allow_partial=False,
        )
        for contour in contours:
            x, y, box_width, box_height = cv2.boundingRect(contour)
            area = float(cv2.contourArea(contour))
            if box_width <= 0 or box_height <= 0:
                continue
            x1 = x
            y1 = y + y_start
            x2 = x + box_width
            y2 = y_start + y + box_height
            area_fraction = area / image_area
            width_fraction = box_width / float(width)
            height_fraction = box_height / float(height)
            aspect = box_width / float(box_height)
            fill = area / float(box_width * box_height)
            if not (0.0010 <= area_fraction <= 0.018):
                continue
            if not (0.045 <= width_fraction <= 0.18 and 0.022 <= height_fraction <= 0.075):
                continue
            if not (0.95 <= aspect <= 2.9 and fill >= 0.36):
                continue
            score = area
            if done_text is not None:
                tx, ty = done_text.center
                if x1 - 10 <= tx <= x2 + 10 and y1 - 10 <= ty <= y2 + 10:
                    score += 100000.0
                else:
                    score += max(0.0, 3500.0 - (math.hypot((x1 + x2) / 2.0 - tx, (y1 + y2) / 2.0 - ty) * 40.0))
            candidates.append((score, (x1, y1, x2, y2)))

        if not candidates:
            if done_text is None:
                return None
            tx, ty = done_text.center
            done_box = (
                int(round(max(0.0, tx - width * 0.055))),
                int(round(max(0.0, ty - height * 0.025))),
                int(round(min(float(width), tx + width * 0.055))),
                int(round(min(float(height), ty + height * 0.025))),
            )
        else:
            _score, done_box = max(candidates, key=lambda item: item[0])

        input_y = (done_box[1] + done_box[3]) / 2.0
        input_x = max(width * 0.08, min(width * 0.48, done_box[0] * 0.48))
        white_region = image[max(0, done_box[1] - 12): min(height, done_box[3] + 12), 0: max(1, done_box[0] - 6), :]
        if white_region.size == 0:
            return None
        near_white = np.all(white_region >= 218, axis=2)
        light_fraction = float(np.mean(near_white))
        if light_fraction < 0.18:
            return None
        done_point = ((done_box[0] + done_box[2]) / 2.0, (done_box[1] + done_box[3]) / 2.0)
        return (input_x, input_y), done_point, done_box

    def _detect_text_editor(
        self,
        image: np.ndarray,
    ) -> tuple[str, tuple[float, float], tuple[float, float], tuple[int, int, int, int] | None] | None:
        bottom = self._detect_bottom_text_editor(image)
        if bottom is not None:
            input_point, done_point, bbox = bottom
            return "bottom", input_point, done_point, bbox
        if self._top_text_editor_is_visible_in_image(image):
            height, width = image.shape[:2]
            return "top", (width * 0.12, height * 0.021), (width * 0.963, height * 0.021), None
        return None

    def _wait_for_text_editor(
        self,
        timeout: float = 3.0,
    ) -> tuple[WindowInfo, str, tuple[float, float], tuple[float, float], tuple[int, int, int, int] | None] | None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            image, window = self.capture_visible_window()
            detected = self._detect_text_editor(image)
            if detected is not None:
                style, input_point, done_point, bbox = detected
                return window, style, input_point, done_point, bbox
            time.sleep(0.18)
        return None

    def _wait_for_top_text_editor(self, timeout: float = 2.0) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self._top_text_editor_is_visible():
                return True
            time.sleep(0.2)
        return False

    def _click_top_text_done(self) -> None:
        self._log("Clicking top text editor done button.")
        self.click_relative(0.963, 0.021, after=0.55)

    def _click_text_editor_done(
        self,
        fallback_window: WindowInfo,
        fallback_point: tuple[float, float],
    ) -> None:
        image, window = self.capture_visible_window()
        detected = self._detect_text_editor(image)
        if detected is not None:
            style, _input_point, done_point, bbox = detected
            bbox_detail = f", bbox={bbox}" if bbox is not None else ""
            self._log(
                f"Clicking {style} text editor done button at "
                f"({int(round(done_point[0]))}, {int(round(done_point[1]))}){bbox_detail}."
            )
            self.click_visible_point(done_point, window, after=0.55)
            return
        self._log(
            f"Clicking text editor done button fallback at "
            f"({int(round(fallback_point[0]))}, {int(round(fallback_point[1]))})."
        )
        self.click_visible_point(fallback_point, fallback_window, after=0.55)

    def _save_dialog_is_visible(self) -> bool:
        image, _window = self.capture_visible_window()
        title = self._best_text_match(
            image,
            ("\u4fdd\u5b58\u68cb\u8c31",),
            region=(0.18, 0.12, 0.82, 0.24),
            min_score=0.35,
            allow_partial=False,
        )
        submit = self._best_text_match(
            image,
            ("\u63d0\u4ea4",),
            region=(0.35, 0.68, 0.90, 0.86),
            min_score=0.35,
            allow_partial=False,
        )
        return title is not None or submit is not None

    def _wait_for_save_dialog_closed(self, timeout: float = 1.5) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if not self._save_dialog_is_visible():
                return True
            time.sleep(0.2)
        return False

    def _click_save_dialog_submit(self) -> None:
        image, window = self.capture_visible_window()
        submit_text = self._best_text_match(
            image,
            ("\u63d0\u4ea4",),
            region=(0.35, 0.68, 0.90, 0.86),
            min_score=0.35,
            allow_partial=False,
        )
        lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
        red_mask = (
            (lab[:, :, 0] >= 70)
            & (lab[:, :, 1] >= 142)
            & (lab[:, :, 2] >= 128)
        ).astype(np.uint8) * 255
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 9))
        red_mask = cv2.morphologyEx(red_mask, cv2.MORPH_CLOSE, kernel)
        contours, _hierarchy = cv2.findContours(red_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        candidates: list[tuple[float, tuple[int, int, int, int], float]] = []
        image_area = float(image.shape[0] * image.shape[1])
        for contour in contours:
            x, y, width, height = cv2.boundingRect(contour)
            area = float(cv2.contourArea(contour))
            if width <= 0 or height <= 0:
                continue
            aspect = width / float(height)
            fill = area / float(width * height)
            area_fraction = area / image_area
            width_fraction = width / float(image.shape[1])
            height_fraction = height / float(image.shape[0])
            if not (0.004 <= area_fraction <= 0.035):
                continue
            if not (0.14 <= width_fraction <= 0.42 and 0.025 <= height_fraction <= 0.09):
                continue
            if not (2.2 <= aspect <= 5.6 and fill >= 0.45):
                continue
            bbox = (x, y, x + width, y + height)
            center_x = (bbox[0] + bbox[2]) / 2.0
            center_y = (bbox[1] + bbox[3]) / 2.0
            score = area
            if submit_text is not None:
                text_x, text_y = submit_text.center
                contains_text = bbox[0] - 12 <= text_x <= bbox[2] + 12 and bbox[1] - 12 <= text_y <= bbox[3] + 12
                distance = math.hypot(center_x - text_x, center_y - text_y)
                score += 100000.0 if contains_text else max(0.0, 5000.0 - (distance * 50.0))
            candidates.append((score, bbox, fill))
        if not candidates:
            if submit_text is not None:
                self._log(
                    f"Could not detect the red submit button shape; clicking detected submit text at "
                    f"({int(round(submit_text.center[0]))}, {int(round(submit_text.center[1]))})."
                )
                self.click_visible_point(submit_text.center, window, after=0.8)
                if self._wait_for_save_dialog_closed():
                    return
                raise TtxqAutomationError("Clicked detected submit text, but the save dialog stayed open.")
            raise TtxqAutomationError("Could not visually detect the red submit button.")
        _score, bbox, fill = max(candidates, key=lambda item: item[0])
        button_point = ((bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0)
        screen_button_point = (window.bbox[0] + button_point[0], window.bbox[1] + button_point[1])
        text_label = f", submit text={submit_text.text!r}" if submit_text is not None else ""
        self._log(
            f"Clicking detected red submit button at ({int(round(button_point[0]))}, "
            f"{int(round(button_point[1]))}), screen=({int(round(screen_button_point[0]))}, "
            f"{int(round(screen_button_point[1]))}), bbox={bbox}, fill={fill:.2f}{text_label}."
        )
        self.click_visible_point(button_point, window, after=0.8)
        if self._wait_for_save_dialog_closed():
            return
        if submit_text is not None:
            self._log(
                f"Save dialog remained open; clicking detected submit text center at "
                f"({int(round(submit_text.center[0]))}, {int(round(submit_text.center[1]))})."
            )
            self.click_visible_point(submit_text.center, window, after=0.8)
            if self._wait_for_save_dialog_closed():
                return
        raise TtxqAutomationError("Clicked detected red submit button, but the save dialog stayed open.")

    def _classify_bottom_action_shape(self, mask: np.ndarray, bbox: tuple[int, int, int, int]) -> str:
        x1, y1, x2, y2 = bbox
        width = max(1, x2 - x1)
        height = max(1, y2 - y1)
        aspect = width / float(height)
        roi = mask[y1:y2, x1:x2]
        if roi.size == 0:
            return "unknown"
        upper = int(np.count_nonzero(roi[: max(1, height // 2), :]))
        lower = int(np.count_nonzero(roi[max(1, height // 2) :, :]))
        fill = float(np.count_nonzero(roi)) / float(width * height)
        if height >= 28 and aspect <= 0.86 and upper >= lower * 0.75 and fill >= 0.18:
            return "hint"
        return "unknown"

    def _detect_bottom_left_action_icon(self, image: np.ndarray) -> ActionIcon | None:
        x1, y1, x2, y2 = self._resolve_region(image, (0.03, 0.86, 0.48, 0.995))
        crop = image[y1:y2, x1:x2]
        if crop.size == 0:
            return None

        hint_text = self._best_text_match(
            image,
            ("\u63d0\u793a",),
            region=(0.03, 0.90, 0.48, 1.0),
            min_score=0.32,
            allow_partial=True,
        )
        answer_text = self._best_text_match(
            image,
            ("\u7b54\u6848",),
            region=(0.03, 0.90, 0.48, 1.0),
            min_score=0.32,
            allow_partial=True,
        )

        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        gray_mask = ((hsv[:, :, 1] <= 110) & (hsv[:, :, 2] >= 82)).astype(np.uint8) * 255
        icon_cutoff = int(round(gray_mask.shape[0] * 0.82))
        gray_mask[icon_cutoff:, :] = 0
        gray_mask = cv2.morphologyEx(gray_mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
        gray_mask = cv2.dilate(gray_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)), iterations=1)

        contours, _hierarchy = cv2.findContours(gray_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        candidates: list[tuple[float, ActionIcon]] = []
        for contour in contours:
            local_x, local_y, width, height = cv2.boundingRect(contour)
            if width < 14 or height < 18 or width > 120 or height > 120:
                continue
            if local_y + height > icon_cutoff + 4:
                continue
            area = float(cv2.contourArea(contour))
            if area < 90:
                continue
            local_bbox = (local_x, local_y, local_x + width, local_y + height)
            active_roi = hsv[local_y : local_y + height, local_x : local_x + width]
            active_pixels = int(np.count_nonzero((active_roi[:, :, 1] <= 95) & (active_roi[:, :, 2] >= 175)))
            mask_roi = gray_mask[local_y : local_y + height, local_x : local_x + width]
            mean_value = float(np.mean(active_roi[:, :, 2][mask_roi > 0])) if np.count_nonzero(mask_roi) else 0.0
            active_ratio = active_pixels / float(width * height)
            active = active_pixels >= max(55, int(width * height * 0.10)) and mean_value >= 145.0
            shape_kind = self._classify_bottom_action_shape(gray_mask, local_bbox)
            kind = shape_kind
            if hint_text is not None:
                kind = "hint"
            if answer_text is not None:
                kind = "key"
            center = (x1 + local_x + (width / 2.0), y1 + local_y + (height / 2.0))
            bbox = (x1 + local_x, y1 + local_y, x1 + local_x + width, y1 + local_y + height)
            confidence = (active_ratio * 2.0) + (mean_value / 255.0) + (area / 2500.0)
            desired_x = crop.shape[1] * 0.50
            score = confidence - (abs((local_x + width / 2.0) - desired_x) / max(1.0, crop.shape[1]))
            candidates.append((score, ActionIcon(kind=kind, center=center, bbox=bbox, active=active, confidence=confidence)))

        if not candidates:
            return None
        return max(candidates, key=lambda item: item[0])[1]

    def hint_button_is_visible(self) -> bool:
        image, _window = self.capture_visible_window()
        icon = self._detect_bottom_left_action_icon(image)
        return icon is not None and icon.kind == "hint"

    def wait_for_ready_hint_button(self, timeout: float = 12.0, poll: float = 0.35) -> tuple[ActionIcon, WindowInfo] | None:
        deadline = time.time() + timeout
        saw_hint = False
        while time.time() < deadline:
            image, window = self.capture_visible_window()
            icon = self._detect_bottom_left_action_icon(image)
            if icon is None:
                return None
            if icon.kind != "hint":
                return None
            saw_hint = True
            if icon.active:
                self._log(
                    f"Detected active hint icon at ({int(round(icon.center[0]))}, "
                    f"{int(round(icon.center[1]))})."
                )
                return icon, window
            time.sleep(poll)
        if saw_hint:
            raise TtxqAutomationError("The hint button was visible, but it did not light up.")
        return None

    def wait_for_answer_key_button(self, timeout: float = 6.0, poll: float = 0.25) -> tuple[ActionIcon, WindowInfo]:
        deadline = time.time() + timeout
        last_icon: ActionIcon | None = None
        while time.time() < deadline:
            image, window = self.capture_visible_window()
            icon = self._detect_bottom_left_action_icon(image)
            if icon is not None:
                last_icon = icon
                if icon.kind == "key":
                    self._log(
                        f"Detected visible answer key icon at ({int(round(icon.center[0]))}, "
                        f"{int(round(icon.center[1]))})."
                    )
                    return icon, window
                if icon.active and icon.kind == "unknown":
                    self._log(
                        f"Detected active bottom-left action icon at ({int(round(icon.center[0]))}, "
                        f"{int(round(icon.center[1]))}), kind={icon.kind}."
                    )
                    return icon, window
            time.sleep(poll)
        detail = f" Last detected bottom-left icon was {last_icon.kind}." if last_icon is not None else ""
        raise TtxqAutomationError(f"The answer key icon did not appear after clicking hint.{detail}")

    def click_action_icon(self, icon: ActionIcon, window: WindowInfo, label: str, after: float = 0.55) -> None:
        self._log(
            f"Clicking detected {label} icon at ({int(round(icon.center[0]))}, "
            f"{int(round(icon.center[1]))}), bbox={icon.bbox}, active={icon.active}."
        )
        self.click_visible_point(icon.center, window, after=after)

    def click_back_arrow(self) -> None:
        image, window = self.capture_visible_window()
        x1, y1, x2, y2 = self._resolve_region(image, (0.0, 0.0, 0.22, 0.11))
        crop = image[y1:y2, x1:x2]
        if crop.size == 0:
            raise TtxqAutomationError("Could not inspect the back-arrow area.")
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        circles = cv2.HoughCircles(
            gray,
            cv2.HOUGH_GRADIENT,
            dp=1.2,
            minDist=max(24, min(crop.shape[:2]) // 2),
            param1=80,
            param2=20,
            minRadius=max(12, int(min(crop.shape[:2]) * 0.16)),
            maxRadius=max(24, int(min(crop.shape[:2]) * 0.42)),
        )
        candidates: list[tuple[float, tuple[float, float], float]] = []
        if circles is not None:
            for cx, cy, radius in circles[0]:
                if cx < crop.shape[1] * 0.12 or cy < crop.shape[0] * 0.12:
                    continue
                if cx > crop.shape[1] * 0.82 or cy > crop.shape[0] * 0.88:
                    continue
                mask = np.zeros(gray.shape, dtype=np.uint8)
                cv2.circle(mask, (int(round(cx)), int(round(cy))), int(round(radius)), 255, 2)
                edge_strength = float(np.mean(gray[mask > 0]))
                score = edge_strength - abs(cx - crop.shape[1] * 0.44) - abs(cy - crop.shape[0] * 0.44)
                candidates.append((score, (x1 + float(cx), y1 + float(cy)), float(radius)))
        if not candidates:
            edges = cv2.Canny(gray, 50, 130)
            contours, _hierarchy = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            for contour in contours:
                area = float(cv2.contourArea(contour))
                if area < 500:
                    continue
                (cx, cy), radius = cv2.minEnclosingCircle(contour)
                if radius < 18 or radius > 55:
                    continue
                circularity = area / max(1.0, math.pi * radius * radius)
                if circularity < 0.35:
                    continue
                score = area * circularity - abs(cx - crop.shape[1] * 0.44) - abs(cy - crop.shape[0] * 0.44)
                candidates.append((score, (x1 + float(cx), y1 + float(cy)), float(radius)))
        if not candidates:
            raise TtxqAutomationError("Could not visually detect the top-left back arrow button.")
        _score, point, radius = max(candidates, key=lambda item: item[0])
        self._log(
            f"Clicking detected back arrow circle at ({int(round(point[0]))}, "
            f"{int(round(point[1]))}), radius={radius:.1f}."
        )
        self.click_visible_point(point, window, after=0.7)

    def click_menu_row(self, label: str, row_index: int, after: float = 0.75) -> None:
        row_center_y = 0.512 + ((row_index - 1) * 0.070)
        self._log(f"Clicking menu row {row_index}: {label}.")
        self.click_relative(0.20, row_center_y, after=after)

    def click_bottom_menu_button(self, after: float = 0.55) -> None:
        self.click_text(
            "menu",
            region=(0.0, 0.80, 0.34, 1.0),
            retries=3,
            after=after,
            fallback_points=[
                (0.36, 0.74),
                (0.36, 0.66),
                (0.30, 0.74),
            ],
        )

    def _click_menu_item_with_fallback(
        self,
        aliases: str | Sequence[str],
        label: str,
        row_index: int,
        after: float = 0.75,
    ) -> None:
        if self.try_click_text(
            aliases,
            region=(0.03, 0.30, 0.58, 0.92),
            retries=2,
            after=after,
            allow_partial=True,
        ):
            return
        self.click_menu_row(label, row_index=row_index, after=after)

    def _click_save_record_menu_item(self) -> None:
        self._click_menu_item_with_fallback(
            "save_record",
            label="save record",
            row_index=3,
            after=0.9,
        )

    def _click_exit_menu_item(self) -> None:
        self._click_menu_item_with_fallback(
            ("\u9000\u51fa", "\u8fd4\u56de", "\u56de\u5230\u4e3b\u83dc\u5355", "exit", "return"),
            label="exit",
            row_index=1,
            after=0.85,
        )

    def _main_screen_is_visible(self, timeout: float = 3.0) -> bool:
        return self.wait_for_text(
            "notation",
            region=(0.05, 0.30, 0.55, 0.48),
            timeout=timeout,
            min_score=0.35,
        )

    def _return_to_main_after_save(self) -> None:
        if self._main_screen_is_visible(timeout=0.7):
            return

        self._log("Returning to the main screen after saving: opening the bottom menu.")
        self.click_bottom_menu_button(after=0.45)
        self._click_exit_menu_item()
        if self._main_screen_is_visible(timeout=4.0):
            return

        self._log("Main screen was not detected after menu exit; trying the top-left app back arrow.")
        self.click_back_arrow()
        if self._main_screen_is_visible(timeout=4.0):
            return

        raise TtxqAutomationError("The app did not return to the main screen after saving the notation.")

    def upload_notation(self, game: NotationGame, game_name: str) -> None:
        self._log(f"Uploading {game.file_path.name} as '{game_name}'.")
        validation_error = validate_notation_game(game)
        if validation_error is not None:
            raise TtxqAutomationError(f"Refusing to upload invalid notation: {validation_error}")
        self._ensure_input_desktop()
        opened = False
        for attempt in range(3):
            self.click_text(
                "notation",
                region=(0.05, 0.30, 0.55, 0.48),
                retries=4,
                after=0.85,
                fallback_points=[
                    (0.34, 0.40),
                    (0.34, 0.48),
                    (0.30, 0.40),
                    (0.40, 0.40),
                ],
            )
            if self.wait_for_text(
                "set_position",
                region=(0.0, 0.72, 1.0, 1.0),
                timeout=3.0,
                min_score=0.35,
            ):
                opened = True
                break
            self._log(f"Notation editor still not visible after 记谱 click (attempt {attempt + 1}/3). Retrying.")
            time.sleep(0.45)
        if not opened:
            raise TtxqAutomationError("The notation editor did not appear after opening 记谱.")
        self.click_text("set_position", region=(0.0, 0.72, 1.0, 1.0), after=0.8)
        self.click_text("create_position", region=(0.10, 0.10, 0.90, 0.72), after=1.0)
        self._apply_setup_position(game)
        self.click_text("finish", region=(0.66, 0.80, 1.0, 1.0), after=0.9)
        self._replay_moves(game)
        self.click_text("menu", region=(0.0, 0.80, 0.34, 1.0), after=0.55)
        self.click_text("edit_tag", region=(0.30, 0.20, 0.98, 0.98), after=0.65)
        self._click_tag_field()
        editor = self._wait_for_text_editor()
        if editor is None:
            raise TtxqAutomationError("The text editor did not appear after clicking the detected game name field.")
        editor_window, editor_style, editor_input, editor_done, editor_bbox = editor
        bbox_detail = f", done bbox={editor_bbox}" if editor_bbox is not None else ""
        self._log(
            f"Detected {editor_style} text editor; clicking input at "
            f"({int(round(editor_input[0]))}, {int(round(editor_input[1]))}){bbox_detail}."
        )
        self.click_visible_point(editor_input, editor_window, after=0.25)
        self._enter_text(game_name)
        self._click_text_editor_done(editor_window, editor_done)
        time.sleep(0.25)
        self._click_save_dialog_submit()
        self.click_bottom_menu_button(after=0.55)
        self._click_save_record_menu_item()
        self._return_to_main_after_save()
