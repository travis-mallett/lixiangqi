"""A winning cannon leaves a chariot's line to uncover check on the general.

The role-reversed twin of the cannon chariot discovery: a cannon masks a chariot
on the losing general's line, and its departure lets the chariot attack. The
motif may occur anywhere in the solution, not only on the final move, and it
applies to mating and non-mating puzzles alike. A chariot attacks the first piece
along an unobstructed line, so board relations decide the whole rule. The module
performs no engine inspection, piece removal, or continuation search.
"""

from .attack_evidence import geometric_attack
from .patterns import (
    DETONATING_MINE_THEME as THEME,
    DETONATING_MINE_VERSION as VERSION,
)
from .position import FenState, UI_MOVE, normalized_fen


def between(origin, chariot, general):
    """Whether ``origin`` lies strictly between a chariot and the general."""
    ox, oy = ord(origin[0]), int(origin[1:])
    rx, ry = ord(chariot[0]), int(chariot[1:])
    gx, gy = ord(general[0]), int(general[1:])
    if rx == gx == ox:
        return min(ry, gy) < oy < max(ry, gy)
    if ry == gy == oy:
        return min(rx, gx) < ox < max(rx, gx)
    return False


def uncovered_plies(trace):
    """Return the winning plies where a cannon uncovers a chariot check.

    Each record binds the ply, the vacated square, the revealed chariot, and the
    losing general. ``None`` means the stored decision ledger cannot prove the
    board sequence, never that the motif is absent.
    """
    if not trace.complete:
        return False
    if not trace.decisions or len(trace.moves) != len(trace.decisions):
        return None
    if trace.decisions[0].side not in {"red", "black"}:
        return None
    red = trace.decisions[0].side == "red"
    cannon, chariot, general = ("C", "R", "k") if red else ("c", "r", "K")
    found = []
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
            origin = parsed[1] + parsed[2]
            target = parsed[3] + parsed[4]
            piece = state.position.get(origin)
            if piece is None or piece.isupper() != (state.turn == "w"):
                return None
            mover = (state.turn == "w") == red
            before = dict(state.position)
            state.push(move)
            if not mover or piece != cannon:
                continue
            general_square = next(
                (
                    square
                    for square, occupant in state.position.items()
                    if occupant == general
                ),
                None,
            )
            if general_square is None:
                continue
            for chariot_square, occupant in state.position.items():
                if (
                    occupant == chariot
                    and between(origin, chariot_square, general_square)
                    and not between(target, chariot_square, general_square)
                    and not geometric_attack(before, chariot_square, general_square)
                    and geometric_attack(
                        state.position, chariot_square, general_square
                    )
                ):
                    found.append(
                        {
                            "ply": index,
                            "move": move,
                            "vacated": origin,
                            "arrived": target,
                            "chariot": chariot_square,
                            "general": general_square,
                        }
                    )
    except (ValueError, IndexError):
        return None
    return found


def candidate(trace):
    """``None`` marks an unprovable ledger; ``False`` excludes the motif."""
    plies = uncovered_plies(trace)
    return None if plies is None else bool(plies)


def stamp(trace):
    return {
        "logic_version": VERSION,
        "terminal_fen": trace.terminal.fen,
        "moves": list(trace.moves),
        "positions": [decision.position_fen for decision in trace.decisions],
    }


def evidence_outcome(trace, record):
    if not isinstance(record, dict) or any(
        record.get(key) != value for key, value in stamp(trace).items()
    ):
        return None
    plies = uncovered_plies(trace)
    return None if plies is None else ("key" if plies else "not_key")


def assess(engine, trace):
    record = {**stamp(trace), "outcome": "inconclusive"}
    plies = uncovered_plies(trace)
    if plies:
        record["uncovered"] = plies
    record["outcome"] = evidence_outcome(trace, record) or "inconclusive"
    return record
