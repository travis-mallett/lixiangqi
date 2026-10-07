"""An advisor or elephant uncovers its general's center-file influence."""

from .attack_evidence import checked_attackers
from .engine import EngineProtocolError, IncompleteSearchError
from .models import SearchContext, fen_side
from .patterns import (
    GENERAL_DISROBING_THEME as THEME,
    GENERAL_DISROBING_VERSION as VERSION,
    TerminalPosition,
    white_faced_general_escape_positions,
)
from .position import FenState, UI_MOVE, normalized_fen, decode_position


def between(origin, target):
    low, high = sorted((int(origin[1:]), int(target[1:])))
    return tuple(f"e{rank}" for rank in range(low + 1, high))


def pinned(board, red):
    winner, loser = ("K", "k") if red else ("k", "K")
    own = next((s for s, p in board.items() if p == winner), None)
    enemy = next((s for s, p in board.items() if p == loser), None)
    if own is None or enemy is None or own[0] != "e" or enemy[0] != "e":
        return None
    screens = [s for s in between(own, enemy) if s in board]
    if len(screens) == 1 and board[screens[0]].isupper() != red:
        return screens[0]
    return None


def witnesses(trace):
    if not trace.checkmate:
        return []
    if not trace.moves or len(trace.moves) != len(trace.decisions):
        return None
    red = fen_side(trace.terminal.fen) == "black"
    general = "K" if red else "k"
    guards = {"A", "B"} if red else {"a", "b"}
    try:
        state = FenState(trace.decisions[0].position_fen)
        ids = {s: s for s in state.position}
        boards, identities = [dict(state.position)], [dict(ids)]
        moves = []
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
            moves.append((origin, target, piece))
            moving = ids.pop(origin)
            ids.pop(target, None)
            ids[target] = moving
            state.push(move)
            boards.append(dict(state.position))
            identities.append(dict(ids))
        if normalized_fen(state.fen()) != normalized_fen(trace.terminal.fen):
            return None
    except (ValueError, IndexError, KeyError):
        return None

    terminal = TerminalPosition(trace.terminal.fen, True, fen_side(trace.terminal.fen))
    escapes = white_faced_general_escape_positions(terminal)
    final_pin = pinned(boards[-1], red)
    result = []
    for index, (origin, target, piece) in enumerate(moves):
        own = next((s for s, p in boards[index].items() if p == general), None)
        if (
            piece not in guards
            or origin[0] != "e"
            or target[0] == "e"
            or own is None
            or own[0] != "e"
        ):
            continue
        after = boards[index + 1]
        pin = pinned(after, red)
        pin_match = (
            pin is not None
            and origin
            in between(
                own, next(s for s, p in after.items() if p == general.swapcase())
            )
            and final_pin is not None
            and identities[index + 1][pin] == identities[-1][final_pin]
            and (len(moves) - index - 1) // 2 <= 3
        )
        opened_escapes = []
        for escape, fen in escapes:
            parsed = UI_MOVE.fullmatch(escape)
            destination = parsed[3] + parsed[4]
            final_own = next(s for s, p in boards[-1].items() if p == general)
            if final_own[0] != "e":
                continue
            ray = between(own, destination)
            if (
                origin in ray
                and origin in between(final_own, destination)
                and not any(s in after for s in ray)
            ):
                opened_escapes.append((escape, fen))
        if pin_match or opened_escapes:
            result.append(
                {"index": index, "pin": bool(pin_match), "escapes": opened_escapes}
            )
    return result


def candidate(trace):
    found = witnesses(trace)
    return None if found is None else bool(found)


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
    found = witnesses(trace)
    if found is None:
        return None
    if not found:
        return "not_key"
    inspections = record.get("witnesses")
    if not isinstance(inspections, list) or len(inspections) != len(found):
        return None
    board = decode_position(trace.terminal.fen)
    general = "K" if fen_side(trace.terminal.fen) == "black" else "k"
    own = next(s for s, p in board.items() if p == general)
    matched = False
    for witness, proof in zip(found, inspections):
        if not isinstance(proof, dict) or proof.get("index") != witness["index"]:
            return None
        checkers = checked_attackers(
            proof.get("before"), trace.decisions[witness["index"]].position_fen
        )
        if checkers is None:
            return None
        escapes = proof.get("escapes")
        if not isinstance(escapes, list) or len(escapes) != len(witness["escapes"]):
            return None
        exclusive = False
        for (move, fen), inspection in zip(witness["escapes"], escapes):
            if not isinstance(inspection, dict) or inspection.get("move") != move:
                return None
            attackers = checked_attackers(inspection, fen)
            if attackers is None:
                return None
            exclusive |= attackers == {own}
        matched |= not checkers and (witness["pin"] or exclusive)
    return "key" if matched else "not_key"


def assess(engine, trace):
    record = {**stamp(trace), "outcome": "inconclusive", "witnesses": []}
    found = witnesses(trace)
    if not found:
        record["outcome"] = "inconclusive" if found is None else "not_key"
        return record
    try:
        for witness in found:
            fen, checkers = engine.checking_pieces(
                SearchContext(trace.decisions[witness["index"]].position_fen, ())
            )
            proof = {
                "index": witness["index"],
                "before": {"fen": fen, "checkers": list(checkers)},
                "escapes": [],
            }
            for move, target_fen in witness["escapes"]:
                inspected, attackers = engine.checking_pieces(
                    SearchContext(target_fen, ())
                )
                proof["escapes"].append(
                    {"move": move, "fen": inspected, "checkers": list(attackers)}
                )
            record["witnesses"].append(proof)
        record["outcome"] = evidence_outcome(trace, record) or "inconclusive"
    except (EngineProtocolError, IncompleteSearchError, OSError, TimeoutError) as exc:
        record["reason"] = f"inspection_failed:{type(exc).__name__}"
    return record
