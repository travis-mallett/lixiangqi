"""Recognize a palace flank followed by a chariot advisor capture and chariot mate."""

from .models import VerifiedTrace, fen_side, SearchContext
from .attack_evidence import checked_attackers
from .engine import EngineProtocolError, IncompleteSearchError
from .patterns import CHARIOTS_THREATENING_ADVISOR_THEME as THEME
from .patterns import CHARIOTS_THREATENING_ADVISOR_LOGIC_VERSION as VERSION
from .position import FenState, UI_MOVE, normalized_fen, decode_position


def candidate(trace: VerifiedTrace) -> bool | None:
    """Find a qualifying capture anywhere in the line, without a distance limit.

    Return None for incomplete or inconsistent move evidence. Replay the entire
    verified ledger through the terminal board, including moves after a match.
    """
    losing = fen_side(trace.terminal.fen)
    if not trace.checkmate:
        return False
    red = losing == "black"
    rank = "9" if red else "2"
    center, left, right = "e" + rank, "d" + rank, "f" + rank
    parsed_moves = tuple(UI_MOVE.fullmatch(move) for move in trace.moves)
    if not parsed_moves or any(move is None for move in parsed_moves):
        return None
    if len(trace.decisions) != len(trace.moves):
        return None
    if any(not decision.position_fen for decision in trace.decisions):
        return None
    chariot, advisor = ("R", "a") if red else ("r", "A")
    winning_turn = "w" if red else "b"
    matched = False
    formation_seen = False
    try:
        state = FenState(trace.decisions[0].position_fen)
        for move, decision in zip(trace.moves, trace.decisions):
            if decision.selected_move != move or normalized_fen(
                state.fen()
            ) != normalized_fen(decision.position_fen):
                return None
            parsed = UI_MOVE.fullmatch(move)
            if not parsed:
                return None
            origin, target = parsed[1] + parsed[2], parsed[3] + parsed[4]
            piece = state.position.get(origin)
            if piece is None or piece.isupper() != (state.turn == "w"):
                return None
            formation_seen |= (
                state.position.get(center) == advisor
                and state.position.get(left) == chariot
                and state.position.get(right) == chariot
            )
            matched |= (
                formation_seen
                and state.turn == winning_turn
                and piece == chariot
                and state.position.get(target) == advisor
            )
            state.push(move)
        if normalized_fen(state.fen()) != normalized_fen(trace.terminal.fen):
            return None
    except (ValueError, IndexError):
        return None
    return matched


def stamp(trace):
    return {
        "logic_version": VERSION,
        "terminal_fen": trace.terminal.fen,
        "moves": list(trace.moves),
        "positions": [d.position_fen for d in trace.decisions],
    }


def evidence_outcome(trace, record):
    if not isinstance(record, dict) or any(
        record.get(k) != v for k, v in stamp(trace).items()
    ):
        return None
    sequence = candidate(trace)
    if sequence is not True:
        return "not_key" if sequence is False else None
    checking = checked_attackers(record.get("terminal"), trace.terminal.fen)
    if checking is None:
        return None
    board = decode_position(trace.terminal.fen)
    red = fen_side(trace.terminal.fen) == "black"
    if any(board[s].isupper() != red for s in checking):
        return None
    return (
        "key" if any(board[s] == ("R" if red else "r") for s in checking) else "not_key"
    )


def assess(engine, trace):
    record = {**stamp(trace), "outcome": "inconclusive"}
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
