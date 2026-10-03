"""A winning chariot leaves a cannon's line to uncover check on the general.

The motif may occur anywhere in the solution, not only on the final move, and it
applies to mating and non-mating puzzles alike. A cannon attacks the first piece
beyond exactly one screen, so board relations decide the whole rule. The module
performs no engine inspection, piece removal, or continuation search.
"""

from .attack_evidence import geometric_attack
from .patterns import (
    CANNON_CHARIOT_DISCOVERED_THEME as THEME,
    CANNON_CHARIOT_DISCOVERED_VERSION as VERSION,
)
from .position import FenState, UI_MOVE, normalized_fen


def between(origin, cannon, general):
    """Whether ``origin`` lies strictly between a cannon and the general."""
    ox, oy = ord(origin[0]), int(origin[1:])
    cx, cy = ord(cannon[0]), int(cannon[1:])
    gx, gy = ord(general[0]), int(general[1:])
    if cx == gx == ox:
        return min(cy, gy) < oy < max(cy, gy)
    if cy == gy == oy:
        return min(cx, gx) < ox < max(cx, gx)
    return False


def uncovered_plies(trace):
    """Return the winning plies where a chariot uncovers a cannon check.

    Each record binds the ply, the vacated square, the revealed cannon, and the
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
    chariot, cannon, general = ("R", "C", "k") if red else ("r", "c", "K")
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
            if not mover or piece != chariot:
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
            for cannon_square, occupant in state.position.items():
                if (
                    occupant == cannon
                    and between(origin, cannon_square, general_square)
                    and not between(target, cannon_square, general_square)
                    and not geometric_attack(before, cannon_square, general_square)
                    and geometric_attack(
                        state.position, cannon_square, general_square
                    )
                ):
                    found.append(
                        {
                            "ply": index,
                            "move": move,
                            "vacated": origin,
                            "arrived": target,
                            "cannon": cannon_square,
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
