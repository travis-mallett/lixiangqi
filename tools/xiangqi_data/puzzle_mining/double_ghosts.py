"""Track palace-flanking pawns that subsequently capture a defending advisor."""

from .models import fen_side
from .patterns import DOUBLE_GHOSTS_THEME as THEME, DOUBLE_GHOSTS_VERSION as VERSION
from .position import FenState, UI_MOVE, normalized_fen


def candidate(trace):
    if not trace.checkmate:
        return False
    if not trace.moves or len(trace.decisions) != len(trace.moves):
        return None
    red = fen_side(trace.terminal.fen) == "black"
    pawn, advisor = ("P", "a") if red else ("p", "A")
    rank = "9" if red else "2"
    left, right = "d" + rank, "f" + rank
    eligible = set()
    matched = False
    try:
        state = FenState(trace.decisions[0].position_fen)
        identities = {square: square for square in state.position}
        if (state.turn == "w") != red:
            return None
        for move, decision in zip(trace.moves, trace.decisions):
            if decision.selected_move != move or normalized_fen(
                state.fen()
            ) != normalized_fen(decision.position_fen):
                return None
            if state.position.get(left) == pawn and state.position.get(right) == pawn:
                eligible.update((identities[left], identities[right]))
            parsed = UI_MOVE.fullmatch(move)
            if parsed is None:
                return None
            origin, target = parsed[1] + parsed[2], parsed[3] + parsed[4]
            piece, captured = state.position.get(origin), state.position.get(target)
            if piece is None or piece.isupper() != (state.turn == "w"):
                return None
            identity = identities.pop(origin)
            matched |= piece == pawn and identity in eligible and captured == advisor
            identities.pop(target, None)
            identities[target] = identity
            state.push(move)
        if normalized_fen(state.fen()) != normalized_fen(trace.terminal.fen):
            return None
    except (ValueError, IndexError, KeyError):
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
    match = candidate(trace)
    return None if match is None else "key" if match else "not_key"


def assess(engine, trace):
    record = {**stamp(trace), "outcome": "inconclusive"}
    record["outcome"] = evidence_outcome(trace, record) or "inconclusive"
    return record
