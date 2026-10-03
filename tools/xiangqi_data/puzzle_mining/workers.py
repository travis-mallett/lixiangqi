"""Lifecycle helpers shared by offline puzzle-mining worker commands.

Workers own their engine subprocesses.  The supervisor requests a graceful
stop first so the worker's ``finally`` block can close that subprocess, then
uses termination only as a last resort for a genuinely stuck child.
"""

from __future__ import annotations

import multiprocessing as mp
import threading
import time
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any


class WorkerCancelled(RuntimeError):
    """Raised inside a worker after its supervisor requests shutdown."""


class WorkerClaimLost(WorkerCancelled):
    """Only this claim was superseded; the worker can take another job."""


def supervisor_running() -> bool:
    """Whether the process that spawned this worker still exists.

    ``multiprocessing`` hands every spawned child a handle to its parent, so
    this reports the parent's exit directly instead of polling process tables.
    """

    parent = mp.parent_process()
    return parent is None or parent.is_alive()


@contextmanager
def watch_supervisor(
    stop_event: mp.synchronize.Event, *, interval: float = 1.0
):
    """Stop this worker once the supervisor that spawned it disappears.

    A pool outliving its supervisor keeps mining against the shared database
    and starves every later stage of the writer lock, and Windows job objects
    cannot contain descendants when the launcher itself runs inside a job.
    """

    finished = threading.Event()

    def watch() -> None:
        while not stop_event.is_set():
            if not supervisor_running():
                stop_event.set()
                return
            if finished.wait(interval):
                return

    # Never leave a daemon waiting on the pool's multiprocessing Event when a
    # worker exits: abandoned condition waiters can deadlock the next set().
    thread = threading.Thread(target=watch, name="supervisor-watch", daemon=True)
    thread.start()
    try:
        yield
    finally:
        finished.set()
        thread.join()


def renew_claim(
    connection: Any,
    table: str,
    claim_id: int,
    claim_token: str,
) -> None:
    """Refresh a lease and fail loudly if another worker owns the row."""

    if table not in {"game_jobs", "candidates", "verification_jobs"}:
        raise ValueError(f"unsupported worker table: {table}")
    timestamp = datetime.now(UTC).isoformat()
    updated = connection.execute(
        f"""
        UPDATE {table}
        SET claimed_at = ?, updated_at = ?
        WHERE id = ? AND claim_token = ? AND status = 'processing'
        """,
        (timestamp, timestamp, claim_id, claim_token),
    )
    connection.commit()
    if updated.rowcount != 1:
        raise WorkerClaimLost("worker claim lease was lost")


def wait_for_due_jobs(
    connection: Any,
    table: str,
    where_sql: str,
    where_params: tuple[Any, ...],
    *,
    stop_event: mp.synchronize.Event | None = None,
) -> bool:
    """Wait briefly for queued/delayed work; return false once drained."""

    if table not in {"game_jobs", "candidates", "verification_jobs"}:
        raise ValueError(f"unsupported worker table: {table}")
    while True:
        if stop_event is not None and stop_event.is_set():
            return False
        row = connection.execute(
            f"""
            SELECT count(*) AS active, min(next_attempt_at) AS next_attempt
            FROM {table}
            WHERE {where_sql} AND status IN ('queued', 'pending', 'processing', 'retry')
            """,
            where_params,
        ).fetchone()
        if not row or not row["active"]:
            return False
        if row["next_attempt"]:
            try:
                wait = max(
                    0.1,
                    min(
                        2.0,
                        datetime.fromisoformat(row["next_attempt"]).timestamp()
                        - time.time(),
                    ),
                )
            except (TypeError, ValueError):
                wait = 0.5
        else:
            wait = 0.5
        if stop_event is not None:
            stop_event.wait(wait)
        else:
            time.sleep(wait)
        return True


def stop_workers(
    workers: list[mp.Process], stop_event: mp.synchronize.Event, *, timeout: float = 5
) -> None:
    """Request graceful worker shutdown, then contain stuck processes."""

    stop_event.set()
    deadline = time.monotonic() + timeout
    for worker in workers:
        remaining = max(0.0, deadline - time.monotonic())
        worker.join(remaining)
    for worker in workers:
        if worker.is_alive():
            worker.terminate()
    for worker in workers:
        worker.join(timeout=2)


def start_workers(workers: list[mp.Process], stop_event: mp.synchronize.Event) -> None:
    """Start a worker group without leaving earlier children orphaned."""

    try:
        for worker in workers:
            worker.start()
    except BaseException:
        stop_workers(workers, stop_event)
        raise
