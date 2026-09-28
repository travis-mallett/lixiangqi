"""Cancellable writer acquisition shared by mining stages."""

import sqlite3


def is_database_busy(exc):
    return isinstance(exc, sqlite3.OperationalError) and (
        getattr(exc, "sqlite_errorcode", 0) & 255
        in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED)
        or str(exc) in ("database is locked", "database table is locked")
    )


def begin_write(connection, stop_event=None):
    """Acquire a writer without losing computed evidence; Stop interrupts contention.

    Only acquisition is retried. The caller owns commit/rollback and must recheck
    its assessment pointer after acquiring the lock. Keep the connection's normal
    timeout for the transaction itself and for callers without a worker lifecycle.
    """
    if stop_event is None or connection.in_transaction:
        connection.execute("BEGIN IMMEDIATE")
        return
    timeout = connection.execute("PRAGMA busy_timeout").fetchone()[0]
    connection.execute(f"PRAGMA busy_timeout={min(timeout, 250)}")
    try:
        while True:
            if stop_event.is_set():
                from .workers import WorkerCancelled

                raise WorkerCancelled("worker stopped while waiting for database")
            try:
                connection.execute("BEGIN IMMEDIATE")
                return
            except sqlite3.OperationalError as exc:
                if not is_database_busy(exc):
                    raise
                stop_event.wait(0.1)
    finally:
        connection.execute(f"PRAGMA busy_timeout={timeout}")
