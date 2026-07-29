"""Infinite, interruptible retry support for transient SQLite lock contention."""

from __future__ import annotations

import sqlite3
import time
from collections.abc import Callable
from typing import TypeVar


T = TypeVar("T")


def is_locked(error: sqlite3.OperationalError) -> bool:
    message = str(error).casefold()
    return "locked" in message and ("database" in message or "table" in message)


class SqliteLockRetry:
    def __init__(
        self,
        *,
        message: Callable[[str], None] | None = None,
        interval: float = 1.0,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.message = message or (lambda value: print(value, flush=True))
        self.interval = interval
        self.sleep = sleep

    def run(self, operation: Callable[[], T], *, context: str) -> T:
        waiting = False
        while True:
            try:
                result = operation()
            except sqlite3.OperationalError as exc:
                if not is_locked(exc):
                    raise
                if not waiting:
                    self.message(
                        f"Explorer database is locked while {context}; "
                        f"retrying every {self.interval:g} second(s)."
                    )
                    waiting = True
                self.sleep(self.interval)
                continue
            if waiting:
                self.message("Explorer database is available; continuing.")
            return result
