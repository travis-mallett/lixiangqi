"""Local rules and production Pikafish adapters for isolated self-play."""

from __future__ import annotations

import logging
import queue
from urllib.parse import urlsplit

from external.pikafish_worker.ai import MoveWork, PikafishMoveEngine
from external.pikafish_worker.opening import choose_opening_move
from external.pikafish_worker.selection import sample_candidate

from .profiles import describe, profile_at


def local_url(url: str) -> str:
    parsed = urlsplit(url)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise ValueError(
            "Use a local HTTP service origin; production/remote endpoints are prohibited"
        )
    return url.rstrip("/")


class CalibrationEngine(PikafishMoveEngine):
    """One persistent production engine. Endpoints use its unchanged sampler."""

    available_count = False
    invalid_output = False

    def _pump_output(self):
        process, output = self.process, self.output
        if process and process.stdout:
            for line in process.stdout:
                output.put(line.strip())

    def choose(self, work: MoveWork, coordinate: float):
        self.available_count = 0 < coordinate < 1
        self.invalid_output = False
        move = self.best_move(work, profile_at(coordinate))
        if self.invalid_output:
            raise RuntimeError(
                "Engine returned no move or a forbidden move; exclude this game"
            )
        return move

    def _sample_candidate(self, candidates, **kwargs):
        if self.available_count:
            # Keep the production filtering and distribution algorithm. Only
            # intermediate profiles solve their mean over actually reported ranks.
            candidates = {
                rank: value
                for rank, (_, value) in enumerate(sorted(candidates.items()), 1)
            }
            kwargs["multi_pv"] = len(candidates)
            kwargs["expected_rank"] = min(kwargs["expected_rank"], len(candidates))
        return sample_candidate(candidates, **kwargs)

    def _permitted_result(self, engine_move, work):
        if engine_move is None or (
            work.legal_moves is not None
            and self._to_ui_move(engine_move) not in work.legal_moves
        ):
            self.invalid_output = True
        return super()._permitted_result(engine_move, work)

    def close(self):
        process = self.process
        try:
            super().close()
        finally:
            if process:
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=5)
                for stream in (process.stdin, process.stdout):
                    if stream:
                        stream.close()
            # Never feed leftover output from a failed process into the next game.
            self.output = queue.Queue()


class BookFailures(logging.Handler):
    def __init__(self):
        super().__init__()
        self.failed = False

    def emit(self, record):
        if record.levelno >= logging.WARNING:
            self.failed = True


def play_game(
    plan: dict, opening: dict, coordinates, engine, rules, *, mode: str, max_plies: int
) -> dict:
    red, black = plan["redLevel"], plan["blackLevel"]
    prefix = tuple(opening["moves"]) if mode == "calibrate" else ()
    moves = prefix
    record = {
        **plan,
        "opening": opening,
        "redProfile": describe(red, coordinates[red - 1]),
        "blackProfile": describe(black, coordinates[black - 1]),
        "mode": mode,
        "ruleset": "tiantian-v1",
        "moves": [],
        "result": None,
        "status": "failed",
        "failure": None,
        "searchTimeout": False,
        "includedInStatistics": False,
    }
    handler = BookFailures()
    logger = logging.getLogger("external.pikafish_worker.opening")
    logger.addHandler(handler)
    stage = "rules"
    try:
        for ply in range(max_plies + 1):
            stage = "rules"
            state = rules.position(opening["initialFen"], moves)
            record["finalFen"] = state["fen"]
            if ply == 0 and mode == "calibrate" and state["fen"] != opening["fen"]:
                raise ValueError("Opening replay differs from saved suite position")
            if state["gameResult"] != "*":
                if ply == 0:
                    raise ValueError("Opening is already terminal")
                record.update(
                    status="completed",
                    result=state["gameResult"],
                    termination=state.get("termination"),
                )
                break
            if ply == max_plies:
                record.update(status="censored", termination="maximum_plies")
                break
            if not state["legalMoves"]:
                raise ValueError("Ongoing native position has no permitted moves")
            level = red if state["turn"] == "red" else black
            work = MoveWork(
                plan["gameId"],
                level,
                opening["initialFen"],
                moves,
                ruleset="tiantian-v1",
                legal_moves=tuple(state["legalMoves"]),
            )
            stage = "opening"
            move = choose_opening_move(work, engine) if mode == "validate" else None
            if handler.failed:
                raise RuntimeError(
                    "Live opening lookup failed; validation game excluded"
                )
            if move is None:
                stage = "search"
                move = engine.choose(work, coordinates[level - 1])
            if move not in work.legal_moves:
                raise RuntimeError("Engine move is not legal")
            moves += (move,)
            record["moves"].append(move)
    except Exception as error:  # noqa: BLE001 - persist all failed games, never score them as losses
        record.update(
            failure={
                "stage": stage,
                "type": type(error).__name__,
                "message": str(error),
            },
            searchTimeout=stage == "search" and isinstance(error, TimeoutError),
        )
        engine.close()
    finally:
        logger.removeHandler(handler)
    return record
