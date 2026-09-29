"""Three nearby palace pawns, with a member of that group delivering mate."""

from .attack_evidence import checked_attackers
from .engine import EngineProtocolError, IncompleteSearchError
from .models import fen_side, SearchContext
from .patterns import THREE_IMMORTALS_THEME as THEME, THREE_IMMORTALS_VERSION as VERSION
from .position import FenState, UI_MOVE, normalized_fen, decode_position


def near_palace(square, losing):
    low, high = (8, 10) if losing == "black" else (1, 3)
    file, rank = ord(square[0]), int(square[1:])
    dx = max(ord("d") - file, 0, file - ord("f"))
    dy = max(low - rank, 0, rank - high)
    return max(dx, dy) <= 1


def eligible_pawns(trace):
    """Return surviving squares of exact pawns that shared a qualifying group."""
    if not trace.checkmate:
        return set()
    if not trace.moves or len(trace.decisions) != len(trace.moves):
        return None
    losing = fen_side(trace.terminal.fen)
    red = losing == "black"
    pawn = "P" if red else "p"
    eligible = set()
    try:
        state = FenState(trace.decisions[0].position_fen)
        identities = {square: square for square in state.position}
        if (state.turn == "w") != red:
            return None

        def observe():
            nearby = {
                identities[s]
                for s, p in state.position.items()
                if p == pawn and near_palace(s, losing)
            }
            if len(nearby) >= 3:
                eligible.update(nearby)

        observe()
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
            identity = identities.pop(origin)
            identities.pop(target, None)
            identities[target] = identity
            state.push(move)
            observe()
        if normalized_fen(state.fen()) != normalized_fen(trace.terminal.fen):
            return None
        return {
            s
            for s, identity in identities.items()
            if identity in eligible and state.position[s] == pawn
        }
    except (ValueError, IndexError, KeyError):
        return None


def candidate(trace):
    pawns = eligible_pawns(trace)
    return None if pawns is None else bool(pawns)


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
    sequence = eligible_pawns(trace)
    if not sequence:
        return "not_key" if sequence is not None else None
    checking = checked_attackers(record.get("terminal"), trace.terminal.fen)
    if checking is None:
        return None
    board = decode_position(trace.terminal.fen)
    red = fen_side(trace.terminal.fen) == "black"
    if any(board[s].isupper() != red for s in checking):
        return None
    return "key" if checking & sequence else "not_key"


def assess(engine, trace):
    record = {**stamp(trace), "outcome": "inconclusive"}
    sequence = eligible_pawns(trace)
    if not sequence:
        record["outcome"] = "not_key" if sequence is not None else "inconclusive"
        return record
    try:
        fen, checkers = engine.checking_pieces(SearchContext(trace.terminal.fen, ()))
        record["terminal"] = {"fen": fen, "checkers": list(checkers)}
        record["outcome"] = evidence_outcome(trace, record) or "inconclusive"
    except (EngineProtocolError, IncompleteSearchError, OSError, TimeoutError) as exc:
        record["reason"] = f"inspection_failed:{type(exc).__name__}"
    return record
