"""A golden-hook horse targets an advisor from a corner and supports its capture."""

from .attack_evidence import geometric_attack
from .models import fen_side
from .patterns import (
    WHITE_HORSE_THEME as THEME,
    WHITE_HORSE_VERSION as VERSION,
    TerminalPosition,
    horse_role_candidate_squares,
)
from .position import FenState, UI_MOVE, normalized_fen


def candidate(trace):
    if not trace.checkmate:
        return False
    if not trace.moves or len(trace.moves) != len(trace.decisions):
        return None
    losing = fen_side(trace.terminal.fen)
    red = losing == "black"
    horse, advisor = ("N", "a") if red else ("n", "A")
    rank = "9" if red else "2"
    corners = set(
        horse_role_candidate_squares(
            TerminalPosition(trace.terminal.fen, True, losing), "palcornerHorse"
        )
    )
    # Corner -> (horse identity, targeted advisor identities, capture witnessed).
    formations = {}
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
            parsed = UI_MOVE.fullmatch(move)
            if parsed is None:
                return None
            origin, target = parsed[1] + parsed[2], parsed[3] + parsed[4]
            piece, captured = state.position.get(origin), state.position.get(target)
            if piece is None or piece.isupper() != (state.turn == "w"):
                return None
            identity = identities[origin]
            captured_id = identities.get(target)
            # Leaving the corner or being captured ends this formation, even
            # if another horse later occupies the same square.
            for corner, (horse_id, advisors, matched) in list(formations.items()):
                if identity == horse_id or captured_id == horse_id:
                    del formations[corner]
                elif (
                    piece.isupper() == red
                    and captured == advisor
                    and captured_id in advisors
                ):
                    formations[corner] = (horse_id, advisors, True)
            identities.pop(origin)
            identities.pop(target, None)
            identities[target] = identity
            state.push(move)
            if (
                piece == horse
                and origin in {"b" + rank, "h" + rank}
                and target in corners
            ):
                advisors = {
                    identities[s]
                    for s, p in state.position.items()
                    if p == advisor and geometric_attack(state.position, target, s)
                }
                formations[target] = (identity, advisors, False)
        if normalized_fen(state.fen()) != normalized_fen(trace.terminal.fen):
            return None
    except (ValueError, IndexError, KeyError):
        return None
    return any(matched for _, _, matched in formations.values())


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
    record = stamp(trace)
    record["outcome"] = evidence_outcome(trace, record) or "inconclusive"
    return record
