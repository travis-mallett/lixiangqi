"""Small deterministic FEN helpers; legality remains owned by Pikafish."""

from __future__ import annotations

import hashlib
import re

from tools.xiangqi_data.pikafish_rules import START_FEN


UI_MOVE = re.compile(r"^([a-i])(10|[1-9])([a-i])(10|[1-9])$")


class FenState:
    """Replay already-validated catalog moves without duplicating rule logic."""

    def __init__(self, fen: str = START_FEN) -> None:
        fields = fen.split()
        self.position = decode_position(fen)
        self.turn = fields[1]
        self.halfmove = int(fields[4])
        self.fullmove = int(fields[5])

    def fen(self) -> str:
        return (
            f"{encode_position(self.position)} {self.turn} - - "
            f"{self.halfmove} {self.fullmove}"
        )

    def push(self, move: str) -> None:
        match = UI_MOVE.fullmatch(move)
        if not match:
            raise ValueError(f"invalid Xiangqi move: {move}")
        origin = f"{match[1]}{match[2]}"
        target = f"{match[3]}{match[4]}"
        piece = self.position.pop(origin, None)
        if piece is None:
            raise ValueError(f"no piece at {origin}")
        capture = target in self.position
        self.position[target] = piece
        self.halfmove = 0 if capture else self.halfmove + 1
        if self.turn == "b":
            self.fullmove += 1
        self.turn = "b" if self.turn == "w" else "w"


def replay_fens(moves: list[str], initial_fen: str = START_FEN) -> list[str]:
    state = FenState(initial_fen)
    fens = [state.fen()]
    for move in moves:
        state.push(move)
        fens.append(state.fen())
    return fens


def normalized_fen(fen: str) -> str:
    fields = fen.split()
    if len(fields) < 2:
        raise ValueError("invalid Xiangqi FEN")
    return f"{fields[0]} {fields[1]}"


def position_hash(fen: str) -> str:
    return hashlib.sha256(normalized_fen(fen).encode("utf-8")).hexdigest()


def candidate_key(fen: str, history: tuple[str, ...] = ()) -> str:
    """Identify a position together with repetition-relevant move history."""

    payload = f"{normalized_fen(fen)}\n{' '.join(history)}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def decode_position(fen: str) -> dict[str, str]:
    ranks = fen.split()[0].split("/")
    if len(ranks) != 10:
        raise ValueError("invalid Xiangqi FEN")
    position: dict[str, str] = {}
    for row, encoded in enumerate(ranks):
        file_index = 0
        for token in encoded:
            if token.isdigit():
                file_index += int(token)
            else:
                position[f"{chr(97 + file_index)}{10 - row}"] = token
                file_index += 1
        if file_index != 9:
            raise ValueError("invalid Xiangqi FEN rank")
    return position


def encode_position(position: dict[str, str]) -> str:
    ranks: list[str] = []
    for rank in range(10, 0, -1):
        encoded = ""
        empty = 0
        for file_index in range(9):
            piece = position.get(f"{chr(97 + file_index)}{rank}")
            if piece:
                if empty:
                    encoded += str(empty)
                    empty = 0
                encoded += piece
            else:
                empty += 1
        if empty:
            encoded += str(empty)
        ranks.append(encoded)
    return "/".join(ranks)
