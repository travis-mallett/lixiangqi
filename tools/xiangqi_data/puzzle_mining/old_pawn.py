"""Prove a sideways final pawn move on the enemy back rank gives checkmate."""

from .attack_evidence import checked_attackers
from .engine import EngineProtocolError, IncompleteSearchError
from .models import SearchContext, VerifiedTrace, fen_side
from .final_move_mates import final_moving_piece
from .patterns import (
    OLD_PAWN_THEME as THEME,
    OLD_PAWN_LOGIC_VERSION as VERSION,
    TerminalPosition,
    old_pawn_squares,
)
from .position import UI_MOVE, decode_position


def candidate(trace: VerifiedTrace) -> bool | None:
    if not trace.checkmate:
        return False
    terminal = TerminalPosition(trace.terminal.fen, True, fen_side(trace.terminal.fen))
    pawns = old_pawn_squares(terminal)
    if not pawns:
        return False
    parsed = UI_MOVE.fullmatch(trace.moves[-1]) if trace.moves else None
    if parsed is None:
        return None
    target = parsed[3] + parsed[4]
    if (
        target not in pawns
        or parsed[2] != parsed[4]
        or abs(ord(parsed[1]) - ord(parsed[3])) != 1
    ):
        return False
    # The shared final-move replay binds this exact pawn to the previous board.
    piece = final_moving_piece(trace)
    return None if piece is None else piece.lower() == "p"


def evidence_outcome(trace: VerifiedTrace, record: object) -> str | None:
    if (
        not isinstance(record, dict)
        or record.get("logic_version") != VERSION
        or record.get("terminal_fen") != trace.terminal.fen
        or record.get("previous_fen")
        != (trace.decisions[-1].position_fen if trace.decisions else None)
        or record.get("move") != (trace.moves[-1] if trace.moves else None)
    ):
        return None
    sequence = candidate(trace)
    if sequence is not True:
        return "not_key" if sequence is False else None
    checking = checked_attackers(record.get("terminal"), trace.terminal.fen)
    if checking is None:
        return None
    board = decode_position(trace.terminal.fen)
    if any(
        board[s].isupper() != (fen_side(trace.terminal.fen) == "black")
        for s in checking
    ):
        return None
    parsed = UI_MOVE.fullmatch(trace.moves[-1])
    target = parsed[3] + parsed[4]
    return "key" if target in checking else "not_key"


def assess(engine, trace: VerifiedTrace) -> dict:
    record = {
        "logic_version": VERSION,
        "terminal_fen": trace.terminal.fen,
        "previous_fen": trace.decisions[-1].position_fen if trace.decisions else None,
        "move": trace.moves[-1] if trace.moves else None,
        "outcome": "inconclusive",
    }
    sequence = candidate(trace)
    if sequence is not True:
        record["outcome"] = "not_key" if sequence is False else "inconclusive"
        return record
    try:
        fen, checkers = engine.checking_pieces(SearchContext(trace.terminal.fen, ()))
        record["terminal"] = {"fen": fen, "checkers": list(checkers)}
        record["outcome"] = evidence_outcome(trace, record) or "inconclusive"
    except (EngineProtocolError, IncompleteSearchError, OSError, TimeoutError) as exc:
        record["reason"] = f"inspection_failed:{type(exc).__name__}"
    return record
