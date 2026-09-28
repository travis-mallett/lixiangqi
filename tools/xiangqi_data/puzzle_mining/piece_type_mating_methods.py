"""Verify the shared rules for mating-methods-by-piece-type themes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .attack_evidence import checked_attackers
from .engine import EngineProtocolError, IncompleteSearchError
from .models import SearchContext, VerifiedTrace, fen_side
from .patterns import (
    PIECE_TYPE_MATING_METHOD_LOGIC_VERSIONS,
    PIECE_TYPE_MATING_METHOD_THEMES,
)
from .position import FenState, UI_MOVE, decode_position, normalized_fen


@dataclass(frozen=True)
class PieceTypeMatingMethods:
    """The allowed winning piece types for one mating-methods theme.

    The same rule applies to every category:

    * whenever the losing side is to move, every checker must be a winning
      piece from this category;
    * when the winning side is not in check, its selected move must be from
      this category, and every named type must make at least one such move;
    * when the winning side is in check, its evasion may use any piece.

    Multiple checkers are accepted when all of them belong to the category.
    """

    theme: str
    version: str
    allowed_types: frozenset[str]

    def _solution_positions(
        self, trace: VerifiedTrace
    ) -> tuple[tuple[int, str, str, str | None], ...] | None:
        """Replay the verified moves and return every board to inspect."""

        if not trace.checkmate or not trace.moves:
            return None
        if len(trace.decisions) != len(trace.moves):
            return None

        positions: list[tuple[int, str, str, str | None]] = []
        for ply, (move, decision) in enumerate(zip(trace.moves, trace.decisions), 1):
            if not decision.position_fen or decision.selected_move != move:
                return None
            if UI_MOVE.fullmatch(move) is None:
                return None
            try:
                state = FenState(decision.position_fen)
                state.push(move)
                after = state.fen()
            except (IndexError, ValueError):
                return None
            positions.append((ply, "before", decision.position_fen, move))

        if not positions or normalized_fen(after) != normalized_fen(trace.terminal.fen):
            return None
        positions.append((len(trace.moves), "terminal", trace.terminal.fen, None))
        return tuple(positions)

    def candidate(self, trace: VerifiedTrace) -> bool | None:
        """Return whether the trace has enough structure for this category."""

        if not trace.checkmate:
            return False
        positions = self._solution_positions(trace)
        return None if positions is None else True

    def _winning_piece_types(self, trace: VerifiedTrace) -> frozenset[str]:
        winning = "black" if fen_side(trace.terminal.fen) == "red" else "red"
        return frozenset(
            piece.lower() if winning == "black" else piece
            for piece in self.allowed_types
        )

    def evidence_outcome(self, trace: VerifiedTrace, record: object) -> str | None:
        """Validate every persisted checker inspection and move restriction."""

        if (
            not isinstance(record, dict)
            or record.get("logic_version") != self.version
            or record.get("terminal_fen") != trace.terminal.fen
            or record.get("moves") != list(trace.moves)
        ):
            return None
        sequence = self.candidate(trace)
        if sequence is not True:
            return "not_key" if sequence is False else None
        expected = self._solution_positions(trace)
        inspections = record.get("positions")
        if (
            expected is None
            or not isinstance(inspections, list)
            or len(inspections) != len(expected)
        ):
            return None

        losing = fen_side(trace.terminal.fen)
        winning_types = self._winning_piece_types(trace)
        moved_types: set[str] = set()
        for item, (ply, phase, fen, move) in zip(inspections, expected):
            if (
                not isinstance(item, dict)
                or item.get("ply") != ply
                or item.get("phase") != phase
                or item.get("move") != move
            ):
                return None
            inspected = item.get("fen")
            if not isinstance(inspected, str) or normalized_fen(
                inspected
            ) != normalized_fen(fen):
                return None
            checkers = checked_attackers(item, fen)
            if checkers is None:
                return None
            position = decode_position(fen)
            losing_turn = fen_side(fen) == losing
            if (losing_turn or phase == "terminal") and any(
                position[square] not in winning_types for square in checkers
            ):
                return "not_key"
            if phase == "before" and fen_side(fen) != losing and not checkers:
                parsed = UI_MOVE.fullmatch(move or "")
                if (
                    parsed is None
                    or position.get(parsed[1] + parsed[2]) not in winning_types
                ):
                    return "not_key"
                moved_types.add(position[parsed[1] + parsed[2]])
            if phase == "terminal" and not checkers:
                return "not_key"
        return "key" if moved_types == winning_types else "not_key"

    def assess(self, engine, trace: VerifiedTrace) -> dict[str, Any]:
        """Inspect every solution turn and the terminal checking position."""

        record: dict[str, Any] = {
            "logic_version": self.version,
            "terminal_fen": trace.terminal.fen,
            "moves": list(trace.moves),
            "positions": [],
            "outcome": "inconclusive",
        }
        sequence = self.candidate(trace)
        if sequence is not True:
            record["outcome"] = "not_key" if sequence is False else "inconclusive"
            return record
        positions = self._solution_positions(trace)
        assert positions is not None
        try:
            for ply, phase, fen, move in positions:
                inspected, checkers = engine.checking_pieces(SearchContext(fen, ()))
                record["positions"].append(
                    {
                        "ply": ply,
                        "phase": phase,
                        "move": move,
                        "fen": inspected,
                        "checkers": list(checkers),
                    }
                )
            record["outcome"] = self.evidence_outcome(trace, record) or "inconclusive"
        except (
            EngineProtocolError,
            IncompleteSearchError,
            OSError,
            TimeoutError,
        ) as exc:
            record["reason"] = f"inspection_failed:{type(exc).__name__}"
        return record


_ALLOWED_TYPES = (
    frozenset(("R",)),
    frozenset(("N",)),
    frozenset(("C",)),
    frozenset(("P",)),
    frozenset(("R", "N")),
    frozenset(("R", "C")),
    frozenset(("R", "P")),
    frozenset(("N", "C")),
    frozenset(("N", "P")),
    frozenset(("C", "P")),
    frozenset(("R", "N", "C")),
    frozenset(("R", "N", "P")),
    frozenset(("R", "C", "P")),
    frozenset(("N", "C", "P")),
    frozenset(("R", "N", "C", "P")),
)

ASSESSORS = tuple(
    PieceTypeMatingMethods(
        theme,
        PIECE_TYPE_MATING_METHOD_LOGIC_VERSIONS[theme],
        allowed_types,
    )
    for theme, allowed_types in zip(PIECE_TYPE_MATING_METHOD_THEMES, _ALLOWED_TYPES)
)
BY_THEME = {assessor.theme: assessor for assessor in ASSESSORS}
THEMES = frozenset(BY_THEME)
