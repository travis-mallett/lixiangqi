"""Cooperative cancellation for SQLite reads superseded by user navigation."""

from contextlib import contextmanager
import threading

_current = threading.local()


@contextmanager
def cancellable(event):
    _current.event = event
    try:
        yield
    finally:
        del _current.event


def attach(connection):
    event = getattr(_current, "event", None)
    if event is not None:
        connection.set_progress_handler(lambda: int(event.is_set()), 1000)
