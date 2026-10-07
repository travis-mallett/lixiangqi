"""Construct and persist mate or tactic solutions independently of taxonomy."""

from __future__ import annotations

import argparse
import json
import math
import multiprocessing as mp
import os
import queue
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from external.xiangqi_explorer.catalog_databases import (
    installed_catalog_database_paths,
)
from tools.xiangqi_data.pikafish import _default_executable
from tools.xiangqi_data.pikafish_rules import START_FEN

from .engine import (
    EngineCancelled,
    EngineProtocolError,
    OfflinePikafish,
    ConstructionTimeout,
    construction_budget,
)
from .models import (
    SearchContext,
    fen_side,
)
from .position import (
    candidate_key,
    normalized_fen,
    puzzle_root_fen,
    replay_fens,
    PUZZLE_HISTORY_POLICY,
)
from .verification_dashboard import VerificationDashboard
from .solver import (
    SolverConfig,
    SolveResult,
    SolutionRejected,
    SolutionReview,
    solve_checkmate,
)
from .database_write import begin_write, is_database_busy
from .storage import open_database, open_database_when_ready
from .tactic_solver import TacticSolverConfig, solve_tactic
from .sources import catalog_source_paths, is_native_source, load_game
from .workers import (
    WorkerCancelled,
    WorkerClaimLost,
    renew_claim,
    start_workers,
    stop_workers,
    watch_supervisor,
    wait_for_due_jobs,
)

DEFAULT_DATABASE = Path("data/local/xiangqi-puzzle-mining.sqlite3")
# Player-only branching with shortest-path reconciliation and a puzzle deadline.
CHECKMATE_VERIFIER_VERSION = "6"
TIMING_LOG = Path("data/local/puzzle-verification-timing.jsonl")


class VerificationInconclusive(EngineProtocolError):
    """Completed searches did not establish a coherent terminal mating trace."""


@dataclass(frozen=True)
class VerifierConfig(SolverConfig):
    version: str = CHECKMATE_VERIFIER_VERSION
    engine_threads: int = 1
    hash_mb: int = 128
    construction_seconds: float = 300.0

    @property
    def candidate_type(self):
        return "checkmate_candidate"

    def __post_init__(self) -> None:
        super().__post_init__()
        if self.engine_threads != 1:
            raise ValueError("final verification requires one engine thread")
        if (
            not math.isfinite(self.construction_seconds)
            or self.construction_seconds <= 0
        ):
            raise ValueError("construction_seconds must be finite and positive")

    def settings(self) -> dict[str, Any]:
        return {**asdict(self), "history_policy": PUZZLE_HISTORY_POLICY}


@dataclass(frozen=True)
class TacticVerifierConfig(TacticSolverConfig):
    version: str = "tactic-1"
    engine_threads: int = 1
    hash_mb: int = 128

    @property
    def candidate_type(self):
        return "tactic_candidate"

    def __post_init__(self):
        super().__post_init__()
        if self.engine_threads != 1:
            raise ValueError("final verification requires one engine thread")

    def settings(self):
        return {
            **asdict(self),
            "objective": "advantage",
            "history_policy": PUZZLE_HISTORY_POLICY,
        }


from .verification_store import (
    seed_verification,
    claim_verification,
    finish_verification,
    fail_verification,
    verification_signature,
    release_verification,
)


def verify_candidate(connection, engine, claim, source_path, config, progress=None):
    if config.candidate_type != "checkmate_candidate":
        return _verify_candidate(
            connection, engine, claim, source_path, config, progress
        )
    started = time.monotonic()
    try:
        with construction_budget(engine, config.construction_seconds):
            return _verify_candidate(
                connection, engine, claim, source_path, config, progress
            )
    except ConstructionTimeout:
        # Reset/setup can exhaust the same budget before the solver is entered.
        result = SolveResult(
            (),
            engine.engine_version,
            engine.nnue,
            0,
            0,
            ("construction_time_limit",),
            False,
            metrics={"elapsed_seconds": round(time.monotonic() - started, 3)},
        )
        return finish_verification(connection, claim, config, engine, result=result)


def _verify_candidate(connection, engine, claim, source_path, config, progress=None):
    candidate = claim.candidate
    TIMING_LOG.parent.mkdir(parents=True, exist_ok=True)
    engine.new_game()

    def timing(stage, details):
        record = {
            "time": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "pid": os.getpid(),
            "candidate_id": candidate.id,
            "game_id": candidate.game_id,
            "ply": candidate.ply,
            "stage": stage,
            **details,
        }
        with TIMING_LOG.open("a", encoding="utf-8") as log:
            log.write(json.dumps(record, separators=(",", ":")) + "\n")

    def stage(name, action):
        begin = time.perf_counter()
        try:
            return action()
        finally:
            timing(name, {"elapsed_ms": round((time.perf_counter() - begin) * 1000, 3)})

    try:
        loaded = stage(
            "source.load_game",
            lambda: load_game(
                connection,
                (
                    {candidate.source_database: source_path}
                    if source_path is not None
                    else {}
                ),
                candidate.source_database,
                candidate.game_id,
            ),
        )
        recorded_moves = list(loaded.moves)
        if candidate.ply > len(recorded_moves):
            raise SolutionRejected("source_ply_is_out_of_range")
        prefix = tuple(recorded_moves[: candidate.ply])
        if not prefix or prefix[-1] != candidate.played_move:
            raise SolutionRejected("source_played_move_changed")
        initial_fen = loaded.initial_fen or START_FEN
        source_fens = stage(
            "source.replay_fens", lambda: replay_fens(list(prefix), initial_fen)
        )
        source_fen = source_fens[-1]
        base = SearchContext(puzzle_root_fen(source_fen), ())
        reconstructed = stage("candidate.engine.inspect", lambda: engine.inspect(base))
        if normalized_fen(reconstructed.fen) != normalized_fen(candidate.position_fen):
            raise SolutionRejected("source_position_changed")
        if (
            candidate_key(reconstructed.fen, prefix, initial_fen)
            != candidate.candidate_key
        ):
            raise SolutionRejected("source_history_changed")
        if fen_side(reconstructed.fen) != candidate.side_to_move:
            raise SolutionRejected("source_side_to_move_changed")

        if candidate.candidate_type != config.candidate_type:
            raise VerificationInconclusive("verification candidate type changed")
        solve = {
            "tactic_candidate": solve_tactic,
        }.get(config.candidate_type, solve_checkmate)
        result = solve(
            engine,
            base,
            candidate.side_to_move,
            config,
            progress=progress,
            timing=timing,
        )
        return stage(
            "verification.persist",
            lambda: finish_verification(
                connection, claim, config, engine, result=result
            ),
        )
    except SolutionRejected as exc:
        return finish_verification(connection, claim, config, engine, invalid=str(exc))
    except SolutionReview as exc:
        raise VerificationInconclusive(str(exc)) from exc


def _worker_main(
    worker_id: int,
    output_path: str,
    executable: str,
    source_paths: dict[str, str],
    config: VerifierConfig,
    engine_threads: int,
    hash_mb: int,
    max_attempts: int,
    stop_event: mp.synchronize.Event,
    report_queue: mp.Queue,
    continuous: bool = False,
    poll_interval: float = 5.0,
    catalog_path=None,
    reconstruct: bool = False,
) -> None:
    with watch_supervisor(stop_event):
        connection = open_database(Path(output_path), initialize=False)
        from .queue_priority import prepare_priority

        prepare_priority(connection, catalog_path)
        engine = OfflinePikafish(
            Path(executable),
            threads=engine_threads,
            hash_mb=hash_mb,
            cancel_event=stop_event,
        )
        try:
            signature = verification_signature(config, engine)
            while not stop_event.is_set():
                try:
                    claim = claim_verification(
                        connection,
                        signature,
                        reconstruct=reconstruct,
                        stop_event=stop_event,
                    )
                except WorkerCancelled:
                    break
                if claim is None:
                    if continuous and worker_id == 0:
                        try:
                            seed_verification(
                                connection, signature, candidate_type=config.candidate_type
                            )
                        except Exception as exc:
                            if not is_database_busy(exc):
                                raise
                            stop_event.wait(0.5)
                            continue
                    if not wait_for_due_jobs(
                        connection,
                        "verification_jobs",
                        "signature=?",
                        (signature,),
                        stop_event=stop_event,
                    ):
                        if not continuous:
                            break
                        report_queue.put(("idle", worker_id))
                        if stop_event.wait(poll_interval):
                            break
                    continue
                candidate = claim.candidate
                report_queue.put(("started", worker_id, candidate.game_id, candidate.ply))
                last_detail_at = 0.0
                last_lease_at = time.monotonic()

                def heartbeat() -> None:
                    nonlocal last_lease_at
                    timestamp = time.monotonic()
                    if stop_event.is_set():
                        raise WorkerCancelled("worker shutdown requested")
                    if timestamp - last_lease_at >= 30.0:
                        begin_write(connection, stop_event)
                        renew_claim(
                            connection, "verification_jobs", claim.id, candidate.claim_token
                        )
                        last_lease_at = timestamp

                def detail_progress(
                    branch: int, branch_total: int, solution_ply: int
                ) -> None:
                    nonlocal last_detail_at
                    heartbeat()
                    timestamp = time.monotonic()
                    if timestamp - last_detail_at >= 1.0:
                        report_queue.put(
                            (
                                "detail",
                                worker_id,
                                candidate.game_id,
                                candidate.ply,
                                branch,
                                branch_total,
                                solution_ply,
                            )
                        )
                        last_detail_at = timestamp

                try:
                    path = source_paths.get(candidate.source_database)
                    if path is None and not is_native_source(candidate.source_database):
                        status = fail_verification(
                            connection,
                            claim,
                            "source database is not installed",
                            max_attempts=max_attempts,
                            stop_event=stop_event,
                        )
                        puzzle_id = None
                    else:
                        engine.heartbeat = heartbeat
                        try:
                            status, puzzle_id = verify_candidate(
                                connection,
                                engine,
                                claim,
                                Path(path) if path is not None else None,
                                config,
                                progress=detail_progress,
                            )
                        except WorkerClaimLost:
                            raise
                        except (WorkerCancelled, EngineCancelled):
                            release_verification(connection, claim)
                            stop_event.set()
                            break
                        except VerificationInconclusive as exc:
                            status = fail_verification(
                                connection,
                                claim,
                                f"inconclusive: {exc}; settings={json.dumps(config.settings(), sort_keys=True)}",
                                max_attempts=max_attempts,
                                stop_event=stop_event,
                                inconclusive=True,
                            )
                            puzzle_id = None
                            report_queue.put(
                                (
                                    "warning",
                                    worker_id,
                                    candidate.game_id,
                                    candidate.ply,
                                    f"review: {exc} (incomplete; publication unchanged)",
                                )
                            )
                        except Exception as exc:
                            status = fail_verification(
                                connection,
                                claim,
                                f"{type(exc).__name__}: {exc}",
                                max_attempts=max_attempts,
                                stop_event=stop_event,
                            )
                            puzzle_id = None
                            report_queue.put(
                                (
                                    "warning",
                                    worker_id,
                                    candidate.game_id,
                                    candidate.ply,
                                    f"{status}: {type(exc).__name__}: {exc}",
                                )
                            )
                        finally:
                            engine.heartbeat = None
                except WorkerCancelled:
                    # Leave the lease recoverable if Stop interrupts a contended write.
                    break
                except WorkerClaimLost as exc:
                    report_queue.put(
                        ("warning", worker_id, candidate.game_id, candidate.ply, str(exc))
                    )
                    report_queue.put(("idle", worker_id))
                    continue
                report_queue.put(
                    (
                        "progress",
                        worker_id,
                        candidate.game_id,
                        candidate.ply,
                        status,
                        puzzle_id,
                    )
                )
        except Exception as exc:
            report_queue.put(("worker_error", worker_id, f"{type(exc).__name__}: {exc}"))
            raise
        finally:
            engine.close()
            connection.close()
            report_queue.put(("worker_done", worker_id))


def parse_args(default_type="checkmate_candidate") -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--candidate-type",
        choices=("checkmate_candidate", "tactic_candidate"),
        default=default_type,
    )
    parser.add_argument("--advantage", type=float, default=0.55)
    parser.add_argument("--uniqueness-gap", type=float, default=0.50)
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--engine", type=Path, default=_default_executable())
    parser.add_argument(
        "--workers", type=int, default=max(1, min(4, (os.cpu_count() or 2) // 2))
    )
    parser.add_argument("--engine-threads", type=int, default=1)
    parser.add_argument("--hash-mb", type=int, default=128)
    parser.add_argument("--depth", type=int, default=20)
    parser.add_argument("--max-uncertainty-retries", type=int, default=1)
    parser.add_argument("--max-solution-plies", type=int, default=31)
    parser.add_argument(
        "--max-positions",
        type=int,
        default=4096,
        help="tactic construction only; checkmates use a 300-second deadline",
    )
    parser.add_argument("--max-attempts", type=int, default=3)
    parser.add_argument(
        "--continuous",
        action="store_true",
        help="keep checking for newly mined candidates until interrupted",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=5.0,
        metavar="SECONDS",
        help="wait between checks when the queue is empty (default: 5 seconds)",
    )
    parser.add_argument("--source-db", action="append", type=Path)
    parser.add_argument(
        "--version",
        default=None,
        help="override the verifier logic revision",
    )
    parser.add_argument("--catalog-db", type=Path)
    parser.add_argument("--reconstruct-old-puzzles", action="store_true")
    parser.add_argument("--force-reverify", action="store_true")
    return parser.parse_args()


def main(default_type="checkmate_candidate") -> int:
    args = parse_args(default_type)
    if not 1 <= args.poll_interval <= 3600:
        raise SystemExit("poll-interval must be between 1 and 3600 seconds")
    if args.workers < 1 or args.engine_threads != 1:
        raise SystemExit(
            "workers must be positive; final verification requires one engine thread"
        )
    tactic = args.candidate_type == "tactic_candidate"
    config = (TacticVerifierConfig if tactic else VerifierConfig)(
        version=args.version or ("tactic-1" if tactic else CHECKMATE_VERIFIER_VERSION),
        depth=args.depth,
        max_uncertainty_retries=args.max_uncertainty_retries,
        max_solution_plies=args.max_solution_plies,
        engine_threads=args.engine_threads,
        hash_mb=args.hash_mb,
        **(
            {
                "advantage": args.advantage,
                "uniqueness_gap": args.uniqueness_gap,
                "max_positions": args.max_positions,
            }
            if tactic
            else {}
        ),
    )
    database = open_database_when_ready(args.database)
    if not args.engine.is_file():
        database.close()
        raise SystemExit(f"Pikafish is not installed at {args.engine}")
    with_engine = OfflinePikafish(args.engine, threads=1, hash_mb=args.hash_mb)
    try:
        signature = verification_signature(config, with_engine)
        seed_verification(
            database,
            signature,
            reconstruct=args.reconstruct_old_puzzles,
            force=args.force_reverify,
            candidate_type=config.candidate_type,
        )
    finally:
        with_engine.close()
    candidate_total = database.execute(
        "SELECT count(*) FROM verification_jobs WHERE signature=? AND status IN ('queued','retry','processing')",
        (signature,),
    ).fetchone()[0]
    dashboard = VerificationDashboard(
        database,
        signature,
        workers=args.workers,
        queued=candidate_total,
        kind="Tactic" if tactic else "Checkmate",
        continuous=args.continuous,
        poll_interval=args.poll_interval,
    )
    if not candidate_total and not args.continuous:
        dashboard.finish("No candidates waiting for verification")
        database.close()
        return 0
    paths = tuple(
        path.resolve()
        for path in (args.source_db or installed_catalog_database_paths())
        if path.is_file()
    )
    source_paths = catalog_source_paths(paths)
    missing_sources = [
        row[0]
        for row in database.execute(
            "SELECT DISTINCT c.source_database FROM verification_jobs j "
            "JOIN candidates c ON c.id=j.candidate_id "
            "WHERE j.signature=? AND j.status IN ('queued','retry','processing')",
            (signature,),
        )
        if not is_native_source(row[0]) and row[0] not in source_paths
    ]
    if missing_sources:
        database.close()
        raise SystemExit(
            "Source catalogs unavailable for: " + ", ".join(missing_sources)
        )
    context = mp.get_context("spawn")
    report_queue = context.Queue()
    stop_event = context.Event()
    workers = [
        context.Process(
            target=_worker_main,
            args=(
                worker_id,
                str(args.database.resolve()),
                str(args.engine.resolve()),
                source_paths,
                config,
                args.engine_threads,
                args.hash_mb,
                args.max_attempts,
                stop_event,
                report_queue,
                args.continuous,
                args.poll_interval,
                args.catalog_db,
                args.reconstruct_old_puzzles or args.force_reverify,
            ),
            name=f"{config.candidate_type}-verifier-{worker_id}",
        )
        for worker_id in range(args.workers)
    ]
    done_workers = 0
    idle_workers: set[int] = set()
    state = "Starting workers"
    workers_stopped = False

    try:
        start_workers(workers, stop_event)
        dashboard.render(state, force=True)
        while done_workers < len(workers):
            try:
                event = report_queue.get(timeout=2.0)
            except queue.Empty as exc:
                dead = [worker for worker in workers if not worker.is_alive()]
                if len(dead) > done_workers:
                    exitcodes = ", ".join(
                        f"{worker.name}={worker.exitcode}" for worker in dead
                    )
                    stop_workers(workers, stop_event)
                    raise RuntimeError(
                        "puzzle verification worker exited without a completion event: "
                        + exitcodes
                    ) from exc
                dashboard.render(state)
                continue
            if event[0] == "worker_error":
                raise RuntimeError(f"verification worker {event[1]} failed: {event[2]}")
            if event[0] == "started":
                _kind, _worker_id, game_id, ply = event
                idle_workers.discard(_worker_id)
                dashboard.active.add(_worker_id)
                state = "Verifying solutions"
            elif event[0] == "detail":
                _, _, game_id, ply, branch, branch_total, solution_ply = event
                state = f"Verifying {game_id} at ply {ply}: branch {branch}/{branch_total}, solution ply {solution_ply}"
            elif event[0] == "progress":
                _kind, _worker_id, game_id, ply, status, puzzle_id = event
                dashboard.record(status)
                dashboard.active.discard(_worker_id)
            elif event[0] == "warning":
                _, worker_id, game_id, ply, diagnostic = event
                dashboard.message(f"WARNING: {game_id} at ply {ply}: {diagnostic}")
            elif event[0] == "idle":
                idle_workers.add(event[1])
                dashboard.active.discard(event[1])
                if len(idle_workers) == len(workers):
                    state = "Waiting for new candidates"
            elif event[0] == "worker_done":
                done_workers += 1
                dashboard.active.discard(event[1])
            dashboard.render(state)
        stop_event.set()
        for worker in workers:
            worker.join()
        failed = [
            f"{worker.name}={worker.exitcode}" for worker in workers if worker.exitcode
        ]
        if failed:
            raise RuntimeError("verification workers failed: " + ", ".join(failed))
        dashboard.finish("Verification complete")
        return 0
    except KeyboardInterrupt:
        stop_workers(workers, stop_event)
        workers_stopped = True
        dashboard.finish("Stopped by user")
        return 130
    except Exception as exc:
        stop_workers(workers, stop_event)
        workers_stopped = True
        dashboard.message(f"ERROR: {exc}")
        dashboard.finish("Verification stopped by an error")
        raise
    finally:
        if not workers_stopped:
            stop_workers(workers, stop_event)
        database.close()


if __name__ == "__main__":
    mp.freeze_support()
    raise SystemExit(main())
