"""Centroid pawn escape restrictions, using Pikafish's attack inspection."""

from .engine import EngineProtocolError, IncompleteSearchError
from .models import SearchContext
from .patterns import (
    CENTROID_PAWN_LOGIC_VERSION,
    TerminalPosition,
    centroid_pawn_escape_positions,
)
from .position import decode_position, normalized_fen


def evidence_outcome(terminal: TerminalPosition, record: object) -> str | None:
    """Require complete current inspections of the actual hypothetical boards."""
    if (
        not isinstance(record, dict)
        or record.get("logic_version") != CENTROID_PAWN_LOGIC_VERSION
        or record.get("terminal_fen") != terminal.fen
    ):
        return None
    expected = dict(centroid_pawn_escape_positions(terminal))
    inspections = record.get("escapes")
    if not isinstance(inspections, list) or len(inspections) != len(expected):
        return None
    pawn = "e9" if terminal.losing_side == "black" else "e2"
    seen = set()
    key = False
    for item in inspections:
        if not isinstance(item, dict):
            return None
        move, fen, checkers = item.get("move"), item.get("fen"), item.get("checkers")
        if (
            not isinstance(move, str)
            or move in seen
            or move not in expected
            or not isinstance(fen, str)
            or len(fen.split()) < 2
            or normalized_fen(fen) != normalized_fen(expected[move])
            or not isinstance(checkers, list)
        ):
            return None
        board = decode_position(expected[move])
        if any(
            not isinstance(s, str)
            or s not in board
            or board[s].isupper() != (terminal.winning_side == "red")
            for s in checkers
        ) or len(set(checkers)) != len(checkers):
            return None
        seen.add(move)
        key |= checkers == [pawn]
    return "key" if key else "not_key"


def assess(engine, terminal: TerminalPosition) -> dict:
    record = {
        "logic_version": CENTROID_PAWN_LOGIC_VERSION,
        "terminal_fen": terminal.fen,
        "escapes": [],
        "outcome": "inconclusive",
    }
    try:
        for move, fen in centroid_pawn_escape_positions(terminal):
            inspected, checkers = engine.checking_pieces(SearchContext(fen, ()))
            record["escapes"].append(
                {"move": move, "fen": inspected, "checkers": list(checkers)}
            )
        record["outcome"] = evidence_outcome(terminal, record) or "inconclusive"
    except (EngineProtocolError, IncompleteSearchError, OSError, TimeoutError) as exc:
        record["reason"] = f"inspection_failed:{type(exc).__name__}"
    return record
