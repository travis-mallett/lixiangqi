"""Consume Lila AI move work from Redis and answer with Pikafish moves."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import queue
import random
import re
import secrets
import socket
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class StrengthProfile:
    nodes: int
    multi_pv: int
    expected_rank: float


# Calibrated against Tiantian's levels 2, 3, 4, 5, 7, 9, 12, 18, and 25,
# respectively. The public site deliberately exposes only the ordinal levels
# 1-9; the reference mapping is an implementation and methodology detail.
STRENGTH_PROFILES = (
    StrengthProfile(149, 2, 1.2109662691040561),
    StrengthProfile(149, 2, 1.1654821783005245),
    StrengthProfile(149, 2, 1.12170647737457),
    StrengthProfile(149, 2, 1.0795749989234302),
    StrengthProfile(149, 1, 1.0),
    StrengthProfile(7_849, 1, 1.0),
    StrengthProfile(24_389, 1, 1.0),
    StrengthProfile(235_500, 1, 1.0),
    StrengthProfile(3_318_000, 1, 1.0),
)


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
    request_id: str | None = None
    turn_key: str | None = None
    ruleset: str | None = None
    legal_moves: tuple[str, ...] | None = None

    @classmethod
    def parse(cls, payload: str) -> "MoveWork":
        fields = payload.split(";", 5)
        if len(fields) != 6 or fields[3] != "xiangqi":
            raise ValueError("Unsupported Fishnet move work")
        moves = tuple(fields[5].split()) if fields[5] else ()
        return cls(fields[0], int(fields[1]), fields[4], moves)

    @classmethod
    def parse_v2(cls, payload: str) -> "MoveWork":
        value = json.loads(payload)
        if not isinstance(value, dict):
            raise ValueError("Invalid AI move work envelope")
        if value.get("version") != 2 or value.get("type") != "move":
            raise ValueError("Unsupported AI move work version")
        position = value.get("position")
        if not isinstance(position, dict) or position.get("variant") != "xiangqi":
            raise ValueError("Unsupported AI move position")
        game_id = value.get("gameId")
        request_id = value.get("requestId")
        turn_key = value.get("turnKey")
        level = value.get("level")
        initial_fen = position.get("initialFen")
        moves = position.get("moves")
        ruleset = position.get("ruleset")
        legal_moves = position.get("legalMoves")
        if ruleset is not None:
            if ruleset not in {"tiantian-v1", "unrestricted-v1"}:
                raise ValueError("Unsupported AI ruleset")
            if not isinstance(legal_moves, list) or not legal_moves or not all(
                isinstance(move, str) and re.fullmatch(r"[a-i](?:10|[1-9])[a-i](?:10|[1-9])", move)
                for move in legal_moves
            ):
                raise ValueError("Invalid permitted AI moves")
        if not isinstance(game_id, str) or not re.fullmatch(r"[A-Za-z0-9]{8}", game_id):
            raise ValueError("Invalid AI game ID")
        if not isinstance(request_id, str) or not re.fullmatch(
            r"[A-Za-z0-9]{12}", request_id
        ):
            raise ValueError("Invalid AI request ID")
        if not isinstance(turn_key, str) or not re.fullmatch(r"[0-9a-f]{64}", turn_key):
            raise ValueError("Invalid AI turn key")
        if isinstance(level, bool) or not isinstance(level, int) or not 1 <= level <= 9:
            raise ValueError("Invalid AI level")
        if not isinstance(initial_fen, str) or not initial_fen.strip():
            raise ValueError("Invalid AI initial FEN")
        if not isinstance(moves, list) or not all(
            isinstance(move, str)
            and re.fullmatch(r"[a-i](?:10|[1-9])[a-i](?:10|[1-9])", move)
            for move in moves
        ):
            raise ValueError("Invalid AI move history")
        work = cls(
            game_id=game_id,
            level=level,
            initial_fen=initial_fen,
            moves=tuple(moves),
            request_id=request_id,
            turn_key=turn_key,
            ruleset=ruleset,
            legal_moves=tuple(legal_moves) if legal_moves is not None else None,
        )
        if not secrets.compare_digest(work.turn_key, work.computed_turn_key):
            raise ValueError("AI turn key does not match its position")
        return work

    @property
    def sign(self) -> str:
        return " ".join(self.moves[-5:])[-20:].replace(" ", "")

    @property
    def computed_turn_key(self) -> str:
        canonical = "\0".join(
            (
                "lixiangqi-ai-turn-v2" if self.ruleset else "lixiangqi-ai-turn-v1",
                self.game_id,
                str(self.level),
                self.initial_fen,
                " ".join(self.moves),
            ) + ((self.ruleset,) if self.ruleset else ())
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class PikafishMoveEngine:
    """Minimal persistent UCI client for the Fishnet move-work boundary."""

    STARTUP_TIMEOUT_SECONDS = 8
    READY_TIMEOUT_SECONDS = 5
    LEGAL_MOVES_TIMEOUT_SECONDS = 10
    SEARCH_TIMEOUT_SECONDS = 45
    MAX_COLD_WORK_SECONDS = STARTUP_TIMEOUT_SECONDS + READY_TIMEOUT_SECONDS + max(
        LEGAL_MOVES_TIMEOUT_SECONDS + 10, SEARCH_TIMEOUT_SECONDS
    )

    _ui_move = re.compile(r"^([a-i])(10|[1-9])([a-i])(10|[1-9])$")
    _engine_move = re.compile(r"^([a-i])([0-9])([a-i])([0-9])$")
    _multipv = re.compile(
        r"\bdepth (?P<depth>\d+).*?\bmultipv (?P<rank>\d+).*?\bscore (?P<kind>cp|mate) "
        r"(?P<score>-?\d+).*?\bpv (?P<move>[a-i][0-9][a-i][0-9])\b"
    )

    def __init__(self) -> None:
        self.executable = self._default_executable()
        self.process: subprocess.Popen[str] | None = None
        self.output: queue.Queue[str] = queue.Queue()

    def best_move(self, work: MoveWork, profile: StrengthProfile) -> str | None:
        self._ensure_started()
        self._send("ucinewgame")
        self._send("setoption name Clear Hash")
        moves = " ".join(self._to_engine_move(move) for move in work.moves)
        position = f"position fen {work.initial_fen}"
        position = f"{position} moves {moves}" if moves else position
        self._send(position)

        if profile.expected_rank > 1.0:
            legal = [self._to_engine_move(move) for move in work.legal_moves] if work.legal_moves is not None else self._legal_moves()
            if not legal:
                return None
            seed_material = f"{work.game_id}|{work.level}|{' '.join(work.moves)}"
            seed = int.from_bytes(hashlib.sha256(seed_material.encode()).digest()[:8], "big")
            chooser = random.Random(seed)
            self._send(position)
            self._send(f"setoption name MultiPV value {min(profile.multi_pv, len(legal))}")
        else:
            legal = []
            self._send("setoption name MultiPV value 1")
        self._send("isready")
        self._read_until("readyok", timeout=self.READY_TIMEOUT_SECONDS)

        searchmoves = ""
        if work.legal_moves is not None:
            searchmoves = " searchmoves " + " ".join(self._to_engine_move(move) for move in work.legal_moves)
        self._send(f"go nodes {profile.nodes}{searchmoves}")
        deadline = time.monotonic() + min(
            self.SEARCH_TIMEOUT_SECONDS, max(10, profile.nodes / 250_000 + 5)
        )
        candidates_by_depth: dict[int, dict[int, str]] = {}
        reported_bestmove: str | None = None
        while True:
            line = self._read_line(deadline)
            match = self._multipv.search(line)
            if match:
                candidates_by_depth.setdefault(int(match["depth"]), {})[
                    int(match["rank"])
                ] = match["move"]
            if line.startswith("bestmove "):
                token = line.split()[1]
                reported_bestmove = None if token in {"(none)", "0000"} else token
                if profile.expected_rank <= 1.0:
                    return self._permitted_result(reported_bestmove, work)
                complete = [
                    values
                    for _depth, values in sorted(candidates_by_depth.items(), reverse=True)
                    if len(set(values.values())) == min(profile.multi_pv, len(legal))
                ]
                available = complete[0] if complete else max(
                    candidates_by_depth.values(),
                    key=lambda values: len(set(values.values())),
                    default={},
                )
                ranked: dict[int, str] = {}
                used: set[str] = set()
                for rank, move in sorted(available.items()):
                    if move in legal and move not in used:
                        ranked[rank] = move
                        used.add(move)
                if not ranked:
                    return self._permitted_result(reported_bestmove, work)
                selected = self._sample_adjacent_rank(ranked, profile.expected_rank, chooser)
                return self._permitted_result(selected, work)

    def _permitted_result(self, engine_move: str | None, work: MoveWork) -> str | None:
        move = self._to_ui_move(engine_move) if engine_move else None
        if work.legal_moves is not None and move not in work.legal_moves:
            # Engine repetition semantics can differ from the site's selected policy.
            # The server's move list is authoritative, including at an engine-declared draw.
            return work.legal_moves[0] if work.legal_moves else None
        return move

    def _legal_moves(self) -> list[str]:
        self._send("go perft 1")
        deadline = time.monotonic() + self.LEGAL_MOVES_TIMEOUT_SECONDS
        legal: list[str] = []
        while True:
            line = self._read_line(deadline)
            if line.startswith("Nodes searched:"):
                return sorted(legal)
            token, separator, _count = line.partition(":")
            if separator and self._engine_move.fullmatch(token):
                legal.append(token)

    @staticmethod
    def _sample_adjacent_rank(
        candidates: dict[int, str], expected_rank: float, rng: random.Random
    ) -> str:
        lower = max(1, int(expected_rank))
        probability = max(0.0, min(1.0, expected_rank - lower))
        requested = lower + (1 if rng.random() < probability else 0)
        ranks = sorted(candidates)
        selected = min(ranks, key=lambda rank: (abs(rank - requested), rank))
        return candidates[selected]

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
        self._read_until("uciok", timeout=self.STARTUP_TIMEOUT_SECONDS)
        self._send("setoption name Threads value 1")
        self._send("setoption name Hash value 128")
        self._send("setoption name nodestime value 0")
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
    V2_REQUEST_CHANNEL = "fishnet-move-v2-out"
    V2_RESULT_CHANNEL = "fishnet-move-v2-in"
    LEASE_SECONDS = 120
    COMPLETED_SECONDS = 300
    _DONE_PREFIX = "done:"
    _RELEASE_LEASE = (
        "if redis.call('get', KEYS[1]) == ARGV[1] then "
        "return redis.call('del', KEYS[1]) else return 0 end"
    )
    _COMPLETE_LEASE = (
        "if redis.call('get', KEYS[1]) == ARGV[1] then "
        "return redis.call('set', KEYS[1], ARGV[2], 'EX', ARGV[3]) "
        "else return nil end"
    )

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
                    subscriber.socket.sendall(
                        _command("SUBSCRIBE", "fishnet-out", self.V2_REQUEST_CHANNEL)
                    )
                    _read_resp(subscriber.stream)
                    _read_resp(subscriber.stream)
                    self.publisher.execute("PUBLISH", "fishnet-in", "start")
                    self.publisher.execute(
                        "PUBLISH",
                        self.V2_RESULT_CHANNEL,
                        json.dumps({"version": 2, "type": "workerReady"}),
                    )
                    retry_delay = 1.0
                    while True:
                        message = _read_resp(subscriber.stream)
                        if (
                            isinstance(message, list)
                            and len(message) == 3
                            and message[0] == "message"
                        ):
                            self._process(
                                message[2], v2=message[1] == self.V2_REQUEST_CHANNEL
                            )
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

    def _process(self, payload: str, *, v2: bool = False) -> None:
        lock_key: str | None = None
        lease_owner: str | None = None
        lease_acquired = False
        lease_completed = False
        work: MoveWork | None = None
        try:
            if not self.publisher:
                raise ConnectionError("Redis publisher is not connected")
            work = MoveWork.parse_v2(payload) if v2 else MoveWork.parse(payload)
            identity = work.request_id if v2 else work.sign
            lock_key = f"lixiangqi:ai:{work.game_id}:{identity}"
            if v2:
                cached = self.publisher.execute("GET", lock_key)
                if isinstance(cached, str) and cached.startswith(self._DONE_PREFIX):
                    self._publish_move(work, cached.removeprefix(self._DONE_PREFIX), v2=True)
                    return
            lease_owner = f"work:{secrets.token_hex(16)}"
            lock = self.publisher.execute(
                "SET", lock_key, lease_owner, "NX", "EX", str(self.LEASE_SECONDS)
            )
            if lock != "OK":
                return
            lease_acquired = True
            move = self.engine.best_move(work, self._profile(work.level))
            if move:
                if v2:
                    completed = self.publisher.execute(
                        "EVAL",
                        self._COMPLETE_LEASE,
                        "1",
                        lock_key,
                        lease_owner,
                        f"{self._DONE_PREFIX}{move}",
                        str(self.COMPLETED_SECONDS),
                    )
                    lease_completed = completed == "OK"
                self._publish_move(work, move, v2=v2)
            elif v2:
                self._publish_failure(work, "no_bestmove")
        except (ConnectionError, OSError):
            # Let the subscription loop reconnect and announce itself again.
            raise
        except Exception as error:
            if v2 and work:
                self._publish_failure(work, type(error).__name__)
            print(
                json.dumps(
                    {
                        "event": "ai_work_failed",
                        "gameId": work.game_id if work else None,
                        "requestId": work.request_id if work else None,
                        "error": str(error),
                    }
                ),
                flush=True,
            )
        finally:
            if (
                lease_acquired
                and not lease_completed
                and lock_key
                and lease_owner
                and self.publisher
            ):
                self.publisher.execute(
                    "EVAL", self._RELEASE_LEASE, "1", lock_key, lease_owner
                )

    def _publish_move(self, work: MoveWork, move: str, *, v2: bool) -> None:
        if not self.publisher:
            raise ConnectionError("Redis publisher is not connected")
        if v2:
            self.publisher.execute(
                "PUBLISH",
                self.V2_RESULT_CHANNEL,
                json.dumps(
                    {
                        "version": 2,
                        "type": "move",
                        "requestId": work.request_id,
                        "gameId": work.game_id,
                        "turnKey": work.turn_key,
                        "move": move,
                    }
                ),
            )
        else:
            self.publisher.execute(
                "PUBLISH", "fishnet-in", f"{work.game_id} {work.sign} {move}"
            )

    def _publish_failure(self, work: MoveWork, code: str) -> None:
        if not self.publisher:
            raise ConnectionError("Redis publisher is not connected")
        self.publisher.execute(
            "PUBLISH",
            self.V2_RESULT_CHANNEL,
            json.dumps(
                {
                    "version": 2,
                    "type": "failure",
                    "requestId": work.request_id,
                    "gameId": work.game_id,
                    "turnKey": work.turn_key,
                    "code": code,
                }
            ),
        )

    @staticmethod
    def _profile(level: int) -> StrengthProfile:
        if not 1 <= level <= len(STRENGTH_PROFILES):
            raise ValueError(f"Unsupported computer level: {level}")
        return STRENGTH_PROFILES[level - 1]


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
