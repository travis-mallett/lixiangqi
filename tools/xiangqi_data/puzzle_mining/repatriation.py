"""Three checks by the same pawn drive the general back to its starting square."""

from .attack_evidence import checked_attackers
from .engine import EngineProtocolError, IncompleteSearchError
from .models import SearchContext, fen_side
from .patterns import REPATRIATION_THEME as THEME, REPATRIATION_VERSION as VERSION
from .position import FenState, UI_MOVE, normalized_fen, decode_position


def candidate(trace):
    if not trace.checkmate or len(trace.moves) < 5:
        return False
    if len(trace.moves) != len(trace.decisions):
        return None
    red = fen_side(trace.terminal.fen) == "black"
    pawn, general = ("P", "k") if red else ("p", "K")
    home = "e10" if red else "e1"
    pawn_square = None
    try:
        state = FenState(trace.decisions[-5].position_fen)
        for i, (move, decision) in enumerate(
            zip(trace.moves[-5:], trace.decisions[-5:])
        ):
            if decision.selected_move != move or normalized_fen(
                state.fen()
            ) != normalized_fen(decision.position_fen):
                return None
            parsed = UI_MOVE.fullmatch(move)
            if parsed is None:
                return None
            origin, target = parsed[1] + parsed[2], parsed[3] + parsed[4]
            if (state.turn == "w") != (red != (i % 2 == 1)):
                return None
            piece = state.position.get(origin)
            if piece is None or piece.isupper() != (state.turn == "w"):
                return None
            if i % 2 == 0:
                if piece != pawn or (pawn_square is not None and origin != pawn_square):
                    return False
                pawn_square = target
            else:
                dx = abs(ord(target[0]) - ord(origin[0]))
                dy = int(target[1:]) - int(origin[1:])
                if piece != general or dx + abs(dy) != 1 or dy * (1 if red else -1) < 0:
                    return False
            state.push(move)
        if normalized_fen(state.fen()) != normalized_fen(trace.terminal.fen):
            return None
        return state.position.get(home) == general
    except (ValueError, IndexError):
        return None


def check_positions(trace):
    return (
        ("first_check", trace.decisions[-4].position_fen, trace.moves[-5]),
        ("second_check", trace.decisions[-2].position_fen, trace.moves[-3]),
        ("terminal", trace.terminal.fen, trace.moves[-1]),
    )


def stamp(trace):
    return {
        "logic_version": VERSION,
        "terminal_fen": trace.terminal.fen,
        "moves": list(trace.moves[-5:]),
        "positions": [d.position_fen for d in trace.decisions[-5:]],
    }


def evidence_outcome(trace, record):
    if not isinstance(record, dict) or any(
        record.get(k) != v for k, v in stamp(trace).items()
    ):
        return None
    sequence = candidate(trace)
    if sequence is not True:
        return "not_key" if sequence is False else None
    red = fen_side(trace.terminal.fen) == "black"
    checks = []
    for key, fen, move in check_positions(trace):
        attackers = checked_attackers(record.get(key), fen)
        if attackers is None:
            return None
        board = decode_position(fen)
        if any(board[s].isupper() != red for s in attackers):
            return None
        parsed = UI_MOVE.fullmatch(move)
        checks.append(parsed[3] + parsed[4] in attackers)
    return "key" if all(checks) else "not_key"


def assess(engine, trace):
    record = {**stamp(trace), "outcome": "inconclusive"}
    sequence = candidate(trace)
    if sequence is not True:
        record["outcome"] = "not_key" if sequence is False else "inconclusive"
        return record
    try:
        for key, fen, move in check_positions(trace):
            inspected, checkers = engine.checking_pieces(SearchContext(fen, ()))
            record[key] = {"fen": inspected, "checkers": list(checkers)}
        record["outcome"] = evidence_outcome(trace, record) or "inconclusive"
    except (EngineProtocolError, IncompleteSearchError, OSError, TimeoutError) as exc:
        record["reason"] = f"inspection_failed:{type(exc).__name__}"
    return record
