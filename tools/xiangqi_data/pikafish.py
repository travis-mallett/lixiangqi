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
from typing import Any, Iterator

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENGINE_MOVE = re.compile(r"^([a-i])([0-9])([a-i])([0-9])([a-z]?)$")
UI_MOVE = re.compile(r"^([a-i])(10|[1-9])([a-i])(10|[1-9])([a-z]?)$")


def to_engine_move(move: str) -> str:
    match = UI_MOVE.fullmatch(move)
    if not match:
        raise ValueError(f"Invalid Xiangqi move: {move}")
    return f"{match[1]}{int(match[2]) - 1}{match[3]}{int(match[4]) - 1}{match[5]}"


def to_ui_move(move: str) -> str:
    match = ENGINE_MOVE.fullmatch(move)
    if not match:
        raise ValueError(f"Invalid Pikafish move: {move}")
    return f"{match[1]}{int(match[2]) + 1}{match[3]}{int(match[4]) + 1}{match[5]}"


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
        """Yield a coherent MultiPV snapshot after every completed depth."""
        move_time_ms = max(100, min(move_time_ms, 5000))
        multi_pv = max(1, min(multi_pv, 5))
        with self.lock:
            self._ensure_started()
            self._send(f"setoption name MultiPV value {multi_pv}")
            self._send("isready")
            self._read_until("readyok", timeout=5)
            self._send(f"position fen {board.fen}")
            self._send(f"go movetime {move_time_ms}")

            lines: dict[int, dict[str, Any]] = {}
            last_complete_lines: dict[int, dict[str, Any]] = {}
            best_move: str | None = None
            primary_depth = -1
            completed = False
            deadline = time.monotonic() + max(8, move_time_ms / 1000 + 5)
            try:
                while True:
                    raw = self._read_line(deadline)
                    if raw.startswith("info "):
                        parsed = self._parse_info(raw, board)
                        if not parsed or not parsed["pvMoves"]:
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
                            yield self._snapshot(board, lines, multi_pv=multi_pv)
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
                yield self._snapshot(
                    board, final_lines, multi_pv=multi_pv, best_move=best_move
                )
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
        ui_moves: list[str] = []
        for move in tokens[pv_index + 1 :]:
            try:
                ui_moves.append(to_ui_move(move))
            except ValueError:
                break
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
        threading.Thread(target=self._pump_output, daemon=True, name="pikafish-output").start()
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
        while not self.output.empty():
            try:
                self.output.get_nowait()
            except queue.Empty:
                break
