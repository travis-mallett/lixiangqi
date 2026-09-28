"""Track individual pawns approaching a retreating enemy general."""

from .models import VerifiedTrace, fen_side
from .position import FenState, UI_MOVE, normalized_fen


def distance(a: str, b: str) -> int:
    return abs(ord(a[0]) - ord(b[0])) + abs(int(a[1:]) - int(b[1:]))


def chasing_pawns(trace: VerifiedTrace, targets: set[str]) -> set[str] | None:
    """Return qualifying terminal squares, or None for an incomplete ledger.

    Count distance changes against the general/pawn location on that same ply.
    Original squares are identities, so captures cannot transfer chase credit.
    """
    if not trace.moves or len(trace.moves) != len(trace.decisions):
        return None
    red = fen_side(trace.terminal.fen) == "black"
    try:
        state = FenState(trace.decisions[0].position_fen)
        if (state.turn == "w") != red:
            return None
        identities = {
            s: s for s, p in state.position.items() if p == ("P" if red else "p")
        }
        approaches = {identity: 0 for identity in identities}
        retreats = {identity: 0 for identity in identities}
        advances = {identity: 0 for identity in identities}
        non_approaching = set()
        pending = None
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
            general = next(
                (s for s, p in state.position.items() if p == ("k" if red else "K")),
                None,
            )
            if general is None:
                return None
            # Only the very next ply can satisfy an approach's response.
            if pending is not None and origin == general:
                identity, square = pending
                if identities.get(square) == identity and distance(
                    target, square
                ) > distance(origin, square):
                    retreats[identity] += 1
            pending = None
            if origin in identities:
                identity = identities.pop(origin)
                if distance(target, general) < distance(origin, general):
                    approaches[identity] += 1
                    if origin[0] == target[0] and int(target[1:]) - int(origin[1:]) == (
                        1 if red else -1
                    ):
                        advances[identity] += 1
                    pending = (identity, target)
                else:
                    non_approaching.add(identity)
                identities.pop(target, None)
                identities[target] = identity
            else:
                identities.pop(target, None)
            state.push(move)
        if normalized_fen(state.fen()) != normalized_fen(trace.terminal.fen):
            return None
    except (ValueError, IndexError):
        return None
    return {
        s
        for s, identity in identities.items()
        if s in targets
        and identity not in non_approaching
        and approaches[identity] >= 3
        and advances[identity] >= 2
        and retreats[identity] >= approaches[identity] - 1
    }
