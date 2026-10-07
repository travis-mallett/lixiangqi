"""A late horizontal general move pins a defender or exclusively bars an escape."""

from .attack_evidence import checked_attackers
from .engine import EngineProtocolError, IncompleteSearchError
from .models import SearchContext, fen_side
from .patterns import ASSISTING_KING_THEME as THEME, ASSISTING_KING_VERSION as VERSION
from .position import FenState, UI_MOVE, general_escape_positions, normalized_fen


def screens(board, origin, target):
    low, high = sorted((int(origin[1:]), int(target[1:])))
    return [
        f"{origin[0]}{rank}"
        for rank in range(low + 1, high)
        if f"{origin[0]}{rank}" in board
    ]


def witnesses(trace):
    if not trace.terminal_win:
        return []
    if not trace.moves or len(trace.moves) != len(trace.decisions):
        return None
    losing = fen_side(trace.terminal.fen)
    red = losing == "black"
    general = "K" if red else "k"
    result = []
    try:
        state = FenState(trace.decisions[0].position_fen)
        winning_moves = []
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
            if piece.isupper() == red:
                winning_moves.append(index)
            state.push(move)
            if (
                piece != general
                or origin[1:] != target[1:]
                or abs(ord(origin[0]) - ord(target[0])) != 1
            ):
                continue
            board = state.position
            enemy = next((s for s, p in board.items() if p == general.swapcase()), None)
            if enemy is None:
                return None
            blockers = screens(board, target, enemy) if target[0] == enemy[0] else []
            pin = len(blockers) == 1 and board[blockers[0]].isupper() != red
            escapes = []
            for escape, fen in general_escape_positions(
                state.fen(), losing, empty_only=True
            ):
                parsed_escape = UI_MOVE.fullmatch(escape)
                destination = parsed_escape[3] + parsed_escape[4]
                if destination[0] == target[0] and not screens(
                    board, target, destination
                ):
                    escapes.append((escape, fen))
            if pin or escapes:
                result.append(
                    {"index": index, "general": target, "pin": pin, "escapes": escapes}
                )
        if normalized_fen(state.fen()) != normalized_fen(trace.terminal.fen):
            return None
        recent = set(winning_moves[-3:])
        return [w for w in result if w["index"] in recent]
    except (ValueError, IndexError):
        return None


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
    proofs = record.get("witnesses")
    if not isinstance(proofs, list) or len(proofs) != len(found):
        return None
    matched = False
    for witness, proof in zip(found, proofs):
        if not isinstance(proof, dict) or proof.get("index") != witness["index"]:
            return None
        inspections = proof.get("escapes")
        if not isinstance(inspections, list) or len(inspections) != len(
            witness["escapes"]
        ):
            return None
        matched |= witness["pin"]
        for (move, fen), inspection in zip(witness["escapes"], inspections):
            if not isinstance(inspection, dict) or inspection.get("move") != move:
                return None
            attackers = checked_attackers(inspection, fen)
            if attackers is None:
                return None
            matched |= attackers == {witness["general"]}
    return "key" if matched else "not_key"


def assess(engine, trace):
    record = {**stamp(trace), "outcome": "inconclusive", "witnesses": []}
    found = witnesses(trace)
    if not found:
        record["outcome"] = "inconclusive" if found is None else "not_key"
        return record
    try:
        for witness in found:
            proof = {"index": witness["index"], "escapes": []}
            for move, fen in witness["escapes"]:
                inspected, checkers = engine.checking_pieces(SearchContext(fen, ()))
                proof["escapes"].append(
                    {"move": move, "fen": inspected, "checkers": list(checkers)}
                )
            record["witnesses"].append(proof)
        record["outcome"] = evidence_outcome(trace, record) or "inconclusive"
    except (EngineProtocolError, IncompleteSearchError, OSError, TimeoutError) as exc:
        record["reason"] = f"inspection_failed:{type(exc).__name__}"
    return record
