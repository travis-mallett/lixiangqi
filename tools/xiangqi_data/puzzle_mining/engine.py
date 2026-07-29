"""Synchronous, history-aware Pikafish client for offline puzzle workers."""

from __future__ import annotations

import os
import queue
import re
import subprocess
import threading
import time
from pathlib import Path
from typing import Iterable, Protocol

from tools.xiangqi_data.pikafish import to_engine_move, to_ui_move

from .models import EngineScore, PositionStatus, SearchContext, SearchLine, SearchResult


ENGINE_MOVE = re.compile(r"^[a-i][0-9][a-i][0-9]$")


class PuzzleEngine(Protocol):
    engine_version: str
    nnue: str

    def analyse(
        self, context: SearchContext, *, nodes: int, multi_pv: int
    ) -> SearchResult: ...

    def inspect(self, context: SearchContext) -> PositionStatus: ...

    def close(self) -> None: ...


class OfflinePikafish:
    """One persistent UCI process, owned by one worker process."""

    def __init__(self, executable: Path, *, threads: int = 1, hash_mb: int = 64) -> None:
        self.executable = executable
        self.threads = threads
        self.hash_mb = hash_mb
        self.process: subprocess.Popen[str] | None = None
        self.output: queue.Queue[str] = queue.Queue()
        self.engine_version = "Pikafish"
        self.nnue = "unknown"

    def start(self) -> None:
        if self.process and self.process.poll() is None:
            return
        if not self.executable.is_file():
            raise FileNotFoundError(f"Pikafish is not installed at {self.executable}")
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
        threading.Thread(
            target=self._pump, daemon=True, name="puzzle-pikafish-output"
        ).start()
        self._send("uci")
        deadline = time.monotonic() + 10
        while True:
            line = self._read_until(deadline)
            if line.startswith("id name "):
                self.engine_version = line.removeprefix("id name ").strip()
            elif line.startswith("option name EvalFile ") and " default " in line:
                self.nnue = line.split(" default ", 1)[1].strip()
            elif line == "uciok":
                break
        self._send(f"setoption name Threads value {self.threads}")
        self._send(f"setoption name Hash value {self.hash_mb}")
        self._send("setoption name UCI_ShowWDL value true")
        self._ready()

    def analyse(
        self, context: SearchContext, *, nodes: int, multi_pv: int
    ) -> SearchResult:
        self.start()
        self._send(f"setoption name MultiPV value {multi_pv}")
        self._ready()
        self._position(context)
        self._send(f"go nodes {nodes}")
        latest: dict[int, SearchLine] = {}
        completed: dict[int, SearchLine] = {}
        primary_depth = -1
        best_move: str | None = None
        timeout = max(30.0, min(900.0, nodes / 15_000.0 + 30.0))
        deadline = time.monotonic() + timeout
        while True:
            raw = self._read_until(deadline)
            if raw.startswith("info "):
                parsed = parse_info(raw)
                if parsed is None or parsed.multipv > multi_pv or not parsed.moves:
                    continue
                if parsed.multipv == 1 and parsed.depth > primary_depth:
                    if latest:
                        completed = latest
                    latest = {}
                    primary_depth = parsed.depth
                if parsed.depth == primary_depth:
                    latest[parsed.multipv] = parsed
            elif raw.startswith("bestmove "):
                token = raw.split()[1]
                if token not in {"(none)", "0000"}:
                    best_move = to_ui_move(token)
                break
        complete_latest = all(index in latest for index in range(1, multi_pv + 1))
        complete_previous = all(
            index in completed for index in range(1, multi_pv + 1)
        )
        chosen = (
            latest
            if complete_latest
            else completed
            if complete_previous
            else latest
            if 1 in latest
            else completed
        )
        return SearchResult(
            engine_version=self.engine_version,
            nnue=self.nnue,
            best_move=best_move,
            lines=tuple(chosen[index] for index in sorted(chosen)),
        )

    def inspect(self, context: SearchContext) -> PositionStatus:
        """Return Pikafish's normalized FEN, check state, and legal moves.

        The complete source prefix plus synthetic solution is sent in one
        ``position`` command. This preserves the engine's repetition and
        long-check history instead of reconstructing from a bare candidate FEN.
        """

        self.start()
        self._position(context)
        self._send("d")
        final_fen = ""
        checked = False
        deadline = time.monotonic() + 10
        while True:
            line = self._read_until(deadline)
            if line.startswith("Fen: "):
                final_fen = line.removeprefix("Fen: ").strip()
            elif line.startswith("Checkers:"):
                checked = bool(line.removeprefix("Checkers:").strip())
                break
        if not final_fen:
            raise RuntimeError("Pikafish did not return a FEN")
        self._send("go perft 1")
        legal: list[str] = []
        while True:
            line = self._read_until(time.monotonic() + 10)
            if line.startswith("Nodes searched:"):
                break
            token, separator, _count = line.partition(":")
            if separator and ENGINE_MOVE.fullmatch(token):
                legal.append(to_ui_move(token))
        return PositionStatus(final_fen, checked, tuple(sorted(legal)))

    def close(self) -> None:
        process, self.process = self.process, None
        if process and process.poll() is None:
            try:
                if process.stdin:
                    process.stdin.write("quit\n")
                    process.stdin.flush()
                process.wait(timeout=2)
            except (OSError, subprocess.TimeoutExpired):
                process.kill()
        while not self.output.empty():
            try:
                self.output.get_nowait()
            except queue.Empty:
                break

    def _position(self, context: SearchContext) -> None:
        encoded = " ".join(to_engine_move(move) for move in context.moves)
        command = f"position fen {context.initial_fen}"
        self._send(f"{command} moves {encoded}" if encoded else command)

    def _ready(self) -> None:
        self._send("isready")
        deadline = time.monotonic() + 10
        while self._read_until(deadline) != "readyok":
            pass

    def _pump(self) -> None:
        process = self.process
        if not process or not process.stdout:
            return
        for line in process.stdout:
            self.output.put(line.strip())

    def _send(self, command: str) -> None:
        if not self.process or not self.process.stdin or self.process.poll() is not None:
            raise RuntimeError("Pikafish stopped unexpectedly")
        self.process.stdin.write(command + "\n")
        self.process.stdin.flush()

    def _read_until(self, deadline: float) -> str:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Pikafish timed out")
        try:
            return self.output.get(timeout=remaining)
        except queue.Empty as exc:
            raise TimeoutError("Pikafish timed out") from exc


def parse_info(raw: str) -> SearchLine | None:
    tokens = raw.split()
    if "score" not in tokens or "pv" not in tokens:
        return None

    def integer_after(name: str, default: int = 0) -> int:
        try:
            return int(tokens[tokens.index(name) + 1])
        except (ValueError, IndexError):
            return default

    score_index = tokens.index("score")
    try:
        score_kind = tokens[score_index + 1]
        score_value = int(tokens[score_index + 2])
    except (IndexError, ValueError):
        return None
    if score_kind not in {"cp", "mate"}:
        return None
    wdl: tuple[int, int, int] | None = None
    if "wdl" in tokens:
        index = tokens.index("wdl")
        try:
            wdl = (
                int(tokens[index + 1]),
                int(tokens[index + 2]),
                int(tokens[index + 3]),
            )
        except (IndexError, ValueError):
            pass
    bound = (
        "lower"
        if "lowerbound" in tokens
        else "upper"
        if "upperbound" in tokens
        else None
    )
    pv_index = tokens.index("pv")
    moves: list[str] = []
    for token in tokens[pv_index + 1 :]:
        if not ENGINE_MOVE.fullmatch(token):
            break
        moves.append(to_ui_move(token))
    return SearchLine(
        multipv=integer_after("multipv", 1),
        depth=integer_after("depth"),
        seldepth=integer_after("seldepth"),
        nodes=integer_after("nodes"),
        time_ms=integer_after("time"),
        score=EngineScore(score_kind, score_value, wdl, bound),
        moves=tuple(moves),
    )
