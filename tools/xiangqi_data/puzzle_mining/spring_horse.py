"""Prove a chariot releases a horse check and exclusively seals an empty escape."""

from .attack_evidence import checked_attackers, geometric_attack
from .engine import EngineProtocolError, IncompleteSearchError
from .models import SearchContext, VerifiedTrace, fen_side
from .patterns import (
    SPRING_HORSE_THEME as THEME,
    SPRING_HORSE_LOGIC_VERSION as VERSION,
    TerminalPosition,
    horse_role_escape_positions,
)
from .position import FenState, UI_MOVE, decode_position, normalized_fen


def released_horses(trace: VerifiedTrace) -> tuple[str, ...] | None:
    """Find horses whose leg the final chariot move vacates.

    An empty tuple excludes the motif; None means the final decision ledger is
    incomplete or inconsistent. Replay only the last already-verified move:
    legality and checkmate remain the verifier's responsibility.
    """
    if not trace.checkmate or not trace.moves:
        return ()
    move = trace.moves[-1]
    parsed = UI_MOVE.fullmatch(move)
    if parsed is None:
        return None
    origin, target = parsed[1] + parsed[2], parsed[3] + parsed[4]
    try:
        red = fen_side(trace.terminal.fen) == "black"
        # A non-chariot final move rules this out even in an older ledger
        # without decision boards; unrelated categories remain reusable.
        if decode_position(trace.terminal.fen).get(target) != ("R" if red else "r"):
            return ()
        if len(trace.decisions) != len(trace.moves):
            return None
        decision = trace.decisions[-1]
        if not decision.position_fen or decision.selected_move != move:
            return None
        before = FenState(decision.position_fen)
        if before.turn != ("w" if red else "b"):
            return None
        after = FenState(decision.position_fen)
        after.push(move)
        if normalized_fen(after.fen()) != normalized_fen(trace.terminal.fen):
            return None
        if before.position.get(origin) != ("R" if red else "r"):
            return ()
        general = next(
            (s for s, p in before.position.items() if p == ("k" if red else "K")),
            None,
        )
        if general is None:
            return None
        # Removing this chariot must free the horse's attack; putting it on its
        # destination must leave that attack open. This uses the shared horse-
        # leg geometry, with the same horse and general on both boards.
        unblocked = {s: p for s, p in before.position.items() if s != origin}
        horse = "N" if red else "n"
        return tuple(
            s
            for s, p in before.position.items()
            if p == horse
            and s != target
            and not geometric_attack(before.position, s, general)
            and geometric_attack(unblocked, s, general)
            and geometric_attack(after.position, s, general)
        )
    except (ValueError, IndexError):
        return None


def escape_positions(trace: VerifiedTrace) -> tuple[tuple[str, str], ...]:
    return horse_role_escape_positions(
        TerminalPosition(
            trace.terminal.fen, trace.checkmate, fen_side(trace.terminal.fen)
        ),
        empty_only=True,
    )


def evidence_outcome(trace: VerifiedTrace, record: object) -> str | None:
    """Require versioned inspections bound to both boards and the final move."""
    if (
        not isinstance(record, dict)
        or record.get("logic_version") != VERSION
        or record.get("terminal_fen") != trace.terminal.fen
        or record.get("previous_fen")
        != (trace.decisions[-1].position_fen if trace.decisions else None)
        or record.get("move") != (trace.moves[-1] if trace.moves else None)
    ):
        return None
    horses = released_horses(trace)
    if horses is None:
        return None
    if not horses:
        return "not_key"
    checking = checked_attackers(record.get("terminal"), trace.terminal.fen)
    expected = dict(escape_positions(trace))
    inspections = record.get("escapes")
    if (
        checking is None
        or not isinstance(inspections, list)
        or len(inspections) != len(expected)
    ):
        return None
    move = UI_MOVE.fullmatch(trace.moves[-1])
    chariot = move[3] + move[4]
    seen = set()
    exclusive_escape = False
    for item in inspections:
        if not isinstance(item, dict):
            return None
        step = item.get("move")
        if not isinstance(step, str) or step not in expected or step in seen:
            return None
        seen.add(step)
        attackers = checked_attackers(item, expected[step])
        if attackers is None:
            return None
        exclusive_escape |= attackers == {chariot}
    return (
        "key"
        if len(checking) == 1 and checking <= set(horses) and exclusive_escape
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
    horses = released_horses(trace)
    if not horses:
        record["outcome"] = "inconclusive" if horses is None else "not_key"
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
