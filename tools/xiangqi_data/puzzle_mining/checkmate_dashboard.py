"""Collection-focused presentation for the checkmate categorizer."""

from __future__ import annotations

import time
import textwrap
import sqlite3

from .checkmate_inventory import CheckmateInventory, load_checkmate_inventory
from .progress import DashboardPrinter


class CheckmateDashboard:
    def __init__(self, connection: sqlite3.Connection, baseline: CheckmateInventory, *, workers: int,
                 queued: int, continuous: bool, poll_interval: float) -> None:
        self.connection = connection
        self.baseline = baseline
        self.inventory = baseline
        self.workers = workers
        self.queued = queued
        self.continuous = continuous
        self.poll_interval = poll_interval
        self.printer = DashboardPrinter()
        self.started_at = time.monotonic()
        self.refreshed_at = float("-inf")
        self.data_version = None
        self.completed = 0
        self.active: set[int] = set()

    def render(self, state: str, *, force: bool = False, final: bool = False) -> None:
        now = time.monotonic()
        # Poll the cheap SQLite change counter, never rescan the corpus for
        # every worker/branch event. Other categorizer processes are included.
        if force or now - self.refreshed_at >= 5:
            version = self.connection.execute("PRAGMA data_version").fetchone()[0]
            if force or version != self.data_version:
                self.inventory = load_checkmate_inventory(self.connection)
                self.data_version = version
            self.refreshed_at = now
        frame = self.frame(state, now)
        if final:
            self.printer.finish(frame)
        else:
            self.printer.update(frame, force=force)

    def frame(self, state: str, now: float) -> str:
        elapsed = max(0, int(now - self.started_at))
        hours, remainder = divmod(elapsed, 3600)
        minutes, seconds = divmod(remainder, 60)
        duration = f"{hours:d}:{minutes:02d}:{seconds:02d}"
        count = f"{self.completed:,} checked"
        if not self.continuous:
            count += f" / {self.queued:,} initially queued"
        lines = ["CHECKMATE COLLECTION", state,
                 f"{count} | {len(self.active)}/{self.workers} busy | {duration}"]
        inventory = self.inventory
        gain = inventory.counts.total - self.baseline.counts.total
        lines.extend(["", f"Detected puzzles: {inventory.counts.total:,} ({gain:+,} since start)"])
        narrow = self.printer.width < 72
        baseline = {row.theme: row.counts.total for row in self.baseline.categories}
        if narrow:
            lines.append("Category: total (change) | live / local")
            for row in inventory.categories:
                delta = row.counts.total - baseline.get(row.theme, 0)
                lines.extend([row.label,
                              f"  {row.counts.total:,} ({delta:+,}) | "
                              f"{row.counts.live_site_games:,} / {row.counts.local_database:,}"])
        else:
            label_width = max(22, min(36, max((len(row.label) for row in inventory.categories), default=22)))
            lines.append(f"{'Detecting':<{label_width}} {'Total':>9} {'Change':>9} {'Live site':>9} {'Local DB':>9}")
            lines.append("-" * (label_width + 40))
            for row in inventory.categories:
                delta = row.counts.total - baseline.get(row.theme, 0)
                lines.append(f"{row.label:<{label_width}} {row.counts.total:>9,} {delta:>+9,} "
                             f"{row.counts.live_site_games:>9,} {row.counts.local_database:>9,}")
        lines.extend(["", f"Live-site games  {inventory.counts.live_site_games:>9,}",
                      f"Local database   {inventory.counts.local_database:>9,}"])
        lines.extend(["", "Collection totals include previous runs; categories may overlap.",
                      "Change = net collection growth since startup."])
        if self.continuous:
            lines.append(f"New candidates checked every {self.poll_interval:g}s. Ctrl+C to stop.")
        if narrow:
            lines = [part for line in lines for part in (textwrap.wrap(line, self.printer.width) or [" "])]
        return "\n".join(lines)

    def message(self, message: str) -> None:
        self.printer.message(message)

    def finish(self, state: str) -> None:
        self.active.clear()
        self.render(state, force=True, final=True)
