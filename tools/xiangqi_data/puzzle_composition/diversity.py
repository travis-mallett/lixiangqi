"""Reject reflected twins, cosmetic variants, and shared solution endings."""

import hashlib
import json

from ..puzzle_mining.position import decode_position
from .board import split_move, xy


def _canonical(values):
    return min(json.dumps(v, sort_keys=True, separators=(",", ":")) for v in values)


def fingerprints(fens, moves, checkers, tail_plies=5):
    """Normalize color, file reflection and translation of the ending sequence.

    Cannon distance and irrelevant pieces are deliberately absent from the
    checking-geometry key. A longer version of an existing puzzle cannot escape
    the suffix check by adding material elsewhere on the board.
    """
    if len(fens) != len(moves) + 1 or not moves or len(checkers) != 4:
        raise ValueError("diversity requires a complete line ending in four checks")
    terminal = decode_position(fens[-1])
    winning_red = fens[0].split()[1] == "w"
    loser = "k" if winning_red else "K"
    king = next(s for s, p in terminal.items() if p == loser)
    kx, ky = xy(king)

    def point(location, mirror):
        x, y = xy(location)
        return ((x - kx) * mirror, (y - ky) * (1 if winning_red else -1))

    def piece(p):
        return p if winning_red else p.swapcase()

    cores, endings = [], {n: [] for n in range(1, min(tail_plies, len(moves)) + 1, 2)}
    for mirror in (-1, 1):
        checking = []
        for location in checkers:
            p = piece(terminal[location])
            dx, dy = point(location, mirror)
            if p == "C":
                dx, dy = ((dx > 0) - (dx < 0)) * 2, ((dy > 0) - (dy < 0)) * 2
            checking.append((p, dx, dy))
        palace_file = (kx if mirror == 1 else 8 - kx) - 3
        palace_rank = 9 - ky if winning_red else ky
        cores.append(
            {"checkers": sorted(checking), "palace": [palace_file, palace_rank]}
        )
        tokens = []
        for f, move in zip(fens, moves):
            board = decode_position(f)
            origin, dest = split_move(move)
            tokens.append(
                (
                    piece(board[origin]),
                    point(origin, mirror),
                    point(dest, mirror),
                    piece(board[dest]) if dest in board else "",
                )
            )
        for n, variants in endings.items():
            variants.append(tokens[-n:])
    return {
        "geometry": _canonical(cores),
        "tails": {str(n): _canonical(v) for n, v in endings.items()},
        "plies": len(moves),
        "tail_plies": tail_plies,
    }


class DiversityIndex:
    def __init__(self, records=(), tail_plies=5):
        self.records = list(records)
        self.tail_plies = tail_plies

    def conflict(self, candidate):
        key = candidate["diversity"]
        for record in self.records:
            old = record["diversity"]
            if old["geometry"] == key["geometry"]:
                return "same_checking_geometry"
            n = min(self.tail_plies, old["plies"], key["plies"])
            if n % 2 == 0:
                n -= 1
            if old["tails"].get(str(n)) == key["tails"].get(str(n)):
                return "shared_ending_sequence"
        return None

    def add(self, record):
        self.records.append(record)


def puzzle_id(fen, moves):
    return hashlib.sha256((fen + "\n" + " ".join(moves)).encode()).hexdigest()[:16]
