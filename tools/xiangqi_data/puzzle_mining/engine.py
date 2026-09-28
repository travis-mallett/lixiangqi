"""Synchronous, history-aware Pikafish client for offline puzzle workers."""

from __future__ import annotations

import hashlib
import os
import queue
import re
import subprocess
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterable, Protocol

from tools.xiangqi_data.pikafish import to_engine_move, to_ui_move

from .models import EngineScore, PositionStatus, SearchContext, SearchLine, SearchResult

ENGINE_MOVE = re.compile(r"^[a-i][0-9][a-i][0-9]$")


class PuzzleEngine(Protocol):
    engine_version: str
    nnue: str

    def new_game(self) -> None: ...

    def analyse(
        self,
        context: SearchContext,
        *,
        nodes: int | None = None,
        multi_pv: int,
        depth: int | None = None,
    ) -> SearchResult: ...

    def inspect(self, context: SearchContext) -> PositionStatus: ...

    def checking_pieces(
        self, context: SearchContext
    ) -> tuple[str, tuple[str, ...]]: ...

    def close(self) -> None: ...


class EngineProtocolError(RuntimeError):
    """The UCI process ended or returned an unusable protocol response."""


class IncompleteSearchError(RuntimeError):
    """The requested MultiPV snapshot was not completed before bestmove."""


class EngineCancelled(RuntimeError):
    """The owning worker requested cancellation while UCI was running."""


class ConstructionTimeout(TimeoutError):
    """The whole puzzle exhausted its budget, not a retryable engine failure."""


def check_deadline(engine) -> None:
    deadline = getattr(engine, "construction_deadline", None)
    if deadline is not None and time.monotonic() >= deadline:
        raise ConstructionTimeout("construction_time_limit")


@contextmanager
def construction_budget(engine, seconds=300.0):
    """Nested calls share the earliest deadline; unrelated engine users are unaffected."""
    previous = getattr(engine, "construction_deadline", None)
    deadline = time.monotonic() + seconds
    engine.construction_deadline = (
        min(previous, deadline) if previous is not None else deadline
    )
    try:
        check_deadline(engine)
        yield
    finally:
        engine.construction_deadline = previous


def _request_high_performance(process_id: int) -> None:
    """Opt a Windows engine into HighQoS independently of window visibility.

    Normal priority alone leaves core selection to background QoS heuristics.
    QoS is not inherited, so apply it to each newly launched engine process.
    This affects scheduling only, not search settings or cache identity.
    """
    if os.name != "nt":
        return
    import ctypes
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.SetProcessInformation.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
    ]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x0200, False, process_id)  # PROCESS_SET_INFORMATION
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        # PROCESS_POWER_THROTTLING_STATE: current version, control execution
        # speed explicitly, disable execution-speed throttling (HighQoS).
        state = (wintypes.DWORD * 3)(1, 1, 0)
        if not kernel.SetProcessInformation(
            handle, 4, ctypes.byref(state), ctypes.sizeof(state)
        ):  # ProcessPowerThrottling
            raise ctypes.WinError(ctypes.get_last_error())
    finally:
        kernel.CloseHandle(handle)


class OfflinePikafish:
    """One persistent UCI process, owned by one worker process."""

    def __init__(
        self,
        executable: Path,
        *,
        threads: int = 1,
        hash_mb: int = 64,
        cancel_event: object | None = None,
        high_performance: bool = False,
        heartbeat: Callable[[], None] | None = None,
    ) -> None:
        self.executable = executable
        self.threads = threads
        self.hash_mb = hash_mb
        self.cancel_event = cancel_event
        self.high_performance = high_performance
        self.heartbeat = heartbeat
        self.process: subprocess.Popen[str] | None = None
        self._reader: threading.Thread | None = None
        self.output: queue.Queue[str] = queue.Queue()
        self._binary_fingerprint = _file_fingerprint(executable)
        # Include the effective process settings in the engine identity.  The
        # analysis cache stores this value as part of its key, and an analysis
        # made with a different hash/thread configuration must never alias it.
        self.engine_version = (
            f"Pikafish;binary={self._binary_fingerprint};"
            f"threads={threads};hash_mb={hash_mb};search_state=per-game-or-puzzle-v1"
        )
        self.nnue = "unknown"

    def start(self) -> None:
        if self.process and self.process.poll() is None:
            return
        if self.process is not None:
            self.close()
        if not self.executable.is_file():
            raise FileNotFoundError(f"Pikafish is not installed at {self.executable}")
        process = subprocess.Popen(
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
        self.process = process
        # Give every process generation its own queue.  A reader thread from a
        # killed process may still be unwinding while the replacement starts;
        # sharing the queue would let stale UCI output satisfy a new command.
        self.output = queue.Queue()
        self._reader = threading.Thread(
            target=self._pump,
            args=(process, self.output),
            daemon=True,
            name="puzzle-pikafish-output",
        )
        self._reader.start()
        try:
            if self.high_performance:
                _request_high_performance(process.pid)
            self._send("uci")
            deadline = time.monotonic() + 10
            engine_name = "Pikafish"
            nnue_name = "unknown"
            while True:
                line = self._read_until(deadline)
                if line.startswith("id name "):
                    engine_name = line.removeprefix("id name ").strip()
                elif line.startswith("option name EvalFile ") and " default " in line:
                    nnue_name = line.split(" default ", 1)[1].strip()
                elif line == "uciok":
                    break
            self.engine_version = (
                f"{engine_name};binary={self._binary_fingerprint};"
                f"threads={self.threads};hash_mb={self.hash_mb};search_state=per-game-or-puzzle-v1"
            )
            self.nnue = _nnue_identity(self.executable, nnue_name)
            self._send(f"setoption name Threads value {self.threads}")
            self._send(f"setoption name Hash value {self.hash_mb}")
            self._send("setoption name UCI_ShowWDL value true")
            self._ready()
        except (TimeoutError, EngineProtocolError, EngineCancelled, OSError):
            self.close()
            raise

    def new_game(self) -> None:
        """Clear search state once at the start of an independent work item."""
        self.start()
        try:
            self._send("ucinewgame")
            self._ready()
        except (TimeoutError, EngineProtocolError, EngineCancelled, OSError):
            self.close()
            raise

    def analyse(
        self,
        context: SearchContext,
        *,
        nodes: int | None = None,
        multi_pv: int,
        depth: int | None = None,
    ) -> SearchResult:
        if (nodes is None) == (depth is None):
            raise ValueError("specify exactly one of nodes or depth")
        if (
            multi_pv < 1
            or (nodes is not None and nodes < 1)
            or (depth is not None and depth < 1)
        ):
            raise ValueError("search limits and multi_pv must be positive")
        self.start()
        try:
            self._send(f"setoption name MultiPV value {multi_pv}")
            self._ready()
            self._position(context)
            self._send(
                f"go depth {depth}" if depth is not None else f"go nodes {nodes}"
            )
            # UCI emits one line per MultiPV slot and depth.  Keep immutable
            # snapshots by depth; never combine a PV from one iteration with a
            # bestmove or alternative from another iteration.
            snapshots: dict[int, dict[int, SearchLine]] = {}
            bestmove: str | None = None
            bestmove_seen = False
            timeout = (
                float("inf")
                if nodes is None
                else max(30.0, min(900.0, nodes / 15_000.0 + 30.0))
            )
            deadline = time.monotonic() + timeout
            while True:
                raw = self._read_until(deadline)
                if raw.startswith("info "):
                    parsed = parse_info(raw)
                    if (
                        parsed is None
                        or parsed.multipv < 1
                        or parsed.multipv > multi_pv
                        or not parsed.moves
                    ):
                        continue
                    snapshots.setdefault(parsed.depth, {})[parsed.multipv] = parsed
                elif raw.startswith("bestmove "):
                    tokens = raw.split()
                    if len(tokens) < 2:
                        raise EngineProtocolError("malformed bestmove response")
                    bestmove_seen = True
                    token = tokens[1]
                    if token not in {"(none)", "0000"}:
                        bestmove = to_ui_move(token)
                    break

            complete = {
                depth: lines
                for depth, lines in snapshots.items()
                if all(index in lines for index in range(1, multi_pv + 1))
                and all(line.score.bound is None for line in lines.values())
                and len({line.moves[0] for line in lines.values()}) == multi_pv
            }
            if bestmove_seen and bestmove is None and snapshots:
                raise EngineProtocolError(
                    "engine returned a terminal bestmove alongside a principal variation"
                )
            if not snapshots and bestmove_seen and bestmove is None:
                # Explicit UCI ``bestmove (none)`` is the engine's terminal
                # position representation.  It is different from a search
                # that timed out or ended without a bestmove response.
                return SearchResult(
                    engine_version=self.engine_version,
                    nnue=self.nnue,
                    best_move=None,
                    lines=(),
                )
            if complete:
                chosen = complete[max(complete)]
            else:
                raise IncompleteSearchError(
                    f"engine returned no complete MultiPV snapshot (requested {multi_pv})"
                )
            if depth is not None and max(complete) < depth:
                raise IncompleteSearchError(
                    f"requested depth {depth}, completed {max(complete)}"
                )
            ordered = tuple(chosen[index] for index in sorted(chosen))
            # The selected line is the canonical source of truth.  Some UCI
            # engines can print a stale bestmove after a partial MultiPV
            # iteration; retaining that token would make the score and move
            # disagree.  A terminal (none) response remains None.
            selected_move = (
                ordered[0].moves[0] if ordered and ordered[0].moves else None
            )
            return SearchResult(
                engine_version=self.engine_version,
                nnue=self.nnue,
                best_move=selected_move,
                lines=ordered,
                search_nodes=nodes,
                search_depth=depth,
                requested_multipv=multi_pv,
            )
        except (
            TimeoutError,
            EngineProtocolError,
            EngineCancelled,
            IncompleteSearchError,
            OSError,
        ):
            # A timed-out or malformed search may leave unread info/bestmove
            # lines in the queue.  Do not reuse that process for another
            # position: terminate it and drain the queue before retrying.
            self.close()
            raise

    def checking_pieces(self, context: SearchContext) -> tuple[str, tuple[str, ...]]:
        """Inspect attacks without generating moves, including counterfactual boards.

        Squares use the catalog's one-based ranks. Keeping the checker identities
        lets motif analysis disregard one attack without changing board occupancy.
        """
        self.start()
        try:
            self._position(context)
            self._send("d")
            final_fen = ""
            deadline = time.monotonic() + 10
            while True:
                line = self._read_until(deadline)
                if line.startswith("Fen: "):
                    final_fen = line.removeprefix("Fen: ").strip()
                elif line.startswith("Checkers:"):
                    squares = line.removeprefix("Checkers:").split()
                    if not final_fen or any(
                        not re.fullmatch(r"[a-i][0-9]", s) for s in squares
                    ):
                        raise EngineProtocolError(
                            "Pikafish returned invalid checker inspection"
                        )
                    return final_fen, tuple(f"{s[0]}{int(s[1]) + 1}" for s in squares)
        except (TimeoutError, EngineProtocolError, EngineCancelled, OSError):
            self.close()
            raise

    def inspect(self, context: SearchContext) -> PositionStatus:
        """Return Pikafish's normalized FEN, check state, and legal moves.

        The caller's complete search context is sent in one
        ``position`` command. This preserves the engine's repetition and
        long-check history instead of reconstructing from a bare candidate FEN.
        """

        self.start()
        try:
            final_fen, checkers = self.checking_pieces(context)
            checked = bool(checkers)
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
        except (TimeoutError, EngineProtocolError, EngineCancelled, OSError):
            self.close()
            raise

    def close(self) -> None:
        process, self.process = self.process, None
        reader, self._reader = self._reader, None
        if process and process.poll() is None:
            try:
                if process.stdin:
                    process.stdin.write("quit\n")
                    process.stdin.flush()
                process.wait(timeout=2)
            except (OSError, subprocess.TimeoutExpired):
                try:
                    process.kill()
                    process.wait(timeout=2)
                except (OSError, subprocess.TimeoutExpired):
                    pass
        if process:
            if process.stdin:
                try:
                    process.stdin.close()
                except OSError:
                    pass  # A crashed engine may have broken its input pipe.
            if reader:
                reader.join(timeout=2)
            # The reader owns stdout, including the rare case where it is still
            # unwinding after this join. Closing a live reader's stream here
            # could block on its I/O lock.
            elif process.stdout:
                process.stdout.close()
        # The queue belongs to this process generation; dropping it prevents
        # stale lines from being consumed if start() launches a replacement.
        self.output = queue.Queue()

    def _position(self, context: SearchContext) -> None:
        encoded = " ".join(to_engine_move(move) for move in context.moves)
        command = f"position fen {context.initial_fen}"
        self._send(f"{command} moves {encoded}" if encoded else command)

    def _ready(self) -> None:
        self._send("isready")
        deadline = time.monotonic() + 10
        while self._read_until(deadline) != "readyok":
            pass

    def _pump(self, process: subprocess.Popen[str], output: queue.Queue[str]) -> None:
        if not process.stdout:
            return
        with process.stdout:
            for line in process.stdout:
                output.put(line.strip())

    def _send(self, command: str) -> None:
        if (
            not self.process
            or not self.process.stdin
            or self.process.poll() is not None
        ):
            raise EngineProtocolError("Pikafish stopped unexpectedly")
        self.process.stdin.write(command + "\n")
        self.process.stdin.flush()

    def _read_until(self, deadline: float) -> str:
        while True:
            check_deadline(self)
            if self.cancel_event is not None and self.cancel_event.is_set():
                raise EngineCancelled("worker shutdown requested")
            if self.heartbeat is not None:
                self.heartbeat()
            remaining = deadline - time.monotonic()
            construction_end = getattr(self, "construction_deadline", None)
            if construction_end is not None:
                remaining = min(remaining, construction_end - time.monotonic())
            if remaining <= 0:
                check_deadline(self)
                raise TimeoutError("Pikafish timed out")
            try:
                return self.output.get(timeout=min(remaining, 0.25))
            except queue.Empty as exc:
                if self.process is not None and self.process.poll() is not None:
                    raise EngineProtocolError(
                        f"Pikafish exited with status {self.process.returncode}"
                    ) from exc


def _file_fingerprint(path: Path) -> str:
    if not path.is_file():
        return "missing"
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _nnue_identity(executable: Path, name: str) -> str:
    """Return a stable NNUE identity, including contents where available."""

    candidate = Path(name)
    if not candidate.is_absolute():
        # Pikafish is started with cwd=executable.parents[1], and its
        # relative EvalFile option is resolved from that directory.
        candidate = executable.parents[1] / name
        if not candidate.is_file():
            candidate = executable.parent / name
    if candidate.is_file():
        return f"{name};sha256={_file_fingerprint(candidate)}"
    return name


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
        else "upper" if "upperbound" in tokens else None
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
