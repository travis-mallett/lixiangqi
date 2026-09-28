"""Authoritative queue totals and bounded worker progress for discovery."""

from __future__ import annotations

import sqlite3
import time
from collections import Counter

from .progress import DashboardPrinter, format_progress
from .sources import is_native_source


class DiscoveryDashboard:
    def __init__(self, connection: sqlite3.Connection, version: str, workers: int,
                 *, continuous: bool = False, printer: DashboardPrinter | None = None):
        self.connection = connection
        self.version = version
        self.workers = workers
        self.continuous = continuous
        self.printer = printer or DashboardPrinter(log_interval_seconds=15)
        self.active: dict[int, str] = {}
        self.sources: dict[int, str] = {}
        self.results: Counter = Counter()
        self.counts: dict[str, Counter] = {}
        self.started_at = time.monotonic()
        self.refreshed_at = float('-inf')
        self.download = 'Live polling enabled' if continuous else 'Input preparation complete'

    def event(self, event: tuple) -> None:
        kind = event[0]
        if kind == 'started':
            self.sources[event[1]] = event[3]
            self.active[event[1]] = f'{event[2]}: starting'
        elif kind == 'detail':
            self.active[event[1]] = f'{event[3]} {event[4]:,}/{event[5]:,} | {event[2]}'
        elif kind == 'progress':
            self.active.pop(event[1], None)
            self.results[event[3]] += 1
            self.results['candidates'] += event[4]['stored']
        elif kind == 'worker_done':
            self.active.pop(event[1], None)
        elif kind == 'publication':
            self.active[event[1]] = event[2]
        elif kind == 'published':
            self.results[event[2]] += 1
        elif kind == 'download':
            self.download = f'Live sync: received {event[2]:,} game records; ' + ('caught up' if event[3] else 'downloading more pages')
        elif kind == 'download_error':
            self.download = f'Live sync retry: {event[1]}'

    def render(self, *, finish: bool = False) -> None:
        now = time.monotonic()
        # Query at a bounded rate, not once per position/worker. Persistent
        # states keep retries, restarts and concurrent ingestion out of the
        # completed count until the games really reach a terminal state.
        if finish or now - self.refreshed_at >= 5:
            self.counts = {'Site games': Counter(), 'Local catalogs': Counter()}
            for row in self.connection.execute(
                'SELECT source_database, status, count(*) AS n FROM game_jobs '
                'WHERE discovery_version = ? GROUP BY source_database, status', (self.version,)
            ):
                label = 'Site games' if is_native_source(row['source_database']) else 'Local catalogs'
                self.counts[label][row['status']] += row['n']
            self.refreshed_at = now
        remaining = sum(c['queued'] + c['retry'] + c['processing'] for c in self.counts.values())
        stage = 'Stage 3/3: evaluating games' if remaining else ('Waiting for new site games' if self.continuous and not finish else 'Queue drained')
        rows = [f'Puzzle discovery | {stage} | revision {self.version}', self.download]
        for label, counts in self.counts.items():
            total = sum(counts.values())
            resolved = counts['complete'] + counts['rejected'] + counts['failed']
            rows.append(format_progress(label, resolved, total, {}, (), width=16))
            rows.append(f"  complete {counts['complete']:,} | rejected {counts['rejected']:,} | failed {counts['failed']:,}")
            rows.append(f"  left {total-resolved:,} | queued {counts['queued']:,} | active {counts['processing']:,} | retry {counts['retry']:,}")
        elapsed = int(now - self.started_at)
        rows.append(f"This run: {self.results['complete']:,} completed | {self.results['candidates']:,} candidates stored | elapsed {elapsed//3600:02}:{elapsed//60%60:02}:{elapsed%60:02}")
        rows.append(f"Game analyses: {self.results['uploaded']:,} uploaded | {self.results['retained']:,} existing analyses retained")
        rows.append('Bars count resolved games, including prior runs; position counters show current engine work.')
        for worker in range(self.workers):
            source = self.sources.get(worker, '')
            label = ('site' if is_native_source(source) else source) if source else ''
            rows.append(f"Worker {worker+1} {label}: {self.active.get(worker, 'idle / waiting for work or retry')}")
        frame = '\n'.join(rows)
        if finish:
            self.printer.finish(frame)
        else:
            self.printer.update(frame)
