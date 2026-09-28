"""Terminal-friendly progress output shared by puzzle-mining commands."""

from __future__ import annotations

import sys
import time
import os
import shutil
from collections.abc import Mapping, Sequence
from typing import TextIO


def _supports_cursor(stream: TextIO) -> bool:
    if not getattr(stream, "isatty", lambda: False)() or os.environ.get("TERM") == "dumb":
        return False
    if os.name != "nt":
        return True
    # Windows consoles require virtual-terminal processing for ANSI redraws.
    # Redirected output and older consoles use plain snapshots instead.
    try:
        import ctypes
        import msvcrt

        kernel = ctypes.windll.kernel32
        handle = ctypes.c_void_p(msvcrt.get_osfhandle(stream.fileno()))
        mode = ctypes.c_ulong()
        return bool(kernel.GetConsoleMode(handle, ctypes.byref(mode)) and
                    kernel.SetConsoleMode(handle, mode.value | 0x0004))
    except (AttributeError, OSError, ValueError):
        return False


class DashboardPrinter:
    """Own a bounded terminal region; emit sparse snapshots in plain logs.

    Each row leaves the final terminal column unused to avoid auto-wrap.
    Never finish a frame merely because a worker is idle.
    """

    def __init__(self, *, stream: TextIO | None = None,
                 log_interval_seconds: float = 60.0) -> None:
        self.stream = sys.stdout if stream is None else stream
        self.is_terminal = _supports_cursor(self.stream)
        self.log_interval_seconds = log_interval_seconds
        self.last_printed_at = float("-inf")
        self.rows = 0
        self.last_frame = ""

    @property
    def width(self) -> int:
        return max(1, shutil.get_terminal_size((100, 30)).columns - 1) if self.is_terminal else 100

    def _clear(self) -> None:
        if self.rows:
            self.stream.write(f"\x1b[{self.rows}A\r\x1b[J")
            self.rows = 0

    def update(self, frame: str, *, force: bool = False) -> None:
        now = time.monotonic()
        interval = 0.25 if self.is_terminal else self.log_interval_seconds
        if not force and (now - self.last_printed_at < interval or frame == self.last_frame):
            return
        # Sanitize control characters from source identifiers and diagnostics.
        lines = ["".join(c if c.isprintable() else " " for c in line)
                 for line in frame.split("\n")]
        if self.is_terminal:
            height = max(1, shutil.get_terminal_size((100, 30)).lines - 1)
            lines = [line[:self.width] for line in lines[:height]]
            self._clear()
        elif self.last_frame:
            self.stream.write("\n")
        self.stream.write("\n".join(lines) + "\n")
        self.stream.flush()
        self.rows = len(lines) if self.is_terminal else 0
        self.last_printed_at = now
        self.last_frame = frame

    def message(self, message: str) -> None:
        self._clear()
        safe = "".join(c if c.isprintable() else " " for c in message)
        self.stream.write(safe + "\n")
        self.stream.flush()
        self.last_printed_at = float("-inf")

    def finish(self, frame: str) -> None:
        self.update(frame, force=True)
        self.rows = 0


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
