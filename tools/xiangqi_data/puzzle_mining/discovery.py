"""Discover general Xiangqi puzzle candidates from recorded games.

Each move is evaluated from the mover's fixed perspective. Pikafish's best
evaluation before the move is compared with the evaluation after the played
move (whose side-to-move score is explicitly negated). A cheap screen is
followed by an independent deep validation before a candidate is persisted.
"""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
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

from .engine import OfflinePikafish, PuzzleEngine
from .models import CandidateRecord, SearchContext, SearchResult, fen_side
from .position import candidate_key, position_hash, replay_fens
from .progress import ProgressPrinter, format_progress
from .storage import (
    ClaimedJob,
    cache_key,
    cached_analysis,
    claim_game_job,
    fail_game_job,
    finish_game_job,
    insert_candidate,
    open_database,
    reject_game_job,
    save_analysis,
    seed_game_job,
)


DEFAULT_DATABASE = Path("data/local/xiangqi-puzzle-mining.sqlite3")
DISCOVERY_VERSION = "1"


@dataclass(frozen=True)
class DiscoveryConfig:
    # The 0.35 screen favors recall at low node count. Deep validation requires
    # a 0.50 expected-score loss: a 25 percentage-point swing in normalized
    # (win - loss) probability, deliberately stricter than an ordinary move
    # annotation because the output must support a puzzle.
    screen_nodes: int = 40_000
    validation_nodes: int = 600_000
    screen_loss: float = 0.35
    validation_loss: float = 0.50
    tactic_advantage: float = 0.55
    max_mate_plies: int = 31
    engine_threads: int = 1
    hash_mb: int = 64

    def settings(self) -> dict[str, int | float]:
        return {
            "screen_nodes": self.screen_nodes,
            "validation_nodes": self.validation_nodes,
            "screen_loss": self.screen_loss,
            "validation_loss": self.validation_loss,
            "tactic_advantage": self.tactic_advantage,
            "max_mate_plies": self.max_mate_plies,
            "engine_threads": self.engine_threads,
            "hash_mb": self.hash_mb,
        }


AnalysisFunction = Callable[[SearchContext, int], SearchResult]
GameProgress = Callable[[str, int, int], None]


def discover_game(
    engine: PuzzleEngine,
    *,
    source_database: str,
    game_id: str,
    source_url: str,
    moves: list[str],
    config: DiscoveryConfig,
    analyse: AnalysisFunction | None = None,
    progress: GameProgress | None = None,
) -> list[CandidateRecord]:
    """Return deeply verified candidates without retaining the complete game."""

    fens = replay_fens(moves)
    search = analyse or (
        lambda context, nodes: engine.analyse(context, nodes=nodes, multi_pv=1)
    )
    shallow: list[SearchResult] = []
    for ply in range(len(moves) + 1):
        if progress is not None:
            progress("screening", ply + 1, len(moves) + 1)
        shallow.append(search(SearchContext(START_FEN, tuple(moves[:ply])), config.screen_nodes))

    screened: list[int] = []
    for index, _played_move in enumerate(moves):
        before = shallow[index].primary.score
        after_for_mover = shallow[index + 1].primary.score.negated()
        loss = before.expected() - after_for_mover.expected()
        mate_transition = (
            after_for_mover.kind == "mate"
            and after_for_mover.value < 0
            and not (before.kind == "mate" and before.value < 0)
        )
        if mate_transition or loss >= config.screen_loss:
            screened.append(index)

    deep: dict[int, SearchResult] = {}
    validation_total = max(1, len(screened) * 2)

    def deep_at(ply: int) -> SearchResult:
        result = deep.get(ply)
        if result is None:
            if progress is not None:
                progress("validating", len(deep) + 1, validation_total)
            result = search(
                SearchContext(START_FEN, tuple(moves[:ply])),
                config.validation_nodes,
            )
            deep[ply] = result
        return result

    candidates: list[CandidateRecord] = []
    for index in screened:
        before_result = deep_at(index)
        after_result = deep_at(index + 1)
        before = before_result.primary.score
        after_for_mover = after_result.primary.score.negated()
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
            loss >= config.validation_loss
            and -after_for_mover.expected() >= config.tactic_advantage
        ):
            candidate_type = "tactic_candidate"
        if candidate_type is None or before_result.best_move is None:
            continue
        position_fen = fens[index + 1]
        candidates.append(
            CandidateRecord(
                candidate_key=candidate_key(
                    position_fen, tuple(moves[: index + 1])
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
    progress: Callable[[int, int, str], None] | None = None,
) -> int:
    seeded = 0
    seen = 0
    for path in source_paths:
        source_database = catalog_database_id(path)
        source = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
        source.row_factory = sqlite3.Row
        try:
            for row in source.execute("SELECT id, source_url FROM games ORDER BY id"):
                if max_games is not None and seen >= max_games:
                    output.commit()
                    return seeded
                seen += 1
                seeded += int(
                    seed_game_job(
                        output,
                        source_database,
                        row["id"],
                        row["source_url"] or "",
                        discovery_version=discovery_version,
                        commit=False,
                    )
                )
                if seen % 1_000 == 0:
                    output.commit()
                if progress is not None:
                    progress(seen, seeded, row["id"])
        finally:
            source.close()
    output.commit()
    return seeded


def count_source_games(
    source_paths: tuple[Path, ...], max_games: int | None
) -> int:
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


def _load_moves(path: Path, game_id: str) -> list[str]:
    source = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    try:
        row = source.execute("SELECT moves FROM games WHERE id = ?", (game_id,)).fetchone()
    finally:
        source.close()
    if row is None:
        raise LookupError(f"source game {game_id} was not found")
    moves = json.loads(row["moves"])
    if not isinstance(moves, list) or not all(isinstance(move, str) for move in moves):
        raise ValueError(f"source game {game_id} has an invalid move list")
    return moves


def _cached_search(
    connection: sqlite3.Connection,
    engine: OfflinePikafish,
) -> AnalysisFunction:
    engine.start()

    def analyse(context: SearchContext, nodes: int) -> SearchResult:
        context_key, settings_key = cache_key(context.initial_fen, context.moves, nodes, 1)
        cached = cached_analysis(
            connection,
            context_hash=context_key,
            engine_version=engine.engine_version,
            nnue=engine.nnue,
            settings_hash=settings_key,
        )
        if cached is not None:
            return cached
        result = engine.analyse(context, nodes=nodes, multi_pv=1)
        save_analysis(
            connection,
            context_hash=context_key,
            engine_version=engine.engine_version,
            nnue=engine.nnue,
            settings_hash=settings_key,
            result=result,
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
) -> tuple[str, dict[str, int]]:
    statistics = {
        "checkmate": 0,
        "tactic": 0,
        "stored": 0,
        "duplicate": 0,
    }
    path = source_paths.get(job.source_database)
    if path is None:
        reject_game_job(connection, job, "source database is not installed")
        return "rejected", statistics
    try:
        moves = _load_moves(path, job.game_id)
        candidates = discover_game(
            engine,
            source_database=job.source_database,
            game_id=job.game_id,
            source_url=job.source_url,
            moves=moves,
            config=config,
            analyse=_cached_search(connection, engine),
            progress=progress,
        )
        for candidate in candidates:
            key = (
                "checkmate"
                if candidate.candidate_type == "checkmate_candidate"
                else "tactic"
            )
            statistics[key] += 1
            if insert_candidate(connection, candidate) is not None:
                statistics["stored"] += 1
            else:
                statistics["duplicate"] += 1
        finish_game_job(connection, job, statistics["stored"])
        return "complete", statistics
    except (ValueError, json.JSONDecodeError) as exc:
        reject_game_job(connection, job, f"{type(exc).__name__}: {exc}")
        return "rejected", statistics
    except LookupError as exc:
        reject_game_job(connection, job, str(exc))
        return "rejected", statistics
    except Exception as exc:
        status = fail_game_job(
            connection,
            job,
            f"{type(exc).__name__}: {exc}",
            retryable=True,
            max_attempts=max_attempts,
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
    report_queue: mp.Queue,
) -> None:
    connection = open_database(Path(output_path))
    engine = OfflinePikafish(
        Path(executable), threads=engine_threads, hash_mb=hash_mb
    )
    try:
        while job := claim_game_job(connection, discovery_version=discovery_version):
            report_queue.put(("started", worker_id, job.game_id))
            last_detail_at = 0.0

            def detail_progress(stage: str, current: int, total: int) -> None:
                nonlocal last_detail_at
                timestamp = time.monotonic()
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
                detail_progress,
            )
            report_queue.put(
                ("progress", worker_id, job.game_id, status, statistics)
            )
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
    parser.add_argument("--screen-nodes", type=int, default=40_000)
    parser.add_argument("--validation-nodes", type=int, default=600_000)
    parser.add_argument("--screen-loss", type=float, default=0.35)
    parser.add_argument("--validation-loss", type=float, default=0.50)
    parser.add_argument("--tactic-advantage", type=float, default=0.55)
    parser.add_argument("--max-mate-plies", type=int, default=31)
    parser.add_argument("--max-attempts", type=int, default=3)
    parser.add_argument("--source-db", action="append", type=Path)
    parser.add_argument("--max-games", type=int)
    parser.add_argument("--version", default=DISCOVERY_VERSION, help="discovery algorithm revision")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.workers < 1 or args.engine_threads < 1:
        raise SystemExit("workers and engine-threads must be positive")
    if args.screen_nodes < 1 or args.validation_nodes < 1:
        raise SystemExit("node budgets must be positive")
    if not args.engine.is_file():
        raise SystemExit(f"Pikafish is not installed at {args.engine}")
    paths = tuple(
        path.resolve()
        for path in (args.source_db or installed_catalog_database_paths())
        if path.is_file()
    )
    if not paths:
        raise SystemExit("No installed Xiangqi catalog databases were found")
    source_paths = {catalog_database_id(path): str(path) for path in paths}
    config = DiscoveryConfig(
        screen_nodes=args.screen_nodes,
        validation_nodes=args.validation_nodes,
        screen_loss=args.screen_loss,
        validation_loss=args.validation_loss,
        tactic_advantage=args.tactic_advantage,
        max_mate_plies=args.max_mate_plies,
        engine_threads=args.engine_threads,
        hash_mb=args.hash_mb,
    )
    output = open_database(args.output.resolve())
    source_total = count_source_games(paths, args.max_games)
    queue_printer = ProgressPrinter()
    seeded_so_far = 0

    def queue_progress(seen: int, seeded: int, game_id: str) -> None:
        nonlocal seeded_so_far
        seeded_so_far = seeded
        queue_printer.update(
            format_progress(
                "Queueing game",
                seen,
                source_total,
                {"new jobs": seeded},
                ("new jobs",),
                detail=game_id,
            )
        )

    seeded = seed_jobs(output, paths, args.max_games, args.version, queue_progress)
    queue_printer.finish(
        format_progress(
            "Queued games",
            source_total,
            source_total,
            {"new jobs": seeded_so_far},
            ("new jobs",),
        )
    )
    job_total = int(
        output.execute(
            "SELECT count(*) FROM game_jobs "
            "WHERE discovery_version = ? AND status IN ('queued', 'retry', 'processing')",
            (args.version,),
        ).fetchone()[0]
    )
    output.close()
    print(
        f"Candidate discovery: {job_total:,} queued game(s), "
        f"{seeded:,} newly queued, {args.workers} worker(s).",
        flush=True,
    )
    if job_total == 0:
        print("No games are waiting for candidate discovery.", flush=True)
        return 0
    context = mp.get_context("spawn")
    report_queue = context.Queue()
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
                report_queue,
            ),
            name=f"puzzle-discovery-{worker_id}",
        )
        for worker_id in range(args.workers)
    ]
    for worker in workers:
        worker.start()
    started = 0
    completed = 0
    done_workers = 0
    current_game = ""
    totals = {
        "checkmate": 0,
        "tactic": 0,
        "stored": 0,
        "duplicate": 0,
        "rejected": 0,
        "retry/failed": 0,
    }
    progress_printer = ProgressPrinter()
    statistic_order = (
        "checkmate",
        "tactic",
        "stored",
        "duplicate",
        "rejected",
        "retry/failed",
    )
    while done_workers < len(workers):
        event = report_queue.get()
        if event[0] == "started":
            _kind, _worker_id, current_game = event
            started += 1
            progress_printer.update(
                format_progress(
                    "Checking game",
                    min(started, job_total),
                    job_total,
                    totals,
                    statistic_order,
                    detail=current_game,
                )
            )
        elif event[0] == "progress":
            _kind, _worker_id, current_game, status, statistics = event
            completed += 1
            for key in ("checkmate", "tactic", "stored", "duplicate"):
                totals[key] += statistics[key]
            totals["rejected"] += int(status == "rejected")
            totals["retry/failed"] += int(status in {"retry", "failed"})
            progress_printer.update(
                format_progress(
                    "Checking game",
                    min(max(started, completed), job_total),
                    job_total,
                    totals,
                    statistic_order,
                    detail=current_game,
                )
            )
        elif event[0] == "detail":
            _kind, _worker_id, current_game, stage, current, total = event
            progress_printer.update(
                format_progress(
                    "Checking game",
                    min(started, job_total),
                    job_total,
                    totals,
                    statistic_order,
                    detail=(
                        f"{current_game}  {stage} position "
                        f"{current:,}/{total:,}"
                    ),
                )
            )
        elif event[0] == "worker_done":
            done_workers += 1
    for worker in workers:
        worker.join()
    progress_printer.finish(
        format_progress(
            "Checked games",
            completed,
            job_total,
            totals,
            statistic_order,
        )
    )
    print(f"Candidate discovery complete after {completed:,} game(s).", flush=True)
    return int(any(worker.exitcode for worker in workers))


if __name__ == "__main__":
    mp.freeze_support()
    sys.exit(main())
