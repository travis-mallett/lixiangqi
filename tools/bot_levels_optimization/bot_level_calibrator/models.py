from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .constants import FILE_LETTERS, PIECE_TO_LALG
from .runtime import np

@dataclass(frozen=True)
class WindowInfo:
    hwnd: int
    title: str
    bbox: tuple[int, int, int, int]


@dataclass
class DetectedPiece:
    side: str
    piece_type: str
    col: int
    row: int
    center: tuple[float, float]
    radius: float
    confidence: float
    glyphs: list[tuple[str, float]] = field(default_factory=list)

    @property
    def coord(self) -> str:
        return f"{FILE_LETTERS[self.col]}{self.row}"

    @property
    def setup_code(self) -> str:
        symbol = PIECE_TO_LALG[self.piece_type]
        return symbol if self.side == "red" else symbol.lower()

    @property
    def lalg_symbol(self) -> str:
        return PIECE_TO_LALG[self.piece_type]

    @property
    def debug_label(self) -> str:
        return f"{self.side[0].upper()}{self.piece_type.upper()}@{self.coord}"


@dataclass
class BoardState:
    pieces: dict[str, DetectedPiece]
    board_bbox: tuple[int, int, int, int]
    grid_x: list[float]
    grid_y: list[float]
    overlay_image: np.ndarray
    setup_entries: list[str]
    warnings: list[str]
    source_image: np.ndarray | None = None


@dataclass
class MoveRecord:
    side: str
    piece_type: str
    src: str
    dst: str
    capture: bool

    @property
    def notation(self) -> str:
        sep = "x" if self.capture else "-"
        return f"{PIECE_TO_LALG[self.piece_type]}{self.src}{sep}{self.dst}"


@dataclass
class NotationGame:
    file_path: Path
    title: str
    setup_pieces: dict[str, tuple[str, str]]
    first_side: str
    moves: list[MoveRecord]


@dataclass
class PieceToken:
    side: str
    piece_type: str
    center: tuple[float, float]
    radius: float
    confidence: float
    on_board: bool


@dataclass
class OcrTextMatch:
    text: str
    score: float
    bbox: tuple[int, int, int, int]

    @property
    def center(self) -> tuple[float, float]:
        x1, y1, x2, y2 = self.bbox
        return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)


@dataclass
class ActionIcon:
    kind: str
    center: tuple[float, float]
    bbox: tuple[int, int, int, int]
    active: bool
    confidence: float


class MoveDetectionError(RuntimeError):
    """Raised when a new board image cannot be reduced to a single move."""


class NoBoardChangeError(MoveDetectionError):
    """Raised when the new board image matches the previous board state."""


class TtxqAutomationError(RuntimeError):
    """Raised when the uploader cannot drive the Tiantian Xiangqi UI as expected."""


@dataclass(frozen=True)
class FixedThemeTemplate:
    side: str
    piece_type: str
    source_coord: str
    mask: np.ndarray
    feature: np.ndarray
