from __future__ import annotations

import json
import math
from collections import Counter
from pathlib import Path
from typing import Sequence

from .constants import CATALOG_VERSION, FILE_LETTERS, KNOWN_GLYPHS, MASK_SIZE, PIECE_TO_LALG, START_POSITION_MAP
from .models import BoardState, DetectedPiece, FixedThemeTemplate
from .runtime import cv2, np

class FixedThemeVision:
    """Deterministic detector for the fixed 天天象棋 board artwork."""

    PATCH_HALF_STEP = 0.60
    PIECE_RADIUS_STEP = 0.44
    ARTWORK_RING_RADIUS_STEP = PIECE_RADIUS_STEP * 0.79
    CATALOG_MASK_SCALE = 0.31
    MASK_SCALES = (0.29, 0.31, 0.33)
    MIN_CLASS_SCORE = 0.42
    MIN_PRESENCE_SCORE = 45.0
    MIN_PRESENCE_COVERAGE = 0.68
    MIN_PRESENCE_RADIAL_ENERGY = 58.0
    PIECE_LIMITS = {"k": 1, "r": 2, "n": 2, "c": 2, "g": 2, "m": 2, "p": 5}
    COUNT_REPAIR_MAX_SCORE_LOSS = 0.08
    COUNT_REPAIR_STRONG_OCR_SCORE = 0.55

    def __init__(self, catalog_dir: Path) -> None:
        self.catalog_dir = catalog_dir
        self.hog = cv2.HOGDescriptor(
            _winSize=(MASK_SIZE, MASK_SIZE),
            _blockSize=(16, 16),
            _blockStride=(8, 8),
            _cellSize=(8, 8),
            _nbins=9,
        )
        self.templates_by_side = self._load_templates(catalog_dir)

    def detect_board(self, image: np.ndarray) -> tuple[tuple[int, int, int, int], list[float], list[float]]:
        candidates = self._board_candidates(image)
        best: tuple[float, tuple[int, int, int, int], list[float], list[float]] | None = None
        for crop_box in candidates:
            x1, y1, x2, y2 = crop_box
            crop = image[y1:y2, x1:x2]
            if crop.size == 0:
                continue
            try:
                local_x, local_y, fit_score = self._fit_grid(crop)
            except RuntimeError:
                continue
            grid_x = [x1 + value for value in local_x]
            grid_y = [y1 + value for value in local_y]
            grid_y, shift_bonus = self._correct_vertical_grid_shift(image, grid_x, grid_y)
            step_x = float(np.median(np.diff(grid_x)))
            step_y = float(np.median(np.diff(grid_y)))
            if step_x < 25.0 or step_y < 25.0:
                continue
            step = (step_x + step_y) / 2.0
            shape_penalty = abs(step_x - step_y) / max(step, 1.0)
            if shape_penalty > 0.18:
                continue
            board_box = self._board_box_from_grid(image, grid_x, grid_y)
            board_area = (board_box[2] - board_box[0]) * (board_box[3] - board_box[1])
            area_bonus = board_area / max(image.shape[0] * image.shape[1], 1)
            is_fallback = crop_box in (
                (0, 0, min(image.shape[1], int(image.shape[1] * 0.96)), image.shape[0]),
                (0, 0, image.shape[1], image.shape[0]),
            )
            candidate_bonus = 35.0 if not is_fallback else 0.0
            score = fit_score - (shape_penalty * 25.0) + (area_bonus * 8.0) + candidate_bonus + shift_bonus
            if best is None or score > best[0]:
                best = (score, board_box, grid_x, grid_y)
        if best is None:
            raise RuntimeError("Could not locate the fixed-theme Xiangqi board grid.")
        return best[1], best[2], best[3]

    def recognize_board(self, image: np.ndarray) -> BoardState:
        board_bbox, grid_x, grid_y = self.detect_board(image)
        step_x = float(np.median(np.diff(grid_x)))
        step_y = float(np.median(np.diff(grid_y)))
        step = float((step_x + step_y) / 2.0)
        pieces: dict[str, DetectedPiece] = {}
        warnings: list[str] = []

        for row_index, y in enumerate(grid_y):
            for col_index, x in enumerate(grid_x):
                coord = f"{FILE_LETTERS[col_index]}{9 - row_index}"
                patch, radius = self.extract_intersection_patch(image, x, y, step)
                if patch is None:
                    continue
                present, coin_score = self.piece_present(patch, radius)
                if not present:
                    continue
                classified = self.classify_piece(patch, radius)
                if classified is None:
                    warnings.append(f"Occupied intersection at {coord.upper()} could not be classified (coin score {coin_score:.1f}).")
                    continue
                side, piece_type, confidence, glyphs = classified
                piece = DetectedPiece(
                    side=side,
                    piece_type=piece_type,
                    col=col_index,
                    row=9 - row_index,
                    center=(x, y),
                    radius=radius,
                    confidence=confidence,
                    glyphs=glyphs,
                )
                pieces[piece.coord] = piece

        if pieces:
            pieces = self._orient_pieces(pieces)
            pieces, legality_warnings = self._repair_impossible_setup_pieces(pieces)
            warnings.extend(legality_warnings)
            pieces = self._repair_missing_generals(pieces)
            pieces, count_warnings = self._repair_piece_count_overflows(pieces)
            warnings.extend(count_warnings)

        overlay = self.draw_overlay(image, board_bbox, grid_x, grid_y, pieces)
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

    def extract_intersection_patch(
        self, image: np.ndarray, x: float, y: float, step: float
    ) -> tuple[np.ndarray | None, float]:
        radius = float(step * self.PIECE_RADIUS_STEP)
        half = int(math.ceil(radius * 1.35))
        center_x = int(round(x))
        center_y = int(round(y))
        x1 = center_x - half
        y1 = center_y - half
        x2 = center_x + half
        y2 = center_y + half
        if x1 < 0 or y1 < 0 or x2 > image.shape[1] or y2 > image.shape[0]:
            return None, radius
        return image[y1:y2, x1:x2].copy(), radius

    def piece_present(self, patch: np.ndarray, radius: float) -> tuple[bool, float]:
        score, coverage, radial_energy = self._piece_coin_score(patch, radius)
        present = (
            score >= self.MIN_PRESENCE_SCORE
            and coverage >= self.MIN_PRESENCE_COVERAGE
            and radial_energy >= self.MIN_PRESENCE_RADIAL_ENERGY
        )
        return present, score

    def classify_piece(
        self, patch: np.ndarray, radius: float
    ) -> tuple[str, str, float, list[tuple[str, float]]] | None:
        candidates = self._rank_piece_candidates(patch, radius)
        if not candidates:
            return None
        side, piece_type, score, ranked = candidates[0]
        if score < self.MIN_CLASS_SCORE:
            return None
        confidence = min(0.99, max(0.55, 0.42 + (score * 0.58)))
        return side, piece_type, confidence, [(f"glyph:{name}", value) for name, value in ranked]

    def classify_piece_for_side(
        self, patch: np.ndarray, radius: float, side: str
    ) -> tuple[str, str, float, list[tuple[str, float]]] | None:
        candidates = self._rank_side_candidates(patch, side, radius)
        if not candidates:
            return None
        side, piece_type, score, ranked = candidates[0]
        if score < self.MIN_CLASS_SCORE:
            return None
        confidence = min(0.99, max(0.55, 0.42 + (score * 0.58)))
        return side, piece_type, confidence, [(f"glyph:{name}", value) for name, value in ranked]

    def classify_palette_piece_for_side(
        self, patch: np.ndarray, radius: float, side: str
    ) -> tuple[str, str, float, list[tuple[str, float]]] | None:
        cleaned = self._remove_palette_badge(patch)
        return self.classify_piece_for_side(cleaned, radius, side)

    def draw_overlay(
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

    def rebuild_catalog(self, catalog_dir: Path | None = None) -> None:
        self.catalog_dir = catalog_dir or self.catalog_dir
        self.templates_by_side = self._load_templates(self.catalog_dir)

    def _board_candidates(self, image: np.ndarray) -> list[tuple[int, int, int, int]]:
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        candidates = self._board_panel_candidates(image, hsv)
        warm = cv2.inRange(hsv, (5, 10, 60), (42, 255, 255))
        pale = cv2.inRange(hsv, (0, 0, 130), (42, 125, 255))
        mask = cv2.bitwise_or(warm, pale)
        toolbar_cutoff = int(image.shape[1] * 0.96)
        kernel = np.ones((9, 9), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        image_h, image_w = image.shape[:2]
        min_area = image_h * image_w * 0.08
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            if w * h < min_area:
                continue
            aspect = w / max(h, 1)
            if not 0.35 <= aspect <= 1.15:
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

        candidates.sort(key=lambda box: (box[2] - box[0]) * (box[3] - box[1]), reverse=True)
        left_content = (0, 0, min(image_w, toolbar_cutoff), image_h)
        candidates.append(left_content)
        candidates.append((0, 0, image_w, image_h))
        deduped: list[tuple[int, int, int, int]] = []
        for box in candidates:
            if box not in deduped:
                deduped.append(box)
        return deduped

    def _board_panel_candidates(
        self, image: np.ndarray, hsv: np.ndarray
    ) -> list[tuple[int, int, int, int]]:
        image_h, image_w = image.shape[:2]
        board_mask = cv2.inRange(hsv, (5, 35, 150), (42, 220, 255))
        kernel = np.ones((7, 7), np.uint8)
        board_mask = cv2.morphologyEx(board_mask, cv2.MORPH_CLOSE, kernel, iterations=2)
        board_mask = cv2.morphologyEx(board_mask, cv2.MORPH_OPEN, kernel, iterations=1)
        contours, _ = cv2.findContours(board_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        min_area = image_h * image_w * 0.14
        candidates: list[tuple[int, int, int, int]] = []
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            if w * h < min_area:
                continue
            aspect = w / max(h, 1)
            if not 0.78 <= aspect <= 1.05:
                continue
            if w < image_w * 0.55 or h < image_h * 0.35:
                continue
            candidates.append((x, y, min(image_w, x + w), min(image_h, y + h)))

        candidates.sort(key=lambda box: (box[2] - box[0]) * (box[3] - box[1]), reverse=True)
        return candidates

    def _fit_grid(self, crop: np.ndarray) -> tuple[list[float], list[float], float]:
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (3, 3), 0)
        vert = np.abs(cv2.Sobel(blur, cv2.CV_32F, 1, 0, ksize=3))
        hori = np.abs(cv2.Sobel(blur, cv2.CV_32F, 0, 1, ksize=3))

        height, width = gray.shape
        vert_profile = vert[int(height * 0.12): int(height * 0.90), :].mean(axis=0)
        hori_profile = hori[:, int(width * 0.08): int(width * 0.92)].mean(axis=1)
        v_peaks = self._find_peaks(vert_profile, min_distance=max(16, width // 18), percentile=84)
        h_peaks = self._find_peaks(hori_profile, min_distance=max(16, height // 20), percentile=84)
        if len(v_peaks) < 5 or len(h_peaks) < 6:
            raise RuntimeError("Board lines were not clear enough to fit a grid.")

        grid_y, y_score = self._arithmetic_grid(h_peaks, 10, height)
        y_step = float(np.median(np.diff(grid_y)))
        grid_x, x_score = self._arithmetic_grid(v_peaks, 9, width, preferred_step=y_step)
        if len(grid_x) != 9 or len(grid_y) != 10:
            raise RuntimeError("Could not fit the full 9x10 Xiangqi grid.")
        line_strength = self._line_support_score(vert_profile, grid_x) + self._line_support_score(hori_profile, grid_y)
        return grid_x, grid_y, x_score + y_score + line_strength

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

    def _arithmetic_grid(
        self,
        peaks: Sequence[int],
        count: int,
        axis_length: int,
        preferred_step: float | None = None,
    ) -> tuple[list[float], float]:
        if len(peaks) < 3:
            raise RuntimeError("Not enough peaks to estimate board spacing.")
        diffs = [b - a for a, b in zip(peaks, peaks[1:]) if 12 <= (b - a) <= axis_length]
        if not diffs:
            raise RuntimeError("Could not estimate board spacing.")
        step_candidates = [float(np.median(diffs))]
        if preferred_step is not None and preferred_step > 0.0:
            step_candidates.extend(self._preferred_grid_steps(peaks, count, axis_length, preferred_step))

        best_sequence: list[float] | None = None
        best_score = float("-inf")

        for step in self._dedupe_steps(step_candidates):
            tolerance = max(5.0, step * 0.18)
            step_penalty = 0.0
            if preferred_step is not None and preferred_step > 0.0:
                step_penalty = abs(step - preferred_step) / max(preferred_step, 1.0) * 40.0

            for anchor in peaks:
                for anchor_index in range(count):
                    start = anchor - (anchor_index * step)
                    sequence = [start + (offset * step) for offset in range(count)]
                    support_score = 0.0
                    edge_penalty = 0.0
                    for value in sequence:
                        nearest = min(abs(value - peak) for peak in peaks)
                        if nearest <= tolerance:
                            support_score += 10.0 - ((nearest / tolerance) * 5.0)
                        if value < -step * 0.8 or value > axis_length + step * 0.8:
                            edge_penalty += 2.5
                    score = support_score - edge_penalty - step_penalty
                    if score > best_score:
                        best_score = score
                        best_sequence = sequence

        if best_sequence is None:
            raise RuntimeError("Could not fit a board grid.")
        return best_sequence, best_score

    def _preferred_grid_steps(
        self,
        peaks: Sequence[int],
        count: int,
        axis_length: int,
        preferred_step: float,
    ) -> list[float]:
        min_step = max(12.0, preferred_step * 0.72)
        max_step = min(float(axis_length), preferred_step * 1.28)
        candidates = [preferred_step, preferred_step * 0.96, preferred_step * 1.04]
        for left_index, left in enumerate(peaks):
            for right in peaks[left_index + 1:]:
                span = float(right - left)
                for intervals in range(1, count):
                    step = span / intervals
                    if min_step <= step <= max_step:
                        candidates.append(step)
        return candidates

    def _dedupe_steps(self, steps: Sequence[float]) -> list[float]:
        deduped: list[float] = []
        seen: set[int] = set()
        for step in steps:
            if step <= 0.0 or not math.isfinite(step):
                continue
            key = int(round(step * 4.0))
            if key in seen:
                continue
            seen.add(key)
            deduped.append(float(step))
        return deduped

    def _line_support_score(self, profile: np.ndarray, grid: Sequence[float]) -> float:
        if profile.size == 0:
            return 0.0
        values: list[float] = []
        for value in grid:
            index = int(round(value))
            if index < 0 or index >= profile.size:
                continue
            left = max(0, index - 2)
            right = min(profile.size, index + 3)
            values.append(float(np.max(profile[left:right])))
        if not values:
            return 0.0
        baseline = float(np.percentile(profile, 55)) + 1e-6
        return float(np.mean(values) / baseline)

    def _board_box_from_grid(
        self, image: np.ndarray, grid_x: Sequence[float], grid_y: Sequence[float]
    ) -> tuple[int, int, int, int]:
        step_x = float(np.median(np.diff(grid_x)))
        step_y = float(np.median(np.diff(grid_y)))
        x1 = int(math.floor(min(grid_x) - (step_x * 0.62)))
        x2 = int(math.ceil(max(grid_x) + (step_x * 0.62)))
        y1 = int(math.floor(min(grid_y) - (step_y * 0.58)))
        y2 = int(math.ceil(max(grid_y) + (step_y * 0.66)))
        return (
            max(0, x1),
            max(0, y1),
            min(image.shape[1], x2),
            min(image.shape[0], y2),
        )

    def _correct_vertical_grid_shift(
        self,
        image: np.ndarray,
        grid_x: Sequence[float],
        grid_y: Sequence[float],
    ) -> tuple[list[float], float]:
        if len(grid_y) < 2:
            return list(grid_y), 0.0
        step_y = float(np.median(np.diff(grid_y)))
        step_x = float(np.median(np.diff(grid_x))) if len(grid_x) > 1 else step_y
        step = float((step_x + step_y) / 2.0)
        above_y = grid_y[0] - step_y
        patch_half = int(math.ceil(step * self.PATCH_HALF_STEP))
        if above_y - patch_half < 0:
            return list(grid_y), 0.0

        above_pieces, above_coin = self._probe_piece_row(image, grid_x, above_y, step, min_classifier_score=0.56)
        current_top_pieces, _current_coin = self._probe_piece_row(image, grid_x, grid_y[0], step, min_classifier_score=0.56)
        grid_line_support = self._median_horizontal_line_support(image, grid_x, grid_y, step)
        above_line_support = self._horizontal_line_support(image, grid_x, above_y, step)

        # If a fitted lattice skipped the real top row, the skipped row is exactly
        # one step above row 9 and often contains complete, classifiable pieces.
        # Coordinate labels above a correctly fitted board do not pass the coin
        # test, so this removes the one-row drift without relying on game state.
        skipped_piece_row = above_pieces >= 2 and above_pieces > current_top_pieces
        skipped_supported_line = (
            above_pieces >= 1
            and above_coin >= self.MIN_PRESENCE_SCORE
            and above_line_support >= grid_line_support * 0.45
            and above_pieces > current_top_pieces
        )
        if skipped_piece_row or skipped_supported_line:
            return [value - step_y for value in grid_y], 18.0
        return list(grid_y), 0.0

    def _probe_piece_row(
        self,
        image: np.ndarray,
        grid_x: Sequence[float],
        y: float,
        step: float,
        min_classifier_score: float = 0.0,
    ) -> tuple[int, float]:
        count = 0
        best_score = 0.0
        for x in grid_x:
            patch, radius = self.extract_intersection_patch(image, x, y, step)
            if patch is None:
                continue
            present, coin_score = self.piece_present(patch, radius)
            best_score = max(best_score, coin_score)
            if not present:
                continue
            classified = self.classify_piece(patch, radius)
            if classified is None:
                continue
            glyph_score = float(classified[3][0][1]) if classified[3] else 0.0
            if glyph_score >= min_classifier_score:
                count += 1
        return count, best_score

    def _repair_missing_generals(self, pieces: dict[str, DetectedPiece]) -> dict[str, DetectedPiece]:
        repaired = dict(pieces)
        for side in ("red", "black"):
            if any(piece.side == side and piece.piece_type == "k" for piece in repaired.values()):
                continue

            candidates: list[tuple[float, DetectedPiece]] = []
            for piece in repaired.values():
                if piece.side != side or piece.piece_type == "k":
                    continue
                if not self._coord_in_general_palace(side, piece.col, piece.row):
                    continue
                current_score = self._glyph_score(piece, piece.piece_type)
                general_score = self._glyph_score(piece, "k")
                if general_score < self.MIN_CLASS_SCORE:
                    continue
                if general_score < current_score - 0.18:
                    continue
                home_bonus = 0.05 if self._coord_is_home_general_square(side, piece.col, piece.row) else 0.0
                candidates.append((general_score + home_bonus, piece))

            if not candidates:
                continue
            _score, piece = max(candidates, key=lambda item: item[0])
            general_score = self._glyph_score(piece, "k")
            glyphs = self._promote_glyph(piece.glyphs, "k")
            confidence = min(0.99, max(0.55, 0.42 + (general_score * 0.58)))
            replacement = DetectedPiece(
                side=piece.side,
                piece_type="k",
                col=piece.col,
                row=piece.row,
                center=piece.center,
                radius=piece.radius,
                confidence=confidence,
                glyphs=glyphs,
            )
            repaired[piece.coord] = replacement
        return repaired

    def _repair_impossible_setup_pieces(
        self,
        pieces: dict[str, DetectedPiece],
    ) -> tuple[dict[str, DetectedPiece], list[str]]:
        repaired: dict[str, DetectedPiece] = {}
        warnings: list[str] = []
        for coord, piece in pieces.items():
            if self._setup_piece_type_is_legal(piece.side, piece.piece_type, piece.col, piece.row):
                repaired[coord] = piece
                continue

            replacement = self._best_legal_piece_reclassification(piece)
            if replacement is not None:
                repaired[coord] = replacement
                warnings.append(
                    f"Reclassified impossible {piece.side} {self._piece_type_name(piece.piece_type)} "
                    f"at {coord.upper()} as {self._piece_type_name(replacement.piece_type)}."
                )
                continue

            warnings.append(
                f"Ignored impossible {piece.side} {self._piece_type_name(piece.piece_type)} "
                f"at {coord.upper()}; no legal visual alternative was strong enough."
            )
        return repaired, warnings

    def _best_legal_piece_reclassification(self, piece: DetectedPiece) -> DetectedPiece | None:
        scores = self._piece_type_scores_from_glyphs(piece.glyphs)
        ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
        for piece_type, score in ranked:
            if piece_type == piece.piece_type:
                continue
            if score < self.MIN_CLASS_SCORE:
                continue
            if not self._setup_piece_type_is_legal(piece.side, piece_type, piece.col, piece.row):
                continue
            confidence = min(0.99, max(0.55, 0.42 + (float(score) * 0.58)))
            return DetectedPiece(
                side=piece.side,
                piece_type=piece_type,
                col=piece.col,
                row=piece.row,
                center=piece.center,
                radius=piece.radius,
                confidence=max(piece.confidence, confidence),
                glyphs=[(f"legality-repair:{piece.piece_type}->{piece_type}", float(score))]
                + self._promote_glyph(piece.glyphs, piece_type),
            )
        return None

    def _repair_piece_count_overflows(
        self,
        pieces: dict[str, DetectedPiece],
    ) -> tuple[dict[str, DetectedPiece], list[str]]:
        repaired = dict(pieces)
        warnings: list[str] = []
        counts: Counter[tuple[str, str]] = Counter((piece.side, piece.piece_type) for piece in repaired.values())

        while True:
            overflow = [
                (side, piece_type, count - self.PIECE_LIMITS[piece_type])
                for (side, piece_type), count in sorted(counts.items())
                if piece_type in self.PIECE_LIMITS and count > self.PIECE_LIMITS[piece_type]
            ]
            if not overflow:
                break

            best: tuple[float, str, DetectedPiece, str, float] | None = None
            for side, overflowing_type, _excess in overflow:
                for coord, piece in sorted(repaired.items()):
                    if piece.side != side or piece.piece_type != overflowing_type:
                        continue
                    candidate = self._best_count_reclassification(piece, counts)
                    if candidate is None:
                        continue
                    loss, replacement, target_type, target_score = candidate
                    if best is None or (loss, coord) < (best[0], best[1]):
                        best = (loss, coord, replacement, target_type, target_score)

            if best is None:
                break

            loss, coord, replacement, target_type, target_score = best
            original = repaired[coord]
            repaired[coord] = replacement
            counts[(original.side, original.piece_type)] -= 1
            counts[(replacement.side, replacement.piece_type)] += 1
            warnings.append(
                f"Reclassified over-counted {original.side} {self._piece_type_name(original.piece_type)} "
                f"at {coord.upper()} as {self._piece_type_name(target_type)} "
                f"(score loss {loss:.3f}, alternative {target_score:.3f})."
            )

        return repaired, warnings

    def _best_count_reclassification(
        self,
        piece: DetectedPiece,
        counts: Counter[tuple[str, str]],
    ) -> tuple[float, DetectedPiece, str, float] | None:
        if self._strong_ocr_supports_piece(piece, piece.piece_type):
            return None
        scores = self._piece_type_scores_from_glyphs(piece.glyphs)
        current_score = scores.get(piece.piece_type)
        if current_score is None:
            return None

        best: tuple[float, DetectedPiece, str, float] | None = None
        for piece_type, score in sorted(scores.items(), key=lambda item: item[1], reverse=True):
            if piece_type == piece.piece_type:
                continue
            if score < self.MIN_CLASS_SCORE:
                continue
            if not self._setup_piece_type_is_legal(piece.side, piece_type, piece.col, piece.row):
                continue
            if counts[(piece.side, piece_type)] >= self.PIECE_LIMITS[piece_type]:
                continue
            loss = float(current_score) - float(score)
            if loss < 0.0:
                loss = 0.0
            if loss > self.COUNT_REPAIR_MAX_SCORE_LOSS:
                continue
            confidence = min(0.99, max(0.55, 0.42 + (float(score) * 0.58)))
            replacement = DetectedPiece(
                side=piece.side,
                piece_type=piece_type,
                col=piece.col,
                row=piece.row,
                center=piece.center,
                radius=piece.radius,
                confidence=max(piece.confidence, confidence),
                glyphs=[(f"count-repair:{piece.piece_type}->{piece_type}", float(score))]
                + self._promote_glyph(piece.glyphs, piece_type),
            )
            if best is None or (loss, -float(score)) < (best[0], -best[3]):
                best = (loss, replacement, piece_type, float(score))
        return best

    def _strong_ocr_supports_piece(self, piece: DetectedPiece, piece_type: str) -> bool:
        for label, score in piece.glyphs:
            if not label.startswith("ocr:"):
                continue
            glyph = label.split(":", 1)[1]
            if KNOWN_GLYPHS.get(glyph) == piece_type and float(score) >= self.COUNT_REPAIR_STRONG_OCR_SCORE:
                return True
        return False

    def _setup_piece_type_is_legal(self, side: str, piece_type: str, col: int, row: int) -> bool:
        if piece_type in ("k", "g"):
            return self._coord_in_general_palace(side, col, row)
        if piece_type == "m":
            return row <= 4 if side == "red" else row >= 5
        if piece_type == "p":
            return row >= 3 if side == "red" else row <= 6
        return piece_type in ("r", "n", "c")

    def _piece_type_scores_from_glyphs(self, glyphs: Sequence[tuple[str, float]]) -> dict[str, float]:
        scores: dict[str, float] = {}
        for label, score in glyphs:
            piece_type: str | None = None
            if label.startswith("glyph:"):
                token = label.split(":", 1)[1]
                piece_type = token if token in PIECE_TO_LALG else KNOWN_GLYPHS.get(token)
            elif label.startswith("ocr:"):
                piece_type = KNOWN_GLYPHS.get(label.split(":", 1)[1])
            elif label.startswith("patch:"):
                token = label.split(":", 1)[1]
                piece_type = token if token in PIECE_TO_LALG else None
            elif label.startswith("direct:"):
                token = label.rsplit(":", 1)[-1]
                piece_type = token if token in PIECE_TO_LALG else None
            if piece_type is None:
                continue
            scores[piece_type] = max(scores.get(piece_type, float("-inf")), float(score))
        return scores

    def _piece_type_name(self, piece_type: str) -> str:
        return {
            "k": "general",
            "r": "rook",
            "n": "horse",
            "c": "cannon",
            "g": "advisor",
            "m": "elephant",
            "p": "pawn",
        }.get(piece_type, piece_type)

    def _glyph_score(self, piece: DetectedPiece, piece_type: str) -> float:
        target = f"glyph:{piece_type}"
        best = float("-inf")
        for label, score in piece.glyphs:
            if label == target:
                best = max(best, float(score))
            if label.startswith("ocr:"):
                glyph = label.split(":", 1)[1]
                normalized_piece_type = KNOWN_GLYPHS.get(glyph)
                if normalized_piece_type == piece_type:
                    best = max(best, float(score))
        return best

    def _promote_glyph(self, glyphs: Sequence[tuple[str, float]], piece_type: str) -> list[tuple[str, float]]:
        target = f"glyph:{piece_type}"
        promoted = [
            (label, score)
            for label, score in glyphs
            if label == target or (label.startswith("ocr:") and KNOWN_GLYPHS.get(label.split(":", 1)[1]) == piece_type)
        ]
        promoted.extend((label, score) for label, score in glyphs if (label, score) not in promoted)
        return promoted

    def _coord_in_general_palace(self, side: str, col: int, row: int) -> bool:
        if col not in (3, 4, 5):
            return False
        return row in ((0, 1, 2) if side == "red" else (7, 8, 9))

    def _coord_is_home_general_square(self, side: str, col: int, row: int) -> bool:
        return col == 4 and row == (0 if side == "red" else 9)

    def _orient_pieces(self, pieces: dict[str, DetectedPiece]) -> dict[str, DetectedPiece]:
        flipped = self._flip_orientation(pieces)
        raw_score = self._orientation_score(pieces)
        flipped_score = self._orientation_score(flipped)
        if flipped_score > raw_score + 3.0:
            return flipped
        return pieces

    def _orientation_score(self, pieces: dict[str, DetectedPiece]) -> float:
        score = 0.0
        for piece in pieces.values():
            if piece.piece_type == "k":
                score += 12.0 if self._coord_in_general_palace(piece.side, piece.col, piece.row) else -12.0
                if self._coord_is_home_general_square(piece.side, piece.col, piece.row):
                    score += 2.0
            elif piece.piece_type == "g":
                score += 4.0 if self._coord_in_general_palace(piece.side, piece.col, piece.row) else -4.0
            elif piece.piece_type == "m":
                home_side = piece.row <= 4 if piece.side == "red" else piece.row >= 5
                score += 2.0 if home_side else -2.0
            elif piece.piece_type == "p":
                reachable_rank = piece.row >= 3 if piece.side == "red" else piece.row <= 6
                score += 1.0 if reachable_rank else -1.0
        return score

    def _median_horizontal_line_support(
        self,
        image: np.ndarray,
        grid_x: Sequence[float],
        grid_y: Sequence[float],
        step: float,
    ) -> float:
        supports = [self._horizontal_line_support(image, grid_x, y, step) for y in grid_y]
        supports = [value for value in supports if value > 0.0]
        if not supports:
            return 1.0
        return float(np.median(supports))

    def _horizontal_line_support(
        self,
        image: np.ndarray,
        grid_x: Sequence[float],
        y: float,
        step: float,
    ) -> float:
        y_int = int(round(y))
        x1 = int(round(min(grid_x) - (step * 0.25)))
        x2 = int(round(max(grid_x) + (step * 0.25)))
        pad_y = max(3, int(round(step * 0.05)))
        x1 = max(0, x1)
        x2 = min(image.shape[1], x2)
        y1 = max(0, y_int - pad_y)
        y2 = min(image.shape[0], y_int + pad_y + 1)
        if x2 <= x1 or y2 <= y1:
            return 0.0
        patch = image[y1:y2, x1:x2]
        gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)
        grad_y = np.abs(cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3))
        return float(np.percentile(grad_y, 88))

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

    def center_artwork_patch(
        self,
        patch: np.ndarray,
        radius: float,
        side: str | None = None,
    ) -> tuple[np.ndarray, tuple[float, float]]:
        """Return a patch translated so the printed inner artwork ring is centered."""
        if patch is None or patch.size == 0:
            return patch, (0.0, 0.0)
        side = side or self._estimate_piece_side(patch)
        local_x, local_y = self._detect_artwork_ring_center(patch, side, radius)
        h, w = patch.shape[:2]
        offset_x = local_x - (w / 2.0)
        offset_y = local_y - (h / 2.0)
        if abs(offset_x) < 0.05 and abs(offset_y) < 0.05:
            return patch.copy(), (0.0, 0.0)
        matrix = np.array(
            [[1.0, 0.0, -offset_x], [0.0, 1.0, -offset_y]],
            dtype=np.float32,
        )
        centered = cv2.warpAffine(
            patch,
            matrix,
            (w, h),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REPLICATE,
        )
        return centered, (float(offset_x), float(offset_y))

    def _detect_artwork_ring_center(self, patch: np.ndarray, side: str, radius: float) -> tuple[float, float]:
        h, w = patch.shape[:2]
        default_x = w / 2.0
        default_y = h / 2.0
        signal = self._piece_artwork_signal(patch, side)
        grad_x = cv2.Sobel(signal, cv2.CV_32F, 1, 0, ksize=3)
        grad_y = cv2.Sobel(signal, cv2.CV_32F, 0, 1, ksize=3)
        magnitude = np.sqrt((grad_x * grad_x) + (grad_y * grad_y))
        yy, xx = np.indices((h, w))
        distance_from_grid = np.sqrt(((xx - default_x) ** 2) + ((yy - default_y) ** 2))
        ring_radius = float(radius * 0.79)
        signal_8 = (signal * 255).astype(np.uint8)
        edges = cv2.Canny(signal_8, 35, 100) > 0
        band = (distance_from_grid >= ring_radius - 15.0) & (distance_from_grid <= ring_radius + 15.0)
        if not np.any(band):
            return default_x, default_y
        edge_floor = float(np.percentile(magnitude[band], 70))
        edge_pixels = edges & band & (magnitude > edge_floor)

        max_offset = max(6, int(round(radius * 0.40)))
        accumulator = np.zeros((max_offset * 2 + 1, max_offset * 2 + 1), dtype=np.float32)
        ys, xs = np.where(edge_pixels)
        for x, y in zip(xs, ys):
            edge_strength = float(magnitude[y, x])
            if edge_strength <= 1e-6:
                continue
            unit_x = float(grad_x[y, x] / edge_strength)
            unit_y = float(grad_y[y, x] / edge_strength)
            for sign in (-1.0, 1.0):
                center_x = x + (sign * ring_radius * unit_x)
                center_y = y + (sign * ring_radius * unit_y)
                offset_x = int(round(center_x - default_x))
                offset_y = int(round(center_y - default_y))
                if -max_offset <= offset_x <= max_offset and -max_offset <= offset_y <= max_offset:
                    accumulator[offset_y + max_offset, offset_x + max_offset] += edge_strength

        if float(accumulator.max()) <= 0.0:
            return default_x, default_y

        accumulator = cv2.GaussianBlur(accumulator, (5, 5), 0)
        _min_value, _max_value, _min_loc, max_loc = cv2.minMaxLoc(accumulator)
        x1 = max(0, max_loc[0] - 2)
        x2 = min(accumulator.shape[1], max_loc[0] + 3)
        y1 = max(0, max_loc[1] - 2)
        y2 = min(accumulator.shape[0], max_loc[1] + 3)
        roi = accumulator[y1:y2, x1:x2]
        if float(roi.sum()) <= 0.0:
            return default_x + (max_loc[0] - max_offset), default_y + (max_loc[1] - max_offset)
        roi_y, roi_x = np.indices(roi.shape)
        refined_x = float((roi * (roi_x + x1 - max_offset)).sum() / roi.sum())
        refined_y = float((roi * (roi_y + y1 - max_offset)).sum() / roi.sum())
        return default_x + refined_x, default_y + refined_y

    def _piece_artwork_signal(self, patch: np.ndarray, side: str) -> np.ndarray:
        h, w = patch.shape[:2]
        b, g, r = cv2.split(patch.astype(np.float32))
        if side == "red":
            hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
            hue = hsv[:, :, 0]
            saturation = hsv[:, :, 1].astype(np.float32)
            red_dominance = np.maximum(r - np.maximum(g, b), 0.0)
            red_hue = ((hue <= 22) | (hue >= 166)).astype(np.float32)
            signal = (red_dominance * red_hue) + (0.12 * saturation * red_hue)
        else:
            gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY).astype(np.float32)
            blurred_gray = cv2.GaussianBlur(gray, (0, 0), max(1.0, min(h, w) * 0.045))
            lab = cv2.cvtColor(patch, cv2.COLOR_BGR2LAB).astype(np.float32)
            l_channel = lab[:, :, 0]
            local_mean = cv2.GaussianBlur(l_channel, (0, 0), max(1.0, min(h, w) * 0.04))
            signal = np.maximum(blurred_gray - gray, local_mean - l_channel)

        yy, xx = np.indices((h, w))
        cx = w / 2.0
        cy = h / 2.0
        distance = np.sqrt(((xx - cx) ** 2) + ((yy - cy) ** 2))
        signal[distance > min(h, w) * 0.49] = 0.0
        signal = cv2.GaussianBlur(signal, (3, 3), 0)
        values = signal[signal > 0]
        if values.size:
            low = float(np.percentile(values, 20))
            high = float(np.percentile(values, 98))
            signal = np.clip((signal - low) / (high - low + 1e-6), 0.0, 1.0)
        return signal.astype(np.float32)

    def _rank_piece_candidates(
        self, patch: np.ndarray, radius: float
    ) -> list[tuple[str, str, float, list[tuple[str, float]]]]:
        side = self._estimate_piece_side(patch)
        ranked = self._rank_side_candidates(patch, side, radius)
        if ranked and ranked[0][2] >= self.MIN_CLASS_SCORE:
            return ranked
        other_side = "black" if side == "red" else "red"
        fallback = self._rank_side_candidates(patch, other_side, radius)
        candidates = ranked + fallback
        candidates.sort(key=lambda item: item[2], reverse=True)
        return candidates

    def _rank_side_candidates(
        self, patch: np.ndarray, side: str, radius: float | None = None
    ) -> list[tuple[str, str, float, list[tuple[str, float]]]]:
        side_templates = self.templates_by_side.get(side, [])
        if not side_templates:
            return []
        if radius is not None:
            patch, _offset = self.center_artwork_patch(patch, radius, side)
        best: tuple[str, str, float, list[tuple[str, float]]] | None = None
        for mask_scale in self.MASK_SCALES:
            mask = self._extract_glyph_mask(patch, side=side, mask_scale=mask_scale)
            if mask is None:
                continue
            normalized = self._normalize_mask(mask)
            if normalized is None:
                continue
            feature = self._compute_hog_feature(normalized)
            scores_by_type: dict[str, float] = {}
            for template in side_templates:
                score = self._template_match_score(normalized, feature, template)
                if score > scores_by_type.get(template.piece_type, float("-inf")):
                    scores_by_type[template.piece_type] = score
            ranked_types = sorted(scores_by_type.items(), key=lambda item: item[1], reverse=True)
            if not ranked_types:
                continue
            piece_type, score = ranked_types[0]
            candidate = (side, piece_type, score, ranked_types[:5])
            if best is None or score > best[2]:
                best = candidate
        return [best] if best is not None else []

    def _template_match_score(
        self,
        normalized_mask: np.ndarray,
        feature: np.ndarray,
        template: FixedThemeTemplate,
    ) -> float:
        hog_score = float(template.feature @ feature)
        shape_score = self._binary_mask_similarity(normalized_mask, template.mask)
        return (0.64 * hog_score) + (0.36 * shape_score)

    def _binary_mask_similarity(self, query: np.ndarray, template: np.ndarray) -> float:
        query_pixels = query > 0
        template_pixels = template > 0
        query_count = int(np.count_nonzero(query_pixels))
        template_count = int(np.count_nonzero(template_pixels))
        if query_count == 0 or template_count == 0:
            return 0.0
        intersection = int(np.logical_and(query_pixels, template_pixels).sum())
        if intersection == 0:
            return 0.0
        union = int(np.logical_or(query_pixels, template_pixels).sum())
        iou = intersection / max(union, 1)
        template_coverage = intersection / template_count
        query_coverage = intersection / query_count
        return (0.45 * iou) + (0.35 * template_coverage) + (0.20 * query_coverage)

    def _remove_palette_badge(self, patch: np.ndarray) -> np.ndarray:
        if patch is None or patch.size == 0:
            return patch
        h, w = patch.shape[:2]
        x1 = int(round(w * 0.54))
        x2 = w
        y1 = 0
        y2 = int(round(h * 0.42))
        if x1 >= x2 or y1 >= y2:
            return patch

        roi = patch[y1:y2, x1:x2]
        hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
        hue = hsv[:, :, 0]
        saturation = hsv[:, :, 1]
        value = hsv[:, :, 2]
        red_or_orange = ((hue <= 22) | (hue >= 168)) & (saturation >= 55) & (value >= 110)
        if np.count_nonzero(red_or_orange) < 8:
            return patch

        mask = np.zeros((h, w), dtype=np.uint8)
        mask[y1:y2, x1:x2] = red_or_orange.astype(np.uint8) * 255
        kernel = np.ones((5, 5), np.uint8)
        mask = cv2.dilate(mask, kernel, iterations=2)
        return cv2.inpaint(patch, mask, 3, cv2.INPAINT_TELEA)

    def _estimate_piece_side(self, patch: np.ndarray) -> str:
        h, w = patch.shape[:2]
        cx = w / 2.0
        cy = h / 2.0
        yy, xx = np.indices((h, w))
        face_radius = min(h, w) * self.CATALOG_MASK_SCALE
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

    def _compute_hog_feature(self, normalized_mask: np.ndarray) -> np.ndarray:
        feature = self.hog.compute(normalized_mask).reshape(-1).astype(np.float32)
        norm = float(np.linalg.norm(feature))
        if norm > 0:
            feature /= norm
        return feature

    def _catalog_patch_radius(self, patch: np.ndarray) -> float:
        return float(min(patch.shape[:2]) / (2.0 * 1.35))

    def _normalized_template_mask_from_patch(
        self,
        patch: np.ndarray,
        side: str,
        mask_scale: float | None = None,
    ) -> np.ndarray | None:
        radius = self._catalog_patch_radius(patch)
        centered, _offset = self.center_artwork_patch(patch, radius, side)
        mask = self._extract_glyph_mask(centered, side, mask_scale or self.CATALOG_MASK_SCALE)
        if mask is None:
            return None
        return self._normalize_mask(mask)

    def _load_templates(self, catalog_dir: Path) -> dict[str, list[FixedThemeTemplate]]:
        catalog_path = catalog_dir / "catalog.json"
        if not catalog_path.exists():
            return {"red": [], "black": []}
        data = json.loads(catalog_path.read_text(encoding="utf-8"))
        templates_by_side: dict[str, list[FixedThemeTemplate]] = {"red": [], "black": []}
        for entry in data.get("templates", []):
            side = entry.get("side")
            piece_type = entry.get("piece_type")
            if side not in ("red", "black") or piece_type not in PIECE_TO_LALG:
                continue
            normalized: np.ndarray | None = None
            patch = cv2.imread(str(catalog_dir / entry.get("patch_file", "")))
            if patch is not None:
                normalized = self._normalized_template_mask_from_patch(patch, side)
            if normalized is None:
                mask = cv2.imread(str(catalog_dir / entry.get("mask_file", "")), cv2.IMREAD_GRAYSCALE)
                if mask is None:
                    continue
                normalized = self._normalize_mask(mask)
            if normalized is None:
                continue
            templates_by_side[side].append(
                FixedThemeTemplate(
                    side=side,
                    piece_type=piece_type,
                    source_coord=entry.get("coord", ""),
                    mask=normalized,
                    feature=self._compute_hog_feature(normalized),
                )
            )
        return templates_by_side

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
