"""Versioned Kids preferences, applied only to similarly evaluated legal moves.

The server owns the profile. This module never decides legality or changes the
strength budget. Its board reconstruction is solely for recognizing piece roles.
"""
from __future__ import annotations

import random
import re

from .selection import Candidate

STYLES = {
    "sun-sun": "defense", "qing-tuan": "gentle", "xiao-lan": "chariot",
    "yan-yan": "horse", "ying-ying": "cannon", "dong-dong": "gentle",
    "si-si": "defense", "ling-ling": "defense", "mo-mo": "defense",
    "suan-suan": "capture", "cai-cai": "capture", "wa-wa": "defense",
    "jian-jian": "chariot", "kou-kou": "gentle", "sang-sang": "gentle",
    "he-he": "cannon", "dou-dou": "gentle", "hu-hu": "chariot",
    "dan-dan": "chariot", "jin-jin": "horse", "tuan-tuan": "defense",
    "zhuang-zhuang": "defense", "xiao-he": "capture", "a-chuan": "horse",
    "ning-ning": "defense", "teacher-lin": "defense",
}


def valid_profile(key: str) -> bool:
    return isinstance(key, str) and key.startswith("v1/") and key[3:] in STYLES


def board_after(fen: str, moves: tuple[str, ...]) -> dict[tuple[str, int], str]:
    board = {}
    for row, contents in enumerate(fen.split()[0].split("/")):
        file = 0
        for piece in contents:
            if piece.isdigit():
                file += int(piece)
            else:
                board[chr(97 + file), 9 - row] = piece.lower()
                file += 1
    for move in moves:
        a, b, c, d = re.fullmatch(r"([a-i])(10|[1-9])([a-i])(10|[1-9])", move).groups()
        piece = board.pop((a, int(b) - 1), None)
        board.pop((c, int(d) - 1), None)
        if piece:
            board[c, int(d) - 1] = piece
    return board


def preference(key: str, move: str, board: dict) -> int:
    style = STYLES[key[3:]]
    role = board.get((move[0], int(move[1])))
    capture = (move[2], int(move[3])) in board
    if style == "capture":
        return int(capture)
    if style == "gentle":
        return int(not capture and role in {"p", "n", "h"})
    return int(role in {
        "defense": {"a", "b", "e", "k"}, "chariot": {"r"},
        "horse": {"n", "h"}, "cannon": {"c"},
    }[style])


def prefer_candidate(key: str, fen: str, moves: tuple[str, ...],
                     candidates: dict[int, Candidate], selected: str,
                     rng: random.Random, max_loss: int = 25) -> str:
    baseline = next((c for c in candidates.values() if c.move == selected), None)
    # Never trade away an engine-proven result or compare mate and cp scores.
    if baseline is None or baseline.kind != "cp":
        return selected
    best = max(c.score for c in candidates.values() if c.kind == "cp")
    close = [c for c in candidates.values()
             if c.kind == "cp" and abs(c.score - baseline.score) <= 25
             and best - c.score <= max_loss]
    board = board_after(fen, moves)
    scored = [(preference(key, c.move, board), c.move) for c in close]
    if not scored:
        return selected
    best = max(score for score, _ in scored)
    return rng.choice([move for score, move in scored if score == best])
