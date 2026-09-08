from __future__ import annotations

import hashlib
import os
import queue
import random
import re
import subprocess
import threading
import time
from pathlib import Path

from .strength import StrengthProfile


START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"
MOVE_PATTERN = re.compile(r"^[a-i][0-9][a-i][0-9]$")
MULTIPV_PATTERN = re.compile(
    r"\bdepth (?P<depth>\d+).*?\bmultipv (?P<rank>\d+).*?\bscore (?P<kind>cp|mate) "
    r"(?P<score>-?\d+).*?\bpv (?P<move>[a-i][0-9][a-i][0-9])\b"
)
ENGINE_CLOSED = "__lixiangqi_engine_closed__"


class PikafishEngine:
    """Persistent UCI client for the one-coordinate strength policy."""

    def __init__(self, executable: Path, threads: int = 1) -> None:
        self.executable = executable
        self.threads = max(1, min(32, int(threads)))
        self.process: subprocess.Popen[str] | None = None
        self.output: queue.Queue[str] = queue.Queue()
        self.lock = threading.RLock()
        self._signature: str | None = None

    @property
    def signature(self) -> str:
        if self._signature is None:
            digest = hashlib.sha256()
            files = (self.executable, self.executable.parents[1] / "pikafish.nnue")
            for path in files:
                if not path.is_file():
                    raise FileNotFoundError(f"Pinned Pikafish component not found: {path}")
                digest.update(path.name.encode("utf-8"))
                with path.open("rb") as source:
                    while chunk := source.read(1024 * 1024):
                        digest.update(chunk)
            self._signature = digest.hexdigest()
        return self._signature

    def choose_move(
        self,
        moves: list[str],
        profile: StrengthProfile,
        rng: random.Random | None = None,
    ) -> str | None:
        with self.lock:
            self._ensure_started()
            self._send("setoption name Clear Hash")
            self._new_position(moves)
            if profile.is_bestmove:
                return self._bestmove_search(profile.nodes)

            legal = self._legal_moves_current_position()
            if not legal:
                return None
            chooser = rng or random.Random()
            self._new_position(moves)
            multi_pv = min(profile.multi_pv, len(legal))
            self._send(f"setoption name MultiPV value {multi_pv}")
            self._send("isready")
            self._read_until("readyok", 10.0)
            self._send(f"go nodes {profile.nodes}")
            deadline = time.monotonic() + max(30.0, profile.nodes / 80_000.0 + 10.0)
            candidates_by_depth: dict[int, dict[int, tuple[float, str]]] = {}
            reported_bestmove: str | None = None
            while True:
                line = self._read_line(deadline)
                match = MULTIPV_PATTERN.search(line)
                if match:
                    candidates_by_depth.setdefault(int(match["depth"]), {})[
                        int(match["rank"])
                    ] = (
                        self._score_cp(match["kind"], int(match["score"])),
                        match["move"],
                    )
                if line.startswith("bestmove "):
                    token = line.split()[1]
                    reported_bestmove = token if MOVE_PATTERN.fullmatch(token) else None
                    break
            complete = [
                values for _depth, values in sorted(candidates_by_depth.items(), reverse=True)
                if len({move for _score, move in values.values() if move in legal}) == multi_pv
            ]
            available = complete[0] if complete else max(
                candidates_by_depth.values(),
                key=lambda values: len({move for _score, move in values.values()}),
                default={},
            )
            ranked: dict[int, str] = {}
            used: set[str] = set()
            for rank, (_score, move) in sorted(available.items()):
                if move in legal and move not in used:
                    ranked[rank] = move
                    used.add(move)
            if not ranked:
                # Preserve the game if an unexpectedly shallow search omitted
                # MultiPV info; Pikafish's reported bestmove remains legal.
                return reported_bestmove
            return self._sample_adjacent_rank(ranked, profile.expected_rank, chooser)

    def _bestmove_search(self, nodes: int) -> str | None:
        self._send("setoption name MultiPV value 1")
        self._send("isready")
        self._read_until("readyok", 10.0)
        self._send(f"go nodes {nodes}")
        deadline = time.monotonic() + max(30.0, nodes / 80_000.0 + 10.0)
        while True:
            line = self._read_line(deadline)
            if line.startswith("bestmove "):
                token = line.split()[1]
                return token if MOVE_PATTERN.fullmatch(token) else None

    @staticmethod
    def _score_cp(kind: str, value: int) -> float:
        if kind == "cp":
            return float(value)
        return (1.0 if value >= 0 else -1.0) * (100_000.0 - min(999, abs(value)) * 100.0)

    @staticmethod
    def _sample_adjacent_rank(
        candidates: dict[int, str],
        expected_rank: float,
        rng: random.Random | None,
    ) -> str:
        chooser = rng or random.Random()
        lower = max(1, int(expected_rank))
        probability = max(0.0, min(1.0, expected_rank - lower))
        requested = lower + (1 if chooser.random() < probability else 0)
        ranks = sorted(candidates)
        selected = min(ranks, key=lambda rank: (abs(rank - requested), rank))
        return candidates[selected]

    def legal_moves(self, moves: list[str]) -> list[str]:
        with self.lock:
            self._ensure_started()
            self._new_position(moves)
            return self._legal_moves_current_position()

    def _new_position(self, moves: list[str]) -> None:
        command = f"position fen {START_FEN}"
        if moves:
            command += " moves " + " ".join(moves)
        self._send(command)

    def _legal_moves_current_position(self) -> list[str]:
        self._send("go perft 1")
        deadline = time.monotonic() + 10.0
        moves: list[str] = []
        while True:
            line = self._read_line(deadline)
            if line.startswith("Nodes searched:"):
                return sorted(moves)
            token, separator, _count = line.partition(":")
            if separator and MOVE_PATTERN.fullmatch(token):
                moves.append(token)

    def _ensure_started(self) -> None:
        if self.process is not None and self.process.poll() is None:
            return
        self.close()
        if not self.executable.is_file():
            raise FileNotFoundError(f"Pikafish executable not found: {self.executable}")
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
        self.output = queue.Queue()
        threading.Thread(target=self._pump, daemon=True, name="calibration-pikafish-output").start()
        self._send("uci")
        self._read_until("uciok", 10.0)
        self._send(f"setoption name Threads value {self.threads}")
        self._send("setoption name Hash value 128")
        self._send("setoption name nodestime value 0")
        self._send("isready")
        self._read_until("readyok", 10.0)

    def _pump(self) -> None:
        process = self.process
        if process is None or process.stdout is None:
            return
        for line in process.stdout:
            self.output.put(line.strip())

    def _send(self, command: str) -> None:
        if self.process is None or self.process.stdin is None or self.process.poll() is not None:
            raise RuntimeError("Pikafish stopped unexpectedly")
        self.process.stdin.write(command + "\n")
        self.process.stdin.flush()

    def _read_line(self, deadline: float) -> str:
        remaining = deadline - time.monotonic()
        if remaining <= 0.0:
            raise TimeoutError("Pikafish failed to finish within the safety deadline")
        try:
            line = self.output.get(timeout=remaining)
            if line == ENGINE_CLOSED:
                raise RuntimeError("Pikafish was stopped while a search was in progress")
            return line
        except queue.Empty as error:
            raise TimeoutError("Pikafish failed to finish within the safety deadline") from error

    def _read_until(self, expected: str, timeout: float) -> None:
        deadline = time.monotonic() + timeout
        while self._read_line(deadline) != expected:
            pass

    def close(self) -> None:
        process, self.process = self.process, None
        if process is None:
            return
        try:
            if process.poll() is None and process.stdin is not None:
                process.stdin.write("quit\n")
                process.stdin.flush()
                process.wait(timeout=2.0)
        except (OSError, subprocess.TimeoutExpired):
            process.kill()
        finally:
            self.output.put(ENGINE_CLOSED)
