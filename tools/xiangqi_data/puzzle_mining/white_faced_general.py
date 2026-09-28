"""Terminal flying-general counterfactual, using Pikafish's attack oracle."""

from .engine import EngineProtocolError, IncompleteSearchError
from .models import SearchContext
from .patterns import (
    WHITE_FACED_GENERAL_LOGIC_VERSION,
    TerminalPosition,
    white_faced_general_escape_positions,
)
from .position import decode_position, normalized_fen


def evidence_outcome(terminal: TerminalPosition, record: object) -> str | None:
    """Validate persisted inspection coverage before reusing its conclusion."""
    if (
        not isinstance(record, dict)
        or record.get("logic_version") != WHITE_FACED_GENERAL_LOGIC_VERSION
        or record.get("terminal_fen") != terminal.fen
    ):
        return None
    inspections = record.get("escapes")
    expected = dict(white_faced_general_escape_positions(terminal))
    if not isinstance(inspections, list) or len(inspections) != len(expected):
        return None
    position = decode_position(terminal.fen)
    general = "K" if terminal.winning_side == "red" else "k"
    winner = next((s for s, p in position.items() if p == general), None)
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
            or not all(isinstance(s, str) and s in position for s in checkers)
        ):
            return None
        seen.add(move)
        key |= checkers == [winner]
    return "key" if key else "not_key"


def assess(engine, terminal: TerminalPosition) -> dict:
    record = {
        "logic_version": WHITE_FACED_GENERAL_LOGIC_VERSION,
        "terminal_fen": terminal.fen,
        "escapes": [],
        "outcome": "inconclusive",
    }
    try:
        for move, fen in white_faced_general_escape_positions(terminal):
            inspected, checkers = engine.checking_pieces(SearchContext(fen, ()))
            record["escapes"].append(
                {"move": move, "fen": inspected, "checkers": list(checkers)}
            )
        record["outcome"] = evidence_outcome(terminal, record) or "inconclusive"
    except (EngineProtocolError, IncompleteSearchError, OSError, TimeoutError) as exc:
        record["reason"] = f"inspection_failed:{type(exc).__name__}"
    return record
