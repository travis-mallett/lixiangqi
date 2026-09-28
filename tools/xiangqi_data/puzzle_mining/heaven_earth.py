"""Prove the pre-move Heaven and Earth Cannons formation and its finish."""

from .attack_evidence import checked_attackers
from .engine import EngineProtocolError, IncompleteSearchError
from .models import SearchContext, VerifiedTrace, fen_side
from .final_move_mates import final_moving_piece
from .patterns import (
    HEAVEN_EARTH_THEME as THEME,
    HEAVEN_EARTH_VERSION as VERSION,
)
from .position import UI_MOVE, decode_position


def candidate(trace: VerifiedTrace) -> bool | None:
    if not trace.checkmate:
        return False
    piece = final_moving_piece(trace)
    if piece is None:
        return None
    if piece.lower() not in {"r", "p"}:
        return False
    board = decode_position(trace.decisions[-1].position_fen)
    red_wins = fen_side(trace.terminal.fen) == "black"
    back_rank = 10 if red_wins else 1
    general = "e" + str(back_rank)
    if board.get(general) != ("k" if red_wins else "K"):
        return False
    cannon = "C" if red_wins else "c"

    def screens(square):
        # Enumerate occupied intervening squares from the general outwards.
        dx = (square[0] > "e") - (square[0] < "e")
        dy = (int(square[1:]) > back_rank) - (int(square[1:]) < back_rank)
        x, y = ord("e") + dx, back_rank + dy
        occupied = []
        while chr(x) + str(y) != square:
            at = chr(x) + str(y)
            if at in board:
                occupied.append(at)
            x, y = x + dx, y + dy
        return occupied

    def enemy_pair(squares):
        return len(squares) == 2 and all(
            board[s].isupper() != red_wins for s in squares
        )

    if not any(
        p == cannon and s[0] == "e" and enemy_pair(screens(s)) for s, p in board.items()
    ):
        return False
    earth_screens = [
        screens(s)
        for s, p in board.items()
        if p == cannon and int(s[1:]) == back_rank and s[0] != "e"
    ]
    earth_screens = [s for s in earth_screens if enemy_pair(s)]
    if not earth_screens:
        return False
    parsed = UI_MOVE.fullmatch(trace.moves[-1])
    target = parsed[3] + parsed[4]
    if target == "e" + str(9 if red_wins else 2):
        return True
    return target in {"d" + str(back_rank), "f" + str(back_rank)} and any(
        s[0] == target for s in earth_screens
    )


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
    if checking is None:
        return None
    board = decode_position(trace.terminal.fen)
    if any(
        board[s].isupper() != (fen_side(trace.terminal.fen) == "black")
        for s in checking
    ):
        return None
    parsed = UI_MOVE.fullmatch(trace.moves[-1])
    target = parsed[3] + parsed[4]
    return "key" if target in checking else "not_key"


def assess(engine, trace: VerifiedTrace) -> dict:
    record = {
        "logic_version": VERSION,
        "terminal_fen": trace.terminal.fen,
        "previous_fen": trace.decisions[-1].position_fen if trace.decisions else None,
        "move": trace.moves[-1] if trace.moves else None,
        "outcome": "inconclusive",
    }
    sequence = candidate(trace)
    if sequence is not True:
        record["outcome"] = "not_key" if sequence is False else "inconclusive"
        return record
    try:
        fen, checkers = engine.checking_pieces(SearchContext(trace.terminal.fen, ()))
        record["terminal"] = {"fen": fen, "checkers": list(checkers)}
        record["outcome"] = evidence_outcome(trace, record) or "inconclusive"
    except (EngineProtocolError, IncompleteSearchError, OSError, TimeoutError) as exc:
        record["reason"] = f"inspection_failed:{type(exc).__name__}"
    return record
