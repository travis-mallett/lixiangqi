"""Track a pawn making exactly three forward moves and ending inside the enemy palace."""

from .models import fen_side
from .patterns import PAWN_TRIPLE_THEME as THEME, PAWN_TRIPLE_VERSION as VERSION
from .position import FenState, UI_MOVE, normalized_fen, decode_position


def candidate(trace):
    if not trace.checkmate or len(trace.moves) < 5:
        return False
    red = fen_side(trace.terminal.fen) == "black"
    pawn = "P" if red else "p"
    ranks = {8, 9, 10} if red else {1, 2, 3}
    targets = {
        s
        for s, p in decode_position(trace.terminal.fen).items()
        if p == pawn and s[0] in "def" and int(s[1:]) in ranks
    }
    if not targets:
        return False
    if len(trace.decisions) != len(trace.moves):
        return None
    try:
        state = FenState(trace.decisions[0].position_fen)
        if (state.turn == "w") != red:
            return None
        # Original squares identify pawns even after sideways moves or captures.
        identities = {s: s for s, p in state.position.items() if p == pawn}
        advances = {s: 0 for s in identities}
        for move, decision in zip(trace.moves, trace.decisions):
            if decision.selected_move != move or normalized_fen(
                state.fen()
            ) != normalized_fen(decision.position_fen):
                return None
            parsed = UI_MOVE.fullmatch(move)
            if parsed is None:
                return None
            origin, target = parsed[1] + parsed[2], parsed[3] + parsed[4]
            piece = state.position.get(origin)
            if piece is None or piece.isupper() != (state.turn == "w"):
                return None
            if origin in identities:
                identity = identities.pop(origin)
                if parsed[1] == parsed[3] and int(parsed[4]) - int(parsed[2]) == (
                    1 if red else -1
                ):
                    advances[identity] += 1
                identities.pop(target, None)
                identities[target] = identity
            else:
                identities.pop(target, None)
            state.push(move)
        if normalized_fen(state.fen()) != normalized_fen(trace.terminal.fen):
            return None
    except (ValueError, IndexError):
        return None
    return any(
        s in targets and advances[identity] == 3 for s, identity in identities.items()
    )


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
