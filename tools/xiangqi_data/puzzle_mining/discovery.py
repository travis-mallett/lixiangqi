"""Discover general Xiangqi puzzle candidates from recorded games.

Each position is evaluated at the full discovery budget. Each move is compared
from the mover's fixed perspective: Pikafish's best evaluation before the move
is compared with the evaluation after the played move (whose side-to-move score
is explicitly negated).
"""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import queue
import sqlite3
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from external.xiangqi_explorer.catalog_databases import (
    catalog_database_id,
    installed_catalog_database_paths,
)
from tools.xiangqi_data.pikafish import _default_executable
from tools.xiangqi_data.pikafish_rules import START_FEN

from .database_write import begin_write
from .engine import EngineCancelled, OfflinePikafish, PuzzleEngine
from .models import CandidateRecord, SearchContext, SearchResult, fen_side
from .position import (
    candidate_key,
    position_hash,
    replay_fens,
    puzzle_root_fen,
    PUZZLE_HISTORY_POLICY,
)
from .discovery_dashboard import DiscoveryDashboard
from .storage import (
    ClaimedJob,
    activate_discovery_version,
    cache_key,
    apply_discovery_result,
    cached_analysis,
    claim_game_job,
    fail_game_job,
    now,
    open_database,
    open_database_when_ready,
    reject_game_job,
    recover_stale_game_jobs,
    save_analysis,
)
from .workers import (
    WorkerCancelled,
    renew_claim,
    start_workers,
    stop_workers,
    watch_supervisor,
    wait_for_due_jobs,
)
from .snapshot_import import import_snapshot
from .sources import catalog_source_paths, load_game

from .discovery_settings import DEFAULT_DEPTH, DISCOVERY_REVISION, DISCOVERY_VERSION

DEFAULT_DATABASE = Path("data/local/xiangqi-puzzle-mining.sqlite3")


@dataclass(frozen=True)
class DiscoveryConfig:
    # Every position receives the full discovery search. A 0.50 expected-score
    # loss is a 25 percentage-point swing in normalized (win - loss)
    # probability, deliberately stricter than an ordinary move annotation
    # because the output must support a puzzle.
    depth: int = DEFAULT_DEPTH
    loss: float = 0.50
    tactic_advantage: float = 0.55
    max_mate_plies: int = 31
    engine_threads: int = 1
    hash_mb: int = 64

    def settings(self) -> dict[str, int | float | str]:
        return {
            "history_policy": PUZZLE_HISTORY_POLICY,
            "depth": self.depth,
            "loss": self.loss,
            "tactic_advantage": self.tactic_advantage,
            "max_mate_plies": self.max_mate_plies,
            "engine_threads": self.engine_threads,
            "hash_mb": self.hash_mb,
        }


AnalysisFunction = Callable[[SearchContext, int], SearchResult]
GameProgress = Callable[[str, int, int], None]


class DiscoveryInconclusive(RuntimeError):
    """The engine did not provide exact evidence for a nonterminal position."""


def seed_native_jobs(
    connection: sqlite3.Connection,
    discovery_version: str,
    *,
    rescan: bool = False,
    depth: int = DEFAULT_DEPTH,
) -> int:
    """Queue eligible snapshot sources without loading the game corpus into memory."""
    activate_discovery_version(connection, discovery_version)
    stamp = now()
    cursor = connection.execute(
        f"""INSERT OR IGNORE INTO game_jobs(
            discovery_version,source_database,game_id,source_url,created_at,updated_at)
            SELECT ?,n.source_database,n.game_id,n.source_url,?,?
            FROM native_games n JOIN source_snapshots s ON s.snapshot_id=n.snapshot_id
            WHERE NOT EXISTS (SELECT 1 FROM game_analysis_depths a
                WHERE a.source_database=n.source_database AND a.game_id=n.game_id
                AND a.depth>=?)
            ORDER BY n.source_database,n.game_id
            ON CONFLICT(discovery_version,source_database,game_id) DO UPDATE SET
              status='queued', attempts=0, diagnostic='', claim_token=NULL,
              claimed_at=NULL, next_attempt_at=NULL, updated_at=excluded.updated_at
            WHERE game_jobs.status='complete' OR
              (game_jobs.status='rejected' AND game_jobs.diagnostic='superseded by newer discovery revision')
""",
        (discovery_version, stamp, stamp, depth),
    )
    connection.commit()
    return cursor.rowcount


def discover_game(
    engine: PuzzleEngine,
    *,
    source_database: str,
    game_id: str,
    source_url: str,
    moves: list[str],
    initial_fen: str = START_FEN,
    config: DiscoveryConfig,
    analyse: AnalysisFunction | None = None,
    progress: GameProgress | None = None,
) -> list[CandidateRecord]:
    """Return candidates from a full-budget evaluation of every game position."""

    engine.new_game()
    fens = replay_fens(moves, initial_fen)
    contexts = [SearchContext(puzzle_root_fen(fen), ()) for fen in fens]
    search = analyse or (
        lambda context, depth: engine.analyse(context, depth=depth, multi_pv=1)
    )
    analyses: list[SearchResult | None] = []
    for ply in range(len(moves) + 1):
        if progress is not None:
            progress("evaluating", ply + 1, len(moves) + 1)
        result = search(contexts[ply], config.depth)
        # A terminal position has no legal move and therefore no principal
        # variation.  Only the final recorded position may be terminal; an
        # empty result earlier in the game means the engine failed to provide
        # evidence and the job must be retried rather than treated as a clean
        # non-candidate assessment.
        if not result.lines:
            if ply != len(moves):
                raise DiscoveryInconclusive(
                    f"missing principal variation at nonterminal ply {ply}"
                )
            # A UCI ``bestmove (none)`` is only terminal after cheap board
            # inspection confirms there are no legal moves.
            status = engine.inspect(contexts[ply])
            if status.legal_moves:
                raise DiscoveryInconclusive(
                    f"empty principal variation at nonterminal ply {ply}"
                )
        analyses.append(result if result.lines else None)

    candidates: list[CandidateRecord] = []
    for index, _played_move in enumerate(moves):
        before_result = analyses[index]
        after_result = analyses[index + 1]
        if before_result is None or after_result is None:
            continue
        before = before_result.primary.score
        after_for_mover = after_result.primary.score.negated()
        if before.bound is not None or after_for_mover.bound is not None:
            raise DiscoveryInconclusive(
                f"bounded evaluation at ply {index} cannot establish a loss"
            )
        # A move made from an already forced-mated position did not originate
        # the opportunity. Discovery must find the earlier mate transition.
        if before.kind == "mate" and before.value < 0:
            continue
        loss = before.expected() - after_for_mover.expected()
        candidate_type: str | None = None
        if after_for_mover.kind == "mate" and after_for_mover.value < 0:
            reported_plies = 2 * abs(after_for_mover.value) - 1
            if reported_plies <= config.max_mate_plies:
                candidate_type = "checkmate_candidate"
        elif (
            loss >= config.loss
            and -after_for_mover.expected() >= config.tactic_advantage
        ):
            candidate_type = "tactic_candidate"
        if candidate_type is None or before_result.best_move is None:
            continue
        position_fen = fens[index + 1]
        candidates.append(
            CandidateRecord(
                candidate_key=candidate_key(
                    position_fen, tuple(moves[: index + 1]), initial_fen
                ),
                source_database=source_database,
                game_id=game_id,
                source_url=source_url or "",
                ply=index + 1,
                side_to_move=fen_side(position_fen),
                pre_fen=fens[index],
                position_fen=position_fen,
                position_hash=position_hash(position_fen),
                played_move=moves[index],
                best_move=before_result.best_move,
                before_score=before,
                after_score=after_for_mover,
                evaluation_loss=loss,
                candidate_type=candidate_type,
                engine_version=after_result.engine_version,
                nnue=after_result.nnue,
                search_settings=config.settings(),
            )
        )
    return candidates


def seed_jobs(
    output: sqlite3.Connection,
    source_paths: tuple[Path, ...],
    max_games: int | None,
    discovery_version: str = DISCOVERY_VERSION,
    rescan: bool = False,
    progress: Callable[[int, int, str], None] | None = None,
    *,
    depth: int = DEFAULT_DEPTH,
) -> int:
    """Reconcile catalog jobs with set-based indexed SQLite operations."""

    activate_discovery_version(output, discovery_version)
    seeded = 0
    for index, path in enumerate(source_paths):
        source_database = catalog_database_id(path)
        schema = f"source_catalog_{index}"
        output.execute(f"ATTACH DATABASE ? AS {schema}", (str(path.resolve()),))
        try:
            limit = "" if max_games is None else " LIMIT ?"
            selected_games = (
                f"SELECT id, source_url FROM {schema}.games ORDER BY id{limit}"
            )
            params: list[object] = [
                discovery_version,
                source_database,
                now(),
                now(),
            ]
            if max_games is not None:
                params.append(max_games)
            completed_guard = """
              WHERE NOT EXISTS (
                SELECT 1 FROM game_analysis_depths a
                WHERE a.source_database = ? AND a.game_id = source_game.id
                  AND a.depth >= ?
              )
            """
            params.extend((source_database, depth))
            before = output.total_changes
            output.execute(
                f"""
                INSERT OR IGNORE INTO game_jobs(
                  discovery_version, source_database, game_id, source_url,
                  created_at, updated_at
                )
                SELECT ?, ?, source_game.id, coalesce(source_game.source_url, ''), ?, ?
                FROM ({selected_games}) source_game
                {completed_guard}
                ORDER BY source_game.id

            ON CONFLICT(discovery_version,source_database,game_id) DO UPDATE SET
              status='queued', attempts=0, diagnostic='', claim_token=NULL,
              claimed_at=NULL, next_attempt_at=NULL, updated_at=excluded.updated_at
            WHERE game_jobs.status='complete' OR
              (game_jobs.status='rejected' AND game_jobs.diagnostic='superseded by newer discovery revision')
                """,
                params,
            )
            seeded += output.total_changes - before
            output.commit()
        finally:
            output.execute(f"DETACH DATABASE {schema}")
        if progress is not None:
            progress(
                min(count_source_games((path,), max_games), max_games or 2**63 - 1),
                seeded,
                source_database,
            )
    return seeded


def count_source_games(source_paths: tuple[Path, ...], max_games: int | None) -> int:
    count = 0
    for path in source_paths:
        source = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
        try:
            count += int(source.execute("SELECT count(*) FROM games").fetchone()[0])
        finally:
            source.close()
        if max_games is not None and count >= max_games:
            return max_games
    return count


def _cached_search(
    connection: sqlite3.Connection,
    engine: OfflinePikafish,
    stop_event=None,
) -> AnalysisFunction:
    engine.start()

    def analyse(context: SearchContext, depth: int) -> SearchResult:
        context_key, settings_key = cache_key(
            context.initial_fen, context.moves, None, 1, depth=depth
        )
        cached = cached_analysis(
            connection,
            context_hash=context_key,
            engine_version=engine.engine_version,
            nnue=engine.nnue,
            settings_hash=settings_key,
        )
        if cached is not None:
            return cached
        result = engine.analyse(context, depth=depth, multi_pv=1)
        save_analysis(
            connection,
            context_hash=context_key,
            engine_version=engine.engine_version,
            nnue=engine.nnue,
            settings_hash=settings_key,
            result=result,
            stop_event=stop_event,
        )
        return result

    return analyse


def _process_job(
    connection: sqlite3.Connection,
    engine: OfflinePikafish,
    job: ClaimedJob,
    source_paths: dict[str, Path],
    config: DiscoveryConfig,
    max_attempts: int,
    discovery_version: str,
    progress: GameProgress | None = None,
    publication_origin: str | None = None,
    stop_event=None,
) -> tuple[str, dict[str, int]]:
    statistics = {
        "checkmate": 0,
        "tactic": 0,
        "stored": 0,
        "duplicate": 0,
    }
    try:
        source_game = load_game(
            connection, source_paths, job.source_database, job.game_id
        )
        moves = list(source_game.moves)
        started_at = now()
        started = time.monotonic()
        positions: list[dict] = []
        cached_search = _cached_search(connection, engine, stop_event)

        def record_analysis(context: SearchContext, depth: int) -> SearchResult:
            result = cached_search(context, depth)
            positions.append({"fen": context.initial_fen, "analysis": result.to_dict()})
            return result

        candidates = discover_game(
            engine,
            source_database=job.source_database,
            game_id=job.game_id,
            source_url=job.source_url,
            moves=moves,
            initial_fen=source_game.initial_fen or START_FEN,
            config=config,
            analyse=record_analysis,
            progress=progress,
        )
        for candidate in candidates:
            key = (
                "checkmate"
                if candidate.candidate_type == "checkmate_candidate"
                else "tactic"
            )
            statistics[key] += 1
        saved = apply_discovery_result(
            connection,
            job,
            candidates,
            game_analysis={
                "format_version": 1,
                "source_database": job.source_database,
                "game_id": job.game_id,
                "source_url": job.source_url,
                "initial_fen": source_game.initial_fen or START_FEN,
                "moves": moves,
                "settings": config.settings(),
                "discovery_version": discovery_version,
                "started_at": started_at,
                "elapsed_seconds": time.monotonic() - started,
                "positions": positions,
            },
            publication_origin=publication_origin,
            stop_event=stop_event,
        )
        if not saved:
            return "rejected", statistics
        statistics["stored"] = len(candidates)
        statistics["duplicate"] = 0
        return "complete", statistics
    except (ValueError, json.JSONDecodeError) as exc:
        reject_game_job(
            connection, job, f"{type(exc).__name__}: {exc}", stop_event=stop_event
        )
        return "rejected", statistics
    except LookupError as exc:
        reject_game_job(connection, job, str(exc), stop_event=stop_event)
        return "rejected", statistics
    except (EngineCancelled, WorkerCancelled):
        # The supervisor is shutting down.  Leave the claim for lease
        # recovery instead of recording a retry/failure for an intentional
        # cancellation.
        raise
    except Exception as exc:
        status = fail_game_job(
            connection,
            job,
            f"{type(exc).__name__}: {exc}",
            retryable=True,
            max_attempts=max_attempts,
            stop_event=stop_event,
        )
        return status, statistics


def _worker_main(
    worker_id: int,
    output_path: str,
    executable: str,
    source_paths: dict[str, str],
    config: DiscoveryConfig,
    engine_threads: int,
    hash_mb: int,
    max_attempts: int,
    discovery_version: str,
    stop_event: mp.synchronize.Event,
    report_queue: mp.Queue,
    publication_origin: str,
    pending_publications: list[int],
) -> None:
    from tools.puzzle_catalog.discovery_publication import publish_pending_analysis
    from tools.puzzle_catalog.live import Publisher

    watch_supervisor(stop_event)
    connection = open_database(Path(output_path), initialize=False)
    publisher = Publisher(publication_origin)
    engine = OfflinePikafish(
        Path(executable),
        threads=engine_threads,
        hash_mb=hash_mb,
        cancel_event=stop_event,
        high_performance=True,
    )
    try:

        def publish(job_id):
            result = publish_pending_analysis(
                connection,
                publisher,
                job_id,
                source_paths,
                stop_event,
                lambda message: report_queue.put(("publication", worker_id, message)),
            )
            if result:
                report_queue.put(("published", worker_id, result))

        for job_id in pending_publications:
            publish(job_id)
        while not stop_event.is_set():
            job = claim_game_job(connection, discovery_version=discovery_version)
            if job is None:
                # A retry may be delayed.  Keep the worker supervisor alive
                # until all work is actually drained instead of reporting
                # success while retry rows are still waiting for their timer.
                if not wait_for_due_jobs(
                    connection,
                    "game_jobs",
                    "discovery_version = ?",
                    (discovery_version,),
                    stop_event=stop_event,
                ):
                    break
                continue
            report_queue.put(("started", worker_id, job.game_id, job.source_database))
            last_detail_at = 0.0
            last_lease_at = 0.0

            def detail_progress(stage: str, current: int, total: int) -> None:
                nonlocal last_detail_at, last_lease_at
                timestamp = time.monotonic()
                if stop_event.is_set():
                    raise WorkerCancelled("worker shutdown requested")
                if timestamp - last_lease_at >= 30.0:
                    begin_write(connection, stop_event)
                    renew_claim(connection, "game_jobs", job.id, job.claim_token)
                    last_lease_at = timestamp
                if timestamp - last_detail_at >= 1.0:
                    report_queue.put(
                        (
                            "detail",
                            worker_id,
                            job.game_id,
                            stage,
                            current,
                            total,
                        )
                    )
                    last_detail_at = timestamp

            status, statistics = _process_job(
                connection,
                engine,
                job,
                {key: Path(value) for key, value in source_paths.items()},
                config,
                max_attempts,
                discovery_version,
                detail_progress,
                publication_origin,
                stop_event,
            )
            if status == "complete":
                publish(job.id)
            report_queue.put(
                (
                    "progress",
                    worker_id,
                    job.game_id,
                    status,
                    statistics,
                    job.source_database,
                )
            )
    except (WorkerCancelled, EngineCancelled):
        pass
    except Exception as error:
        report_queue.put(("publication_error", worker_id, str(error)))
        raise
    finally:
        engine.close()
        connection.close()
        report_queue.put(("worker_done", worker_id))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--engine", type=Path, default=_default_executable())
    parser.add_argument(
        "--workers", type=int, default=max(1, min(8, (os.cpu_count() or 2) // 2))
    )
    parser.add_argument("--engine-threads", type=int, default=1)
    parser.add_argument("--hash-mb", type=int, default=64)
    parser.add_argument("--depth", type=int, default=DEFAULT_DEPTH)
    parser.add_argument("--tactic-advantage", type=float, default=0.55)
    parser.add_argument("--max-mate-plies", type=int, default=31)
    parser.add_argument("--max-attempts", type=int, default=3)
    parser.add_argument("--source-db", action="append", type=Path)
    parser.add_argument("--max-games", type=int)
    parser.add_argument(
        "--publication-origin",
        default="https://lixiangqi.com",
        help="upload completed game analyses here; token comes from LIXIANGQI_PUZZLE_TOKEN",
    )
    parser.add_argument(
        "--version",
        default=DISCOVERY_REVISION,
        help="discovery algorithm revision (queue is also scoped by depth)",
    )
    parser.add_argument(
        "--rescan",
        action="store_true",
        help="reconcile sources again; equal or deeper completed analyses are still skipped",
    )
    parser.add_argument(
        "--snapshot",
        type=Path,
        help="verified production snapshot directory; never a preview database",
    )
    args = parser.parse_args()
    args.version = f"{args.version}-depth{args.depth}"
    return args


def _monitor_workers(
    args: argparse.Namespace, workers: list, report_queue: mp.Queue
) -> None:
    monitor = sqlite3.connect(f"{args.output.resolve().as_uri()}?mode=ro", uri=True)
    monitor.row_factory = sqlite3.Row
    dashboard = DiscoveryDashboard(
        monitor, args.version, args.workers, continuous=False
    )
    done = 0
    try:
        dashboard.render()
        while done < len(workers):
            try:
                event = report_queue.get(timeout=2.0)
            except queue.Empty:
                dead = [worker for worker in workers if not worker.is_alive()]
                if len(dead) > done:
                    raise RuntimeError(
                        "puzzle discovery worker exited without a completion event: "
                        + ", ".join(
                            f"{worker.name}={worker.exitcode}" for worker in dead
                        )
                    )
            else:
                if event[0] == "publication_error":
                    raise RuntimeError(f"Discovery worker {event[1] + 1}: {event[2]}")
                dashboard.event(event)
                if event[0] == "worker_done":
                    done += 1
            dashboard.render()
        for worker in workers:
            worker.join()
        dashboard.render(finish=True)
    finally:
        monitor.close()


def main() -> int:
    args = parse_args()
    if args.workers < 1 or args.engine_threads < 1:
        raise SystemExit("workers and engine-threads must be positive")
    if args.depth < 1:
        raise SystemExit("depth must be positive")
    if not args.engine.is_file():
        raise SystemExit(f"Pikafish is not installed at {args.engine}")
    paths = tuple(
        path.resolve()
        for path in (args.source_db or installed_catalog_database_paths())
        if path.is_file()
    )
    source_paths = catalog_source_paths(paths)
    from tools.puzzle_catalog.discovery_publication import (
        connect_discovery,
        pending_analysis_jobs,
    )

    publisher = connect_discovery(args.publication_origin)
    args.publication_origin = publisher.origin
    config = DiscoveryConfig(
        depth=args.depth,
        tactic_advantage=args.tactic_advantage,
        max_mate_plies=args.max_mate_plies,
        engine_threads=args.engine_threads,
        hash_mb=args.hash_mb,
    )
    output = open_database_when_ready(args.output.resolve())
    if args.snapshot:
        import_snapshot(output, args.snapshot.resolve(), args.version, depth=args.depth)
    source_total = count_source_games(paths, args.max_games)
    print("Reconciling new catalog games…", flush=True)
    seeded = seed_jobs(
        output, paths, args.max_games, args.version, args.rescan, depth=args.depth
    )
    # Requeue native games retained in the staging database when a newer
    # discovery revision is started without the live downloader.
    seed_native_jobs(output, args.version, rescan=args.rescan, depth=args.depth)
    recovered = recover_stale_game_jobs(output)
    print(
        f"Catalog reconciliation complete: {source_total:,} known game(s), "
        f"{seeded:,} newly queued, {recovered:,} expired claim(s) recovered.",
        flush=True,
    )
    job_total = int(
        output.execute(
            "SELECT count(*) FROM game_jobs "
            "WHERE discovery_version = ? AND status IN ('queued', 'retry', 'processing')",
            (args.version,),
        ).fetchone()[0]
    )
    pending_publications = pending_analysis_jobs(output, args.publication_origin)
    output.close()
    print(
        f"Candidate discovery: {job_total:,} queued game(s), "
        f"{seeded:,} newly queued, {len(pending_publications):,} saved uploads to retry, "
        f"{args.workers} worker(s). Completed analyses upload to {args.publication_origin}.",
        flush=True,
    )
    if job_total == 0 and not pending_publications:
        print("No games are waiting for candidate discovery.", flush=True)
        return 0
    context = mp.get_context("spawn")
    report_queue = context.Queue()
    stop_event = context.Event()
    workers = [
        context.Process(
            target=_worker_main,
            args=(
                worker_id,
                str(args.output.resolve()),
                str(args.engine.resolve()),
                source_paths,
                config,
                args.engine_threads,
                args.hash_mb,
                args.max_attempts,
                args.version,
                stop_event,
                report_queue,
                args.publication_origin,
                pending_publications[worker_id :: args.workers],
            ),
            name=f"puzzle-discovery-{worker_id}",
        )
        for worker_id in range(args.workers)
    ]
    start_workers(workers, stop_event)
    try:
        _monitor_workers(args, workers, report_queue)
        return int(any(worker.exitcode for worker in workers))
    finally:
        stop_workers(workers, stop_event)


if __name__ == "__main__":
    mp.freeze_support()
    sys.exit(main())
