"""Final-move evidence for Leisurely Stroll and Cross-Check Attack."""

from .attack_evidence import checked_attackers
from .engine import EngineProtocolError, IncompleteSearchError
from .models import SearchContext, VerifiedTrace, fen_side
from .patterns import (
    CROSS_CHECK_THEME as THEME,
    TERMINAL_MOTIF_VERSION as VERSION,
    LEISURELY_STROLL_THEME,
)
from .position import FenState, UI_MOVE, decode_position, normalized_fen


def final_moving_piece(trace: VerifiedTrace) -> str | None:
    """Bind the verifier's final winning move to the terminal board.

    Move legality belongs to the verifier; absent or inconsistent evidence
    remains inconclusive rather than being inferred from the terminal board.
    """
    if (
        not trace.terminal_win
        or not trace.moves
        or len(trace.decisions) != len(trace.moves)
    ):
        return None
    decision = trace.decisions[-1]
    move = trace.moves[-1]
    parsed = UI_MOVE.fullmatch(move)
    if not decision.position_fen or decision.selected_move != move or parsed is None:
        return None
    try:
        state = FenState(decision.position_fen)
        piece = state.position.get(parsed[1] + parsed[2])
        if (
            fen_side(state.fen()) == fen_side(trace.terminal.fen)
            or piece is None
            or piece.isupper() != (state.turn == "w")
        ):
            return None
        state.push(move)
        if normalized_fen(state.fen()) != normalized_fen(trace.terminal.fen):
            return None
        return piece
    except (ValueError, IndexError):
        return None


def leisurely_stroll(trace: VerifiedTrace) -> bool | None:
    if not trace.stalemate:
        return False
    # A verified final destination occupied by another winning piece rules out
    # a general move even when an older trace lacks decision-board evidence.
    parsed = UI_MOVE.fullmatch(trace.moves[-1]) if trace.moves else None
    if parsed is not None:
        piece = decode_position(trace.terminal.fen).get(parsed[3] + parsed[4])
        if (
            piece
            and piece.isupper() == (fen_side(trace.terminal.fen) == "black")
            and piece.lower() != "k"
        ):
            return False
    piece = final_moving_piece(trace)
    return None if piece is None else piece.lower() == "k"


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
    if not trace.checkmate:
        return "not_key"
    if final_moving_piece(trace) is None:
        return None
    previous = trace.decisions[-1].position_fen
    checking = checked_attackers(record.get("previous"), previous)
    if checking is None:
        return None
    board = decode_position(previous)
    red = fen_side(previous) == "black"
    if any(board[s].isupper() != red for s in checking):
        return None
    return "key" if checking else "not_key"


def assess(engine, trace: VerifiedTrace) -> dict:
    record = {
        "logic_version": VERSION,
        "terminal_fen": trace.terminal.fen,
        "previous_fen": trace.decisions[-1].position_fen if trace.decisions else None,
        "move": trace.moves[-1] if trace.moves else None,
        "outcome": "inconclusive",
    }
    if not trace.checkmate:
        record["outcome"] = "not_key"
        return record
    if final_moving_piece(trace) is None:
        return record
    try:
        fen, checkers = engine.checking_pieces(
            SearchContext(record["previous_fen"], ())
        )
        record["previous"] = {"fen": fen, "checkers": list(checkers)}
        record["outcome"] = evidence_outcome(trace, record) or "inconclusive"
    except (EngineProtocolError, IncompleteSearchError, OSError, TimeoutError) as exc:
        record["reason"] = f"inspection_failed:{type(exc).__name__}"
    return record
