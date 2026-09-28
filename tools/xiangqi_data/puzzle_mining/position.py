"""Small deterministic FEN helpers; legality remains owned by Pikafish."""

from __future__ import annotations

import hashlib
import re

from tools.xiangqi_data.pikafish_rules import START_FEN
from .models import BLACK, RED

UI_MOVE = re.compile(r"^([a-i])(10|[1-9])([a-i])(10|[1-9])$")
PUZZLE_HISTORY_POLICY = "isolated-root-v1"


def puzzle_root_fen(fen: str) -> str:
    """Start a standalone puzzle; only subsequent puzzle moves carry rules history."""
    return f"{normalized_fen(fen)} - - 0 1"


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


def candidate_key(
    fen: str, history: tuple[str, ...] = (), initial_fen: str = START_FEN
) -> str:
    """Identify the originating candidate, independently of its search context."""

    # Preserve standard-start puzzle IDs. Custom native setups include their
    # root board so distinct games cannot alias after converging moves.
    root = (
        ""
        if normalized_fen(initial_fen) == normalized_fen(START_FEN)
        else normalized_fen(initial_fen)
    )
    payload = f"{normalized_fen(fen)}\n{' '.join(history)}" + (
        f"\n{root}" if root else ""
    )
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


def general_palace_targets(origin: str, side: str) -> tuple[str, ...]:
    """One-step palace destinations, regardless of occupants or attacks."""
    if side not in (BLACK, RED):
        raise ValueError(f"unknown Xiangqi side: {side}")
    low, high = (8, 10) if side == BLACK else (1, 3)
    file, rank = ord(origin[0]), int(origin[1:])
    if not (ord("d") <= file <= ord("f") and low <= rank <= high):
        return ()
    return tuple(
        f"{chr(file + dx)}{rank + dy}"
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
        if ord("d") <= file + dx <= ord("f") and low <= rank + dy <= high
    )


def general_escape_positions(
    fen: str, side: str, *, empty_only: bool = False
) -> tuple[tuple[str, str], ...]:
    """Adjacent palace steps for attack inspection, including captures.

    Friendly occupants prevent a step. Capturing an enemy non-general removes
    it before inspecting attacks. Set the turn to the general's side so the
    engine reports its attackers, including on boards before the final move.
    Empty-only motifs exclude every occupied destination.
    """
    if side not in (BLACK, RED):
        raise ValueError(f"unknown Xiangqi side: {side}")
    position = decode_position(fen)
    general = "k" if side == BLACK else "K"
    origin = next((s for s, p in position.items() if p == general), None)
    if origin is None:
        return ()
    result = []
    for target in general_palace_targets(origin, side):
        occupant = position.get(target)
        if empty_only and occupant:
            continue
        if occupant and (
            occupant.isupper() == general.isupper() or occupant.lower() == "k"
        ):
            continue
        moved = dict(position)
        del moved[origin]
        moved[target] = general
        fields = fen.split()
        fields[0] = encode_position(moved)
        fields[1] = "b" if side == BLACK else "w"
        result.append((origin + target, " ".join(fields)))
    return tuple(result)
