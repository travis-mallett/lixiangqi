"""Rear cannon attacks that dislodge a chariot for a flying-general mate.

The shared white_faced_general assessor owns the terminal escape proof. Here
we track piece identities and prove the cannon's capture threat is legal.
"""

from .attack_evidence import checked_attackers
from .engine import EngineProtocolError, IncompleteSearchError
from .models import SearchContext, VerifiedTrace, fen_side
from .patterns import (
    MOON_SCOOPING_THEME as THEME,
    MOON_SCOOPING_LOGIC_VERSION as VERSION,
    TerminalPosition,
    white_faced_general_escape_positions,
)
from .position import FenState, UI_MOVE, decode_position, normalized_fen


def _target(board, cannon, losing):
    """Cannon -> general -> defending chariot, toward the attacker's side."""
    general = "k" if losing == "black" else "K"
    king = next((s for s, p in board.items() if p == general), None)
    if king is None or king[0] != cannon[0]:
        return None
    direction = -1 if losing == "black" else 1
    rank, king_rank = int(cannon[1:]), int(king[1:])
    if (king_rank - rank) * direction <= 0:
        return None
    occupied = [
        cannon[0] + str(r)
        for r in range(rank + direction, 0 if direction == -1 else 11, direction)
        if cannon[0] + str(r) in board
    ]
    if len(occupied) < 2 or occupied[0] != king:
        return None
    rook = occupied[1]
    return rook if board[rook] == ("r" if losing == "black" else "R") else None


def witnesses(trace: VerifiedTrace) -> list[dict] | None:
    """Ordered geometric witnesses, or None when the move ledger is incomplete."""
    losing = fen_side(trace.terminal.fen)
    if not trace.checkmate or len(trace.moves) < 3:
        return []
    terminal = TerminalPosition(trace.terminal.fen, True, losing)
    if not white_faced_general_escape_positions(terminal):
        return []
    red = losing == "black"
    chariot, cannon = ("R", "C") if red else ("r", "c")
    final_board = decode_position(trace.terminal.fen)
    if chariot not in final_board.values():
        return []
    if len(trace.decisions) != len(trace.moves) or any(
        not d.position_fen for d in trace.decisions
    ):
        return None
    # IDs are the original squares, retained across moves and never reused
    # after captures. This distinguishes multiple chariots/cannons in noisy boards.
    try:
        state = FenState(trace.decisions[0].position_fen)
        ids = {s: s for s in state.position}
        boards, identities, fens, moves = [], [], [], []
        for move, decision in zip(trace.moves, trace.decisions):
            if decision.selected_move != move or normalized_fen(
                state.fen()
            ) != normalized_fen(decision.position_fen):
                return None
            parsed = UI_MOVE.fullmatch(move)
            if not parsed:
                return None
            origin, target = parsed[1] + parsed[2], parsed[3] + parsed[4]
            piece = state.position.get(origin)
            if piece is None or piece.isupper() != (state.turn == "w"):
                return None
            boards.append(dict(state.position))
            identities.append(dict(ids))
            fens.append(state.fen())
            moving = ids.pop(origin)
            moves.append((origin, target, piece, moving, ids.get(target)))
            ids[target] = moving
            state.push(move)
        if normalized_fen(state.fen()) != normalized_fen(trace.terminal.fen):
            return None
        boards.append(dict(state.position))
        identities.append(dict(ids))
        fens.append(state.fen())
    except (ValueError, IndexError):
        return None

    king = next(s for s, p in final_board.items() if p == ("k" if red else "K"))
    finishers = {
        identity: square
        for square, identity in ids.items()
        if final_board[square] == chariot and square[0] == king[0]
    }
    result = []
    for i, (origin, square, piece, cannon_id, _) in enumerate(moves):
        if piece != cannon:
            continue
        target = _target(boards[i + 1], square, losing)
        if target is None or square[0] != king[0]:
            continue
        defender = identities[i + 1][target]
        previous = _target(boards[i], origin, losing)
        if previous and identities[i][previous] == defender:
            continue  # Sliding an already established threat is not the maneuver.
        # The same threat must survive until this defender leaves its file or
        # is captured. A cannon captured before dislodging it does not qualify.
        displaced = None
        for j in range(i + 1, len(moves)):
            current_cannon = next(
                (s for s, identity in identities[j].items() if identity == cannon_id),
                None,
            )
            threatened = (
                _target(boards[j], current_cannon, losing) if current_cannon else None
            )
            if threatened is None or identities[j][threatened] != defender:
                break
            _, destination, _, moving, captured = moves[j]
            if captured == defender or (
                moving == defender and destination[0] != square[0]
            ):
                displaced = j
                break
        if displaced is None:
            continue
        for identity, finish in finishers.items():
            # Connect the finish to this displacement: this surviving chariot
            # subsequently enters the exposed file, or captures the defender.
            if identity not in identities[i + 1].values():
                continue
            if not any(
                moving == identity
                and destination[0] == square[0]
                and (start[0] != square[0] or captured == defender)
                for start, destination, _, moving, captured in moves[displaced:]
            ):
                continue
            fields = fens[i + 1].split()
            fields[1] = "w" if red else "b"
            result.append(
                {
                    "ply": i,
                    "capture_fen": " ".join(fields),
                    "capture": square + target,
                    "finisher": finish,
                }
            )
    return result


def candidate(trace: VerifiedTrace) -> bool | None:
    found = witnesses(trace)
    return None if found is None else bool(found)


def evidence_outcome(trace: VerifiedTrace, record: object) -> str | None:
    expected = witnesses(trace)
    if expected is None:
        return None
    if not expected:
        return "not_key"
    if (
        not isinstance(record, dict)
        or record.get("logic_version") != VERSION
        or record.get("terminal_fen") != trace.terminal.fen
        or record.get("witnesses") != expected
    ):
        return None
    checking = checked_attackers(record.get("terminal"), trace.terminal.fen)
    inspections = record.get("threats")
    requested = {w["capture_fen"] for w in expected}
    if (
        checking is None
        or not isinstance(inspections, dict)
        or set(inspections) != requested
    ):
        return None
    for fen, item in inspections.items():
        if (
            not isinstance(item, dict)
            or not isinstance(item.get("fen"), str)
            or len(item["fen"].split()) < 2
            or normalized_fen(item["fen"]) != normalized_fen(fen)
            or not isinstance(item.get("legal_moves"), list)
            or any(
                not isinstance(m, str) or not UI_MOVE.fullmatch(m)
                for m in item["legal_moves"]
            )
        ):
            return None
    return (
        "key"
        if any(
            w["finisher"] in checking
            and w["capture"] in inspections[w["capture_fen"]]["legal_moves"]
            for w in expected
        )
        else "not_key"
    )


def assess(engine, trace: VerifiedTrace) -> dict:
    found = witnesses(trace)
    record = {
        "logic_version": VERSION,
        "terminal_fen": trace.terminal.fen,
        "witnesses": found,
        "threats": {},
        "outcome": "inconclusive",
    }
    if not found:
        record["outcome"] = "inconclusive" if found is None else "not_key"
        return record
    try:
        fen, checkers = engine.checking_pieces(SearchContext(trace.terminal.fen, ()))
        record["terminal"] = {"fen": fen, "checkers": list(checkers)}
        for fen in sorted({w["capture_fen"] for w in found}):
            status = engine.inspect(SearchContext(fen, ()))
            record["threats"][fen] = {
                "fen": status.fen,
                "legal_moves": list(status.legal_moves),
            }
        record["outcome"] = evidence_outcome(trace, record) or "inconclusive"
    except (EngineProtocolError, IncompleteSearchError, OSError, TimeoutError) as exc:
        record["reason"] = f"inspection_failed:{type(exc).__name__}"
    return record
