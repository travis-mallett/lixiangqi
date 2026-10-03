"""Run the shared category workers, defaulting to checkmate candidates.

The tactic entry point selects its own candidate pool. Neither mode constructs
or extends solutions; both retain category evidence and project publication.
"""

from __future__ import annotations

import argparse
from contextlib import ExitStack, closing
from dataclasses import dataclass
import multiprocessing as mp
from pathlib import Path
import time

from tools.xiangqi_data.pikafish import _default_executable
from .classification_job import classify_solutions
from .engine import OfflinePikafish, EngineCancelled
from .storage import open_database, open_database_when_ready
from .workers import (
    WorkerCancelled,
    start_workers,
    stop_workers,
    watch_supervisor,
)

DEFAULT_DATABASE = Path("data/local/xiangqi-puzzle-mining.sqlite3")


@dataclass(frozen=True)
class CategorizerConfig:
    nodes: int = 20_000_000
    engine_threads: int = 1
    hash_mb: int = 128

    def __post_init__(self):
        if self.nodes < 1 or self.hash_mb < 1 or self.engine_threads != 1:
            raise ValueError(
                "Classification requires positive budgets and one engine thread"
            )


def _worker_main(index, args, stop, catalog_changed):
    with ExitStack() as resources:
        resources.enter_context(watch_supervisor(stop))
        connection = resources.enter_context(
            closing(open_database(args.database, initialize=False))
        )
        from .queue_priority import prepare_priority

        prepare_priority(connection, getattr(args, "catalog_db", None))
        # OfflinePikafish starts its process on the first inspection/search. Supply
        # it immediately so missing evidence is completed in this same pool pass.
        engine = resources.enter_context(
            closing(
                OfflinePikafish(
                    args.engine, threads=1, hash_mb=args.hash_mb, cancel_event=stop
                )
            )
        )
        try:
            while not stop.is_set():
                counts = classify_solutions(
                    connection,
                    stop_event=stop,
                    engine=engine,
                    nodes=args.nodes,
                    force=args.force_reclassify_same_version,
                    partition=index,
                    partitions=args.workers,
                    published_only=getattr(args, "published_only", None),
                    candidate_type=getattr(args, "candidate_type", "checkmate_candidate"),
                )
                # Force invalidates each category once. Engine retries must resume
                # the unfinished checks, not force completed categories again.
                args.force_reclassify_same_version = False
                if getattr(args, "catalog_db", None) and any(
                    counts.get(status)
                    for status in ("classified", "uncategorized", "category_conflict")
                ):
                    # Classification commits to mining; only the supervisor projects
                    # those changes into the authored catalog.
                    catalog_changed.set()
                print(f"Categorization worker {index + 1}: {counts}", flush=True)
                if not args.continuous or stop.wait(args.poll_interval):
                    break
        except (EngineCancelled, WorkerCancelled):
            if not stop.is_set():
                raise


def parse_args(default_type="checkmate_candidate"):
    kind = "tactic" if default_type == "tactic_candidate" else "checkmate"
    parser = argparse.ArgumentParser(
        description=f"Categorize verified {kind} solutions without constructing or extending their lines."
    )
    parser.add_argument(
        "--candidate-type",
        choices=("checkmate_candidate", "tactic_candidate"),
        default=default_type,
    )
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--catalog-db", type=Path)
    parser.add_argument("--engine", type=Path, default=_default_executable())
    parser.add_argument("--nodes", type=int, default=20_000_000)
    parser.add_argument("--hash-mb", type=int, default=128)
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--engine-threads", type=int, choices=[1], default=1)
    parser.add_argument("--continuous", action="store_true")
    parser.add_argument("--poll-interval", type=float, default=5)
    parser.add_argument("--force-reclassify-same-version", action="store_true")
    args = parser.parse_args()
    if args.force_reclassify_same_version and args.continuous:
        parser.error("explicit reclassification is a finite pass; omit --continuous")
    if args.workers < 1 or not 1 <= args.poll_interval <= 3600:
        parser.error("workers must be positive and poll interval between 1 and 3600")
    CategorizerConfig(args.nodes, args.engine_threads, args.hash_mb)
    return args


def _reconcile_catalog(args, catalog_changed):
    if not args.catalog_db or not catalog_changed.is_set():
        return
    from tools.puzzle_catalog.authoring import reconcile_assessments
    from tools.puzzle_catalog.catalog import PuzzleCatalog

    # Clear before reading: commits arriving during reconciliation must
    # schedule another pass rather than lose their notification.
    catalog_changed.clear()
    with PuzzleCatalog(args.catalog_db) as catalog:
        reconcile_assessments(catalog, args.database)


def main(default_type="checkmate_candidate"):
    args = parse_args(default_type)
    connection = open_database_when_ready(args.database)
    connection.close()
    context = mp.get_context("spawn")
    stop = context.Event()
    catalog_changed = context.Event()
    # Recover committed results left by an interrupted previous run.
    catalog_changed.set()
    # Explicit reclassification completes the live pass across every worker
    # (including engine evidence retries) before starting unpublished work.
    phases = (True, False) if args.force_reclassify_same_version else (None,)
    workers = []
    next_reconcile = 0.0

    try:
        for phase in phases:
            args.published_only = phase
            workers = [
                context.Process(
                    target=_worker_main,
                    args=(i, args, stop, catalog_changed),
                    name=f"{args.candidate_type}-classifier-{i}",
                )
                for i in range(args.workers)
            ]
            start_workers(workers, stop)
            while any(worker.is_alive() for worker in workers):
                if time.monotonic() >= next_reconcile:
                    _reconcile_catalog(args, catalog_changed)
                    next_reconcile = time.monotonic() + args.poll_interval
                for worker in workers:
                    worker.join(timeout=0.2)
                if any(worker.exitcode not in (None, 0) for worker in workers):
                    return 1
            if any(worker.exitcode != 0 for worker in workers):
                return 1
            # Finite runs (including each forced live/unpublished phase) flush
            # their final committed results before reporting completion.
            _reconcile_catalog(args, catalog_changed)
        return 0
    except KeyboardInterrupt:
        return 130
    finally:
        stop_workers(workers, stop)


if __name__ == "__main__":
    mp.freeze_support()
    raise SystemExit(main())
