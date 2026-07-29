"""Independent terminal-position matchers for Xiangqi mating methods."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from .models import BLACK, RED, opposite
from .position import decode_position


CENTROID_PAWN_THEME = "centroidPawnMate"
MATE_IN_THEMES = {1: "mateIn1", 2: "mateIn2", 3: "mateIn3", 4: "mateIn4"}
MATE_IN_FIVE_OR_MORE_THEME = "mateIn5"


@dataclass(frozen=True)
class TerminalPosition:
    fen: str
    checkmate: bool
    losing_side: str

    @property
    def winning_side(self) -> str:
        return opposite(self.losing_side)


def is_centroid_pawn_mate(terminal: TerminalPosition) -> bool:
    """Match the deliberately geometric Lixiangqi centroid-pawn definition."""

    if not terminal.checkmate:
        return False
    position = decode_position(terminal.fen)
    if terminal.losing_side == BLACK:
        return position.get("e10") == "k" and position.get("e9") == "P"
    if terminal.losing_side == RED:
        return position.get("e1") == "K" and position.get("e2") == "p"
    raise ValueError(f"unknown losing side: {terminal.losing_side}")


PatternMatcher = tuple[str, Callable[[TerminalPosition], bool]]
CHECKMATE_MATCHERS: tuple[PatternMatcher, ...] = (
    (CENTROID_PAWN_THEME, is_centroid_pawn_mate),
)


def matching_themes(terminal: TerminalPosition) -> set[str]:
    return {theme for theme, matcher in CHECKMATE_MATCHERS if matcher(terminal)}


def mate_themes(solution_plies: int) -> set[str]:
    """Classify a verified solution as mate in 1, 2, 3, 4, or 5+ moves."""

    if solution_plies < 1:
        raise ValueError("a mating solution must contain an attacker move")
    mate_in = (solution_plies + 1) // 2
    return {"mate", MATE_IN_THEMES.get(mate_in, MATE_IN_FIVE_OR_MORE_THEME)}
