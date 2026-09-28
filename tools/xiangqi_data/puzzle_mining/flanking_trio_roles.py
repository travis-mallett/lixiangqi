"""Version-bound checking and escape-control witnesses for the identified trio."""

from .attack_evidence import checked_attackers
from .models import fen_side
from .position import FenState, UI_MOVE, decode_position, general_escape_positions


def inspection_positions(trace, trio):
    """Map (ply, general move) to inspection board and square-to-original-ID map.

    Empty move denotes a check against the general in its actual position.
    Escape inspection moves the general first, including removing captures.
    Terminal check is held separately; visit later positions first to find
    contributions quickly while retaining complete coverage for non-matches.
    """
    losing = fen_side(trace.terminal.fen)
    state = FenState(trace.decisions[0].position_fen)
    identities = {square: square for square in trio["pieces"]}
    frames = []
    for ply in range(len(trace.moves) + 1):
        fields = state.fen().split()
        fields[1] = "b" if losing == "black" else "w"
        frames.append((ply, " ".join(fields), dict(identities)))
        if ply < len(trace.moves):
            m = UI_MOVE.fullmatch(trace.moves[ply])
            origin, target = m[1] + m[2], m[3] + m[4]
            if origin in identities:
                identities[target] = identities.pop(origin)
            state.push(trace.moves[ply])
    result = {}
    for ply, fen, ids in reversed(frames):
        if ply != len(trace.moves):
            result[(ply, "")] = (fen, ids)
        for move, escaped in general_escape_positions(fen, losing):
            # A captured trio member cannot control the square it occupied.
            m = UI_MOVE.fullmatch(move)
            target = m[3] + m[4]
            result[(ply, move)] = (
                escaped,
                {s: i for s, i in ids.items() if s != target},
            )
    return result


def contributors(item, fen, identities, red):
    attackers = checked_attackers(item, fen)
    if attackers is None:
        return None
    board = decode_position(fen)
    if any(board[s].isupper() != red for s in attackers):
        return None
    return {identities[s] for s in attackers if s in identities}


def outcome(trace, trio, record, terminal_checkers):
    contributed = {
        identity
        for identity, square in trio["pieces"].items()
        if square in terminal_checkers
    }
    positions = inspection_positions(trace, trio)
    inspections = record.get("contributions")
    if not isinstance(inspections, list):
        return None
    seen = set()
    red = fen_side(trace.terminal.fen) == "black"
    for item in inspections:
        if not isinstance(item, dict):
            return None
        ply, move = item.get("ply"), item.get("move")
        if type(ply) is not int or not isinstance(move, str):
            return None
        key = (ply, move)
        if key not in positions or key in seen:
            return None
        seen.add(key)
        fen, ids = positions[key]
        found = contributors(item, fen, ids, red)
        if found is None:
            return None
        contributed.update(found)
    if contributed == set(trio["pieces"]):
        return "key"
    return "not_key" if seen == set(positions) else None
