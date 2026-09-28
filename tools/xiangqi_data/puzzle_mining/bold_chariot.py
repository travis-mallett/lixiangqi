"""A chariot takes an advisor/elephant and is immediately sacrificed before mate."""

from .models import fen_side
from .patterns import BOLD_CHARIOT_THEME as THEME, BOLD_CHARIOT_VERSION as VERSION
from .position import FenState, UI_MOVE, normalized_fen


def candidate(trace):
    if not trace.checkmate or len(trace.moves) < 3:
        return False
    if len(trace.decisions) != len(trace.moves):
        return None
    red = fen_side(trace.terminal.fen) == "black"
    chariot = "R" if red else "r"
    victims = {"a", "b"} if red else {"A", "B"}
    pending = None
    matched = False
    try:
        state = FenState(trace.decisions[0].position_fen)
        if (state.turn == "w") != red:
            return None
        for index, (move, decision) in enumerate(zip(trace.moves, trace.decisions)):
            if decision.selected_move != move or normalized_fen(
                state.fen()
            ) != normalized_fen(decision.position_fen):
                return None
            parsed = UI_MOVE.fullmatch(move)
            if parsed is None:
                return None
            origin, target = parsed[1] + parsed[2], parsed[3] + parsed[4]
            piece, captured = state.position.get(origin), state.position.get(target)
            if piece is None or piece.isupper() != (state.turn == "w"):
                return None
            # The pending chariot has not moved since its capture. Capturing its
            # square on this immediate reply binds the same piece's identity.
            if (
                pending == target
                and captured == chariot
                and piece.isupper() != red
                and index < len(trace.moves) - 1
            ):
                matched = True
            pending = target if piece == chariot and captured in victims else None
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
    match = candidate(trace)
    return None if match is None else "key" if match else "not_key"


def assess(engine, trace):
    record = {**stamp(trace), "outcome": "inconclusive"}
    record["outcome"] = evidence_outcome(trace, record) or "inconclusive"
    return record
