"""Material constraints and reverse-move proposals, not a second rules engine.

Every proposed move is validated by the existing native Pikafish authority.
Coordinates are the catalog's a1..i10, not UCI's a0..i9.
"""

from collections import Counter

from ..puzzle_mining.position import (
    UI_MOVE,
    FenState,
    encode_position,
    puzzle_root_fen,
)

SQUARES = tuple(f"{f}{r}" for f in "abcdefghi" for r in range(1, 11))
LIMITS = {"k": 1, "a": 2, "b": 2, "n": 2, "r": 2, "c": 2, "p": 5}


def xy(square):
    return ord(square[0]) - 97, int(square[1:]) - 1


def square(x, y):
    return chr(97 + x) + str(y + 1)


def split_move(move):
    match = UI_MOVE.fullmatch(move)
    if not match:
        raise ValueError(f"invalid move: {move}")
    return match[1] + match[2], match[3] + match[4]


def fen(board, turn="w"):
    return encode_position(board) + f" {turn} - - 0 1"


def other_turn(value):
    fields = value.split()
    fields[1] = "b" if fields[1] == "w" else "w"
    return " ".join(fields)


def play(value, move):
    state = FenState(value)
    state.push(move)
    return puzzle_root_fen(state.fen())


def admissible(piece, location):
    x, y = xy(location)
    if not 0 <= x < 9 or not 0 <= y < 10:
        return False
    y = y if piece.isupper() else 9 - y
    kind = piece.lower()
    if kind == "k":
        return 3 <= x <= 5 and 0 <= y <= 2
    if kind == "a":
        return (x, y) in {(3, 0), (5, 0), (4, 1), (3, 2), (5, 2)}
    if kind == "b":
        return (x, y) in {(2, 0), (6, 0), (0, 2), (4, 2), (8, 2), (2, 4), (6, 4)}
    if kind == "p":
        return y >= 3 and (y >= 5 or x % 2 == 0)
    return kind in LIMITS


def valid_material(board):
    counts = Counter(board.values())
    uncrossed_files = [
        (piece, xy(loc)[0])
        for loc, piece in board.items()
        if piece in "Pp" and (xy(loc)[1] < 5 if piece == "P" else xy(loc)[1] > 4)
    ]
    return (
        counts["k"] == counts["K"] == 1
        and all(
            count <= LIMITS.get(piece.lower(), 0) for piece, count in counts.items()
        )
        and all(admissible(piece, loc) for loc, piece in board.items())
        and len(set(uncrossed_files)) == len(uncrossed_files)
    )


def can_restore(board, piece, location):
    return (
        admissible(piece, location)
        and sum(p == piece for p in board.values()) < LIMITS[piece.lower()]
    )


def reverse_geometry(piece, origin, destination, board, capture):
    """Cheap superset of possible moves; pins, legs and eyes are engine-owned."""
    if not admissible(piece, origin):
        return False
    x, y = xy(origin)
    u, v = xy(destination)
    dx, dy = u - x, v - y
    kind = piece.lower()
    if kind == "n":
        return sorted((abs(dx), abs(dy))) == [1, 2]
    if kind == "k":
        return abs(dx) + abs(dy) == 1
    if kind == "a":
        return abs(dx) == abs(dy) == 1
    if kind == "b":
        return abs(dx) == abs(dy) == 2
    if kind == "p":
        return (dx == 0 and dy == (1 if piece.isupper() else -1)) or (
            dy == 0 and abs(dx) == 1 and (y >= 5 if piece.isupper() else y <= 4)
        )
    if (dx and dy) or (not dx and not dy):
        return False
    sx, sy = (dx > 0) - (dx < 0), (dy > 0) - (dy < 0)
    blockers = sum(
        square(x + sx * i, y + sy * i) in board for i in range(1, max(abs(dx), abs(dy)))
    )
    return blockers == (1 if kind == "c" and capture else 0)
