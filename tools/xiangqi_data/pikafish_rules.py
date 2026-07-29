"""Offline Pikafish validation oracle and Xiangqi position replay."""

from __future__ import annotations

import atexit
import os
import re
import subprocess
import threading
from pathlib import Path
from typing import Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[2]
START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"
UI_MOVE = re.compile(r"^([a-i])(10|[1-9])([a-i])(10|[1-9])$")
ENGINE_MOVE = re.compile(r"^([a-i])([0-9])([a-i])([0-9])$")
PIECE_NAMES = {"r": "R", "n": "H", "b": "E", "a": "A", "k": "K", "c": "C", "p": "P"}


class PikafishUnavailable(RuntimeError):
    pass


def default_executable() -> Path:
    configured = os.environ.get("LIXIANGQI_PIKAFISH")
    if configured:
        return Path(configured).expanduser().resolve()
    platform_dir = "Windows" if os.name == "nt" else "Linux"
    executable = "pikafish-avx2.exe" if os.name == "nt" else "pikafish-avx2"
    return PROJECT_ROOT / ".tools" / "pikafish" / platform_dir / executable


def to_engine_move(move: str) -> str:
    match = UI_MOVE.fullmatch(move)
    if not match:
        raise ValueError(f"invalid Xiangqi move: {move}")
    return f"{match[1]}{int(match[2]) - 1}{match[3]}{int(match[4]) - 1}"


def to_ui_move(move: str) -> str:
    match = ENGINE_MOVE.fullmatch(move)
    if not match:
        raise ValueError(f"invalid Pikafish move: {move}")
    return f"{match[1]}{int(match[2]) + 1}{match[3]}{int(match[4]) + 1}"


class PikafishGameValidator:
    """Use the official Pikafish executable as the legality authority."""

    def __init__(self, executable: Path | None = None) -> None:
        self.executable = executable or default_executable()
        self.process: subprocess.Popen[str] | None = None
        self.lock = threading.RLock()

    def __enter__(self) -> "PikafishGameValidator":
        self.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def start(self) -> None:
        if self.process and self.process.poll() is None:
            return
        if not self.executable.is_file():
            raise PikafishUnavailable(
                f"Pikafish is not installed at {self.executable}. "
                "Run scripts/windows/Install-Pikafish.ps1."
            )
        try:
            self.process = subprocess.Popen(
                [str(self.executable)],
                cwd=str(self.executable.parents[1]),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
        except OSError as exc:
            raise PikafishUnavailable(f"Could not start Pikafish: {exc}") from exc
        self._send("uci")
        self._read_until(lambda line: line == "uciok")
        self._send("isready")
        self._read_until(lambda line: line == "readyok")

    def validate(self, moves: Iterable[str], initial_fen: str = START_FEN) -> None:
        sequence = tuple(moves)
        with self.lock:
            final_fen, _checked = self.inspect(initial_fen, sequence)
        if not final_fen:
            raise PikafishUnavailable("Pikafish did not return the validated position")
        accepted = _played_plies(initial_fen, final_fen)
        if accepted != len(sequence):
            rejected = sequence[accepted] if 0 <= accepted < len(sequence) else "unknown"
            raise ValueError(f"illegal move {rejected} at ply {accepted + 1}")

    def inspect(self, fen: str, moves: Iterable[str] = ()) -> tuple[str, bool]:
        with self.lock:
            self.start()
            encoded = " ".join(to_engine_move(move) for move in moves)
            command = f"position fen {fen}"
            if encoded:
                command += f" moves {encoded}"
            self._send(command)
            self._send("d")
            final_fen = ""
            checked = False
            while True:
                line = self._read_line()
                if line.startswith("Fen: "):
                    final_fen = line.removeprefix("Fen: ").strip()
                if line.startswith("Checkers:"):
                    checked = bool(line.removeprefix("Checkers:").strip())
                    break
            if not final_fen:
                raise PikafishUnavailable("Pikafish did not return a position")
            return final_fen, checked

    def legal_moves(self, fen: str) -> list[str]:
        with self.lock:
            self.start()
            self._send(f"position fen {fen}")
            self._send("go perft 1")
            moves: list[str] = []
            while True:
                line = self._read_line()
                if line.startswith("Nodes searched:"):
                    return moves
                token, separator, _count = line.partition(":")
                if separator and ENGINE_MOVE.fullmatch(token):
                    moves.append(to_ui_move(token))

    def perft(self, fen: str, depth: int) -> int:
        if depth < 1:
            raise ValueError("perft depth must be positive")
        with self.lock:
            self.start()
            self._send(f"position fen {fen}")
            self._send(f"go perft {depth}")
            while True:
                line = self._read_line()
                if line.startswith("Nodes searched:"):
                    return int(line.removeprefix("Nodes searched:").strip())

    def close(self) -> None:
        with self.lock:
            process, self.process = self.process, None
            if not process:
                return
            try:
                if process.poll() is None:
                    if process.stdin:
                        process.stdin.write("quit\n")
                        process.stdin.flush()
                    process.wait(timeout=2)
            except (OSError, subprocess.TimeoutExpired):
                process.kill()
                process.wait(timeout=2)
            finally:
                if process.stdin:
                    process.stdin.close()
                if process.stdout:
                    process.stdout.close()

    def _send(self, command: str) -> None:
        if not self.process or not self.process.stdin or self.process.poll() is not None:
            raise PikafishUnavailable("Pikafish stopped unexpectedly")
        self.process.stdin.write(command + "\n")
        self.process.stdin.flush()

    def _read_line(self) -> str:
        if not self.process or not self.process.stdout:
            raise PikafishUnavailable("Pikafish is not running")
        line = self.process.stdout.readline()
        if not line and self.process.poll() is not None:
            raise PikafishUnavailable("Pikafish stopped unexpectedly")
        return line.strip()

    def _read_until(self, predicate) -> str:
        while True:
            line = self._read_line()
            if predicate(line):
                return line


_SHARED_RULES = PikafishGameValidator()
atexit.register(_SHARED_RULES.close)


class PikafishBoard:
    """Board-shaped adapter backed by Pikafish legal move generation."""

    def __init__(self, variant: str, initial_fen: str = START_FEN) -> None:
        if variant != "xiangqi":
            raise ValueError(f"unsupported Pikafish variant: {variant}")
        self.fen = initial_fen
        self.ply = _absolute_ply(initial_fen)

    @property
    def color(self) -> int:
        return 0 if self.fen.split()[1] == "w" else 1

    def legal_moves(self) -> list[str]:
        return _SHARED_RULES.legal_moves(self.fen)

    def get_san(self, move: str) -> str:
        return wxf_notation(_decode_position(self.fen), move)

    def is_capture(self, move: str) -> bool:
        match = UI_MOVE.fullmatch(move)
        if not match:
            raise ValueError(f"invalid Xiangqi move: {move}")
        return f"{match[3]}{match[4]}" in _decode_position(self.fen)

    def push(self, move: str) -> None:
        final_fen, _checked = _SHARED_RULES.inspect(self.fen, (move,))
        if _played_plies(self.fen, final_fen) != 1:
            raise ValueError(f"illegal Xiangqi move at ply {self.ply + 1}: {move}")
        self.fen = final_fen
        self.ply += 1

    def is_checked(self) -> bool:
        _fen, checked = _SHARED_RULES.inspect(self.fen)
        return checked

    def is_immediate_game_end(self) -> tuple[bool, int]:
        ended = not self.legal_moves()
        return ended, 1 if ended else 0

    def is_optional_game_end(self) -> tuple[bool, int]:
        return False, 0

    def insufficient_material(self) -> tuple[bool, bool]:
        return False, False


def index_validated_line(
    moves: Iterable[str], initial_fen: str = START_FEN
) -> list[tuple[int, str, str, str]]:
    position = _decode_position(initial_fen)
    turn = initial_fen.split()[1]
    indexed: list[tuple[int, str, str, str]] = []
    for ply, move in enumerate(moves):
        indexed.append((ply, _position_key(position, turn), move, wxf_notation(position, move)))
        _apply_move(position, move)
        turn = "b" if turn == "w" else "w"
    return indexed


def wxf_notation(position: dict[str, str], move: str) -> str:
    match = UI_MOVE.fullmatch(move)
    if not match:
        raise ValueError(f"invalid Xiangqi move: {move}")
    origin = f"{match[1]}{match[2]}"
    target = f"{match[3]}{match[4]}"
    piece = position.get(origin)
    if not piece:
        raise ValueError(f"no piece at {origin}")
    red = piece.isupper()
    role = piece.lower()
    name = PIECE_NAMES.get(role)
    if not name:
        raise ValueError(f"unsupported Xiangqi piece: {piece}")
    from_file: int | str = _file_number(origin[0], red)
    same_file = sorted(
        (
            square
            for square, candidate in position.items()
            if square[0] == origin[0] and candidate == piece
        ),
        key=lambda square: int(square[1:]),
        reverse=red,
    )
    if len(same_file) == 2:
        from_file = "+" if origin == same_file[0] else "-"
    elif len(same_file) >= 3 and role == "p":
        # World Xiangqi Rules (2018): omit P, then identify a tandem Pawn by
        # its front-to-rear ordinal and the file occupied before the move.
        pawn_ordinal = same_file.index(origin) + 1
        name = str(pawn_ordinal)
    to_file = _file_number(target[0], red)
    from_rank, to_rank = int(origin[1:]), int(target[1:])
    forward = to_rank > from_rank if red else to_rank < from_rank
    if from_rank == to_rank:
        action, destination = "=", to_file
    elif role in {"n", "b", "a"}:
        action, destination = ("+" if forward else "-"), to_file
    else:
        action, destination = ("+" if forward else "-"), abs(to_rank - from_rank)
    return f"{name}{from_file}{action}{destination}"


def _played_plies(initial_fen: str, final_fen: str) -> int:
    initial = initial_fen.split()
    final = final_fen.split()
    try:
        initial_offset = 1 if initial[1] == "b" else 0
        final_offset = 1 if final[1] == "b" else 0
        return (int(final[5]) - int(initial[5])) * 2 + final_offset - initial_offset
    except (IndexError, ValueError) as exc:
        raise PikafishUnavailable("Pikafish returned a malformed FEN") from exc


def _absolute_ply(fen: str) -> int:
    fields = fen.split()
    try:
        return (max(1, int(fields[5])) - 1) * 2 + (1 if fields[1] == "b" else 0)
    except (IndexError, ValueError) as exc:
        raise ValueError("invalid Xiangqi FEN") from exc


def _decode_position(fen: str) -> dict[str, str]:
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


def _position_key(position: dict[str, str], turn: str) -> str:
    ranks: list[str] = []
    for rank in range(10, 0, -1):
        empty = 0
        encoded = ""
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
    return f"{'/'.join(ranks)} {turn}"


def _apply_move(position: dict[str, str], move: str) -> None:
    match = UI_MOVE.fullmatch(move)
    if not match:
        raise ValueError(f"invalid Xiangqi move: {move}")
    origin = f"{match[1]}{match[2]}"
    target = f"{match[3]}{match[4]}"
    try:
        position[target] = position.pop(origin)
    except KeyError as exc:
        raise ValueError(f"no piece at {origin}") from exc


def _file_number(file_name: str, red: bool) -> int:
    index = ord(file_name) - ord("a")
    return 9 - index if red else index + 1
