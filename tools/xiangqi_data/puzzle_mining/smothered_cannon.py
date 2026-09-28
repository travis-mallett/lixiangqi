"""Prove pre-move confinement by defenders followed by a cannon checkmate."""

from .attack_evidence import checked_attackers
from .engine import EngineProtocolError, IncompleteSearchError
from .models import SearchContext, VerifiedTrace, fen_side
from .patterns import (
    SMOTHERED_CANNON_THEME as THEME,
    SMOTHERED_CANNON_LOGIC_VERSION as VERSION,
    TerminalPosition,
    smothered_cannon_candidate,
)
from .position import (
    FenState,
    UI_MOVE,
    decode_position,
    general_escape_positions,
    normalized_fen,
)


def candidate(trace: VerifiedTrace) -> bool | None:
    """False excludes the motif; None means the final decision is unproven.

    Legality and mate belong to the verifier. Replay its final decision to bind
    the pre-move confinement to this exact terminal position.
    """
    if not trace.checkmate or not trace.moves:
        return False
    losing = fen_side(trace.terminal.fen)
    if not smothered_cannon_candidate(
        TerminalPosition(trace.terminal.fen, True, losing)
    ):
        return False
    parsed = UI_MOVE.fullmatch(trace.moves[-1])
    if parsed is None:
        return None
    origin, target = parsed[1] + parsed[2], parsed[3] + parsed[4]
    # Only the final destination can have lost a defending occupant. Two other
    # escapes rule this out even in an older ledger with no decision boards.
    if (
        sum(
            not move.endswith(target)
            for move, _ in general_escape_positions(trace.terminal.fen, losing)
        )
        > 1
    ):
        return False
    if len(trace.decisions) != len(trace.moves):
        return None
    decision = trace.decisions[-1]
    if not decision.position_fen or decision.selected_move != trace.moves[-1]:
        return None
    try:
        state = FenState(decision.position_fen)
        red = losing == "black"
        piece = state.position.get(origin)
        if (
            state.turn != ("w" if red else "b")
            or piece is None
            or piece.isupper() != red
            or ("k" if red else "K") not in state.position.values()
        ):
            return None
        state.push(trace.moves[-1])
        if normalized_fen(state.fen()) != normalized_fen(trace.terminal.fen):
            return None
        return len(escape_positions(trace)) <= 1
    except (ValueError, IndexError):
        return None


def escape_positions(trace: VerifiedTrace) -> tuple[tuple[str, str], ...]:
    """Inspect the losing general's palace steps before the final winning move."""
    return general_escape_positions(
        trace.decisions[-1].position_fen, fen_side(trace.terminal.fen)
    )


def advisor_screened_cannons(trace: VerifiedTrace) -> set[str]:
    """Winning cannons with a losing advisor as their sole terminal screen."""
    position = decode_position(trace.terminal.fen)
    general, advisor, cannon = (
        ("k", "a", "C") if fen_side(trace.terminal.fen) == "black" else ("K", "A", "c")
    )
    origin = next((s for s, p in position.items() if p == general), None)
    if origin is None:
        return set()
    result = set()
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        x, y = ord(origin[0]), int(origin[1:])
        screened = False
        while True:
            x, y = x + dx, y + dy
            if not (ord("a") <= x <= ord("i") and 1 <= y <= 10):
                break
            square = f"{chr(x)}{y}"
            piece = position.get(square)
            if piece is None:
                continue
            if not screened and piece == advisor:
                screened = True
                continue
            if screened and piece == cannon:
                result.add(square)
            break
    return result


def evidence_outcome(trace: VerifiedTrace, record: object) -> str | None:
    if (
        not isinstance(record, dict)
        or record.get("logic_version") != VERSION
        or record.get("terminal_fen") != trace.terminal.fen
        or record.get("previous_fen")
        != (trace.decisions[-1].position_fen if trace.decisions else None)
        or record.get("move") != (trace.moves[-1] if trace.moves else None)
    ):
        return None
    sequence = candidate(trace)
    if sequence is not True:
        return "not_key" if sequence is False else None
    checking = checked_attackers(record.get("terminal"), trace.terminal.fen)
    expected = dict(escape_positions(trace))
    inspections = record.get("escapes")
    if (
        checking is None
        or not isinstance(inspections, list)
        or len(inspections) != len(expected)
    ):
        return None
    seen = set()
    confined = True
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
        confined &= bool(attackers)
    return (
        "key"
        if confined
        and len(checking) == 1
        and checking & advisor_screened_cannons(trace)
        else "not_key"
    )


def assess(engine, trace: VerifiedTrace) -> dict:
    record = {
        "logic_version": VERSION,
        "terminal_fen": trace.terminal.fen,
        "previous_fen": trace.decisions[-1].position_fen if trace.decisions else None,
        "move": trace.moves[-1] if trace.moves else None,
        "escapes": [],
        "outcome": "inconclusive",
    }
    sequence = candidate(trace)
    if sequence is not True:
        record["outcome"] = "not_key" if sequence is False else "inconclusive"
        return record
    try:
        inspected, checkers = engine.checking_pieces(
            SearchContext(trace.terminal.fen, ())
        )
        record["terminal"] = {"fen": inspected, "checkers": list(checkers)}
        for move, fen in escape_positions(trace):
            inspected, checkers = engine.checking_pieces(SearchContext(fen, ()))
            record["escapes"].append(
                {"move": move, "fen": inspected, "checkers": list(checkers)}
            )
        record["outcome"] = evidence_outcome(trace, record) or "inconclusive"
    except (EngineProtocolError, IncompleteSearchError, OSError, TimeoutError) as exc:
        record["reason"] = f"inspection_failed:{type(exc).__name__}"
    return record
