"""Verification progress, independent of category inventory."""

import time
from collections import Counter
from .progress import DashboardPrinter


class VerificationDashboard:
    def __init__(
        self,
        connection,
        signature,
        *,
        workers,
        queued,
        continuous,
        poll_interval,
        kind="Checkmate",
    ):
        self.connection = connection
        self.kind = kind
        self.signature = signature
        self.workers = workers
        self.queued = queued
        self.continuous = continuous
        self.poll_interval = poll_interval
        self.outcomes = Counter()
        self.active = set()
        self.started = time.monotonic()
        self.printer = DashboardPrinter()

    def record(self, status):
        self.outcomes[status] += 1

    def render(self, state, *, force=False, final=False):
        text = (
            f"{self.kind.upper()} VERIFICATION\n{state}\n"
            f"{sum(self.outcomes.values()):,} attempts finished / {self.queued:,} initially queued · "
            f"{len(self.active)}/{self.workers} busy · {int(time.monotonic() - self.started)}s\n"
            f"{self.outcomes['complete']:,} verified · {self.outcomes['incomplete']:,} incomplete · "
            f"{self.outcomes['invalid']:,} invalid · {self.outcomes['retry']:,} retries · "
            f"{self.outcomes['failed']:,} failed\n"
            "Solutions and required branches are saved independently of categories."
        )
        if final:
            self.printer.finish(text)
        else:
            self.printer.update(text, force=force)

    def message(self, text):
        self.printer.message(text)

    def finish(self, state):
        self.active.clear()
        self.render(state, force=True, final=True)
