"""Terminal-friendly progress output shared by puzzle-mining commands."""

from __future__ import annotations

import sys
import time
from collections.abc import Mapping, Sequence
from typing import TextIO


def format_progress(
    action: str,
    current: int,
    total: int,
    statistics: Mapping[str, int],
    statistic_order: Sequence[str],
    *,
    detail: str = "",
    width: int = 24,
) -> str:
    bounded = min(current, total) if total else current
    ratio = bounded / total if total else 1.0
    filled = round(width * ratio)
    bar = "#" * filled + "-" * (width - filled)
    count = f"{current:,}/{total:,}" if total else f"{current:,}/0"
    stats = "  ".join(
        f"{name.replace('_', ' ')}: {statistics.get(name, 0):,}"
        for name in statistic_order
    )
    suffix = f"  {detail}" if detail else ""
    return f"[{bar}] {action} {count}  {stats}{suffix}".rstrip()


class ProgressPrinter:
    """Render in place on terminals and periodically in redirected logs."""

    def __init__(
        self,
        *,
        stream: TextIO = sys.stdout,
        log_interval_seconds: float = 5.0,
        terminal_interval_seconds: float = 0.1,
    ) -> None:
        self.stream = stream
        self.log_interval_seconds = log_interval_seconds
        self.terminal_interval_seconds = terminal_interval_seconds
        self.is_terminal = bool(getattr(stream, "isatty", lambda: False)())
        self.last_length = 0
        self.last_printed_at = 0.0

    def update(self, line: str, *, force: bool = False) -> None:
        timestamp = time.monotonic()
        if self.is_terminal:
            if (
                not force
                and timestamp - self.last_printed_at
                < self.terminal_interval_seconds
            ):
                return
            padding = " " * max(0, self.last_length - len(line))
            self.stream.write(f"\r{line}{padding}")
            self.stream.flush()
            self.last_length = len(line)
            self.last_printed_at = timestamp
            return
        if force or timestamp - self.last_printed_at >= self.log_interval_seconds:
            self.stream.write(line + "\n")
            self.stream.flush()
            self.last_printed_at = timestamp

    def finish(self, line: str) -> None:
        if self.is_terminal:
            padding = " " * max(0, self.last_length - len(line))
            self.stream.write(f"\r{line}{padding}\n")
            self.stream.flush()
            self.last_length = 0
        else:
            self.update(line, force=True)
