"""Prove checking and exclusive escape control for two pieces of one role."""

from .engine import EngineProtocolError, IncompleteSearchError
from .models import SearchContext
from .patterns import (
    DOUBLE_CHARIOTS_LOGIC_VERSION,
    TerminalPosition,
    double_chariots_candidate,
    double_chariots_escape_positions,
)
from .position import decode_position
from .attack_evidence import checked_attackers


def evidence_outcome(
    terminal: TerminalPosition,
    record: object,
    *,
    role="R",
    version=DOUBLE_CHARIOTS_LOGIC_VERSION,
) -> str | None:
    """Require complete, versioned attack evidence bound to this terminal board."""
    if (
        not isinstance(record, dict)
        or record.get("logic_version") != version
        or record.get("terminal_fen") != terminal.fen
    ):
        return None
    checking = checked_attackers(record.get("terminal"), terminal.fen)
    expected = dict(double_chariots_escape_positions(terminal, role))
    inspections = record.get("escapes")
    if (
        checking is None
        or not isinstance(inspections, list)
        or len(inspections) != len(expected)
    ):
        return None
    chariot = role if terminal.winning_side == "red" else role.lower()
    chariots = {s for s, p in decode_position(terminal.fen).items() if p == chariot}
    checking_chariots = checking & chariots
    seen = set()
    key = False
    for item in inspections:
        if not isinstance(item, dict):
            return None
        move = item.get("move")
        if not isinstance(move, str) or move not in expected or move in seen:
            return None
        seen.add(move)
        attackers = checked_attackers(item, expected[move])
        if attackers is None:
            return None
        if (
            len(attackers) == 1
            and attackers <= chariots
            and checking_chariots - attackers
        ):
            key = True
    return "key" if double_chariots_candidate(terminal, role) and key else "not_key"


def assess(
    engine,
    terminal: TerminalPosition,
    *,
    role="R",
    version=DOUBLE_CHARIOTS_LOGIC_VERSION,
) -> dict:
    record = {
        "logic_version": version,
        "terminal_fen": terminal.fen,
        "escapes": [],
        "outcome": "inconclusive",
    }
    try:
        inspected, checkers = engine.checking_pieces(SearchContext(terminal.fen, ()))
        record["terminal"] = {"fen": inspected, "checkers": list(checkers)}
        for move, fen in double_chariots_escape_positions(terminal, role):
            inspected, checkers = engine.checking_pieces(SearchContext(fen, ()))
            record["escapes"].append(
                {"move": move, "fen": inspected, "checkers": list(checkers)}
            )
        record["outcome"] = (
            evidence_outcome(terminal, record, role=role, version=version)
            or "inconclusive"
        )
    except (EngineProtocolError, IncompleteSearchError, OSError, TimeoutError) as exc:
        record["reason"] = f"inspection_failed:{type(exc).__name__}"
    return record
