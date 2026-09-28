"""Generate predecessors and repair general escapes by adding legal defenders."""

from dataclasses import dataclass

from ..puzzle_mining.engine import check_deadline
from ..puzzle_mining.position import decode_position
from .board import (
    SQUARES,
    can_restore,
    fen,
    other_turn,
    play,
    reverse_geometry,
    split_move,
    valid_material,
)


@dataclass(frozen=True)
class Predecessor:
    fen: str
    move: str
    restored: str


def predecessors(current, side, oracle, rng):
    board = decode_position(current)
    captured = "PRCNBA" if side == "b" else "prcnba"
    direct = set(oracle.checkers(current)) if side == "w" else set()
    pieces = [(s, p) for s, p in board.items() if p.isupper() == (side == "w")]
    rng.shuffle(pieces)
    pieces.sort(key=lambda item: (item[0] not in direct, item[1].lower() != "k"))
    empty = [s for s in SQUARES if s not in board]
    rng.shuffle(empty)
    for destination, piece in pieces:
        for origin in empty:
            for restored in ("", *captured):
                if restored and not can_restore(board, restored, destination):
                    continue
                if not reverse_geometry(
                    piece, origin, destination, board, bool(restored)
                ):
                    continue
                check_deadline(oracle.engine)
                proposed = dict(board)
                del proposed[destination]
                proposed[origin] = piece
                if restored:
                    proposed[destination] = restored
                if not valid_material(proposed):
                    continue
                before = fen(proposed, side)
                if oracle.checkers(other_turn(before)):
                    continue
                move = origin + destination
                if move in oracle.status(before).legal_moves:
                    yield Predecessor(before, move, restored)


def add_static(fen_value, moves, additions):
    """An added defender must occupy a free square throughout the existing line."""
    current = fen_value
    for index in range(len(moves) + 1):
        if any(s in decode_position(current) for s in additions):
            return None
        if index < len(moves):
            current = play(current, moves[index])
    board = decode_position(fen_value)
    board.update(additions)
    return fen(board, fen_value.split()[1]) if valid_material(board) else None


def repair_escapes(current, continuation, oracle, rng, max_added=2):
    """Keep one specified reply, or no reply for an endpoint.

    Search legal friendly blockers on unwanted general destinations. Other
    defenses are rejected, never assumed away. This intentionally searches a
    useful subset of all possible repairs; acceptance remains engine-owned.
    """
    expected = continuation[0] if continuation else None
    seen = set()

    def visit(additions):
        check_deadline(oracle.engine)
        modified = add_static(current, continuation, additions)
        if modified is None or modified in seen:
            return
        seen.add(modified)
        if not oracle.legal_root(modified):
            return
        status = oracle.status(modified)
        if not status.checked or (expected and expected not in status.legal_moves):
            return
        unwanted = [m for m in status.legal_moves if m != expected]
        if not unwanted:
            if oracle.follows(modified, continuation):
                yield modified, additions
            return
        if len(additions) >= max_added:
            return
        board = decode_position(modified)
        # A blocker can close an empty king destination, not a capture square.
        options = []
        for move in unwanted:
            origin, dest = split_move(move)
            if board[origin] == "k" and dest not in board:
                options.append(dest)
            else:
                return
        dest = min(options)
        pieces = list("anrcbp")
        rng.shuffle(pieces)
        for piece in pieces:
            if can_restore(board, piece, dest):
                yield from visit({**additions, dest: piece})

    yield from visit({})
