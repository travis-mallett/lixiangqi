"""Require unscreened center-file cannon alignment without a cannon check."""

from .attack_evidence import checked_attackers
from .engine import EngineProtocolError, IncompleteSearchError
from .models import RED, SearchContext
from .patterns import (
    HEADHUNTER_CANNON_THEME as THEME,
    HEADHUNTER_CANNON_LOGIC_VERSION as VERSION,
    TerminalPosition,
    headhunter_cannon,
)
from .position import decode_position


def candidate(terminal: TerminalPosition) -> bool:
    return headhunter_cannon(terminal)


def evidence_outcome(terminal: TerminalPosition, record: object) -> str | None:
    if (
        not isinstance(record, dict)
        or record.get("logic_version") != VERSION
        or record.get("terminal_fen") != terminal.fen
    ):
        return None
    if not candidate(terminal):
        return "not_key"
    if terminal.stalemate:
        return "key"
    checking = checked_attackers(record.get("terminal"), terminal.fen)
    if checking is None:
        return None
    board = decode_position(terminal.fen)
    if any(board[s].isupper() != (terminal.winning_side == RED) for s in checking):
        return None
    if not checking:
        return None
    return "not_key" if any(board[s].lower() == "c" for s in checking) else "key"


def assess(engine, terminal: TerminalPosition) -> dict:
    record = {
        "logic_version": VERSION,
        "terminal_fen": terminal.fen,
        "outcome": "inconclusive",
    }
    if not candidate(terminal):
        record["outcome"] = "not_key"
        return record
    if terminal.stalemate:
        record["outcome"] = "key"
        return record
    try:
        fen, checkers = engine.checking_pieces(SearchContext(terminal.fen, ()))
        record["terminal"] = {"fen": fen, "checkers": list(checkers)}
        record["outcome"] = evidence_outcome(terminal, record) or "inconclusive"
    except (EngineProtocolError, IncompleteSearchError, OSError, TimeoutError) as exc:
        record["reason"] = f"inspection_failed:{type(exc).__name__}"
    return record
