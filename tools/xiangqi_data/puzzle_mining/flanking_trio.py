"""Track one chariot, horse and cannon on a fixed enemy flank throughout mate."""

from .attack_evidence import checked_attackers
from . import flanking_trio_roles
from .engine import EngineProtocolError, IncompleteSearchError
from .models import SearchContext, VerifiedTrace, fen_side
from .patterns import (
    FLANKING_TRIO_THEME as THEME,
    FLANKING_TRIO_LOGIC_VERSION as VERSION,
    TerminalPosition,
    flanking_trio_boxes,
    flanking_trio_candidate,
    flanking_trio_pawns_distant,
)
from .position import FenState, UI_MOVE, decode_position, normalized_fen


def tracked_trio(trace: VerifiedTrace) -> dict | None:
    """A continuous trio witness, {} for a non-match, or None for missing proof."""
    if not trace.checkmate or not trace.moves:
        return {}
    losing = fen_side(trace.terminal.fen)
    if not flanking_trio_candidate(TerminalPosition(trace.terminal.fen, True, losing)):
        return {}
    if len(trace.decisions) != len(trace.moves) or any(
        not decision.position_fen for decision in trace.decisions
    ):
        return None
    try:
        state = FenState(trace.decisions[0].position_fen)
        if fen_side(state.fen()) == losing:
            return None
        boxes = flanking_trio_boxes(state.position, losing)
        if len(boxes) != 1:
            return {}
        flank, squares = next(iter(boxes.items()))
        # Original squares identify the same three pieces throughout the solution.
        identities = {square: square for square in state.position}
        trio_ids = set(squares)
        moved = set()
        for ply in range(len(trace.moves) + 1):
            if not flanking_trio_pawns_distant(state.position, losing):
                return {}
            boxes = flanking_trio_boxes(state.position, losing)
            if (
                set(boxes) != {flank}
                or {identities[s] for s in boxes[flank]} != trio_ids
            ):
                return {}
            if ply == len(trace.moves):
                break
            move, decision = trace.moves[ply], trace.decisions[ply]
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
            identities[target] = identity
            moved.add(identity)
            state.push(move)
        if normalized_fen(state.fen()) != normalized_fen(trace.terminal.fen):
            return None
    except (ValueError, IndexError):
        return None
    if not trio_ids.issubset(moved):
        return {}
    return {
        "flank": flank,
        "pieces": {identities[s]: s for s in boxes[flank]},
    }


def candidate(trace: VerifiedTrace) -> bool | None:
    trio = tracked_trio(trace)
    return None if trio is None else bool(trio)


def evidence_outcome(trace: VerifiedTrace, record: object) -> str | None:
    if (
        not isinstance(record, dict)
        or record.get("logic_version") != VERSION
        or record.get("terminal_fen") != trace.terminal.fen
        or record.get("initial_fen")
        != (trace.decisions[0].position_fen if trace.decisions else None)
        or record.get("moves") != list(trace.moves)
    ):
        return None
    trio = tracked_trio(trace)
    if trio is None:
        return None
    if not trio:
        return "not_key"
    if record.get("trio") != trio:
        return None
    checking = checked_attackers(record.get("terminal"), trace.terminal.fen)
    if checking is None:
        return None
    red = fen_side(trace.terminal.fen) == "black"
    board = decode_position(trace.terminal.fen)
    if any(board[s].isupper() != red for s in checking):
        return None
    if not checking.intersection(trio["pieces"].values()):
        return "not_key"
    return flanking_trio_roles.outcome(trace, trio, record, checking)


def assess(engine, trace: VerifiedTrace) -> dict:
    trio = tracked_trio(trace)
    record = {
        "logic_version": VERSION,
        "terminal_fen": trace.terminal.fen,
        "initial_fen": trace.decisions[0].position_fen if trace.decisions else None,
        "moves": list(trace.moves),
        "trio": trio,
        "contributions": [],
        "outcome": "inconclusive",
    }
    if not trio:
        record["outcome"] = "inconclusive" if trio is None else "not_key"
        return record
    try:
        fen, checkers = engine.checking_pieces(SearchContext(trace.terminal.fen, ()))
        record["terminal"] = {"fen": fen, "checkers": list(checkers)}
        terminal_ids = {square: identity for identity, square in trio["pieces"].items()}
        red = fen_side(trace.terminal.fen) == "black"
        contributed = flanking_trio_roles.contributors(
            record["terminal"], trace.terminal.fen, terminal_ids, red
        )
        if contributed:
            cache = {normalized_fen(trace.terminal.fen): record["terminal"]}
            for (ply, move), (
                expected,
                ids,
            ) in flanking_trio_roles.inspection_positions(trace, trio).items():
                if contributed == set(trio["pieces"]):
                    break
                key = normalized_fen(expected)
                if key not in cache:
                    inspected, attackers = engine.checking_pieces(
                        SearchContext(expected, ())
                    )
                    cache[key] = {"fen": inspected, "checkers": list(attackers)}
                item = {"ply": ply, "move": move, **cache[key]}
                record["contributions"].append(item)
                found = flanking_trio_roles.contributors(item, expected, ids, red)
                if found is None:
                    return record
                contributed.update(found)
        record["outcome"] = evidence_outcome(trace, record) or "inconclusive"
    except (EngineProtocolError, IncompleteSearchError, OSError, TimeoutError) as exc:
        record["reason"] = f"inspection_failed:{type(exc).__name__}"
    return record
