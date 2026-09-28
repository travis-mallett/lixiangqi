"""Prove the final cannon sacrifice, capture, and second-cannon recapture."""

from .attack_evidence import checked_attackers
from .engine import EngineProtocolError, IncompleteSearchError
from .models import SearchContext, fen_side
from .patterns import DOUBLE_TOAST_THEME as THEME, DOUBLE_TOAST_VERSION as VERSION
from .position import FenState, UI_MOVE, normalized_fen, decode_position


def cannon_capture(board, origin, target):
    """A cannon capture must cross exactly one occupied screen square."""
    if origin == target or (origin[0] != target[0] and origin[1:] != target[1:]):
        return False
    dx = (target[0] > origin[0]) - (target[0] < origin[0])
    dy = (int(target[1:]) > int(origin[1:])) - (int(target[1:]) < int(origin[1:]))
    x, y = ord(origin[0]) + dx, int(origin[1:]) + dy
    count = 0
    while chr(x) + str(y) != target:
        count += (chr(x) + str(y)) in board
        x, y = x + dx, y + dy
    return count == 1


def candidate(trace):
    if not trace.checkmate or len(trace.moves) < 3:
        return False
    if len(trace.moves) != len(trace.decisions):
        return None
    red = fen_side(trace.terminal.fen) == "black"
    cannon = "C" if red else "c"
    destination = None
    try:
        state = FenState(trace.decisions[-3].position_fen)
        for i, (move, decision) in enumerate(
            zip(trace.moves[-3:], trace.decisions[-3:])
        ):
            if decision.selected_move != move or normalized_fen(
                state.fen()
            ) != normalized_fen(decision.position_fen):
                return None
            parsed = UI_MOVE.fullmatch(move)
            if parsed is None:
                return None
            origin, target = parsed[1] + parsed[2], parsed[3] + parsed[4]
            if (state.turn == "w") != (red != (i == 1)):
                return None
            piece, captured = state.position.get(origin), state.position.get(target)
            if piece is None or piece.isupper() != (state.turn == "w"):
                return None
            if i == 0:
                destination = target
            if target != destination:
                return False
            if i == 1:
                if captured != cannon:
                    return False
            elif (
                piece != cannon
                or captured is None
                or captured.isupper() == red
                or not cannon_capture(state.position, origin, target)
            ):
                return False
            # Both captures land on the same square. The first cannon is removed
            # at ply B; the piece replacing it is captured immediately at ply C.
            state.push(move)
        if normalized_fen(state.fen()) != normalized_fen(trace.terminal.fen):
            return None
    except (ValueError, IndexError):
        return None
    return True


def stamp(trace):
    return {
        "logic_version": VERSION,
        "terminal_fen": trace.terminal.fen,
        "moves": list(trace.moves[-3:]),
        "positions": [d.position_fen for d in trace.decisions[-3:]],
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
    target_move = UI_MOVE.fullmatch(trace.moves[-1])
    target = target_move[3] + target_move[4]
    checks = []
    for key, fen in (
        ("first_check", trace.decisions[-2].position_fen),
        ("terminal", trace.terminal.fen),
    ):
        attackers = checked_attackers(record.get(key), fen)
        if attackers is None:
            return None
        board = decode_position(fen)
        if any(board[s].isupper() != red for s in attackers):
            return None
        checks.append(target in attackers)
    return "key" if all(checks) else "not_key"


def assess(engine, trace):
    record = {**stamp(trace), "outcome": "inconclusive"}
    sequence = candidate(trace)
    if sequence is not True:
        record["outcome"] = "not_key" if sequence is False else "inconclusive"
        return record
    try:
        for key, fen in (
            ("first_check", trace.decisions[-2].position_fen),
            ("terminal", trace.terminal.fen),
        ):
            inspected, checkers = engine.checking_pieces(SearchContext(fen, ()))
            record[key] = {"fen": inspected, "checkers": list(checkers)}
        record["outcome"] = evidence_outcome(trace, record) or "inconclusive"
    except (EngineProtocolError, IncompleteSearchError, OSError, TimeoutError) as exc:
        record["reason"] = f"inspection_failed:{type(exc).__name__}"
    return record
