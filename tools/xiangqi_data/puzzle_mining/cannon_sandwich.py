"""Complementary chariot and stacked-cannon checks and exclusive escapes."""

from .attack_evidence import checked_attackers
from .engine import EngineProtocolError, IncompleteSearchError
from .models import SearchContext, fen_side
from .patterns import (
    SANDWICH_THEME as THEME,
    SANDWICH_VERSION as VERSION,
    sandwich_candidate,
    TerminalPosition,
    double_cannon_attackers,
)
from .position import (
    decode_position,
    general_escape_positions,
    UI_MOVE,
    FenState,
    normalized_fen,
)


def terminal_position(trace):
    return TerminalPosition(
        trace.terminal.fen, trace.checkmate, fen_side(trace.terminal.fen)
    )


def candidate(trace):
    return sandwich_candidate(terminal_position(trace))


def visible_crossing(board, origin, target, other, axis):
    """Strictly cross the other's parallel line with an unobstructed sight line."""
    if axis == "vertical":
        if (
            not min(int(origin[1:]), int(target[1:]))
            < int(other[1:])
            < max(int(origin[1:]), int(target[1:]))
        ):
            return False
        between = (
            chr(x) + other[1:]
            for x in range(
                min(ord(origin[0]), ord(other[0])) + 1,
                max(ord(origin[0]), ord(other[0])),
            )
        )
    else:
        if not min(origin[0], target[0]) < other[0] < max(origin[0], target[0]):
            return False
        between = (
            other[0] + str(y)
            for y in range(
                min(int(origin[1:]), int(other[1:])) + 1,
                max(int(origin[1:]), int(other[1:])),
            )
        )
    return all(s not in board for s in between)


def movement_history(trace):
    """Track movement axes and visible crossings, retaining only surviving identities."""
    if not trace.moves or len(trace.moves) != len(trace.decisions):
        return None
    try:
        state = FenState(trace.decisions[0].position_fen)
        if fen_side(state.fen()) == fen_side(trace.terminal.fen):
            return None
        identities = {s: s for s in state.position}
        axes = {s: set() for s in state.position}
        crossings = set()
        red = fen_side(trace.terminal.fen) == "black"
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
            identity = identities[origin]
            axis = None
            if parsed[1] == parsed[3] and parsed[2] != parsed[4]:
                axis = "vertical"
            elif parsed[2] == parsed[4] and parsed[1] != parsed[3]:
                axis = "horizontal"
            if axis is not None:
                axes[identity].add(axis)
                if piece.isupper() == red and piece.lower() in {"r", "c"}:
                    counterpart = "C" if piece.lower() == "r" else "R"
                    if not red:
                        counterpart = counterpart.lower()
                    for square, occupant in state.position.items():
                        if occupant == counterpart and visible_crossing(
                            state.position, origin, target, square, axis
                        ):
                            rook, cannon = (
                                (identity, identities[square])
                                if piece.lower() == "r"
                                else (identities[square], identity)
                            )
                            crossings.add((rook, cannon, axis))
            identities.pop(origin)
            identities[target] = identity
            state.push(move)
        if normalized_fen(state.fen()) != normalized_fen(trace.terminal.fen):
            return None
    except (ValueError, IndexError):
        return None
    surviving = {identity: s for s, identity in identities.items()}
    return {
        "axes": {s: axes[identity] for s, identity in identities.items()},
        "crossings": {
            (surviving[r], surviving[c], axis)
            for r, c, axis in crossings
            if r in surviving and c in surviving
        },
    }


def stamp(trace):
    return {
        "logic_version": VERSION,
        "terminal_fen": trace.terminal.fen,
        "moves": list(trace.moves),
        "positions": [d.position_fen for d in trace.decisions],
    }


def terminal_lineups_clear(board, trio, general, vertical_ray):
    """All three must share a strict side and every one-step lineup must be clear."""
    along = lambda s: int(s[1:]) if vertical_ray else ord(s[0])
    across = lambda s: ord(s[0]) if vertical_ray else int(s[1:])
    offsets = [along(s) - along(general) for s in trio]
    if not (all(n > 0 for n in offsets) or all(n < 0 for n in offsets)):
        return False
    coordinates = [across(s) for s in trio]
    lower, upper = (ord("a"), ord("i")) if vertical_ray else (1, 10)
    targets = range(
        max(lower, max(coordinates) - 1), min(upper, min(coordinates) + 1) + 1
    )
    if not targets:
        return False
    for target in targets:
        destinations = set()
        for square in trio:
            destination = (
                chr(target) + square[1:] if vertical_ray else square[0] + str(target)
            )
            if destination in destinations or (
                destination != square and destination in board
            ):
                return False
            destinations.add(destination)
    return True


def moved_pair(history, rook, rear, cannon_fen, checker, general, terminal_board):
    # The perpendicular direction is relative to the final checking ray.
    axis = "horizontal" if checker[0] == general[0] else "vertical"
    board = decode_position(cannon_fen)
    king = next(
        s
        for s, p in board.items()
        if p.lower() == "k" and p.isupper() != board[rear].isupper()
    )
    pair = {rear} | {
        s
        for s in board
        if (
            s[0] == rear[0] == king[0]
            and min(int(rear[1:]), int(king[1:]))
            < int(s[1:])
            < max(int(rear[1:]), int(king[1:]))
        )
        or (
            s[1:] == rear[1:] == king[1:]
            and min(rear[0], king[0]) < s[0] < max(rear[0], king[0])
        )
    }
    return (
        terminal_lineups_clear(
            terminal_board, pair | {rook}, general, checker[0] == general[0]
        )
        and axis in history["axes"].get(rook, set())
        and any(axis in history["axes"].get(s, set()) for s in pair)
        and any((rook, s, axis) in history["crossings"] for s in pair)
    )


def escapes(terminal):
    return general_escape_positions(terminal.fen, terminal.losing_side, empty_only=True)


def perpendicular(checker, move):
    parsed = UI_MOVE.fullmatch(move)
    return (checker[0] == parsed[1] and parsed[1] != parsed[3]) or (
        checker[1:] == parsed[2] and parsed[2] != parsed[4]
    )


def evidence_outcome(trace, record):
    terminal = terminal_position(trace)
    if (
        not isinstance(record, dict)
        or record.get("logic_version") != VERSION
        or any(record.get(k) != v for k, v in stamp(trace).items())
    ):
        return None
    if not candidate(trace):
        return "not_key"
    history = movement_history(trace)
    if history is None:
        return None
    checking = checked_attackers(record.get("terminal"), terminal.fen)
    expected = dict(escapes(terminal))
    inspections = record.get("escapes")
    if (
        checking is None
        or not isinstance(inspections, list)
        or len(inspections) != len(expected)
    ):
        return None
    board = decode_position(terminal.fen)
    red = terminal.winning_side == "red"
    if any(board[s].isupper() != red for s in checking):
        return None
    general = next(s for s, p in board.items() if p == ("k" if red else "K"))
    rooks = {s for s, p in board.items() if p == ("R" if red else "r")}
    cannon_checks = checking & double_cannon_attackers(
        terminal.fen, terminal.losing_side
    )
    seen = set()
    key = False
    for item in inspections:
        if not isinstance(item, dict):
            return None
        move = item.get("move")
        if not isinstance(move, str) or move not in expected or move in seen:
            return None
        seen.add(move)
        attackers = checked_attackers(item, expected[move])
        if attackers is None:
            return None
        if len(attackers) != 1:
            continue
        cannon_blockers = double_cannon_attackers(expected[move], terminal.losing_side)
        rear_or_rook = next(iter(attackers))
        if attackers <= cannon_blockers:
            key |= any(
                perpendicular(rook, move)
                and moved_pair(
                    history, rook, rear_or_rook, expected[move], rook, general, board
                )
                for rook in checking & rooks
            )
        if attackers <= rooks:
            key |= any(
                perpendicular(rear, move)
                and moved_pair(
                    history, rear_or_rook, rear, terminal.fen, rear, general, board
                )
                for rear in cannon_checks
            )
    return "key" if key else "not_key"


def assess(engine, trace):
    terminal = terminal_position(trace)
    record = {
        **stamp(trace),
        "escapes": [],
        "outcome": "inconclusive",
    }
    if not candidate(trace):
        record["outcome"] = "not_key"
        return record
    if movement_history(trace) is None:
        return record
    try:
        fen, checkers = engine.checking_pieces(SearchContext(terminal.fen, ()))
        record["terminal"] = {"fen": fen, "checkers": list(checkers)}
        for move, expected in escapes(terminal):
            fen, checkers = engine.checking_pieces(SearchContext(expected, ()))
            record["escapes"].append(
                {"move": move, "fen": fen, "checkers": list(checkers)}
            )
        record["outcome"] = evidence_outcome(trace, record) or "inconclusive"
    except (EngineProtocolError, IncompleteSearchError, OSError, TimeoutError) as exc:
        record["reason"] = f"inspection_failed:{type(exc).__name__}"
    return record
