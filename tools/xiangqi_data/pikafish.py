"""Persistent UCI bridge to the official Pikafish Xiangqi engine."""

from __future__ import annotations

import atexit
import os
import queue
import re
import subprocess
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Iterator

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENGINE_MOVE = re.compile(r"^([a-i])([0-9])([a-i])([0-9])$")
UI_MOVE = re.compile(r"^([a-i])(10|[1-9])([a-i])(10|[1-9])$")


def to_engine_move(move: str) -> str:
    match = UI_MOVE.fullmatch(move)
    if not match:
        raise ValueError(f"Invalid Xiangqi move: {move}")
    return f"{match[1]}{int(match[2]) - 1}{match[3]}{int(match[4]) - 1}"


def to_ui_move(move: str) -> str:
    match = ENGINE_MOVE.fullmatch(move)
    if not match:
        raise ValueError(f"Invalid Pikafish move: {move}")
    return f"{match[1]}{int(match[2]) + 1}{match[3]}{int(match[4]) + 1}"


def _default_executable() -> Path:
    configured = os.environ.get("LIXIANGQI_PIKAFISH")
    if configured:
        return Path(configured).expanduser().resolve()
    platform_dir = "Windows" if os.name == "nt" else "Linux"
    executable = "pikafish-avx2.exe" if os.name == "nt" else "pikafish-avx2"
    return PROJECT_ROOT / ".tools" / "pikafish" / platform_dir / executable


class EngineUnavailable(RuntimeError):
    pass


class Pikafish:
    def __init__(self, executable: Path | None = None) -> None:
        self.executable = executable or _default_executable()
        self.process: subprocess.Popen[str] | None = None
        self.reader: threading.Thread | None = None
        self.output: queue.Queue[str] = queue.Queue()
        self.lock = threading.Lock()
        self.name = "Pikafish"
        atexit.register(self.close)

    @property
    def installed(self) -> bool:
        return self.executable.is_file()

    def analyze(self, board, *, move_time_ms: int = 900, multi_pv: int = 3) -> dict[str, Any]:
        latest: dict[str, Any] | None = None
        for latest in self.analyze_stream(
            board, move_time_ms=move_time_ms, multi_pv=multi_pv
        ):
            pass
        if latest is None:
            raise RuntimeError("Pikafish returned no analysis lines")
        return latest

    def analyze_stream(
        self, board, *, move_time_ms: int = 900, multi_pv: int = 3
    ) -> Iterator[dict[str, Any]]:
        """Render native engine snapshots for the offline board consumer."""
        for snapshot in self.search_stream(
            initial_fen=board.fen, moves=[], search={"movetime": max(100, min(move_time_ms, 5000))},
            multi_pv=max(1, min(multi_pv, 5)),
        ):
            yield self._snapshot(board, {line["multipv"]: line for line in snapshot["lines"]},
                                 multi_pv=multi_pv, best_move=snapshot["bestMove"])

    def search_stream(
        self, *, initial_fen: str, moves: list[str], search: dict[str, int],
        multi_pv: int = 1, threads: int = 1, hash_mb: int = 128,
        legal_moves: list[str] | None = None,
    ) -> Iterator[dict[str, Any]]:
        """Yield a coherent MultiPV snapshot after every completed depth."""
        if len(search) != 1 or next(iter(search)) not in {"movetime", "depth", "nodes"}:
            raise ValueError("Exactly one native engine search limit is required")
        if not all(isinstance(n, int) and n > 0 for n in search.values()):
            raise ValueError("Engine search limits must be positive integers")
        if not 1 <= multi_pv <= 10 or not 1 <= threads <= 65536 or not 1 <= hash_mb <= 1048576:
            raise ValueError("Invalid engine resources")
        if any(char in initial_fen for char in "\r\n") or len(initial_fen.split()) != 6:
            raise ValueError("Invalid engine position")
        history = " ".join(to_engine_move(move) for move in moves)
        restricted = "" if legal_moves is None else " searchmoves " + " ".join(to_engine_move(move) for move in legal_moves)
        if legal_moves is not None:
            if not legal_moves:
                raise ValueError("Cannot search a terminal position")
            multi_pv = min(multi_pv, len(legal_moves))
        red_to_move = (initial_fen.split()[1] == "w") == (len(moves) % 2 == 0)
        score_context = SimpleNamespace(color=0 if red_to_move else 1)
        with self.lock:
            self._ensure_started()
            self._send(f"setoption name Threads value {threads}")
            self._send(f"setoption name Hash value {hash_mb}")
            self._send(f"setoption name MultiPV value {multi_pv}")
            self._send("isready")
            self._read_until("readyok", timeout=5)
            self._send(f"position fen {initial_fen}" + (f" moves {history}" if history else ""))
            self._send("go " + " ".join(f"{key} {value}" for key, value in search.items()) + restricted)

            lines: dict[int, dict[str, Any]] = {}
            last_complete_lines: dict[int, dict[str, Any]] = {}
            best_move: str | None = None
            primary_depth = -1
            completed = False
            deadline = time.monotonic() + (search["movetime"] / 1000 + 10 if "movetime" in search else 1200)
            def snapshot(lines, best_move=None):
                ordered = [lines[key] for key in sorted(lines)]
                primary = ordered[0]
                return {"engine": self.name, "bestMove": best_move, "depth": primary["depth"],
                        "timeMs": primary["timeMs"], "nodes": primary["nodes"], "lines": ordered}
            try:
                while True:
                    raw = self._read_line(deadline)
                    if raw.startswith("info "):
                        parsed = self._parse_info(raw, score_context)
                        if not parsed or not parsed["pvMoves"]:
                            continue
                        if parsed["score"].get("bound"):
                            continue
                        pv_index = parsed["multipv"]
                        depth = parsed["depth"]
                        if pv_index == 1:
                            if depth < primary_depth:
                                continue
                            if depth > primary_depth:
                                primary_depth = depth
                                lines = {}
                        if depth != primary_depth or pv_index > multi_pv:
                            continue
                        lines[pv_index] = parsed
                        if pv_index == multi_pv and all(
                            index in lines for index in range(1, multi_pv + 1)
                        ):
                            last_complete_lines = {
                                index: dict(line) for index, line in lines.items()
                            }
                            yield snapshot(lines)
                    elif raw.startswith("bestmove "):
                        token = raw.split()[1]
                        if token not in {"(none)", "0000"}:
                            best_move = to_ui_move(token)
                        completed = True
                        break

                if not lines:
                    raise RuntimeError("Pikafish returned no analysis lines")
                final_lines = (
                    lines
                    if all(index in lines for index in range(1, multi_pv + 1))
                    else last_complete_lines or lines
                )
                yield snapshot(final_lines, best_move)
            finally:
                if not completed:
                    self._stop_and_drain()

    def _snapshot(
        self,
        board,
        lines: dict[int, dict[str, Any]],
        *,
        multi_pv: int,
        best_move: str | None = None,
    ) -> dict[str, Any]:
        ordered: list[dict[str, Any]] = []
        for key in sorted(lines):
            if key > multi_pv:
                continue
            line = dict(lines[key])
            # Full WXF conversion is comparatively expensive. The first move
            # of every MultiPV line provides the live recommendations; retain
            # each complete PV in the final snapshot once search has stopped.
            pv_moves = line["pvMoves"] if best_move is not None else line["pvMoves"][:1]
            if best_move is None:
                # get_san does not play the move and avoids constructing a new
                # rules board for each live one-move recommendation.
                wxf_moves = [board.get_san(pv_moves[0])]
            else:
                from .engine import line_notation

                wxf_moves = line_notation(board, pv_moves)
            line["pvMoves"] = pv_moves[: len(wxf_moves)]
            line["wxfMoves"] = wxf_moves
            ordered.append(line)
        primary = ordered[0]
        return {
            "engine": self.name,
            "bestMove": best_move,
            "depth": primary.get("depth", 0),
            "seldepth": primary.get("seldepth", 0),
            "timeMs": primary.get("timeMs", 0),
            "nodes": primary.get("nodes", 0),
            "nps": primary.get("nps", 0),
            "score": primary.get("score", {}),
            "lines": ordered,
        }

    def _stop_and_drain(self) -> None:
        """Leave the persistent process ready when a streaming client disconnects."""
        try:
            self._send("stop")
            deadline = time.monotonic() + 2
            while not self._read_line(deadline).startswith("bestmove "):
                pass
        except (EngineUnavailable, TimeoutError):
            self.close()

    def _parse_info(self, raw: str, board) -> dict[str, Any] | None:
        tokens = raw.split()
        if "pv" not in tokens or "score" not in tokens:
            return None

        def number_after(name: str, default: int = 0) -> int:
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

        pv_index = tokens.index("pv")
        ui_moves = [to_ui_move(move) for move in tokens[pv_index + 1 :]]
        # UCI scores are relative to the side to move. The browser bar is
        # always Red-relative, independent of whose turn it is.
        red_value = score_value if board.color == 0 else -score_value
        score: dict[str, Any] = {score_kind: score_value, f"red{score_kind.title()}": red_value}
        if "lowerbound" in tokens:
            score["bound"] = "lower"
        elif "upperbound" in tokens:
            score["bound"] = "upper"
        if "wdl" in tokens:
            wdl_index = tokens.index("wdl")
            try:
                score["wdl"] = [int(value) for value in tokens[wdl_index + 1 : wdl_index + 4]]
            except ValueError:
                pass
        return {
            "multipv": number_after("multipv", 1),
            "depth": number_after("depth"),
            "seldepth": number_after("seldepth"),
            "timeMs": number_after("time"),
            "nodes": number_after("nodes"),
            "nps": number_after("nps"),
            "score": score,
            "pvMoves": ui_moves,
        }

    def _ensure_started(self) -> None:
        if self.process and self.process.poll() is None:
            return
        self.close()
        if not self.installed:
            raise EngineUnavailable(
                f"Pikafish is not installed at {self.executable}. Run scripts/windows/Install-Pikafish.ps1."
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
            raise EngineUnavailable(f"Could not start Pikafish: {exc}") from exc
        self.reader = threading.Thread(target=self._pump_output, daemon=True, name="pikafish-output")
        self.reader.start()
        self._send("uci")
        deadline = time.monotonic() + 8
        while True:
            line = self._read_line(deadline)
            if line.startswith("id name "):
                self.name = line.removeprefix("id name ").strip()
            if line == "uciok":
                break
        threads = max(1, min(4, os.cpu_count() or 1))
        self._send(f"setoption name Threads value {threads}")
        self._send("setoption name Hash value 128")
        self._send("setoption name UCI_ShowWDL value true")

    def _pump_output(self) -> None:
        process = self.process
        if not process or not process.stdout:
            return
        for line in process.stdout:
            self.output.put(line.strip())

    def _send(self, command: str) -> None:
        if not self.process or not self.process.stdin or self.process.poll() is not None:
            raise EngineUnavailable("Pikafish stopped unexpectedly")
        self.process.stdin.write(command + "\n")
        self.process.stdin.flush()

    def _read_line(self, deadline: float) -> str:
        # Snapshot notation may take long enough for the search to finish in
        # the background. Always consume already-pumped output before applying
        # the no-output timeout.
        try:
            return self.output.get_nowait()
        except queue.Empty:
            pass
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            self.close()
            raise TimeoutError("Pikafish analysis timed out")
        try:
            return self.output.get(timeout=remaining)
        except queue.Empty as exc:
            self.close()
            raise TimeoutError("Pikafish analysis timed out") from exc

    def _read_until(self, expected: str, *, timeout: float) -> None:
        deadline = time.monotonic() + timeout
        while self._read_line(deadline) != expected:
            pass

    def close(self) -> None:
        process, self.process = self.process, None
        if process and process.poll() is None:
            try:
                if process.stdin:
                    process.stdin.write("quit\n")
                    process.stdin.flush()
                process.wait(timeout=1)
            except (OSError, subprocess.TimeoutExpired):
                process.kill()
                process.wait(timeout=5)
        if self.reader and self.reader is not threading.current_thread():
            self.reader.join(timeout=5)
            self.reader = None
        if process:
            for stream in (process.stdin, process.stdout):
                if stream:
                    stream.close()
        while not self.output.empty():
            try:
                self.output.get_nowait()
            except queue.Empty:
                break
