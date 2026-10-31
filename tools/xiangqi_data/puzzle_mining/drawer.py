"""A chariot mates after repeated checked general retreats/advances, with cannon support."""

from .attack_evidence import checked_attackers
from .engine import EngineProtocolError, IncompleteSearchError
from .models import SearchContext, fen_side
from .patterns import DRAWER_THEME as THEME, DRAWER_VERSION as VERSION
from .position import (
    FenState,
    UI_MOVE,
    normalized_fen,
    decode_position,
    general_escape_positions,
)


def sequence(trace):
    if not trace.checkmate:
        return False
    if not trace.moves or len(trace.moves) != len(trace.decisions):
        return None
    red = fen_side(trace.terminal.fen) == "black"
    general = "k" if red else "K"
    replies = []
    try:
        state = FenState(trace.decisions[0].position_fen)
        ids = {s: s for s in state.position}
        if (state.turn == "w") != red:
            return None
        for index, (move, decision) in enumerate(zip(trace.moves, trace.decisions)):
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
            if (
                piece == general
                and origin[0] == target[0]
                and abs(int(origin[1:]) - int(target[1:])) == 1
            ):
                replies.append(
                    {
                        "index": index,
                        "fen": decision.position_fen,
                        "ids": dict(ids),
                        "direction": int(target[1:]) - int(origin[1:]),
                    }
                )
            moving = ids.pop(origin)
            ids.pop(target, None)
            ids[target] = moving
            state.push(move)
        if normalized_fen(state.fen()) != normalized_fen(trace.terminal.fen):
            return None
    except (ValueError, IndexError, KeyError):
        return None
    # The last three defender turns must all be vertical general replies,
    # immediately followed by the mating move. Earlier replies cannot fill gaps.
    required = set(range(len(trace.moves) - 6, len(trace.moves) - 1, 2))
    replies = [reply for reply in replies if reply["index"] in required]
    rook, cannon = ("R", "C") if red else ("r", "c")
    if (
        len(replies) < 3
        or any(
            previous["direction"] == following["direction"]
            for previous, following in zip(replies, replies[1:])
        )
        or rook not in state.position.values()
        or cannon not in state.position.values()
    ):
        return False
    return {"replies": replies, "ids": ids}


def candidate(trace):
    result = sequence(trace)
    return None if result is None else bool(result)


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
    seq = sequence(trace)
    if not seq:
        return None if seq is None else "not_key"
    red = fen_side(trace.terminal.fen) == "black"
    rook, cannon = ("R", "C") if red else ("r", "c")
    board = decode_position(trace.terminal.fen)
    checking = checked_attackers(record.get("terminal"), trace.terminal.fen)
    if checking is None:
        return None
    finishers = {seq["ids"][s] for s in checking if board[s] == rook}
    expected = general_escape_positions(
        trace.terminal.fen, fen_side(trace.terminal.fen), empty_only=True
    )
    escapes = record.get("escapes")
    if not isinstance(escapes, list) or len(escapes) != len(expected):
        return None
    blocked = False
    for (move, fen), proof in zip(expected, escapes):
        if not isinstance(proof, dict) or proof.get("move") != move:
            return None
        attackers = checked_attackers(proof, fen)
        if attackers is None:
            return None
        blocked |= any(board.get(s) == cannon for s in attackers)
    proofs = record.get("replies")
    if not isinstance(proofs, list) or len(proofs) != len(seq["replies"]):
        return None
    counts = {identity: 0 for identity in finishers}
    for reply, proof in zip(seq["replies"], proofs):
        if not isinstance(proof, dict) or proof.get("index") != reply["index"]:
            return None
        attackers = checked_attackers(proof, reply["fen"])
        if attackers is None:
            return None
        previous = decode_position(reply["fen"])
        cannon_check = any(previous[s] == cannon for s in attackers)
        for identity in counts:
            counts[identity] += cannon_check or any(
                previous[s] == rook and reply["ids"][s] == identity for s in attackers
            )
    return (
        "key" if blocked and any(count >= 3 for count in counts.values()) else "not_key"
    )


def assess(engine, trace):
    record = {**stamp(trace), "outcome": "inconclusive", "escapes": [], "replies": []}
    seq = sequence(trace)
    if not seq:
        record["outcome"] = "inconclusive" if seq is None else "not_key"
        return record
    try:
        fen, checkers = engine.checking_pieces(SearchContext(trace.terminal.fen, ()))
        record["terminal"] = {"fen": fen, "checkers": list(checkers)}
        for move, target in general_escape_positions(
            trace.terminal.fen, fen_side(trace.terminal.fen), empty_only=True
        ):
            fen, checkers = engine.checking_pieces(SearchContext(target, ()))
            record["escapes"].append(
                {"move": move, "fen": fen, "checkers": list(checkers)}
            )
        for reply in seq["replies"]:
            fen, checkers = engine.checking_pieces(SearchContext(reply["fen"], ()))
            record["replies"].append(
                {"index": reply["index"], "fen": fen, "checkers": list(checkers)}
            )
        record["outcome"] = evidence_outcome(trace, record) or "inconclusive"
    except (EngineProtocolError, IncompleteSearchError, OSError, TimeoutError) as exc:
        record["reason"] = f"inspection_failed:{type(exc).__name__}"
    return record
