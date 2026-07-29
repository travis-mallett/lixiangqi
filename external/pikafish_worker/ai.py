"""Consume Lila AI move work from Redis and answer with Pikafish moves."""

from __future__ import annotations

import argparse
import os
import queue
import re
import socket
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


def _command(*parts: str) -> bytes:
    encoded = [part.encode() for part in parts]
    return (
        f"*{len(encoded)}\r\n".encode()
        + b"".join(f"${len(part)}\r\n".encode() + part + b"\r\n" for part in encoded)
    )


def _read_line(stream) -> bytes:
    line = stream.readline()
    if not line.endswith(b"\r\n"):
        raise ConnectionError("Redis connection closed")
    return line[:-2]


def _read_resp(stream) -> Any:
    prefix = stream.read(1)
    if prefix == b"+":
        return _read_line(stream).decode()
    if prefix == b"-":
        raise RuntimeError(_read_line(stream).decode(errors="replace"))
    if prefix == b":":
        return int(_read_line(stream))
    if prefix == b"$":
        size = int(_read_line(stream))
        if size < 0:
            return None
        value = stream.read(size)
        if stream.read(2) != b"\r\n":
            raise ConnectionError("Invalid Redis bulk response")
        return value.decode()
    if prefix == b"*":
        return [_read_resp(stream) for _ in range(int(_read_line(stream)))]
    raise ConnectionError("Invalid Redis response")


class RedisConnection:
    def __init__(self, host: str, port: int) -> None:
        self.socket = socket.create_connection((host, port), timeout=10)
        self.socket.settimeout(None)
        self.stream = self.socket.makefile("rb")
        self.lock = threading.Lock()

    def execute(self, *parts: str) -> Any:
        with self.lock:
            self.socket.sendall(_command(*parts))
            return _read_resp(self.stream)

    def close(self) -> None:
        try:
            self.stream.close()
        except OSError:
            pass
        try:
            self.socket.close()
        except OSError:
            pass


@dataclass(frozen=True)
class MoveWork:
    game_id: str
    level: int
    initial_fen: str
    moves: tuple[str, ...]

    @classmethod
    def parse(cls, payload: str) -> "MoveWork":
        fields = payload.split(";", 5)
        if len(fields) != 6 or fields[3] != "xiangqi":
            raise ValueError("Unsupported Fishnet move work")
        moves = tuple(fields[5].split()) if fields[5] else ()
        return cls(fields[0], int(fields[1]), fields[4], moves)

    @property
    def sign(self) -> str:
        return " ".join(self.moves[-5:])[-20:].replace(" ", "")


class PikafishMoveEngine:
    """Minimal persistent UCI client for the Fishnet move-work boundary."""

    _ui_move = re.compile(r"^([a-i])(10|[1-9])([a-i])(10|[1-9])$")
    _engine_move = re.compile(r"^([a-i])([0-9])([a-i])([0-9])$")

    def __init__(self) -> None:
        self.executable = self._default_executable()
        self.process: subprocess.Popen[str] | None = None
        self.output: queue.Queue[str] = queue.Queue()

    def best_move(self, work: MoveWork, move_time_ms: int) -> str | None:
        self._ensure_started()
        self._send("isready")
        self._read_until("readyok", timeout=5)
        moves = " ".join(self._to_engine_move(move) for move in work.moves)
        position = f"position fen {work.initial_fen}"
        self._send(f"{position} moves {moves}" if moves else position)
        self._send(f"go movetime {move_time_ms}")
        deadline = time.monotonic() + max(8, move_time_ms / 1000 + 5)
        while True:
            line = self._read_line(deadline)
            if line.startswith("bestmove "):
                token = line.split()[1]
                return None if token in {"(none)", "0000"} else self._to_ui_move(token)

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

    def _ensure_started(self) -> None:
        if self.process and self.process.poll() is None:
            return
        self.close()
        if not self.executable.is_file():
            raise RuntimeError(
                f"Pikafish is not installed at {self.executable}. "
                "Run scripts/windows/Install-Pikafish.ps1."
            )
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
        threading.Thread(target=self._pump_output, daemon=True, name="pikafish-ai-output").start()
        self._send("uci")
        self._read_until("uciok", timeout=8)
        threads = max(1, min(4, os.cpu_count() or 1))
        self._send(f"setoption name Threads value {threads}")
        self._send("setoption name Hash value 128")
        self._send("setoption name MultiPV value 1")

    def _pump_output(self) -> None:
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

    def _read_line(self, deadline: float) -> str:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            self.close()
            raise TimeoutError("Pikafish timed out")
        try:
            return self.output.get(timeout=remaining)
        except queue.Empty as error:
            self.close()
            raise TimeoutError("Pikafish timed out") from error

    def _read_until(self, expected: str, *, timeout: float) -> None:
        deadline = time.monotonic() + timeout
        while self._read_line(deadline) != expected:
            pass

    @classmethod
    def _to_engine_move(cls, move: str) -> str:
        match = cls._ui_move.fullmatch(move)
        if not match:
            raise ValueError(f"Invalid Xiangqi move: {move}")
        return f"{match[1]}{int(match[2]) - 1}{match[3]}{int(match[4]) - 1}"

    @classmethod
    def _to_ui_move(cls, move: str) -> str:
        match = cls._engine_move.fullmatch(move)
        if not match:
            raise ValueError(f"Invalid Pikafish move: {move}")
        return f"{match[1]}{int(match[2]) + 1}{match[3]}{int(match[4]) + 1}"

    @staticmethod
    def _default_executable() -> Path:
        configured = os.environ.get("LIXIANGQI_PIKAFISH")
        if configured:
            return Path(configured).expanduser().resolve()
        project_root = Path(__file__).resolve().parents[2]
        platform_dir = "Windows" if os.name == "nt" else "Linux"
        executable = "pikafish-avx2.exe" if os.name == "nt" else "pikafish-avx2"
        return project_root / ".tools" / "pikafish" / platform_dir / executable


class AiWorker:
    def __init__(self, redis_host: str, redis_port: int) -> None:
        self.redis_host = redis_host
        self.redis_port = redis_port
        self.publisher: RedisConnection | None = None
        self.engine = PikafishMoveEngine()

    def run(self) -> None:
        """Stay available across Redis restarts and transient network failures.

        Fishnet move work is deliberately transient. Announcing ``start`` after
        every successful subscription lets the round actors re-submit any AI
        turn that was in flight while this worker was disconnected.
        """
        retry_delay = 1.0
        try:
            while True:
                subscriber: RedisConnection | None = None
                try:
                    self.publisher = RedisConnection(self.redis_host, self.redis_port)
                    subscriber = RedisConnection(self.redis_host, self.redis_port)
                    self.publisher.execute("PUBLISH", "fishnet-in", "start")
                    subscriber.socket.sendall(_command("SUBSCRIBE", "fishnet-out"))
                    _read_resp(subscriber.stream)
                    retry_delay = 1.0
                    while True:
                        message = _read_resp(subscriber.stream)
                        if (
                            isinstance(message, list)
                            and len(message) == 3
                            and message[0] == "message"
                        ):
                            self._process(message[2])
                except (ConnectionError, OSError, RuntimeError) as error:
                    print(
                        f"Pikafish AI worker lost Redis; retrying in {retry_delay:.0f}s: {error}",
                        flush=True,
                    )
                    time.sleep(retry_delay)
                    retry_delay = min(retry_delay * 2, 30.0)
                finally:
                    if subscriber:
                        subscriber.close()
                    if self.publisher:
                        self.publisher.close()
                        self.publisher = None
        finally:
            self.engine.close()

    def _process(self, payload: str) -> None:
        lock_key: str | None = None
        try:
            if not self.publisher:
                raise ConnectionError("Redis publisher is not connected")
            work = MoveWork.parse(payload)
            lock_key = f"lixiangqi:ai:{work.game_id}:{work.sign}"
            lock = self.publisher.execute(
                "SET", lock_key, "1", "NX", "EX", "30"
            )
            if lock != "OK":
                return
            move = self.engine.best_move(work, self._move_time(work.level))
            if move:
                self.publisher.execute(
                    "PUBLISH",
                    "fishnet-in",
                    f"{work.game_id} {work.sign} {move}",
                )
        except (ConnectionError, OSError):
            # Let the subscription loop reconnect and announce itself again.
            raise
        except Exception as error:
            # Do not suppress a re-submitted turn after an engine failure.
            # The next FishnetStart announcement will ask active rounds again.
            if lock_key:
                try:
                    if self.publisher:
                        self.publisher.execute("DEL", lock_key)
                except (ConnectionError, OSError, RuntimeError):
                    pass
            print(f"Could not complete AI work: {error}", flush=True)

    @staticmethod
    def _move_time(level: int) -> int:
        return (80, 120, 180, 260, 380, 550, 800, 1200)[max(1, min(8, level)) - 1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--redis-host", default=os.environ.get("LIXIANGQI_REDIS_HOST", "127.0.0.1")
    )
    parser.add_argument(
        "--redis-port", type=int, default=int(os.environ.get("LIXIANGQI_REDIS_PORT", "6379"))
    )
    args = parser.parse_args()
    AiWorker(args.redis_host, args.redis_port).run()


if __name__ == "__main__":
    main()
