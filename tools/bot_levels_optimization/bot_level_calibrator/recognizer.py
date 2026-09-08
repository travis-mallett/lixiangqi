from __future__ import annotations

import ctypes
import json
import math
import re
import shutil
import threading
import time
from collections import Counter
from pathlib import Path
from typing import Iterable, Sequence

from .constants import (
    CATALOG_VERSION,
    FILE_LETTERS,
    FILE_TO_INDEX,
    KNOWN_GLYPHS,
    LALG_TO_PIECE,
    MASK_SIZE,
    PIECE_TO_LALG,
    START_POSITION_MAP,
)
from .models import (
    BoardState,
    DetectedPiece,
    MoveRecord,
    MoveDetectionError,
    NoBoardChangeError,
    WindowInfo,
)
from .paths import PROJECT_ROOT
from .platform import _make_process_dpi_aware
from .runtime import Image, ImageGrab, PieceRapidOCR, RapidOCR, WindowsCapture, cv2, np, win32api, win32con
from .vision import FixedThemeVision

class XiangqiRecognizer:
    OCR_OVERRIDE_MIN_CONFIDENCE = 0.64
    OCR_OVERRIDE_MIN_PIECE_SCORE = 0.45
    TEMPLATE_AMBIGUOUS_MARGIN = 0.08
    TRANSITION_TEMPLATE_MIN_CONFIDENCE = 0.72

    def __init__(self) -> None:
        _make_process_dpi_aware()
        self.base_dir = PROJECT_ROOT
        self.catalog_dir = self.base_dir / "piece_catalog"
        self.fixed_vision = FixedThemeVision(self.catalog_dir)
        self.catalog_mask_scale = self.fixed_vision.CATALOG_MASK_SCALE
        self.mask_scales = self.fixed_vision.MASK_SCALES
        self.direct_template_size = 128
        self.hog = self.fixed_vision.hog
        self.template_bank: dict[str, dict[str, list[np.ndarray]]] = {"red": {}, "black": {}}
        self.patch_template_bank: dict[str, dict[str, list[tuple[np.ndarray, np.ndarray]]]] = {"red": {}, "black": {}}
        self.direct_template_bank: dict[str, dict[str, list[tuple[np.ndarray, np.ndarray, np.ndarray, float]]]] = {"red": {}, "black": {}}
        self.mask_feature_bank: dict[str, dict[str, np.ndarray | list[str]]] = {}
        self.ocr: object | None = None
        self.piece_ocr: object | None = None
        self.enable_ocr_fallback = False
        # Windows Graphics Capture is a streaming API. Starting and stopping a
        # session for every observation adds far more latency than the board
        # recognizer itself, so retain one stream and read its latest frame.
        self._capture_condition = threading.Condition()
        self._capture_hwnd: int | None = None
        self._capture_object: object | None = None
        self._capture_control: object | None = None
        self._capture_frame: np.ndarray | None = None
        self._capture_closed = False

    @staticmethod
    def _ttxq_title_score(title: str) -> int:
        title_l = title.lower()
        exact_chinese = "\u5929\u5929\u8c61\u68cb" in title
        chinese_xiangqi = "\u8c61\u68cb" in title

        if exact_chinese:
            score = 500
        elif chinese_xiangqi:
            score = 430
        elif "ttxq" in title_l:
            score = 340
        elif re.search(r"\bxiangqi\b", title_l):
            score = 160
        elif re.search(r"\bchinese\s+chess\b", title_l):
            score = 140
        elif re.search(r"\bchess\b", title_l):
            score = 90
        elif re.search(r"\bxq\b", title_l):
            score = 60
        else:
            return 0

        non_game_markers = (
            "file explorer",
            "windows explorer",
            "xiangqi capture",
            "codex",
            "visual studio code",
            "powershell",
            "terminal",
            "command prompt",
        )
        strong_game_title = exact_chinese or chinese_xiangqi or "ttxq" in title_l
        if not strong_game_title and any(marker in title_l for marker in non_game_markers):
            return 0
        return score

    @staticmethod
    def _ttxq_window_rank(window: WindowInfo) -> tuple[int, int, int]:
        score = XiangqiRecognizer._ttxq_title_score(window.title)
        left, top, right, bottom = window.bbox
        width = max(0, right - left)
        height = max(0, bottom - top)
        aspect = width / max(height, 1)
        portrait_bonus = 40 if 0.42 <= aspect <= 0.86 else 15 if 0.86 < aspect <= 1.08 else 0
        area_bonus = min(width * height, 1_500_000) // 20_000
        return (score, portrait_bonus, area_bonus)

    def find_window(self) -> WindowInfo:
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        enum_windows = user32.EnumWindows
        is_window_visible = user32.IsWindowVisible
        is_window_enabled = user32.IsWindowEnabled
        get_window_text_length = user32.GetWindowTextLengthW
        get_window_text = user32.GetWindowTextW
        get_window_rect = user32.GetWindowRect
        get_foreground_window = user32.GetForegroundWindow

        class RECT(ctypes.Structure):
            _fields_ = [
                ("left", ctypes.c_long),
                ("top", ctypes.c_long),
                ("right", ctypes.c_long),
                ("bottom", ctypes.c_long),
            ]

        matches: list[WindowInfo] = []
        hidden_matches: list[WindowInfo] = []

        def _title_looks_like_ttxq(title: str) -> bool:
            return self._ttxq_title_score(title) > 0

        @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
        def enum_proc(hwnd: int, _lparam: int) -> bool:
            if not is_window_enabled(hwnd):
                return True
            length = get_window_text_length(hwnd)
            if not length:
                return True
            text = ctypes.create_unicode_buffer(length + 1)
            get_window_text(hwnd, text, length + 1)
            title = text.value.strip()
            if not title:
                return True
            if not _title_looks_like_ttxq(title):
                return True
            rect = RECT()
            get_window_rect(hwnd, ctypes.byref(rect))
            width = rect.right - rect.left
            height = rect.bottom - rect.top
            if width < 300 or height < 300:
                return True
            window = WindowInfo(
                hwnd=hwnd,
                title=title,
                bbox=(rect.left, rect.top, rect.right, rect.bottom),
            )
            if is_window_visible(hwnd):
                matches.append(window)
            else:
                hidden_matches.append(window)
            return True

        if not enum_windows(enum_proc, 0):
            raise RuntimeError("Failed to enumerate windows.")
        candidates = matches or hidden_matches
        if candidates:
            candidates.sort(key=self._ttxq_window_rank, reverse=True)
            return candidates[0]

        @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
        def fallback_proc(hwnd: int, _lparam: int) -> bool:
            if not is_window_enabled(hwnd) or not is_window_visible(hwnd):
                return True
            length = get_window_text_length(hwnd)
            if not length:
                return True
            text = ctypes.create_unicode_buffer(length + 1)
            get_window_text(hwnd, text, length + 1)
            title = text.value.strip()
            if not title:
                return True
            if self._ttxq_title_score(title) <= 0:
                return True
            title_l = title.lower()
            if "\u8c61\u68cb" in title:
                title_l = f"{title_l} xiangqi"
            if "象" not in title and "棋" not in title and "xiangqi" not in title_l and "ttxq" not in title_l and "chess" not in title_l:
                return True
            rect = RECT()
            get_window_rect(hwnd, ctypes.byref(rect))
            width = rect.right - rect.left
            height = rect.bottom - rect.top
            if width < 300 or height < 300:
                return True
            matches.append(
                WindowInfo(
                    hwnd=hwnd,
                    title=title,
                    bbox=(rect.left, rect.top, rect.right, rect.bottom),
                )
            )
            return True

        enum_windows(fallback_proc, 0)
        if matches:
            matches.sort(key=self._ttxq_window_rank, reverse=True)
            return matches[0]

        foreground = get_foreground_window()
        if foreground:
            if not is_window_enabled(foreground):
                raise RuntimeError("Could not find a usable 天天象棋 window.")
            length = get_window_text_length(foreground)
            if length:
                text = ctypes.create_unicode_buffer(length + 1)
                get_window_text(foreground, text, length + 1)
                title = text.value.strip()
                if title and _title_looks_like_ttxq(title):
                    rect = RECT()
                    get_window_rect(foreground, ctypes.byref(rect))
                    width = rect.right - rect.left
                    height = rect.bottom - rect.top
                    if width >= 300 and height >= 300:
                        return WindowInfo(
                            hwnd=foreground,
                            title=title,
                            bbox=(rect.left, rect.top, rect.right, rect.bottom),
                        )
        raise RuntimeError("Could not find a visible 天天象棋 window.")

    def capture_window(self, image_path: Path | None = None) -> tuple[np.ndarray, WindowInfo | None]:
        if image_path is not None:
            try:
                image_data = np.fromfile(str(image_path), dtype=np.uint8)
                image = cv2.imdecode(image_data, cv2.IMREAD_COLOR)
            except Exception:
                image = None
            if image is None:
                raise RuntimeError(f"Could not open image: {image_path}")
            return image, None

        window = self.find_window()
        image = self._capture_window_pixels(window)
        return image, window

    def _get_ocr(self) -> object:
        raise RuntimeError(
            "OCR is disabled in the bot-level optimizer; use fixed-theme template vision."
        )

    def _piece_ocr_model_params(self) -> dict[str, object] | None:
        if PieceRapidOCR is None:
            return None
        try:
            import rapidocr
        except ImportError:
            return None
        model_dir = Path(rapidocr.__file__).resolve().parent / "models"
        det_model = model_dir / "ch_PP-OCRv4_det_infer.onnx"
        cls_model = model_dir / "ch_ppocr_mobile_v2.0_cls_infer.onnx"
        rec_model = model_dir / "ch_PP-OCRv4_rec_infer.onnx"
        keys = model_dir / "ppocr_keys_v1.txt"
        if not (det_model.exists() and cls_model.exists() and rec_model.exists() and keys.exists()):
            return None
        return {
            "Det.model_path": str(det_model),
            "Cls.model_path": str(cls_model),
            "Rec.model_path": str(rec_model),
            "Rec.rec_keys_path": str(keys),
            "Global.use_det": False,
            "Global.use_cls": False,
            "Global.use_rec": True,
            "Global.log_level": "error",
        }

    def _get_piece_ocr(self) -> object:
        if self.piece_ocr is not None:
            return self.piece_ocr
        params = self._piece_ocr_model_params()
        if PieceRapidOCR is not None and params is not None:
            self.piece_ocr = PieceRapidOCR(params=params)
        else:
            self.piece_ocr = self._get_ocr()
        return self.piece_ocr

    def _capture_window_pixels(self, window: WindowInfo) -> np.ndarray:
        if WindowsCapture is not None:
            captured = self._capture_with_windows_graphics(window.hwnd)
            if captured is not None and captured.size > 0:
                return captured
        left, top, right, bottom = window.bbox
        image = ImageGrab.grab(bbox=(left, top, right, bottom), all_screens=True)
        return cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)

    def _capture_with_windows_graphics(self, hwnd: int) -> np.ndarray | None:
        with self._capture_condition:
            if self._capture_hwnd == int(hwnd) and not self._capture_closed:
                if self._capture_frame is not None:
                    return self._capture_frame
            else:
                self._stop_graphics_capture_locked()

            if self._capture_object is None:
                try:
                    capture = WindowsCapture(
                        cursor_capture=False,
                        draw_border=False,
                        window_hwnd=int(hwnd),
                    )
                except Exception:  # pragma: no cover - runtime-dependent.
                    return None

                @capture.event
                def on_frame_arrived(frame, _control) -> None:
                    image = frame.convert_to_bgr().frame_buffer.copy()
                    with self._capture_condition:
                        self._capture_frame = image
                        self._capture_condition.notify_all()

                @capture.event
                def on_closed() -> None:
                    with self._capture_condition:
                        self._capture_closed = True
                        self._capture_condition.notify_all()

                self._capture_hwnd = int(hwnd)
                self._capture_object = capture
                self._capture_frame = None
                self._capture_closed = False
                try:
                    self._capture_control = capture.start_free_threaded()
                except Exception:  # pragma: no cover - runtime-dependent.
                    self._stop_graphics_capture_locked()
                    return None

            deadline = time.monotonic() + 1.0
            while self._capture_frame is None and not self._capture_closed:
                remaining = deadline - time.monotonic()
                if remaining <= 0.0:
                    self._stop_graphics_capture_locked()
                    return None
                self._capture_condition.wait(remaining)
            return self._capture_frame

    def close_capture(self) -> None:
        """Release the retained Graphics Capture stream."""
        with self._capture_condition:
            self._stop_graphics_capture_locked()

    def _stop_graphics_capture_locked(self) -> None:
        control = self._capture_control
        self._capture_control = None
        self._capture_object = None
        self._capture_hwnd = None
        self._capture_frame = None
        self._capture_closed = False
        if control is not None:
            try:
                control.stop()
            except Exception:  # pragma: no cover - runtime-dependent.
                pass

    def detect_board(self, image: np.ndarray) -> tuple[tuple[int, int, int, int], list[float], list[float]]:
        return self.fixed_vision.detect_board(image)

    def recognize_board(self, image: np.ndarray) -> BoardState:
        return self.fixed_vision.recognize_board(image)

    def recognize_initial_board(
        self,
        image: np.ndarray,
        bottom_side: str,
        geometry: tuple[tuple[int, int, int, int], list[float], list[float]] | None = None,
    ) -> BoardState:
        """Verify opening occupancy without reclassifying 32 known glyphs.

        The controller has already selected the human/Lixiangqi side, which is
        the side displayed at the bottom. Before our first click the only legal
        deviation from the standard map is Tiantian Red's non-capturing first
        move. Coin occupancy is therefore sufficient and much cheaper than HOG
        classification of every opening piece.
        """
        if bottom_side not in ("red", "black"):
            raise ValueError(f"Invalid bottom side: {bottom_side!r}.")
        board_bbox, grid_x, grid_y = geometry or self.detect_board(image)
        step_x = float(np.median(np.diff(grid_x)))
        step_y = float(np.median(np.diff(grid_y)))
        step = (step_x + step_y) / 2.0
        pieces: dict[str, DetectedPiece] = {}
        warnings: list[str] = []

        for physical_row, y in enumerate(grid_y):
            for physical_col, x in enumerate(grid_x):
                patch, radius = self.fixed_vision.extract_intersection_patch(image, x, y, step)
                if patch is None:
                    continue
                present, _coin_score = self.fixed_vision.piece_present(patch, radius)
                if not present:
                    continue
                if bottom_side == "red":
                    col = physical_col
                    row = 9 - physical_row
                else:
                    col = 8 - physical_col
                    row = physical_row
                coord = f"{FILE_LETTERS[col]}{row}"
                start_piece = START_POSITION_MAP.get(coord)
                if start_piece is None:
                    side, piece_type = "red", "p"
                    warnings.append(f"Opening observer found Red's moved piece at {coord}.")
                else:
                    side, piece_type = start_piece
                pieces[coord] = DetectedPiece(
                    side=side,
                    piece_type=piece_type,
                    col=col,
                    row=row,
                    center=(x, y),
                    radius=radius,
                    confidence=1.0,
                    glyphs=[("canonical-opening", 1.0)],
                )

        overlay = self._draw_overlay(image, board_bbox, grid_x, grid_y, pieces)
        setup_entries = [f"{piece.setup_code}{piece.coord}" for _, piece in sorted(pieces.items())]
        return BoardState(
            pieces=pieces,
            board_bbox=board_bbox,
            grid_x=list(grid_x),
            grid_y=list(grid_y),
            overlay_image=overlay,
            setup_entries=setup_entries,
            warnings=warnings,
            source_image=image.copy(),
        )

    def recognize_transition_board(self, reference: BoardState, image: np.ndarray) -> BoardState:
        """Observe occupancy and colour on a previously calibrated board grid.

        Full recognition locates the grid and runs glyph/HOG matching for every
        piece. That is appropriate for initial setup, but wasteful between moves:
        canonical history already owns the grid and every piece identity. This
        transition observer therefore compares all 90 known intersections, then
        runs occupancy and artwork probes only where pixels changed materially.
        """
        if image.shape[:2] != reference.overlay_image.shape[:2]:
            raise RuntimeError("Tiantian window geometry changed during the game.")

        step = self._grid_step(reference)
        changed: set[str] = set()
        if reference.source_image is not None and reference.source_image.shape == image.shape:
            diff_scores: dict[str, float] = {}
            half = int(max(12, round(step * 0.36)))
            for col, letter in enumerate(FILE_LETTERS):
                for row in range(10):
                    coord = f"{letter}{row}"
                    center_x, center_y = self._physical_center(reference, col, row)
                    cx = int(round(center_x))
                    cy = int(round(center_y))
                    x1, x2 = cx - half, cx + half
                    y1, y2 = cy - half, cy + half
                    if x1 < 0 or y1 < 0 or x2 > image.shape[1] or y2 > image.shape[0]:
                        continue
                    before = reference.source_image[y1:y2, x1:x2]
                    after = image[y1:y2, x1:x2]
                    if before.shape == after.shape:
                        diff_scores[coord] = float(cv2.absdiff(before, after).mean())
            changed = set(self._select_changed_coords(diff_scores))
            # A capture onto an occupied square can change fewer pixels than
            # source/destination highlights because the round coin remains in
            # place. Never let the top-six animation ranking hide such a side
            # replacement: audit every materially changed canonical occupant.
            changed.update(
                coord
                for coord, score in diff_scores.items()
                if coord in reference.pieces and score >= 2.0
            )

        pieces: dict[str, DetectedPiece] = dict(reference.pieces)
        warnings: list[str] = []
        for coord in changed:
            col = FILE_TO_INDEX[coord[0]]
            row = int(coord[1])
            center = self._physical_center(reference, col, row)
            patch, radius = self.fixed_vision.extract_intersection_patch(
                image,
                center[0],
                center[1],
                step,
            )
            if patch is None:
                continue
            present, _coin_score = self.fixed_vision.piece_present(patch, radius)
            if not present:
                pieces.pop(coord, None)
                continue

            prior = reference.pieces.get(coord)
            classified = self.fixed_vision.classify_piece(patch, radius)
            if classified is not None:
                side, piece_type, confidence, glyphs = classified
            elif prior is not None:
                side = prior.side
                piece_type = prior.piece_type
                confidence = prior.confidence
                glyphs = [("canonical-occupancy", 1.0)]
            else:
                # New occupied squares need only a colour for canonical
                # transition matching; history supplies their true identity.
                side = self.fixed_vision._estimate_piece_side(patch)
                piece_type = "p"
                confidence = 0.60
                glyphs = [("transition-side", 1.0)]
                warnings.append(f"Transition observer estimated colour only at {coord}.")
            pieces[coord] = DetectedPiece(
                side=side,
                piece_type=piece_type,
                col=col,
                row=row,
                center=center,
                radius=radius,
                confidence=confidence,
                glyphs=glyphs,
            )

        if len(pieces) < 2:
            raise RuntimeError("The known Tiantian board grid is no longer visibly occupied.")
        overlay = self._draw_overlay(
            image,
            reference.board_bbox,
            reference.grid_x,
            reference.grid_y,
            pieces,
        )
        return BoardState(
            pieces=pieces,
            board_bbox=reference.board_bbox,
            grid_x=list(reference.grid_x),
            grid_y=list(reference.grid_y),
            overlay_image=overlay,
            setup_entries=[],
            warnings=warnings,
            source_image=image.copy(),
        )

    def _recognize_board_with_piece_ocr(self, image: np.ndarray) -> BoardState:
        board_bbox, grid_x, grid_y = self.fixed_vision.detect_board(image)
        step_x = float(np.median(np.diff(grid_x)))
        step_y = float(np.median(np.diff(grid_y)))
        step = float((step_x + step_y) / 2.0)

        occupied: list[dict[str, object]] = []
        variants: list[np.ndarray] = []
        for row_index, y in enumerate(grid_y):
            for col_index, x in enumerate(grid_x):
                coord = f"{FILE_LETTERS[col_index]}{9 - row_index}"
                patch, radius = self.fixed_vision.extract_intersection_patch(image, x, y, step)
                if patch is None:
                    continue
                present, coin_score = self.fixed_vision.piece_present(patch, radius)
                if not present:
                    continue
                side = self.fixed_vision._estimate_piece_side(patch)
                start = len(variants)
                variants.extend(self._piece_ocr_variants(patch, radius, side))
                occupied.append(
                    {
                        "coord": coord,
                        "col": col_index,
                        "row": 9 - row_index,
                        "center": (x, y),
                        "patch": patch,
                        "radius": radius,
                        "side": side,
                        "coin_score": coin_score,
                        "start": start,
                        "end": len(variants),
                    }
                )

        recognized_text = self._recognize_piece_text_batch(variants) if variants else []
        pieces: dict[str, DetectedPiece] = {}
        warnings: list[str] = []
        for item in occupied:
            start = int(item["start"])
            end = int(item["end"])
            side = str(item["side"])
            ocr_classified = self._classify_piece_from_ocr_results(recognized_text[start:end], side)
            template_classified = self.fixed_vision.classify_piece(item["patch"], float(item["radius"]))  # type: ignore[arg-type]
            classified = self._choose_piece_classification(ocr_classified, template_classified)
            if classified is None:
                warnings.append(
                    f"Occupied intersection at {str(item['coord']).upper()} could not be classified "
                    f"(coin score {float(item['coin_score']):.1f})."
                )
                continue
            else:
                side, piece_type, confidence, glyphs = classified

            piece = DetectedPiece(
                side=side,
                piece_type=piece_type,
                col=int(item["col"]),
                row=int(item["row"]),
                center=item["center"],  # type: ignore[arg-type]
                radius=float(item["radius"]),
                confidence=confidence,
                glyphs=glyphs,
            )
            pieces[piece.coord] = piece

        if pieces:
            pieces = self.fixed_vision._orient_pieces(pieces)
            pieces, legality_warnings = self.fixed_vision._repair_impossible_setup_pieces(pieces)
            warnings.extend(legality_warnings)
            pieces = self.fixed_vision._repair_missing_generals(pieces)
            pieces, count_warnings = self.fixed_vision._repair_piece_count_overflows(pieces)
            warnings.extend(count_warnings)

        overlay = self.fixed_vision.draw_overlay(image, board_bbox, grid_x, grid_y, pieces)
        setup_entries = [f"{piece.setup_code}{piece.coord}" for _, piece in sorted(pieces.items())]
        return BoardState(
            pieces=pieces,
            board_bbox=board_bbox,
            grid_x=grid_x,
            grid_y=grid_y,
            overlay_image=overlay,
            setup_entries=setup_entries,
            warnings=warnings,
            source_image=image.copy(),
        )

    def _piece_ocr_variants(self, patch: np.ndarray, radius: float, side: str) -> list[np.ndarray]:
        pad_large = max(12, int(radius * 0.28))
        padded = self._pad_patch(patch, pad_large)
        return [
            variant
            for variant in (
                self._variant_original(patch),
                self._variant_mask_for_side(patch, side, 0.24),
                self._variant_mask_for_side(patch, side, 0.28),
                self._variant_mask_for_side(patch, side, 0.31),
                self._variant_mask(patch, radius, 0.24, 0),
                self._variant_mask(patch, radius, 0.28, 0),
                self._variant_otsu(patch, invert=True),
                self._variant_original(padded),
                self._variant_mask_for_side(padded, side, 0.28),
                self._variant_mask(padded, radius + pad_large, 0.28, 0),
            )
            if variant is not None
        ]

    def _recognize_piece_text_batch(self, variants: Sequence[np.ndarray]) -> list[tuple[str, float]]:
        if not variants:
            return []
        ocr = self._get_piece_ocr()
        if hasattr(ocr, "recognize_txt"):
            result = ocr.recognize_txt(list(variants))
            txts = getattr(result, "txts", None)
            scores = getattr(result, "scores", None)
            if txts is not None and scores is not None:
                return [(str(text or ""), float(score or 0.0)) for text, score in zip(txts, scores)]
        if hasattr(ocr, "text_rec"):
            rec_res, _elapsed = ocr.text_rec(list(variants))
            return [(str(text or ""), float(score or 0.0)) for text, score in rec_res]
        output: list[tuple[str, float]] = []
        for variant in variants:
            result, _ = self._get_ocr()(variant)
            if result:
                text = str(result[0][1]).strip()
                score = float(result[0][2])
                output.append((text, score))
            else:
                output.append(("", 0.0))
        return output

    def _classify_piece_from_ocr_results(
        self,
        results: Sequence[tuple[str, float]],
        side: str,
    ) -> tuple[str, str, float, list[tuple[str, float]]] | None:
        best_by_type: dict[str, float] = {}
        votes_by_type: Counter[str] = Counter()
        glyph_scores: dict[str, float] = {}
        for text, score in results:
            glyph = self._normalize_ocr_text(text)
            if glyph is None:
                continue
            piece_type = KNOWN_GLYPHS[glyph]
            if score < 0.12:
                continue
            best_by_type[piece_type] = max(best_by_type.get(piece_type, 0.0), float(score))
            votes_by_type[piece_type] += 1
            glyph_scores[glyph] = max(glyph_scores.get(glyph, 0.0), float(score))

        if not best_by_type:
            return None

        ranked_types = sorted(
            best_by_type,
            key=lambda piece_type: (
                best_by_type[piece_type] + (0.07 * max(0, votes_by_type[piece_type] - 1)),
                votes_by_type[piece_type],
            ),
            reverse=True,
        )
        piece_type = ranked_types[0]
        best_score = best_by_type[piece_type]
        vote_count = votes_by_type[piece_type]
        if best_score < 0.22 and vote_count < 2:
            return None
        confidence = min(0.99, max(0.55, best_score + (0.07 * max(0, vote_count - 1))))
        glyphs = sorted(
            glyph_scores.items(),
            key=lambda item: item[1],
            reverse=True,
        )[:5]
        return side, piece_type, confidence, [(f"ocr:{glyph}", score) for glyph, score in glyphs]

    def _detect_pieces_by_circles(
        self,
        image: np.ndarray,
        board_bbox: tuple[int, int, int, int],
        grid_x: Sequence[float],
        grid_y: Sequence[float],
        step: float,
    ) -> dict[str, DetectedPiece]:
        return {}
        x1, y1, x2, y2 = board_bbox
        crop = image[y1:y2, x1:x2]
        if crop.size == 0:
            return {}
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (5, 5), 0)
        circles = cv2.HoughCircles(
            gray,
            cv2.HOUGH_GRADIENT,
            dp=1.18,
            minDist=max(18, int(round(step * 0.62))),
            param1=90,
            param2=22,
            minRadius=max(14, int(round(step * 0.28))),
            maxRadius=max(24, int(round(step * 0.55))),
        )
        if circles is None:
            return {}

        detected: dict[str, tuple[float, DetectedPiece]] = {}
        for local_x, local_y, circle_radius in circles[0]:
            center_x = x1 + float(local_x)
            center_y = y1 + float(local_y)
            if center_x < min(grid_x) - step * 0.55 or center_x > max(grid_x) + step * 0.55:
                continue
            if center_y < min(grid_y) - step * 0.55 or center_y > max(grid_y) + step * 0.55:
                continue
            col_index = min(range(len(grid_x)), key=lambda index: abs(center_x - grid_x[index]))
            row_index = min(range(len(grid_y)), key=lambda index: abs(center_y - grid_y[index]))
            dx = abs(center_x - grid_x[col_index])
            dy = abs(center_y - grid_y[row_index])
            if dx > step * 0.46 or dy > step * 0.46:
                continue
            patch, patch_radius = self._extract_intersection_patch(image, center_x, center_y, step)
            if patch is None:
                continue
            present, _edge_score = self._piece_present(patch, patch_radius)
            if not present:
                continue
            classified = self._classify_piece(patch, patch_radius)
            if classified is None:
                continue
            side, piece_type, confidence, glyphs = classified
            if confidence < 0.74 or not glyphs or not str(glyphs[0][0]).startswith("patch:"):
                continue
            coord = f"{FILE_LETTERS[col_index]}{9 - row_index}"
            snap_penalty = (dx + dy) / max(step, 1.0)
            score = confidence - (0.10 * snap_penalty)
            piece = DetectedPiece(
                side=side,
                piece_type=piece_type,
                col=col_index,
                row=9 - row_index,
                center=(center_x, center_y),
                radius=float(circle_radius),
                confidence=confidence,
                glyphs=glyphs,
            )
            existing = detected.get(coord)
            if existing is None or score > existing[0]:
                detected[coord] = (score, piece)
        return {coord: piece for coord, (_score, piece) in detected.items()}

    def detect_move(
        self,
        previous: BoardState,
        current: BoardState,
        expected_side: str | None = None,
    ) -> MoveRecord:
        old = previous.pieces
        new = current.pieces
        old_by_coord = {coord: (piece.side, piece.piece_type) for coord, piece in old.items()}
        new_by_coord = {coord: (piece.side, piece.piece_type) for coord, piece in new.items()}

        changed_old = [coord for coord, piece in old_by_coord.items() if new_by_coord.get(coord) != piece]
        changed_new = [coord for coord, piece in new_by_coord.items() if old_by_coord.get(coord) != piece]

        sources: list[str] = []
        destinations: list[str] = []
        capture = False

        for coord in changed_old:
            if coord not in new_by_coord:
                sources.append(coord)
            else:
                old_side, old_type = old_by_coord[coord]
                new_side, new_type = new_by_coord[coord]
                if old_side != new_side:
                    capture = True
                    destinations.append(coord)
                    if old_type != new_type or old_side != new_side:
                        pass

        for coord in changed_new:
            if coord not in old_by_coord:
                destinations.append(coord)
            else:
                old_side, old_type = old_by_coord[coord]
                new_side, new_type = new_by_coord[coord]
                if old_side != new_side or old_type != new_type:
                    destinations.append(coord)
                    capture = True

        sources = sorted(set(sources))
        destinations = sorted(set(destinations))
        if expected_side is not None:
            sources = [coord for coord in sources if old.get(coord) and old[coord].side == expected_side]
        if len(sources) != 1 or len(destinations) != 1:
            if not sources and not destinations and old_by_coord == new_by_coord:
                raise NoBoardChangeError("No board change detected.")
            inferred = self._infer_move_from_states(
                previous,
                current,
                expected_side=expected_side,
                changed_coords=sorted(set(changed_old + changed_new)),
                diff_scores=None,
            )
            if inferred is not None:
                return inferred[0]
            raise MoveDetectionError(
                f"Could not infer a single move. Sources={sources!r}, destinations={destinations!r}."
            )

        src = sources[0]
        dst = destinations[0]
        moving_piece = old[src]
        if dst in old and old[dst].side != moving_piece.side:
            capture = True

        return MoveRecord(
            side=moving_piece.side,
            piece_type=moving_piece.piece_type,
            src=src,
            dst=dst,
            capture=capture,
        )

    def detect_move_fast(
        self,
        previous: BoardState,
        image: np.ndarray,
        expected_side: str | None = None,
    ) -> tuple[MoveRecord, BoardState]:
        if previous.source_image is None or previous.source_image.shape != image.shape:
            current = self.recognize_board(image)
            return self.detect_move(previous, current, expected_side=expected_side), current

        step_x = float(np.median(np.diff(previous.grid_x)))
        step_y = float(np.median(np.diff(previous.grid_y)))
        step = float((step_x + step_y) / 2.0)
        diff_scores = self._diff_intersections(previous.source_image, image, previous.grid_x, previous.grid_y, step)
        if diff_scores and max(diff_scores.values()) < 1.5:
            raise NoBoardChangeError("No board change detected.")
        changed = self._select_changed_coords(diff_scores)
        if not changed:
            raise NoBoardChangeError("No board change detected.")
        if len(changed) < 2 or len(changed) > 6:
            current = self.recognize_board(image)
            return self.detect_move(previous, current, expected_side=expected_side), current

        occupancy_now: dict[str, bool] = {}
        for coord in changed:
            col = FILE_LETTERS.index(coord[0])
            row = int(coord[1])
            row_index = 9 - row
            patch, radius = self._extract_intersection_patch(image, previous.grid_x[col], previous.grid_y[row_index], step)
            if patch is None:
                continue
            present, _edge = self._piece_present(patch, radius)
            occupancy_now[coord] = present

        source_candidates = [coord for coord in changed if coord in previous.pieces and not occupancy_now.get(coord, False)]
        if expected_side is not None:
            source_candidates = [coord for coord in source_candidates if previous.pieces[coord].side == expected_side]
        if len(source_candidates) != 1:
            current = self.recognize_board(image)
            inferred = self._infer_move_from_states(
                previous,
                current,
                expected_side=expected_side,
                changed_coords=changed,
                diff_scores=diff_scores,
            )
            if inferred is not None:
                move, inferred_state = inferred
                inferred_state.source_image = image.copy()
                inferred_state.overlay_image = self._draw_overlay(
                    image,
                    inferred_state.board_bbox,
                    inferred_state.grid_x,
                    inferred_state.grid_y,
                    inferred_state.pieces,
                )
                return move, inferred_state
            return self.detect_move(previous, current, expected_side=expected_side), current

        src = source_candidates[0]
        moving_piece = previous.pieces[src]
        destination_candidates = [
            coord
            for coord in changed
            if coord != src and occupancy_now.get(coord, False)
        ]
        if not destination_candidates:
            current = self.recognize_board(image)
            inferred = self._infer_move_from_states(
                previous,
                current,
                expected_side=expected_side,
                changed_coords=changed,
                diff_scores=diff_scores,
            )
            if inferred is not None:
                move, inferred_state = inferred
                inferred_state.source_image = image.copy()
                inferred_state.overlay_image = self._draw_overlay(
                    image,
                    inferred_state.board_bbox,
                    inferred_state.grid_x,
                    inferred_state.grid_y,
                    inferred_state.pieces,
                )
                return move, inferred_state
            return self.detect_move(previous, current, expected_side=expected_side), current

        destination_candidates.sort(key=lambda coord: diff_scores[coord], reverse=True)
        dst = destination_candidates[0]
        capture = dst in previous.pieces and previous.pieces[dst].side != moving_piece.side
        if dst not in self._legal_destinations(moving_piece, previous.pieces):
            current = self.recognize_board(image)
            inferred = self._infer_move_from_states(
                previous,
                current,
                expected_side=expected_side,
                changed_coords=changed,
                diff_scores=diff_scores,
            )
            if inferred is not None:
                move, inferred_state = inferred
                inferred_state.source_image = image.copy()
                inferred_state.overlay_image = self._draw_overlay(
                    image,
                    inferred_state.board_bbox,
                    inferred_state.grid_x,
                    inferred_state.grid_y,
                    inferred_state.pieces,
                )
                return move, inferred_state
            raise MoveDetectionError(f"Rejected impossible move candidate: {moving_piece.debug_label} to {dst}.")

        col = FILE_LETTERS.index(dst[0])
        row = int(dst[1])
        updated_piece = DetectedPiece(
            side=moving_piece.side,
            piece_type=moving_piece.piece_type,
            col=col,
            row=row,
            center=(previous.grid_x[col], previous.grid_y[9 - row]),
            radius=moving_piece.radius,
            confidence=1.0,
            glyphs=[("diff", 1.0)],
        )
        new_pieces = dict(previous.pieces)
        new_pieces.pop(src, None)
        new_pieces[dst] = updated_piece

        overlay = self._draw_overlay(image, previous.board_bbox, previous.grid_x, previous.grid_y, new_pieces)
        setup_entries = [f"{piece.setup_code}{piece.coord}" for _, piece in sorted(new_pieces.items())]
        current = BoardState(
            pieces=new_pieces,
            board_bbox=previous.board_bbox,
            grid_x=list(previous.grid_x),
            grid_y=list(previous.grid_y),
            overlay_image=overlay,
            setup_entries=setup_entries,
            warnings=[],
            source_image=image.copy(),
        )
        move = MoveRecord(
            side=moving_piece.side,
            piece_type=moving_piece.piece_type,
            src=src,
            dst=dst,
            capture=capture,
        )
        return move, current

    def detect_move_sequence_fast(
        self,
        previous: BoardState,
        image: np.ndarray,
        max_moves: int = 2,
        expected_side: str | None = None,
    ) -> tuple[list[MoveRecord], BoardState]:
        try:
            move, state = self.detect_move_fast(previous, image, expected_side=expected_side)
            if max_moves >= 2:
                current = self.recognize_board(image)
                observed_dst = current.pieces.get(move.dst)
                inferred_dst = state.pieces.get(move.dst)
                dst_conflicts = (
                    observed_dst is not None
                    and inferred_dst is not None
                    and (observed_dst.side, observed_dst.piece_type) != (inferred_dst.side, inferred_dst.piece_type)
                )
                if dst_conflicts:
                    diff_scores: dict[str, float] | None = None
                    changed_coords: list[str] | None = None
                    if previous.source_image is not None and previous.source_image.shape == image.shape:
                        step_x = float(np.median(np.diff(previous.grid_x)))
                        step_y = float(np.median(np.diff(previous.grid_y)))
                        step = float((step_x + step_y) / 2.0)
                        diff_scores = self._diff_intersections(previous.source_image, image, previous.grid_x, previous.grid_y, step)
                        changed_coords = self._select_changed_coords(diff_scores)
                    inferred = self._infer_move_sequence_from_states(
                        previous,
                        current,
                        max_moves=max_moves,
                        expected_side=expected_side,
                        changed_coords=changed_coords,
                        diff_scores=diff_scores,
                    )
                    if inferred is not None:
                        moves, sequence_state = inferred
                        sequence_state.source_image = image.copy()
                        sequence_state.overlay_image = self._draw_overlay(
                            image,
                            sequence_state.board_bbox,
                            sequence_state.grid_x,
                            sequence_state.grid_y,
                            sequence_state.pieces,
                        )
                        return moves, sequence_state
                    raise MoveDetectionError(
                        f"Single-move candidate {move.notation} conflicts with the recognized destination "
                        f"{observed_dst.debug_label if observed_dst is not None else 'empty'}."
                    )
            return [move], state
        except NoBoardChangeError:
            raise
        except MoveDetectionError as first_error:
            if max_moves < 2:
                raise first_error

        current = self.recognize_board(image)
        diff_scores: dict[str, float] | None = None
        changed_coords: list[str] | None = None
        if previous.source_image is not None and previous.source_image.shape == image.shape:
            step_x = float(np.median(np.diff(previous.grid_x)))
            step_y = float(np.median(np.diff(previous.grid_y)))
            step = float((step_x + step_y) / 2.0)
            diff_scores = self._diff_intersections(previous.source_image, image, previous.grid_x, previous.grid_y, step)
            changed_coords = self._select_changed_coords(diff_scores)

        inferred = self._infer_move_sequence_from_states(
            previous,
            current,
            max_moves=max_moves,
            expected_side=expected_side,
            changed_coords=changed_coords,
            diff_scores=diff_scores,
        )
        if inferred is None:
            raise MoveDetectionError("Could not infer a stable one- or two-move sequence.")
        moves, state = inferred
        state.source_image = image.copy()
        state.overlay_image = self._draw_overlay(
            image,
            state.board_bbox,
            state.grid_x,
            state.grid_y,
            state.pieces,
        )
        return moves, state

    def detect_move_sequence_from_state(
        self,
        previous: BoardState,
        current: BoardState,
        max_moves: int = 2,
        expected_side: str | None = None,
    ) -> tuple[list[MoveRecord], BoardState]:
        diff_scores: dict[str, float] | None = None
        changed_coords: list[str] | None = None
        image = current.source_image
        if previous.source_image is not None and image is not None and previous.source_image.shape == image.shape:
            step_x = float(np.median(np.diff(previous.grid_x)))
            step_y = float(np.median(np.diff(previous.grid_y)))
            step = float((step_x + step_y) / 2.0)
            diff_scores = self._diff_intersections(previous.source_image, image, previous.grid_x, previous.grid_y, step)
            changed_coords = self._select_changed_coords(diff_scores)

        previous_map = self._state_position_map(previous)
        current_map = self._state_position_map(current)
        if previous_map == current_map:
            raise NoBoardChangeError("No board change detected.")

        exact_candidates = self._exact_move_sequence_candidates(
            previous,
            current,
            max_moves=max_moves,
            expected_side=expected_side,
        )
        if len(exact_candidates) == 1:
            return exact_candidates[0]
        if len(exact_candidates) > 1:
            changed_for_score = self._expanded_changed_coords(changed_coords, diff_scores)
            scored_exact = sorted(
                (
                    (
                        self._score_sequence_state(state, current, moves, changed_for_score, diff_scores),
                        moves,
                        state,
                    )
                    for moves, state in exact_candidates
                ),
                key=lambda item: item[0],
                reverse=True,
            )
            best_score, best_moves, best_state = scored_exact[0]
            second_score = scored_exact[1][0] if len(scored_exact) > 1 else float("-inf")
            if best_score - second_score >= 0.8:
                return best_moves, best_state
            detail = "; ".join(
                "+".join(move.notation for move in moves) + f"@{score:.2f}"
                for score, moves, _state in scored_exact[:5]
            )
            raise MoveDetectionError(f"Ambiguous exact move sequence from settled board: {detail}.")

        if max_moves >= 2:
            inferred = self._infer_move_sequence_from_states(
                previous,
                current,
                max_moves=max_moves,
                expected_side=expected_side,
                changed_coords=changed_coords,
                diff_scores=diff_scores,
            )
            if inferred is not None:
                return inferred

        inferred_single = self._infer_move_from_states(
            previous,
            current,
            expected_side=expected_side,
            changed_coords=changed_coords,
            diff_scores=diff_scores,
        )
        if inferred_single is not None:
            move, state = inferred_single
            return [move], state

        raise MoveDetectionError("Could not infer a legal move sequence from the settled board snapshot.")

    def state_after_known_move(
        self,
        previous: BoardState,
        move: str,
        expected_side: str,
    ) -> tuple[MoveRecord, BoardState]:
        """Apply a move selected by the engine without guessing it from vision."""
        if len(move) != 4 or not self._coord_is_valid(move[:2]) or not self._coord_is_valid(move[2:]):
            raise MoveDetectionError(f"Invalid engine move coordinate: {move!r}.")
        src, dst = move[:2], move[2:]
        piece = previous.pieces.get(src)
        if piece is None:
            raise MoveDetectionError(f"Engine move {move} starts from an empty square.")
        if piece.side != expected_side:
            raise MoveDetectionError(
                f"Engine move {move} starts on {piece.side}'s {piece.piece_type}, not {expected_side}'s piece."
            )
        if dst not in self._legal_destinations(piece, previous.pieces):
            raise MoveDetectionError(f"Engine move {move} is not legal in the detected board position.")
        record = MoveRecord(
            side=piece.side,
            piece_type=piece.piece_type,
            src=src,
            dst=dst,
            capture=dst in previous.pieces and previous.pieces[dst].side != piece.side,
        )
        return record, self._state_after_move(previous, previous, record)

    def detect_exact_move_from_state(
        self,
        previous: BoardState,
        current: BoardState,
        expected_side: str,
    ) -> tuple[MoveRecord, BoardState]:
        """Match one legal canonical move to vision's occupancy-and-side position.

        Move history is authoritative for piece identity.  A video classifier is
        allowed to say that an occupied square contains (for example) a black
        elephant rather than a black advisor, but it is never allowed to create,
        remove, recolour, or relocate a piece.  The returned state is therefore
        the canonical legal successor rendered over the latest observation, not
        the classifier's raw piece map.
        """
        previous_map = self._state_position_map(previous)
        current_map = self._state_position_map(current)
        if previous_map == current_map:
            raise NoBoardChangeError("No board change detected.")
        candidates = self._exact_move_sequence_candidates(
            previous,
            current,
            max_moves=1,
            expected_side=expected_side,
        )
        if len(candidates) == 1:
            moves, candidate_state = candidates[0]
            type_noise = sorted(
                coord
                for coord in set(candidate_state.pieces) & set(current.pieces)
                if candidate_state.pieces[coord].piece_type != current.pieces[coord].piece_type
            )
            if type_noise:
                candidate_state.warnings.append(
                    "Vision piece-type classifications differed from canonical history at "
                    + ", ".join(type_noise)
                    + "; canonical identities were retained."
                )
            return moves[0], candidate_state
        changed = sorted(
            coord
            for coord in set(previous_map) | set(current_map)
            if previous_map.get(coord) != current_map.get(coord)
        )
        if len(candidates) > 1:
            detail = ", ".join(candidate[0][0].src + candidate[0][0].dst for candidate in candidates[:6])
            raise MoveDetectionError(f"Ambiguous exact move ({detail}); changed squares: {', '.join(changed)}.")

        raise MoveDetectionError(
            "Settled board is not exactly one legal "
            f"{expected_side} move from the tracked position; changed squares: {', '.join(changed) or 'none'}."
        )

    def reconcile_expected_position(
        self,
        expected: BoardState,
        observed: BoardState,
        image: np.ndarray,
    ) -> BoardState | None:
        """Fuse full-board classification with targeted occupancy probes.

        Move history already supplies piece identity and side. The visual task at
        a transition boundary is therefore occupancy, not re-identifying every
        glyph. Fixed-theme recognition intentionally omits an occupied square
        when its coin is visible but its glyph classification is uncertain.
        Re-probing just those expected squares prevents that classification
        failure from masquerading as a missing moved piece.

        Unexpected occupied squares are never repaired away. This means an
        animation frame with the source ghost still visible cannot confirm a
        move, while a settled frame with an unclassified destination coin can.
        """
        expected_map = self._state_position_map(expected)
        observed_map = self._state_position_map(observed)
        if expected_map == observed_map:
            return self.refresh_state_image(expected, image)

        repaired: list[str] = []
        coin_repaired: list[str] = []
        template_repaired: list[str] = []
        for coord, expected_side in expected_map.items():
            observed_side = observed_map.get(coord)
            if observed_side == expected_side:
                continue
            if observed_side is not None:
                return None
            piece = expected.pieces[coord]
            patch, radius = self.fixed_vision.extract_intersection_patch(
                image,
                piece.center[0],
                piece.center[1],
                self._grid_step(expected),
            )
            if patch is None:
                return None
            present, _coin_score = self.fixed_vision.piece_present(patch, radius)
            if not present:
                # During Tiantian's landing animation a full-size piece can be
                # displaced from the intersection by several pixels.  The
                # conservative ring-coverage test may then miss one angular
                # sector even though the centered glyph template still gives
                # strong, piece-specific evidence.  Accept that evidence only
                # when both colour and canonical piece identity agree.  Small
                # numbered move markers do not pass this template check.
                classified = self.fixed_vision.classify_piece(patch, radius)
                expected_piece = expected.pieces[coord]
                if (
                    classified is None
                    or classified[0] != expected_side
                    or classified[1] != expected_piece.piece_type
                    or classified[2] < self.TRANSITION_TEMPLATE_MIN_CONFIDENCE
                ):
                    return None
                template_repaired.append(coord)
            else:
                coin_repaired.append(coord)
            repaired.append(coord)

        if any(coord not in expected_map for coord in observed_map):
            return None
        reconciled = self.refresh_state_image(expected, image)
        if coin_repaired:
            reconciled.warnings.append(
                "Canonical occupancy repaired unclassified piece coin(s) at "
                + ", ".join(sorted(coin_repaired))
                + "."
            )
        if template_repaired:
            reconciled.warnings.append(
                "Canonical occupancy accepted strongly classified landing-animation piece(s) at "
                + ", ".join(sorted(template_repaired))
                + "."
            )
        return reconciled

    def detect_exact_move_resilient(
        self,
        previous: BoardState,
        current: BoardState,
        expected_side: str,
        image: np.ndarray,
    ) -> tuple[MoveRecord, BoardState]:
        """Detect one legal move using classification, then occupancy fusion."""
        try:
            return self.detect_exact_move_from_state(previous, current, expected_side)
        except NoBoardChangeError:
            raise
        except MoveDetectionError as original_error:
            candidates: list[tuple[MoveRecord, BoardState]] = []
            for move in self._legal_move_records(previous, expected_side):
                expected = self._state_after_move(previous, current, move)
                reconciled = self.reconcile_expected_position(expected, current, image)
                if reconciled is not None:
                    candidates.append((move, reconciled))
            if len(candidates) == 1:
                return candidates[0]
            if len(candidates) > 1:
                moves = ", ".join(move.src + move.dst for move, _state in candidates[:6])
                raise MoveDetectionError(
                    f"Targeted occupancy probes left multiple legal moves ({moves}); refusing ambiguity."
                ) from original_error
            raise original_error

    def detect_move_sequence_snapshot(
        self,
        previous: BoardState,
        image: np.ndarray,
        max_moves: int = 2,
        expected_side: str | None = None,
    ) -> tuple[list[MoveRecord], BoardState]:
        current = self.recognize_board(image)
        return self.detect_move_sequence_from_state(
            previous,
            current,
            max_moves=max_moves,
            expected_side=expected_side,
        )

    def refresh_state_image(self, previous: BoardState, image: np.ndarray) -> BoardState:
        overlay = self._draw_overlay(image, previous.board_bbox, previous.grid_x, previous.grid_y, previous.pieces)
        return BoardState(
            pieces=dict(previous.pieces),
            board_bbox=previous.board_bbox,
            grid_x=list(previous.grid_x),
            grid_y=list(previous.grid_y),
            overlay_image=overlay,
            setup_entries=list(previous.setup_entries),
            warnings=[],
            source_image=image.copy(),
        )

    def _choose_piece_classification(
        self,
        ocr_classified: tuple[str, str, float, list[tuple[str, float]]] | None,
        template_classified: tuple[str, str, float, list[tuple[str, float]]] | None,
    ) -> tuple[str, str, float, list[tuple[str, float]]] | None:
        if template_classified is None:
            if ocr_classified is not None and self._ocr_classification_is_strong(ocr_classified):
                return ocr_classified
            return None
        if ocr_classified is None:
            return template_classified

        template_side, template_type, _template_confidence, _template_glyphs = template_classified
        ocr_side, ocr_type, _ocr_confidence, _ocr_glyphs = ocr_classified
        if (ocr_side, ocr_type) == (template_side, template_type):
            return self._merge_classification_evidence(template_classified, ocr_classified)

        template_margin = self._template_classification_margin(template_classified)
        ocr_is_strong = self._ocr_classification_is_strong(ocr_classified)
        ocr_is_credible = self._ocr_classification_is_credible(ocr_classified)
        if ocr_side != template_side:
            if ocr_is_strong and template_margin <= max(self.TEMPLATE_AMBIGUOUS_MARGIN, 0.10):
                return self._merge_classification_evidence(ocr_classified, template_classified)
            return template_classified

        if ocr_is_strong and template_margin <= self.TEMPLATE_AMBIGUOUS_MARGIN:
            return self._merge_classification_evidence(ocr_classified, template_classified)
        if ocr_is_credible and template_margin <= 0.06:
            return self._merge_classification_evidence(ocr_classified, template_classified)
        if not ocr_is_strong:
            return template_classified
        return template_classified

    def _merge_classification_evidence(
        self,
        primary: tuple[str, str, float, list[tuple[str, float]]],
        secondary: tuple[str, str, float, list[tuple[str, float]]],
    ) -> tuple[str, str, float, list[tuple[str, float]]]:
        side, piece_type, confidence, glyphs = primary
        _other_side, _other_type, other_confidence, other_glyphs = secondary
        merged_glyphs = list(glyphs)
        seen = set(merged_glyphs)
        for item in other_glyphs:
            if item not in seen:
                merged_glyphs.append(item)
                seen.add(item)
        return side, piece_type, max(confidence, other_confidence), merged_glyphs

    def _ocr_classification_is_strong(
        self,
        classified: tuple[str, str, float, list[tuple[str, float]]],
    ) -> bool:
        _side, _piece_type, confidence, _glyphs = classified
        return (
            confidence >= self.OCR_OVERRIDE_MIN_CONFIDENCE
            and self._ocr_piece_score(classified) >= self.OCR_OVERRIDE_MIN_PIECE_SCORE
        )

    def _ocr_classification_is_credible(
        self,
        classified: tuple[str, str, float, list[tuple[str, float]]],
    ) -> bool:
        _side, _piece_type, confidence, _glyphs = classified
        return confidence >= 0.55 and self._ocr_piece_score(classified) >= 0.35

    def _ocr_piece_score(
        self,
        classified: tuple[str, str, float, list[tuple[str, float]]],
    ) -> float:
        _side, piece_type, _confidence, glyphs = classified
        best = 0.0
        for label, score in glyphs:
            if not label.startswith("ocr:"):
                continue
            glyph = label.split(":", 1)[1]
            if KNOWN_GLYPHS.get(glyph) == piece_type:
                best = max(best, float(score))
        return best

    def _template_classification_margin(
        self,
        classified: tuple[str, str, float, list[tuple[str, float]]],
    ) -> float:
        _side, _piece_type, _confidence, glyphs = classified
        scores = sorted((float(score) for _label, score in glyphs), reverse=True)
        if len(scores) < 2:
            return float("inf")
        return scores[0] - scores[1]

    def _state_piece_map(self, state: BoardState) -> dict[str, tuple[str, str]]:
        return {coord: (piece.side, piece.piece_type) for coord, piece in state.pieces.items()}

    def _legal_move_records(
        self,
        state: BoardState,
        expected_side: str | None,
    ) -> list[MoveRecord]:
        moves: list[MoveRecord] = []
        for src, piece in state.pieces.items():
            if expected_side is not None and piece.side != expected_side:
                continue
            for dst in self._legal_destinations(piece, state.pieces):
                moves.append(
                    MoveRecord(
                        side=piece.side,
                        piece_type=piece.piece_type,
                        src=src,
                        dst=dst,
                        capture=dst in state.pieces and state.pieces[dst].side != piece.side,
                    )
                )
        return moves

    def _exact_move_sequence_candidates(
        self,
        previous: BoardState,
        current: BoardState,
        max_moves: int,
        expected_side: str | None,
    ) -> list[tuple[list[MoveRecord], BoardState]]:
        target_map = self._state_position_map(current)
        candidates: list[tuple[list[MoveRecord], BoardState]] = []
        for move1 in self._legal_move_records(previous, expected_side):
            state1 = self._state_after_move(previous, current, move1)
            if self._state_position_map(state1) == target_map:
                candidates.append(([move1], state1))
            if max_moves < 2:
                continue
            reply_side = "black" if move1.side == "red" else "red"
            for move2 in self._legal_move_records(state1, reply_side):
                state2 = self._state_after_move(state1, current, move2)
                if self._state_position_map(state2) == target_map:
                    candidates.append(([move1, move2], state2))
        candidates.sort(key=lambda item: (-len(item[0]), tuple(move.notation for move in item[0])))
        return candidates

    @staticmethod
    def _state_position_map(state: BoardState) -> dict[str, str]:
        """The only visual facts allowed to confirm a game-state transition."""
        return {coord: piece.side for coord, piece in state.pieces.items()}

    def _coord_to_tuple(self, coord: str) -> tuple[int, int]:
        if not self._coord_is_valid(coord):
            raise ValueError(f"Invalid board coordinate: {coord!r}")
        return FILE_TO_INDEX[coord[0]], int(coord[1])

    def _tuple_to_coord(self, col: int, row: int) -> str:
        if not self._within_board(col, row):
            raise ValueError(f"Board coordinate is out of range: col={col}, row={row}")
        return f"{FILE_LETTERS[col]}{row}"

    def _coord_is_valid(self, coord: str) -> bool:
        if len(coord) != 2 or coord[0] not in FILE_TO_INDEX or not coord[1].isdigit():
            return False
        return 0 <= int(coord[1]) < 10

    def _within_board(self, col: int, row: int) -> bool:
        return 0 <= col < 9 and 0 <= row < 10

    def _in_palace(self, side: str, col: int, row: int) -> bool:
        if not 3 <= col <= 5:
            return False
        if side == "red":
            return 0 <= row <= 2
        return 7 <= row <= 9

    def _pieces_between(self, pieces: dict[str, DetectedPiece], src: str, dst: str) -> list[str]:
        src_col, src_row = self._coord_to_tuple(src)
        dst_col, dst_row = self._coord_to_tuple(dst)
        coords: list[str] = []
        if src_col == dst_col:
            step = 1 if dst_row > src_row else -1
            for row in range(src_row + step, dst_row, step):
                coord = self._tuple_to_coord(src_col, row)
                if coord in pieces:
                    coords.append(coord)
        elif src_row == dst_row:
            step = 1 if dst_col > src_col else -1
            for col in range(src_col + step, dst_col, step):
                coord = self._tuple_to_coord(col, src_row)
                if coord in pieces:
                    coords.append(coord)
        return coords

    def _legal_destinations(self, piece: DetectedPiece, pieces: dict[str, DetectedPiece]) -> list[str]:
        generators = {
            "k": self._legal_general_destinations,
            "g": self._legal_advisor_destinations,
            "m": self._legal_elephant_destinations,
            "n": self._legal_horse_destinations,
            "r": self._legal_rook_destinations,
            "c": self._legal_cannon_destinations,
            "p": self._legal_pawn_destinations,
        }
        generator = generators.get(piece.piece_type)
        if generator is None:
            return []
        return list(dict.fromkeys(generator(piece, pieces)))

    def _open_destination(
        self,
        piece: DetectedPiece,
        pieces: dict[str, DetectedPiece],
        dst_col: int,
        dst_row: int,
    ) -> str | None:
        if not self._within_board(dst_col, dst_row):
            return None
        dst = self._tuple_to_coord(dst_col, dst_row)
        occupant = pieces.get(dst)
        if occupant is not None and occupant.side == piece.side:
            return None
        return dst

    def _legal_general_destinations(
        self, piece: DetectedPiece, pieces: dict[str, DetectedPiece]
    ) -> list[str]:
        destinations = self._palace_step_destinations(piece, pieces, ((1, 0), (-1, 0), (0, 1), (0, -1)))
        enemy_general = next((p for p in pieces.values() if p.side != piece.side and p.piece_type == "k"), None)
        if enemy_general is not None and enemy_general.col == piece.col:
            src = self._tuple_to_coord(piece.col, piece.row)
            dst = self._tuple_to_coord(enemy_general.col, enemy_general.row)
            if not self._pieces_between(pieces, src, dst):
                destinations.append(dst)
        return destinations

    def _legal_advisor_destinations(
        self, piece: DetectedPiece, pieces: dict[str, DetectedPiece]
    ) -> list[str]:
        return self._palace_step_destinations(piece, pieces, ((1, 1), (1, -1), (-1, 1), (-1, -1)))

    def _palace_step_destinations(
        self,
        piece: DetectedPiece,
        pieces: dict[str, DetectedPiece],
        deltas: Iterable[tuple[int, int]],
    ) -> list[str]:
        destinations: list[str] = []
        for dc, dr in deltas:
            dst_col, dst_row = piece.col + dc, piece.row + dr
            if not self._in_palace(piece.side, dst_col, dst_row):
                continue
            if dst := self._open_destination(piece, pieces, dst_col, dst_row):
                destinations.append(dst)
        return destinations

    def _legal_elephant_destinations(
        self, piece: DetectedPiece, pieces: dict[str, DetectedPiece]
    ) -> list[str]:
        destinations: list[str] = []
        for dc, dr in ((2, 2), (2, -2), (-2, 2), (-2, -2)):
            dst_col, dst_row = piece.col + dc, piece.row + dr
            eye_col, eye_row = piece.col + (dc // 2), piece.row + (dr // 2)
            if not self._within_board(eye_col, eye_row) or not self._elephant_stays_home(piece.side, dst_row):
                continue
            eye = self._tuple_to_coord(eye_col, eye_row)
            if eye not in pieces and (dst := self._open_destination(piece, pieces, dst_col, dst_row)):
                destinations.append(dst)
        return destinations

    def _elephant_stays_home(self, side: str, target_row: int) -> bool:
        return target_row <= 4 if side == "red" else target_row >= 5

    def _legal_horse_destinations(
        self, piece: DetectedPiece, pieces: dict[str, DetectedPiece]
    ) -> list[str]:
        jumps = (
            (1, 2, 0, 1),
            (-1, 2, 0, 1),
            (1, -2, 0, -1),
            (-1, -2, 0, -1),
            (2, 1, 1, 0),
            (2, -1, 1, 0),
            (-2, 1, -1, 0),
            (-2, -1, -1, 0),
        )
        destinations: list[str] = []
        for dc, dr, leg_c, leg_r in jumps:
            dst_col, dst_row = piece.col + dc, piece.row + dr
            leg_col, leg_row = piece.col + leg_c, piece.row + leg_r
            if not self._within_board(leg_col, leg_row):
                continue
            leg = self._tuple_to_coord(leg_col, leg_row)
            if leg not in pieces and (dst := self._open_destination(piece, pieces, dst_col, dst_row)):
                destinations.append(dst)
        return destinations

    def _legal_rook_destinations(
        self, piece: DetectedPiece, pieces: dict[str, DetectedPiece]
    ) -> list[str]:
        destinations: list[str] = []
        for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            dst_col, dst_row = piece.col + dc, piece.row + dr
            while self._within_board(dst_col, dst_row):
                dst = self._tuple_to_coord(dst_col, dst_row)
                occupant = pieces.get(dst)
                if occupant is None:
                    destinations.append(dst)
                else:
                    if occupant.side != piece.side:
                        destinations.append(dst)
                    break
                dst_col += dc
                dst_row += dr
        return destinations

    def _legal_cannon_destinations(
        self, piece: DetectedPiece, pieces: dict[str, DetectedPiece]
    ) -> list[str]:
        destinations: list[str] = []
        for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            destinations.extend(self._legal_cannon_ray(piece, pieces, dc, dr))
        return destinations

    def _legal_cannon_ray(
        self,
        piece: DetectedPiece,
        pieces: dict[str, DetectedPiece],
        dc: int,
        dr: int,
    ) -> list[str]:
        destinations: list[str] = []
        dst_col, dst_row = piece.col + dc, piece.row + dr
        screens = 0
        while self._within_board(dst_col, dst_row):
            dst = self._tuple_to_coord(dst_col, dst_row)
            occupant = pieces.get(dst)
            if occupant is None and screens == 0:
                destinations.append(dst)
            elif occupant is not None:
                screens += 1
                if screens == 2:
                    if occupant.side != piece.side:
                        destinations.append(dst)
                    break
            dst_col += dc
            dst_row += dr
        return destinations

    def _legal_pawn_destinations(
        self, piece: DetectedPiece, pieces: dict[str, DetectedPiece]
    ) -> list[str]:
        forward = 1 if piece.side == "red" else -1
        deltas = [(0, forward)]
        crossed = piece.row >= 5 if piece.side == "red" else piece.row <= 4
        if crossed:
            deltas.extend(((1, 0), (-1, 0)))
        destinations: list[str] = []
        for dc, dr in deltas:
            if dst := self._open_destination(piece, pieces, piece.col + dc, piece.row + dr):
                destinations.append(dst)
        return destinations

    def _state_after_move(
        self,
        previous: BoardState,
        current: BoardState,
        move: MoveRecord,
    ) -> BoardState:
        moving_piece = previous.pieces[move.src]
        col, row = self._coord_to_tuple(move.dst)
        center = self._physical_center(previous, col, row, geometry=current)
        updated_piece = DetectedPiece(
            side=moving_piece.side,
            piece_type=moving_piece.piece_type,
            col=col,
            row=row,
            center=center,
            radius=moving_piece.radius,
            confidence=max(moving_piece.confidence, 0.9),
            glyphs=[("inferred", 1.0)],
        )
        new_pieces = dict(previous.pieces)
        new_pieces.pop(move.src, None)
        if move.capture:
            new_pieces.pop(move.dst, None)
        new_pieces[move.dst] = updated_piece
        setup_entries = [f"{piece.setup_code}{piece.coord}" for _, piece in sorted(new_pieces.items())]
        base_image = current.source_image if current.source_image is not None else current.overlay_image
        overlay = self._draw_overlay(base_image, current.board_bbox, current.grid_x, current.grid_y, new_pieces)
        return BoardState(
            pieces=new_pieces,
            board_bbox=current.board_bbox,
            grid_x=list(current.grid_x),
            grid_y=list(current.grid_y),
            overlay_image=overlay,
            setup_entries=setup_entries,
            warnings=list(current.warnings),
            source_image=base_image.copy(),
        )

    @staticmethod
    def _grid_step(state: BoardState) -> float:
        step_x = float(np.median(np.diff(state.grid_x)))
        step_y = float(np.median(np.diff(state.grid_y)))
        return (step_x + step_y) / 2.0

    def _physical_center(
        self,
        state: BoardState,
        col: int,
        row: int,
        *,
        geometry: BoardState | None = None,
    ) -> tuple[float, float]:
        """Map canonical coordinates to pixels using the observed orientation."""
        normal_error = 0.0
        flipped_error = 0.0
        for piece in state.pieces.values():
            physical_col = min(
                range(9), key=lambda index: abs(state.grid_x[index] - piece.center[0])
            )
            physical_row = min(
                range(10), key=lambda index: abs(state.grid_y[index] - piece.center[1])
            )
            normal_error += abs(physical_col - piece.col) + abs(physical_row - (9 - piece.row))
            flipped_error += abs(physical_col - (8 - piece.col)) + abs(physical_row - piece.row)
        flipped = flipped_error < normal_error
        physical_col = 8 - col if flipped else col
        physical_row = row if flipped else 9 - row
        grid = geometry or state
        return grid.grid_x[physical_col], grid.grid_y[physical_row]

    def _score_candidate_move(
        self,
        previous: BoardState,
        current: BoardState,
        move: MoveRecord,
        changed_coords: Sequence[str] | None,
        diff_scores: dict[str, float] | None,
    ) -> tuple[float, BoardState]:
        candidate_state = self._state_after_move(previous, current, move)
        current_map = {coord: (piece.side, piece.piece_type) for coord, piece in current.pieces.items()}
        candidate_map = {coord: (piece.side, piece.piece_type) for coord, piece in candidate_state.pieces.items()}
        score = 0.0
        for coord in sorted(set(current_map) | set(candidate_map)):
            expected = candidate_map.get(coord)
            observed = current_map.get(coord)
            if expected and observed:
                if expected == observed:
                    score += 4.0
                elif expected[0] == observed[0]:
                    score += 1.25
                else:
                    score -= 3.0
            elif expected and not observed:
                score -= 0.5
            elif observed and not expected:
                score -= 1.0

        changed_set = set(changed_coords or [])
        if move.src in changed_set:
            score += 1.0
        if move.dst in changed_set:
            score += 1.5
        if diff_scores:
            top = max(diff_scores.values()) or 1.0
            score += 0.75 * (diff_scores.get(move.src, 0.0) / top)
            score += 1.0 * (diff_scores.get(move.dst, 0.0) / top)

        return score, candidate_state

    def _infer_move_from_states(
        self,
        previous: BoardState,
        current: BoardState,
        expected_side: str | None,
        changed_coords: Sequence[str] | None,
        diff_scores: dict[str, float] | None,
    ) -> tuple[MoveRecord, BoardState] | None:
        candidates: list[tuple[float, MoveRecord, BoardState]] = []
        for src, piece in previous.pieces.items():
            if expected_side is not None and piece.side != expected_side:
                continue
            for dst in self._legal_destinations(piece, previous.pieces):
                if changed_coords and src not in changed_coords and dst not in changed_coords:
                    continue
                capture = dst in previous.pieces and previous.pieces[dst].side != piece.side
                move = MoveRecord(
                    side=piece.side,
                    piece_type=piece.piece_type,
                    src=src,
                    dst=dst,
                    capture=capture,
                )
                score, candidate_state = self._score_candidate_move(previous, current, move, changed_coords, diff_scores)
                candidates.append((score, move, candidate_state))

        candidates.extend(
            self._recover_missed_source_candidates(
                previous,
                current,
                expected_side=expected_side,
                changed_coords=changed_coords,
                diff_scores=diff_scores,
            )
        )

        if not candidates:
            return None
        candidates.sort(key=lambda item: item[0], reverse=True)
        best_score, best_move, best_state = candidates[0]
        second_score = candidates[1][0] if len(candidates) > 1 else float("-inf")
        if best_score < 4.0:
            return None
        if len(candidates) > 1 and best_score - second_score < 1.5:
            return None
        return best_move, best_state

    def _expanded_changed_coords(
        self,
        changed_coords: Sequence[str] | None,
        diff_scores: dict[str, float] | None,
        limit: int = 14,
    ) -> list[str]:
        changed = {coord for coord in (changed_coords or []) if self._coord_is_valid(coord)}
        if diff_scores:
            top_score = max(diff_scores.values()) or 1.0
            floor = max(3.0, top_score * 0.18)
            for coord, score in sorted(diff_scores.items(), key=lambda item: item[1], reverse=True):
                if len(changed) >= limit:
                    break
                if score >= floor and self._coord_is_valid(coord):
                    changed.add(coord)
        return sorted(changed)

    def _recover_missed_source_candidates(
        self,
        previous: BoardState,
        current: BoardState,
        expected_side: str | None,
        changed_coords: Sequence[str] | None,
        diff_scores: dict[str, float] | None,
    ) -> list[tuple[float, MoveRecord, BoardState]]:
        if not changed_coords:
            return []

        changed = self._expanded_changed_coords(changed_coords, diff_scores)
        if len(changed) < 2:
            return []

        candidates: list[tuple[float, MoveRecord, BoardState]] = []
        for dst in changed:
            current_piece = current.pieces.get(dst)
            if current_piece is None:
                continue
            if expected_side is not None and current_piece.side != expected_side:
                continue
            previous_dst = previous.pieces.get(dst)
            if previous_dst is not None and previous_dst.side == current_piece.side and previous_dst.piece_type == current_piece.piece_type:
                continue

            for src in changed:
                if src == dst or current.pieces.get(src) is not None:
                    continue
                previous_src = previous.pieces.get(src)
                if previous_src is not None and previous_src.side != current_piece.side:
                    continue
                if (
                    current_piece.piece_type == "k"
                    and any(
                        coord != src and piece.side == current_piece.side and piece.piece_type == "k"
                        for coord, piece in previous.pieces.items()
                    )
                ):
                    continue
                if (
                    previous_src is not None
                    and previous_src.side == current_piece.side
                    and previous_src.piece_type == current_piece.piece_type
                ):
                    continue
                src_col, src_row = self._coord_to_tuple(src)
                pseudo_piece = DetectedPiece(
                    side=current_piece.side,
                    piece_type=current_piece.piece_type,
                    col=src_col,
                    row=src_row,
                    center=(previous.grid_x[src_col], previous.grid_y[9 - src_row]),
                    radius=previous_src.radius if previous_src is not None else current_piece.radius,
                    confidence=max(current_piece.confidence, 0.75),
                    glyphs=[("recovered-source", 1.0)],
                )
                pseudo_previous_pieces = dict(previous.pieces)
                pseudo_previous_pieces[src] = pseudo_piece
                if dst not in self._legal_destinations(pseudo_piece, pseudo_previous_pieces):
                    continue
                move = MoveRecord(
                    side=current_piece.side,
                    piece_type=current_piece.piece_type,
                    src=src,
                    dst=dst,
                    capture=previous_dst is not None and previous_dst.side != current_piece.side,
                )
                pseudo_previous = BoardState(
                    pieces=pseudo_previous_pieces,
                    board_bbox=previous.board_bbox,
                    grid_x=list(previous.grid_x),
                    grid_y=list(previous.grid_y),
                    overlay_image=previous.overlay_image,
                    setup_entries=list(previous.setup_entries),
                    warnings=list(previous.warnings),
                    source_image=previous.source_image.copy() if previous.source_image is not None else None,
                )
                score, candidate_state = self._score_candidate_move(
                    pseudo_previous,
                    current,
                    move,
                    changed_coords=changed,
                    diff_scores=diff_scores,
                )
                score -= 0.35
                candidates.append((score, move, candidate_state))
        return candidates

    def _score_sequence_state(
        self,
        state: BoardState,
        current: BoardState,
        moves: Sequence[MoveRecord],
        changed_coords: Sequence[str] | None,
        diff_scores: dict[str, float] | None,
    ) -> float:
        current_map = {coord: (piece.side, piece.piece_type) for coord, piece in current.pieces.items()}
        candidate_map = {coord: (piece.side, piece.piece_type) for coord, piece in state.pieces.items()}
        score = 0.0
        for coord in sorted(set(current_map) | set(candidate_map)):
            expected = candidate_map.get(coord)
            observed = current_map.get(coord)
            if expected and observed:
                if expected == observed:
                    score += 4.0
                elif expected[0] == observed[0]:
                    score += 1.0
                else:
                    score -= 3.0
            elif expected and not observed:
                score -= 0.75
            elif observed and not expected:
                score -= 1.25

        changed_set = set(changed_coords or [])
        touched: list[str] = []
        for move in moves:
            touched.extend((move.src, move.dst))
            if changed_set:
                if move.src in changed_set:
                    score += 1.0
                if move.dst in changed_set:
                    score += 1.5
            if diff_scores:
                top = max(diff_scores.values()) or 1.0
                score += 0.65 * (diff_scores.get(move.src, 0.0) / top)
                score += 0.85 * (diff_scores.get(move.dst, 0.0) / top)

        if changed_set:
            missing = changed_set.difference(touched)
            extra = set(touched).difference(changed_set)
            score -= len(missing) * 1.2
            score -= len(extra) * 0.4
        return score

    def _infer_move_sequence_from_states(
        self,
        previous: BoardState,
        current: BoardState,
        max_moves: int,
        expected_side: str | None,
        changed_coords: Sequence[str] | None,
        diff_scores: dict[str, float] | None,
    ) -> tuple[list[MoveRecord], BoardState] | None:
        if max_moves < 2:
            return None
        candidates = self._rank_move_sequence_candidates(
            previous,
            current,
            max_moves=max_moves,
            expected_side=expected_side,
            changed_coords=changed_coords,
            diff_scores=diff_scores,
        )
        if not candidates:
            return None
        best_score, best_moves, best_state = candidates[0]
        second_score = candidates[1][0] if len(candidates) > 1 else float("-inf")
        current_map = self._state_piece_map(current)
        best_matches_current = self._state_piece_map(best_state) == current_map
        second_matches_current = (
            len(candidates) > 1 and self._state_piece_map(candidates[1][2]) == current_map
        )
        if best_score < 7.0:
            return None
        if best_matches_current and not second_matches_current and best_score - second_score >= 0.5:
            return best_moves, best_state
        if len(candidates) > 1 and best_score - second_score < 1.2:
            return None
        return best_moves, best_state

    def _rank_move_sequence_candidates(
        self,
        previous: BoardState,
        current: BoardState,
        max_moves: int,
        expected_side: str | None,
        changed_coords: Sequence[str] | None,
        diff_scores: dict[str, float] | None,
    ) -> list[tuple[float, list[MoveRecord], BoardState]]:
        if max_moves < 2:
            return []
        candidates: list[tuple[float, list[MoveRecord], BoardState]] = []
        expanded_changed = self._expanded_changed_coords(changed_coords, diff_scores)
        changed_set = set(expanded_changed)

        first_candidates: list[tuple[MoveRecord, BoardState]] = []

        for src1, piece1 in previous.pieces.items():
            if expected_side is not None and piece1.side != expected_side:
                continue
            for dst1 in self._legal_destinations(piece1, previous.pieces):
                if changed_set and src1 not in changed_set and dst1 not in changed_set:
                    continue
                move1 = MoveRecord(
                    side=piece1.side,
                    piece_type=piece1.piece_type,
                    src=src1,
                    dst=dst1,
                    capture=dst1 in previous.pieces and previous.pieces[dst1].side != piece1.side,
                )
                state1 = self._state_after_move(previous, current, move1)
                first_candidates.append((move1, state1))

        recovered_first = self._recover_missed_source_candidates(
            previous,
            current,
            expected_side=expected_side,
            changed_coords=expanded_changed,
            diff_scores=diff_scores,
        )
        first_candidates.extend((move, state1) for _score, move, state1 in recovered_first)

        for move1, state1 in first_candidates:
            for src2, piece2 in state1.pieces.items():
                if piece2.side == move1.side:
                    continue
                for dst2 in self._legal_destinations(piece2, state1.pieces):
                    if changed_set and src2 not in changed_set and dst2 not in changed_set:
                        continue
                    move2 = MoveRecord(
                        side=piece2.side,
                        piece_type=piece2.piece_type,
                        src=src2,
                        dst=dst2,
                        capture=dst2 in state1.pieces and state1.pieces[dst2].side != piece2.side,
                    )
                    state2 = self._state_after_move(state1, current, move2)
                    moves = [move1, move2]
                    score = self._score_sequence_state(state2, current, moves, expanded_changed, diff_scores)
                    candidates.append((score, moves, state2))

            recovered_second = self._recover_missed_source_candidates(
                state1,
                current,
                expected_side="black" if move1.side == "red" else "red",
                changed_coords=expanded_changed,
                diff_scores=diff_scores,
            )
            for _single_score, move2, state2 in recovered_second:
                moves = [move1, move2]
                score = self._score_sequence_state(state2, current, moves, expanded_changed, diff_scores) - 0.35
                candidates.append((score, moves, state2))

        candidates.sort(key=lambda item: item[0], reverse=True)
        return candidates

    def debug_move_sequence_candidates(
        self,
        previous: BoardState,
        current: BoardState,
        max_moves: int,
        expected_side: str | None,
        changed_coords: Sequence[str] | None,
        diff_scores: dict[str, float] | None,
        limit: int = 12,
    ) -> dict[str, object]:
        expanded_changed = self._expanded_changed_coords(changed_coords, diff_scores)
        candidates = self._rank_move_sequence_candidates(
            previous,
            current,
            max_moves=max_moves,
            expected_side=expected_side,
            changed_coords=changed_coords,
            diff_scores=diff_scores,
        )
        best_score = candidates[0][0] if candidates else None
        second_score = candidates[1][0] if len(candidates) > 1 else None
        gap = None if best_score is None or second_score is None else best_score - second_score
        current_map = self._state_piece_map(current)
        best_matches_current = bool(candidates and self._state_piece_map(candidates[0][2]) == current_map)
        second_matches_current = bool(len(candidates) > 1 and self._state_piece_map(candidates[1][2]) == current_map)
        accepted = bool(
            candidates
            and best_score is not None
            and best_score >= 7.0
            and (
                second_score is None
                or best_score - second_score >= 1.2
                or (best_matches_current and not second_matches_current and best_score - second_score >= 0.5)
            )
        )
        return {
            "candidate_count": len(candidates),
            "expanded_changed": expanded_changed,
            "best_score": round(float(best_score), 4) if best_score is not None else None,
            "second_score": round(float(second_score), 4) if second_score is not None else None,
            "score_gap": round(float(gap), 4) if gap is not None else None,
            "accepted_by_thresholds": accepted,
            "best_matches_current": best_matches_current,
            "second_matches_current": second_matches_current,
            "top": [
                {
                    "rank": index + 1,
                    "score": round(float(score), 4),
                    "moves": [
                        {
                            "side": move.side,
                            "piece_type": move.piece_type,
                            "src": move.src,
                            "dst": move.dst,
                            "capture": move.capture,
                            "notation": move.notation,
                        }
                        for move in moves
                    ],
                }
                for index, (score, moves, _state) in enumerate(candidates[:limit])
            ],
        }

    def _board_candidates(self, image: np.ndarray) -> list[tuple[int, int, int, int]]:
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        masks = [
            cv2.inRange(hsv, (5, 10, 60), (40, 255, 255)),
            cv2.inRange(hsv, (0, 0, 130), (40, 120, 255)),
        ]
        mask = masks[0]
        for extra in masks[1:]:
            mask = cv2.bitwise_or(mask, extra)
        kernel = np.ones((9, 9), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        image_h, image_w = image.shape[:2]
        min_area = image_h * image_w * 0.08
        candidates: list[tuple[int, int, int, int]] = []
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            area = w * h
            if area < min_area:
                continue
            aspect = w / max(h, 1)
            if not 0.35 <= aspect <= 1.25:
                continue
            pad_x = int(w * 0.03)
            pad_y = int(h * 0.03)
            candidates.append(
                (
                    max(0, x - pad_x),
                    max(0, y - pad_y),
                    min(image_w, x + w + pad_x),
                    min(image_h, y + h + pad_y),
                )
            )

        candidates.append((0, 0, image_w, image_h))
        deduped: list[tuple[int, int, int, int]] = []
        for box in candidates:
            if box not in deduped:
                deduped.append(box)
        return deduped

    def _score_candidate(self, image: np.ndarray, box: tuple[int, int, int, int]) -> float:
        x1, y1, x2, y2 = box
        crop = image[y1:y2, x1:x2]
        if crop.size == 0:
            return float("-inf")
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (3, 3), 0)
        vert = np.abs(cv2.Sobel(blur, cv2.CV_32F, 1, 0, ksize=3))
        hori = np.abs(cv2.Sobel(blur, cv2.CV_32F, 0, 1, ksize=3))
        h, w = gray.shape
        vert_profile = vert[int(h * 0.12): int(h * 0.9), :].mean(axis=0)
        hori_profile = hori[:, int(w * 0.08): int(w * 0.92)].mean(axis=1)

        v_peaks = self._find_peaks(vert_profile, min_distance=max(16, w // 18), percentile=84)
        h_peaks = self._find_peaks(hori_profile, min_distance=max(16, h // 20), percentile=84)
        if len(v_peaks) < 6 or len(h_peaks) < 8:
            return float("-inf")

        v_diffs = np.diff(v_peaks)
        h_diffs = np.diff(h_peaks)
        step_x = float(np.median(v_diffs))
        step_y = float(np.median(h_diffs))
        regularity = float(np.std(v_diffs) + np.std(h_diffs))
        step_match = abs(step_x - step_y)
        area_bonus = ((x2 - x1) * (y2 - y1)) / max(image.shape[0] * image.shape[1], 1)
        return (len(v_peaks) * 2.0) + (len(h_peaks) * 2.0) - (regularity * 0.6) - (step_match * 0.3) + (area_bonus * 10.0)

    def _fit_grid(self, crop: np.ndarray) -> tuple[list[float], list[float]]:
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (3, 3), 0)
        vert = np.abs(cv2.Sobel(blur, cv2.CV_32F, 1, 0, ksize=3))
        hori = np.abs(cv2.Sobel(blur, cv2.CV_32F, 0, 1, ksize=3))

        height, width = gray.shape
        vert_profile = vert[int(height * 0.12): int(height * 0.9), :].mean(axis=0)
        hori_profile = hori[:, int(width * 0.08): int(width * 0.92)].mean(axis=1)
        v_peaks = self._find_peaks(vert_profile, min_distance=max(16, width // 18), percentile=84)
        h_peaks = self._find_peaks(hori_profile, min_distance=max(16, height // 20), percentile=84)
        if len(v_peaks) < 5 or len(h_peaks) < 6:
            raise RuntimeError("Board lines were not clear enough to fit a grid.")

        grid_x = self._arithmetic_grid(v_peaks, 9, width)
        grid_y = self._arithmetic_grid(h_peaks, 10, height)
        return grid_x, grid_y

    def _find_peaks(self, profile: np.ndarray, min_distance: int, percentile: float) -> list[int]:
        if profile.size == 0:
            return []
        smooth = np.convolve(profile, np.ones(9) / 9.0, mode="same")
        threshold = np.percentile(smooth, percentile)
        peaks: list[int] = []
        for index in range(1, len(smooth) - 1):
            if smooth[index] < threshold:
                continue
            if smooth[index] < smooth[index - 1] or smooth[index] < smooth[index + 1]:
                continue
            if not peaks or index - peaks[-1] > min_distance:
                peaks.append(index)
            elif smooth[index] > smooth[peaks[-1]]:
                peaks[-1] = index
        return peaks

    def _arithmetic_grid(self, peaks: Sequence[int], count: int, axis_length: int) -> list[float]:
        if len(peaks) < 3:
            raise RuntimeError("Not enough peaks to estimate board spacing.")
        diffs = [b - a for a, b in zip(peaks, peaks[1:]) if 12 <= (b - a) <= axis_length]
        step = float(np.median(diffs))
        tolerance = max(5.0, step * 0.18)
        best_sequence: list[float] | None = None
        best_score = float("-inf")

        for anchor in peaks:
            for anchor_index in range(count):
                start = anchor - (anchor_index * step)
                sequence = [start + (offset * step) for offset in range(count)]
                matches = 0
                edge_penalty = 0.0
                for value in sequence:
                    nearest = min(abs(value - peak) for peak in peaks)
                    if nearest <= tolerance:
                        matches += 1
                    if value < -step * 0.8 or value > axis_length + step * 0.8:
                        edge_penalty += 2.5
                score = (matches * 10.0) - edge_penalty
                if score > best_score:
                    best_score = score
                    best_sequence = sequence

        if best_sequence is None:
            raise RuntimeError("Could not fit a board grid.")
        return best_sequence

    def _extract_intersection_patch(
        self, image: np.ndarray, x: float, y: float, step: float
    ) -> tuple[np.ndarray | None, float]:
        return self.fixed_vision.extract_intersection_patch(image, x, y, step)

    def _diff_intersections(
        self,
        previous_image: np.ndarray,
        current_image: np.ndarray,
        grid_x: Sequence[float],
        grid_y: Sequence[float],
        step: float,
    ) -> dict[str, float]:
        diff_scores: dict[str, float] = {}
        half = int(max(12, round(step * 0.36)))
        for row_index, y in enumerate(grid_y):
            for col_index, x in enumerate(grid_x):
                cx = int(round(x))
                cy = int(round(y))
                x1 = cx - half
                y1 = cy - half
                x2 = cx + half
                y2 = cy + half
                if x1 < 0 or y1 < 0 or x2 > previous_image.shape[1] or y2 > previous_image.shape[0]:
                    continue
                prev_patch = previous_image[y1:y2, x1:x2]
                curr_patch = current_image[y1:y2, x1:x2]
                if prev_patch.shape != curr_patch.shape:
                    continue
                score = float(cv2.absdiff(prev_patch, curr_patch).mean())
                coord = f"{FILE_LETTERS[col_index]}{9 - row_index}"
                diff_scores[coord] = score
        return diff_scores

    def _select_changed_coords(self, diff_scores: dict[str, float]) -> list[str]:
        if not diff_scores:
            return []
        ranked = sorted(diff_scores.items(), key=lambda item: item[1], reverse=True)
        top_score = ranked[0][1]
        floor = max(4.0, top_score * 0.30)
        selected = [coord for coord, score in ranked if score >= floor][:6]
        return selected

    def _piece_present(self, patch: np.ndarray, radius: float) -> tuple[bool, float]:
        return self.fixed_vision.piece_present(patch, radius)

    def _piece_coin_score(self, patch: np.ndarray, radius: float) -> tuple[float, float, float]:
        if patch is None or patch.size == 0:
            return 0.0, 0.0, 0.0
        gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (3, 3), 0)
        grad_x = cv2.Sobel(blur, cv2.CV_32F, 1, 0, ksize=3)
        grad_y = cv2.Sobel(blur, cv2.CV_32F, 0, 1, ksize=3)
        magnitude = np.sqrt((grad_x * grad_x) + (grad_y * grad_y))

        height, width = gray.shape
        cx = width / 2.0
        cy = height / 2.0
        yy, xx = np.indices(gray.shape)
        dx = xx - cx
        dy = yy - cy
        distance = np.sqrt((dx * dx) + (dy * dy)) + 1e-6
        radial_alignment = np.abs(
            ((grad_x * dx) + (grad_y * dy)) / (np.maximum(magnitude, 1e-6) * distance)
        )

        best_score = 0.0
        best_coverage = 0.0
        best_energy = 0.0
        for ring_radius in np.linspace(radius * 0.74, radius * 1.18, 13):
            annulus = (distance >= ring_radius * 0.88) & (distance <= ring_radius * 1.08)
            if np.count_nonzero(annulus) < 30:
                continue
            ring_magnitude = magnitude[annulus]
            strong_threshold = float(np.percentile(ring_magnitude, 65))
            strong = annulus & (magnitude > strong_threshold) & (radial_alignment > 0.42)
            if np.count_nonzero(strong) < 12:
                continue

            angles = (np.arctan2(dy[strong], dx[strong]) + math.pi) / (2.0 * math.pi)
            bins = np.bincount(np.minimum(31, (angles * 32).astype(np.int32)), minlength=32)
            coverage = float(np.count_nonzero(bins) / 32.0)
            radial_energy = float((magnitude[annulus] * radial_alignment[annulus]).mean())
            score = coverage * radial_energy
            if score > best_score:
                best_score = score
                best_coverage = coverage
                best_energy = radial_energy
        return best_score, best_coverage, best_energy

    def _estimate_piece_side(self, patch: np.ndarray) -> str:
        h, w = patch.shape[:2]
        cx = w / 2.0
        cy = h / 2.0
        yy, xx = np.indices((h, w))
        face_radius = min(h, w) * self.catalog_mask_scale
        face = ((xx - cx) ** 2 + (yy - cy) ** 2) <= (face_radius ** 2)
        if not np.any(face):
            return "black"

        blur_sigma = max(1.0, min(h, w) * 0.06)
        blurred = cv2.GaussianBlur(patch, (0, 0), blur_sigma)
        gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY).astype(np.float32)
        blurred_gray = cv2.cvtColor(blurred, cv2.COLOR_BGR2GRAY).astype(np.float32)
        dark_score = blurred_gray - gray
        threshold = max(14.0, float(np.percentile(dark_score[face], 92)) * 0.58)
        dark_mask = (dark_score >= threshold) & face
        if np.count_nonzero(dark_mask) < 20:
            return "black"

        b, g, r = cv2.split(patch.astype(np.float32))
        red_dominance = r - np.maximum(g, b)
        mean_red = float(red_dominance[dark_mask].mean())
        return "red" if mean_red >= 40.0 else "black"

    def _classify_piece(
        self, patch: np.ndarray, radius: float
    ) -> tuple[str, str, float, list[tuple[str, float]]] | None:
        return self.fixed_vision.classify_piece(patch, radius)

    def _classify_piece_with_ocr(
        self,
        patch: np.ndarray,
        radius: float,
        side: str,
        allowed_piece_types: set[str] | None = None,
        min_confidence: float = 0.0,
    ) -> tuple[str, str, float, list[tuple[str, float]]] | None:
        candidates: list[tuple[str, float]] = []
        pad_large = max(12, int(radius * 0.28))
        variants = [
            self._variant_original(patch),
            self._variant_mask_for_side(patch, side, 0.24),
            self._variant_mask_for_side(patch, side, 0.28),
            self._variant_mask_for_side(patch, side, 0.31),
            self._variant_mask(patch, radius, 0.24, 0),
            self._variant_mask(patch, radius, 0.28, 0),
            self._variant_otsu(patch, invert=True),
            self._variant_original(self._pad_patch(patch, pad_large)),
            self._variant_mask_for_side(self._pad_patch(patch, pad_large), side, 0.28),
            self._variant_mask(self._pad_patch(patch, pad_large), radius + pad_large, 0.28, 0),
        ]

        seen_text: set[str] = set()
        for variant in variants:
            if variant is None:
                continue
            result, _ = self._get_ocr()(variant)
            if not result:
                continue
            text = result[0][1].strip()
            score = float(result[0][2])
            if not text or text in seen_text:
                continue
            seen_text.add(text)
            normalized = self._normalize_ocr_text(text)
            if normalized is not None:
                piece_type = KNOWN_GLYPHS[normalized]
                if allowed_piece_types is not None and piece_type not in allowed_piece_types:
                    continue
                if score >= max(0.80, min_confidence):
                    return side, piece_type, min(0.99, score), [(normalized, score)]
                candidates.append((normalized, score))

        if not candidates:
            return None

        grouped: Counter[str] = Counter()
        score_map: dict[str, float] = {}
        for glyph, score in candidates:
            grouped[glyph] += 1
            score_map[glyph] = max(score_map.get(glyph, 0.0), score)

        ranked = sorted(
            grouped.items(),
            key=lambda item: (item[1], score_map[item[0]]),
            reverse=True,
        )
        chosen_glyph = ranked[0][0]
        piece_type = KNOWN_GLYPHS[chosen_glyph]
        confidence = min(0.99, score_map[chosen_glyph] + (0.07 * (grouped[chosen_glyph] - 1)))
        if confidence < min_confidence:
            return None
        return side, piece_type, confidence, [(glyph, score_map[glyph]) for glyph, _count in ranked]

    def _stroke_mask(
        self, patch: np.ndarray, radius: float, mask_scale: float
    ) -> tuple[str, np.ndarray | None]:
        _ = radius
        best_side = "black"
        best_mask: np.ndarray | None = None
        best_score = -1
        for side in ("black", "red"):
            mask = self._extract_glyph_mask(patch, side=side, mask_scale=mask_scale)
            if mask is None:
                continue
            score = cv2.countNonZero(mask)
            if score > best_score:
                best_side = side
                best_mask = mask
                best_score = score
        return best_side, best_mask

    def _extract_glyph_mask(self, patch: np.ndarray, side: str, mask_scale: float) -> np.ndarray | None:
        h, w = patch.shape[:2]
        if h == 0 or w == 0:
            return None

        cx = w / 2.0
        cy = h / 2.0
        yy, xx = np.indices((h, w))
        face_radius = min(h, w) * mask_scale
        dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
        face = dist <= face_radius
        if not np.any(face):
            return None

        blur_sigma = max(1.0, min(h, w) * 0.06)
        blurred = cv2.GaussianBlur(patch, (0, 0), blur_sigma)
        gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY).astype(np.float32)
        blurred_gray = cv2.cvtColor(blurred, cv2.COLOR_BGR2GRAY).astype(np.float32)
        delta_l = blurred_gray - gray

        b, g, r = cv2.split(patch.astype(np.float32))
        red_dominance = r - np.maximum(g, b)

        if side == "black":
            lab = cv2.cvtColor(patch, cv2.COLOR_BGR2LAB).astype(np.float32)
            l_channel = lab[:, :, 0]
            local_mean = cv2.GaussianBlur(l_channel, (0, 0), max(1.0, min(h, w) * 0.045))
            local_dark = local_mean - l_channel
            score = np.where(face, np.maximum(delta_l, local_dark), 0.0)
            values = score[face]
            threshold = max(8.0, float(np.percentile(values, 91)) * 0.44)
            mask = ((score >= threshold) & face).astype(np.uint8) * 255
        else:
            hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
            hue = hsv[:, :, 0]
            saturation = hsv[:, :, 1]
            value = hsv[:, :, 2]
            red_hue = (hue <= 16) | (hue >= 168)
            red_stroke = red_hue & (saturation >= 45) & (value <= 225) & face
            if np.count_nonzero(red_stroke) >= 20:
                score = red_dominance + (0.35 * delta_l) + (0.20 * saturation.astype(np.float32))
                values = score[red_stroke]
                threshold = max(32.0, float(np.percentile(values, 58)) * 0.72)
                mask = ((score >= threshold) & red_stroke).astype(np.uint8) * 255
            else:
                chroma_red = red_dominance + (0.22 * delta_l)
                score = np.where(face, chroma_red, 0.0)
                values = score[face]
                threshold = max(12.0, float(np.percentile(values, 94)) * 0.72)
                mask = ((score >= threshold) & face).astype(np.uint8) * 255

        mask = cv2.medianBlur(mask, 3)
        inner_face = dist <= face_radius * 0.84
        mask[~inner_face] = 0
        mask = self._clean_glyph_mask(mask, face_radius)
        if cv2.countNonZero(mask) < 20:
            return None
        return mask

    def _clean_glyph_mask(self, mask: np.ndarray, face_radius: float) -> np.ndarray:
        component_count, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, 8)
        if component_count <= 1:
            return mask

        cleaned = np.zeros_like(mask)
        h, w = mask.shape
        cx = w / 2.0
        cy = h / 2.0
        min_area = max(3, int(round(face_radius * 0.08)))
        for label in range(1, component_count):
            area = int(stats[label, cv2.CC_STAT_AREA])
            if area <= 0:
                continue
            center_x, center_y = centroids[label]
            distance = math.hypot(center_x - cx, center_y - cy)
            keep_small = area >= 2 and distance <= face_radius * 0.82
            if area >= min_area or keep_small:
                cleaned[labels == label] = 255
        return cleaned

    def _normalize_mask(self, mask: np.ndarray, size: int = MASK_SIZE) -> np.ndarray | None:
        ys, xs = np.where(mask > 0)
        if len(xs) == 0:
            return None
        x1, x2 = xs.min(), xs.max() + 1
        y1, y2 = ys.min(), ys.max() + 1
        glyph = mask[y1:y2, x1:x2]
        height, width = glyph.shape
        if height == 0 or width == 0:
            return None
        scale = min((size - 20) / width, (size - 20) / height)
        new_width = max(1, int(round(width * scale)))
        new_height = max(1, int(round(height * scale)))
        resized = cv2.resize(glyph, (new_width, new_height), interpolation=cv2.INTER_AREA)
        resized = cv2.threshold(resized, 96, 255, cv2.THRESH_BINARY)[1]
        canvas = np.zeros((size, size), dtype=np.uint8)
        start_x = (size - new_width) // 2
        start_y = (size - new_height) // 2
        canvas[start_y:start_y + new_height, start_x:start_x + new_width] = (resized > 0).astype(np.uint8) * 255
        return canvas

    def _load_template_catalog(self, catalog_dir: Path) -> dict[str, dict[str, list[np.ndarray]]]:
        catalog_path = catalog_dir / "catalog.json"
        if not catalog_path.exists():
            return {}
        data = json.loads(catalog_path.read_text(encoding="utf-8"))
        bank: dict[str, dict[str, list[np.ndarray]]] = {"red": {}, "black": {}}
        for entry in data.get("templates", []):
            mask_path = catalog_dir / entry["mask_file"]
            mask = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
            if mask is None:
                continue
            normalized = self._normalize_mask(mask)
            if normalized is None:
                continue
            bank.setdefault(entry["side"], {}).setdefault(entry["piece_type"], []).append(normalized)
        return bank

    def _piece_patch_feature(self, patch: np.ndarray, size: int = 144) -> tuple[np.ndarray, np.ndarray] | None:
        if patch is None or patch.size == 0:
            return None
        resized = cv2.resize(patch, (size, size), interpolation=cv2.INTER_AREA)
        lab = cv2.cvtColor(resized, cv2.COLOR_BGR2LAB).astype(np.float32)
        l_channel = lab[:, :, 0]
        smooth = cv2.GaussianBlur(l_channel, (0, 0), max(1.0, size * 0.045))
        dark_detail = np.maximum(smooth - l_channel, 0.0)

        b, g, r = cv2.split(resized.astype(np.float32))
        red_detail = np.maximum(r - np.maximum(g, b), 0.0)
        detail = np.maximum(dark_detail, red_detail * 0.45)

        gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 40, 115).astype(np.float32) / 255.0

        yy, xx = np.indices((size, size))
        center = (size - 1) / 2.0
        dist = np.sqrt((xx - center) ** 2 + (yy - center) ** 2)
        face = dist <= size * 0.35
        if np.count_nonzero(face) < 50:
            return None

        detail_values = detail[face].astype(np.float32)
        detail_values -= float(detail_values.mean())
        detail_norm = float(np.linalg.norm(detail_values))
        if detail_norm <= 1e-6:
            return None
        detail_values /= detail_norm

        edge_values = edges[face].astype(np.float32)
        edge_values -= float(edge_values.mean())
        edge_norm = float(np.linalg.norm(edge_values))
        if edge_norm > 1e-6:
            edge_values /= edge_norm
        return detail_values, edge_values

    def _canonical_piece_patch(
        self,
        patch: np.ndarray,
        radius: float | None = None,
        size: int | None = None,
    ) -> np.ndarray | None:
        if patch is None or patch.size == 0:
            return None
        target_size = size or self.direct_template_size
        h, w = patch.shape[:2]
        if h < 10 or w < 10:
            return None

        if radius is None:
            radius = min(h, w) / 2.7

        center_x, center_y = self._estimate_piece_disk_center(patch, radius)
        matrix = np.array(
            [[1.0, 0.0, (w / 2.0) - center_x], [0.0, 1.0, (h / 2.0) - center_y]],
            dtype=np.float32,
        )
        centered = cv2.warpAffine(
            patch,
            matrix,
            (w, h),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REPLICATE,
        )
        return cv2.resize(centered, (target_size, target_size), interpolation=cv2.INTER_AREA)

    def _estimate_piece_disk_center(self, patch: np.ndarray, radius: float) -> tuple[float, float]:
        h, w = patch.shape[:2]
        default_x = w / 2.0
        default_y = h / 2.0
        gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        min_radius = max(8, int(round(radius * 0.74)))
        max_radius = max(min_radius + 2, int(round(radius * 1.16)))
        circles = cv2.HoughCircles(
            blurred,
            cv2.HOUGH_GRADIENT,
            dp=1.12,
            minDist=max(12, int(round(radius * 0.7))),
            param1=90,
            param2=16,
            minRadius=min_radius,
            maxRadius=max_radius,
        )
        if circles is None:
            return default_x, default_y

        best: tuple[float, float, float] | None = None
        for x, y, detected_radius in circles[0]:
            distance = math.hypot(float(x) - default_x, float(y) - default_y)
            if distance > radius * 0.34:
                continue
            score = distance + abs(float(detected_radius) - radius) * 0.35
            if best is None or score < best[2]:
                best = (float(x), float(y), score)
        if best is None:
            return default_x, default_y
        return best[0], best[1]

    def _unit_feature(self, values: np.ndarray, subtract_mean: bool = True) -> np.ndarray:
        vector = values.astype(np.float32).reshape(-1)
        if subtract_mean and vector.size:
            vector = vector - float(vector.mean())
        norm = float(np.linalg.norm(vector))
        if norm <= 1e-6:
            return np.zeros_like(vector, dtype=np.float32)
        return (vector / norm).astype(np.float32)

    def _piece_direct_feature_from_canonical(
        self,
        canonical: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, float] | None:
        size = canonical.shape[0]
        if canonical.shape[0] != canonical.shape[1] or size < 32:
            return None

        lab = cv2.cvtColor(canonical, cv2.COLOR_BGR2LAB).astype(np.float32)
        l_channel = lab[:, :, 0]
        local_mean = cv2.GaussianBlur(l_channel, (0, 0), max(1.0, size * 0.045))
        dark_detail = np.clip(local_mean - l_channel, 0.0, 80.0) / 80.0

        b, g, r = cv2.split(canonical.astype(np.float32))
        red_detail_raw = np.clip(r - np.maximum(g, b), 0.0, 160.0)
        red_detail = red_detail_raw / 160.0

        gray = cv2.cvtColor(canonical, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 38, 115).astype(np.float32) / 255.0

        yy, xx = np.indices((size, size))
        center = (size - 1) / 2.0
        dist = np.sqrt((xx - center) ** 2 + (yy - center) ** 2)
        glyph_face = dist <= size * 0.36
        if np.count_nonzero(glyph_face) < 100:
            return None

        ink = np.maximum(dark_detail, red_detail * 0.75)
        ink_values = ink[glyph_face]
        if ink_values.size == 0:
            return None
        ink_threshold = max(0.08, float(np.percentile(ink_values, 76)))
        stroke_pixels = glyph_face & (ink >= ink_threshold)
        if np.count_nonzero(stroke_pixels) < 18:
            stroke_pixels = glyph_face & (ink >= max(0.04, float(np.percentile(ink_values, 66))))
        if np.count_nonzero(stroke_pixels) < 18:
            return None

        red_signal = float(red_detail_raw[stroke_pixels].mean())
        dark_feature = self._unit_feature(dark_detail[glyph_face], subtract_mean=True)
        red_feature = self._unit_feature(red_detail[glyph_face], subtract_mean=True)
        edge_feature = self._unit_feature(edges[glyph_face], subtract_mean=True)
        return dark_feature, red_feature, edge_feature, red_signal

    def _piece_direct_feature(
        self,
        patch: np.ndarray,
        radius: float | None = None,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, float] | None:
        canonical = self._canonical_piece_patch(patch, radius=radius, size=self.direct_template_size)
        if canonical is None:
            return None
        return self._piece_direct_feature_from_canonical(canonical)

    def _load_direct_template_catalog(
        self,
        catalog_dir: Path,
    ) -> dict[str, dict[str, list[tuple[np.ndarray, np.ndarray, np.ndarray, float]]]]:
        catalog_path = catalog_dir / "catalog.json"
        if not catalog_path.exists():
            return {}
        data = json.loads(catalog_path.read_text(encoding="utf-8"))
        bank: dict[str, dict[str, list[tuple[np.ndarray, np.ndarray, np.ndarray, float]]]] = {"red": {}, "black": {}}
        for entry in data.get("templates", []):
            patch_path = catalog_dir / entry.get("patch_file", "")
            patch = cv2.imread(str(patch_path))
            if patch is None:
                continue
            feature = self._piece_direct_feature(patch)
            if feature is None:
                continue
            side = entry.get("side")
            piece_type = entry.get("piece_type")
            if side not in ("red", "black") or piece_type not in PIECE_TO_LALG:
                continue
            bank.setdefault(side, {}).setdefault(piece_type, []).append(feature)
        return bank

    def _direct_template_similarity(
        self,
        query: tuple[np.ndarray, np.ndarray, np.ndarray, float],
        template: tuple[np.ndarray, np.ndarray, np.ndarray, float],
    ) -> float:
        query_dark, query_red, query_edge, query_red_signal = query
        template_dark, template_red, template_edge, template_red_signal = template
        dark_score = float(query_dark @ template_dark)
        red_score = float(query_red @ template_red)
        edge_score = float(query_edge @ template_edge)
        side_score = max(0.0, 1.0 - (abs(query_red_signal - template_red_signal) / 48.0))
        return (
            (0.50 * dark_score)
            + (0.22 * edge_score)
            + (0.16 * red_score)
            + (0.12 * side_score)
        )

    def _classify_piece_with_direct_templates(
        self,
        patch: np.ndarray,
        radius: float,
    ) -> tuple[str, str, float, list[tuple[str, float]]] | None:
        query = self._piece_direct_feature(patch, radius=radius)
        if query is None:
            return None

        ranked: list[tuple[str, str, float]] = []
        for side, pieces in self.direct_template_bank.items():
            for piece_type, templates in pieces.items():
                best_score = float("-inf")
                for template in templates:
                    score = self._direct_template_similarity(query, template)
                    if score > best_score:
                        best_score = score
                if best_score > float("-inf"):
                    ranked.append((side, piece_type, best_score))

        if not ranked:
            return None
        ranked.sort(key=lambda item: item[2], reverse=True)
        best_side, best_type, best_score = ranked[0]
        if best_score < 0.16:
            return None
        second_score = ranked[1][2] if len(ranked) > 1 else best_score
        margin = max(0.0, best_score - second_score)
        confidence = min(0.99, max(0.50, 0.58 + (best_score * 0.34) + min(margin, 0.25) * 0.28))
        glyphs = [(f"direct:{side}:{piece_type}", score) for side, piece_type, score in ranked[:5]]
        return best_side, best_type, confidence, glyphs

    def _load_patch_template_catalog(self, catalog_dir: Path) -> dict[str, dict[str, list[tuple[np.ndarray, np.ndarray]]]]:
        catalog_path = catalog_dir / "catalog.json"
        if not catalog_path.exists():
            return {}
        data = json.loads(catalog_path.read_text(encoding="utf-8"))
        bank: dict[str, dict[str, list[tuple[np.ndarray, np.ndarray]]]] = {"red": {}, "black": {}}
        for entry in data.get("templates", []):
            patch_path = catalog_dir / entry.get("patch_file", "")
            patch = cv2.imread(str(patch_path))
            if patch is None:
                continue
            feature = self._piece_patch_feature(patch)
            if feature is None:
                continue
            bank.setdefault(entry["side"], {}).setdefault(entry["piece_type"], []).append(feature)
        return bank

    def _classify_piece_with_patch_templates(
        self,
        patch: np.ndarray,
        side: str,
    ) -> tuple[str, str, float, list[tuple[str, float]]] | None:
        side_bank = self.patch_template_bank.get(side)
        if not side_bank:
            return None
        feature = self._piece_patch_feature(patch)
        if feature is None:
            return None
        detail, edge = feature
        best_by_type: dict[str, float] = {}
        for piece_type, templates in side_bank.items():
            best_score = float("-inf")
            for template_detail, template_edge in templates:
                score = (0.72 * float(detail @ template_detail)) + (0.28 * float(edge @ template_edge))
                if score > best_score:
                    best_score = score
            best_by_type[piece_type] = best_score
        ranked = sorted(best_by_type.items(), key=lambda item: item[1], reverse=True)
        if not ranked:
            return None
        best_type, best_score = ranked[0]
        second_score = ranked[1][1] if len(ranked) > 1 else float("-inf")
        margin = best_score - second_score
        if best_score < 0.62 or margin < 0.08:
            return None
        confidence = min(0.99, max(0.35, 0.55 + (best_score * 0.45)))
        return side, best_type, confidence, [(f"patch:{name}", value) for name, value in ranked[:5]]

    def _compute_hog_feature(self, normalized_mask: np.ndarray) -> np.ndarray:
        feature = self.hog.compute(normalized_mask).reshape(-1).astype(np.float32)
        norm = float(np.linalg.norm(feature))
        if norm > 0:
            feature /= norm
        return feature

    def _build_mask_feature_bank(self) -> dict[str, dict[str, np.ndarray | list[str]]]:
        bank: dict[str, dict[str, np.ndarray | list[str]]] = {}
        for side, pieces in self.template_bank.items():
            features: list[np.ndarray] = []
            labels: list[str] = []
            for piece_type, masks in pieces.items():
                for mask in masks:
                    features.append(self._compute_hog_feature(mask))
                    labels.append(piece_type)
            if features:
                bank[side] = {
                    "features": np.vstack(features).astype(np.float32),
                    "labels": labels,
                }
        return bank

    def _score_mask_classifier(
        self, side: str, normalized_mask: np.ndarray
    ) -> tuple[str, float, list[tuple[str, float]]] | None:
        side_bank = self.mask_feature_bank.get(side)
        if not side_bank:
            return None
        features = side_bank["features"]
        labels = side_bank["labels"]
        assert isinstance(features, np.ndarray)
        assert isinstance(labels, list)
        query = self._compute_hog_feature(normalized_mask)
        scores = features @ query
        best_by_type: dict[str, float] = {}
        for label, score in zip(labels, scores):
            score_value = float(score)
            if score_value > best_by_type.get(label, float("-inf")):
                best_by_type[label] = score_value
        ranked = sorted(best_by_type.items(), key=lambda item: item[1], reverse=True)
        if not ranked:
            return None
        best_type, best_score = ranked[0]
        return best_type, best_score, ranked[:5]

    def _match_template(self, side: str, normalized_mask: np.ndarray) -> tuple[str, float] | None:
        side_bank = self.template_bank.get(side)
        if not side_bank:
            return None
        best_type = None
        best_score = 0.0
        for piece_type, templates in side_bank.items():
            for template in templates:
                inter = np.logical_and(normalized_mask > 0, template > 0).sum()
                union = np.logical_or(normalized_mask > 0, template > 0).sum()
                if union == 0:
                    continue
                overlap = inter / max(np.count_nonzero(template), 1)
                iou = inter / union
                score = (0.7 * iou) + (0.3 * overlap)
                if score > best_score:
                    best_score = float(score)
                    best_type = piece_type
        if best_type is None:
            return None
        return best_type, best_score

    def _best_piece_candidate(
        self, patch: np.ndarray, radius: float
    ) -> tuple[str, str, float, list[tuple[str, float]], float] | None:
        best: tuple[str, str, float, list[tuple[str, float]], float] | None = None
        _ = radius
        side = self._estimate_piece_side(patch)
        if side not in self.mask_feature_bank:
            return None
        for mask_scale in self.mask_scales:
            base_mask = self._extract_glyph_mask(patch, side=side, mask_scale=mask_scale)
            if base_mask is None:
                continue
            normalized = self._normalize_mask(base_mask)
            if normalized is None:
                continue
            scored = self._score_mask_classifier(side, normalized)
            if scored is None:
                continue
            piece_type, score, ranked = scored
            if best is None or score > best[2]:
                best = (
                    side,
                    piece_type,
                    score,
                    [(name, value) for name, value in ranked],
                    mask_scale,
                )
        return best

    def _migrate_catalog_masks(self, catalog_dir: Path) -> None:
        catalog_path = catalog_dir / "catalog.json"
        if not catalog_path.exists():
            return

        data = json.loads(catalog_path.read_text(encoding="utf-8"))
        if data.get("catalog_version", 0) >= CATALOG_VERSION:
            return

        updated = False
        for entry in data.get("templates", []):
            patch_path = catalog_dir / entry["patch_file"]
            if not patch_path.exists():
                continue
            patch = cv2.imread(str(patch_path))
            if patch is None:
                continue
            mask = self._extract_glyph_mask(
                patch,
                side=entry["side"],
                mask_scale=self.catalog_mask_scale,
            )
            if mask is None:
                continue
            cv2.imwrite(str(catalog_dir / entry["mask_file"]), mask)
            updated = True

        if not updated:
            return

        data["catalog_version"] = CATALOG_VERSION
        data["generated_at"] = datetime.now().isoformat()
        catalog_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def build_template_catalog(self, image: np.ndarray, catalog_dir: Path | None = None) -> Path:
        catalog_dir = catalog_dir or self.catalog_dir
        catalog_dir.mkdir(parents=True, exist_ok=True)
        board_bbox, grid_x, grid_y = self.detect_board(image)
        step_x = float(np.median(np.diff(grid_x)))
        step_y = float(np.median(np.diff(grid_y)))
        step = float((step_x + step_y) / 2.0)
        templates: list[dict[str, str]] = []

        for coord, (side, piece_type) in START_POSITION_MAP.items():
            col = FILE_LETTERS.index(coord[0])
            row = int(coord[1])
            row_index = 9 - row
            patch, radius = self.fixed_vision.extract_intersection_patch(image, grid_x[col], grid_y[row_index], step)
            if patch is None:
                continue
            _ = radius
            centered, _offset = self.fixed_vision.center_artwork_patch(patch, radius, side)
            mask = self.fixed_vision._extract_glyph_mask(
                centered,
                side=side,
                mask_scale=self.catalog_mask_scale,
            )
            if mask is None:
                continue
            normalized = self.fixed_vision._normalize_mask(mask)
            if normalized is None or cv2.countNonZero(normalized) < 70:
                continue
            base_name = f"{side}_{piece_type}_{coord}"
            patch_file = f"{base_name}.png"
            mask_file = f"{base_name}_mask.png"
            cv2.imwrite(str(catalog_dir / patch_file), centered)
            cv2.imwrite(str(catalog_dir / mask_file), normalized)
            templates.append(
                {
                    "coord": coord,
                    "side": side,
                    "piece_type": piece_type,
                    "patch_file": patch_file,
                    "mask_file": mask_file,
                }
            )

        catalog_path = catalog_dir / "catalog.json"
        catalog_path.write_text(
            json.dumps(
                {
                    "board_bbox": board_bbox,
                    "catalog_version": CATALOG_VERSION,
                    "generated_at": datetime.now().isoformat(),
                    "templates": templates,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        self.template_bank = self._load_template_catalog(catalog_dir)
        self.patch_template_bank = self._load_patch_template_catalog(catalog_dir)
        self.direct_template_bank = self._load_direct_template_catalog(catalog_dir)
        self.mask_feature_bank = self._build_mask_feature_bank()
        self.fixed_vision.rebuild_catalog(catalog_dir)
        self.enable_ocr_fallback = False
        return catalog_path

    def _variant_original(self, patch: np.ndarray) -> np.ndarray:
        return patch

    def _variant_otsu(self, patch: np.ndarray, invert: bool = False) -> np.ndarray:
        gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)
        big = cv2.resize(gray, None, fx=4, fy=4, interpolation=cv2.INTER_CUBIC)
        flag = cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU if invert else cv2.THRESH_BINARY + cv2.THRESH_OTSU
        binary = cv2.threshold(big, 0, 255, flag)[1]
        return cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)

    def _variant_mask(self, patch: np.ndarray, radius: float, mask_scale: float, extra_pad: int) -> np.ndarray | None:
        _side, mask = self._stroke_mask(patch, radius, mask_scale)
        if mask is None or cv2.countNonZero(mask) < 50:
            return None
        big = cv2.resize(255 - mask, None, fx=5, fy=5, interpolation=cv2.INTER_NEAREST)
        return cv2.cvtColor(big, cv2.COLOR_GRAY2BGR)

    def _variant_mask_for_side(self, patch: np.ndarray, side: str, mask_scale: float) -> np.ndarray | None:
        mask = self._extract_glyph_mask(patch, side=side, mask_scale=mask_scale)
        if mask is None or cv2.countNonZero(mask) < 50:
            return None
        big = cv2.resize(255 - mask, None, fx=5, fy=5, interpolation=cv2.INTER_NEAREST)
        return cv2.cvtColor(big, cv2.COLOR_GRAY2BGR)

    def _pad_patch(self, patch: np.ndarray, pad: int) -> np.ndarray:
        return cv2.copyMakeBorder(patch, pad, pad, pad, pad, cv2.BORDER_REPLICATE)

    def _normalize_ocr_text(self, text: str) -> str | None:
        for char in text:
            if char in KNOWN_GLYPHS:
                return char
        replacements = {
            "\u5bbe": "\u5175",
            "\u5e08": "\u5e2b",
            "\u98fe": "\u5e25",
            "\u7279": "\u5c06",
            "\u5f85": "\u5c06",
            "\u79fb": "\u5c06",
            "\u8f9b": "\u5352",
            "\u4efb": "\u4ed5",
            "\u793e": "\u4ed5",
            "\u4e16": "\u4ed5",
            "\u547d": "\u5e25",
            "\u7ba1": "\u5e25",
            "\u8ecd": "\u8eca",
            "\u7535": "\u8eca",
            "\u96fb": "\u8eca",
            "\u91cd": "\u8eca",
            "\u79df": "\u76f8",
            "\u7bb1": "\u76f8",
            "\u53a2": "\u76f8",
            "\u50cf": "\u8c61",
            "\u5bb6": "\u8c61",
            "\u56f4": "\u99ac",
            "\u570d": "\u99ac",
            "\u5c55": "\u99ac",
            "\u5718": "\u99ac",
            "\u56e2": "\u99ac",
            "\u5730": "\u70ae",
            "\u7130": "\u70ae",
            "\u7edd": "\u70ae",
            "\u7d55": "\u70ae",
            "\u7231": "\u70ae",
            "\u611b": "\u70ae",
        }
        for char in text:
            if char in replacements:
                return replacements[char]
        return None

    def _flip_orientation(self, pieces: dict[str, DetectedPiece]) -> dict[str, DetectedPiece]:
        flipped: dict[str, DetectedPiece] = {}
        for piece in pieces.values():
            new_col = 8 - piece.col
            new_row = 9 - piece.row
            replacement = DetectedPiece(
                side=piece.side,
                piece_type=piece.piece_type,
                col=new_col,
                row=new_row,
                center=piece.center,
                radius=piece.radius,
                confidence=piece.confidence,
                glyphs=piece.glyphs,
            )
            flipped[replacement.coord] = replacement
        return flipped

    def _draw_overlay(
        self,
        image: np.ndarray,
        board_bbox: tuple[int, int, int, int],
        grid_x: Sequence[float],
        grid_y: Sequence[float],
        pieces: dict[str, DetectedPiece],
    ) -> np.ndarray:
        overlay = image.copy()
        x1, y1, x2, y2 = board_bbox
        cv2.rectangle(overlay, (x1, y1), (x2, y2), (0, 255, 255), 2)
        for x in grid_x:
            cv2.line(overlay, (int(round(x)), int(round(grid_y[0]))), (int(round(x)), int(round(grid_y[-1]))), (255, 128, 0), 1)
        for y in grid_y:
            cv2.line(overlay, (int(round(grid_x[0])), int(round(y))), (int(round(grid_x[-1])), int(round(y))), (255, 128, 0), 1)
        for piece in pieces.values():
            center = (int(round(piece.center[0])), int(round(piece.center[1])))
            color = (0, 0, 255) if piece.side == "red" else (40, 40, 40)
            cv2.circle(overlay, center, int(round(piece.radius)), color, 2)
            cv2.putText(
                overlay,
                piece.debug_label,
                (center[0] - 26, center[1] - int(round(piece.radius + 6))),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.45,
                (0, 255, 0),
                1,
                cv2.LINE_AA,
            )
        return overlay
