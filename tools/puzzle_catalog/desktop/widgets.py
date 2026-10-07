"""Small Qt presentation helpers shared by studio workspaces."""

from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
import re
import threading
import sqlite3
from .queries import cancellable
from PySide6.QtCore import QAbstractTableModel, QModelIndex, Qt, QObject, QTimer, Signal
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QFrame,
    QVBoxLayout,
    QLabel,
    QPushButton,
    QTableView,
    QHeaderView,
    QAbstractItemView,
)

STATUS_LABELS = {
    "unpublished": "New - Ready for Publication",
    "awaiting_verification": "◷ Needs reconstruction",
    "awaiting_classification": "◷ Needs classification",
    "uncategorized": "◇ Uncategorized",
    "uncategorized_checkmate": "Uncategorized (Checkmate)",
    "single_solution_uncategorized_checkmate": "Single Solution, Uncategorized Checkmate",
    "uncategorized_tactic": "Uncategorized (Tactic)",
    "published": "● Published",
    "pending_retirement": "◷ Retirement pending",
    "retired": "○ Retired",
    "rejected": "× Rejected",
    "review": "! Needs review",
    "pending": "◷ Pending",
    "processing": "● Processing",
    "retry": "↻ Retry queued",
    "failed": "! Failed",
    "withdrawn": "○ Withdrawn",
}
STATUS_COLORS = {
    "unpublished": "#69BAFF",
    "awaiting_verification": "#F4BA60",
    "awaiting_classification": "#F4BA60",
    "uncategorized": "#A99AFF",
    "uncategorized_checkmate": "#A99AFF",
    "uncategorized_tactic": "#A99AFF",
    "published": "#38D9A0",
    "pending_retirement": "#F4BA60",
    "retired": "#8995A8",
    "rejected": "#FF8190",
    "review": "#F4BA60",
    "failed": "#FF8190",
}


def theme_name(value):
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", value).replace("_", " ").capitalize()


def label(text, role="body"):
    w = QLabel(text)
    w.setProperty("role", role)
    w.setWordWrap(True)
    return w


def button(text, callback, primary=False):
    w = QPushButton(text)
    if primary:
        w.setObjectName("PrimaryButton")
    w.clicked.connect(callback)
    return w


def card(title="", caption=""):
    w = QFrame()
    w.setObjectName("SurfaceCard")
    lay = QVBoxLayout(w)
    lay.setContentsMargins(20, 18, 20, 18)
    lay.setSpacing(12)
    if title:
        lay.addWidget(label(title, "section"))
    if caption:
        lay.addWidget(label(caption, "muted"))
    return w, lay


class RowsModel(QAbstractTableModel):
    def __init__(self, columns, rows=None, parent=None):
        super().__init__(parent)
        self.columns = columns
        self.rows = rows or []

    def rowCount(self, parent=QModelIndex()):
        return 0 if parent.isValid() else len(self.rows)

    def columnCount(self, parent=QModelIndex()):
        return 0 if parent.isValid() else len(self.columns)

    def data(self, index, role=Qt.DisplayRole):
        if not index.isValid():
            return None
        key = self.columns[index.column()][0]
        row = self.rows[index.row()]
        value = row.get(key, "")
        if role == Qt.DisplayRole:
            if key == "status":
                return STATUS_LABELS.get(value, value)
            if isinstance(value, list):
                return (
                    ", ".join(theme_name(v) for v in value)
                    if key == "themes"
                    else ", ".join(value)
                )
            if isinstance(value, bool):
                return "Yes" if value else ""
            return str(value or "")
        if role == Qt.ForegroundRole and key == "status":
            return QColor(STATUS_COLORS.get(value, "#A8B3C7"))
        if role == Qt.ToolTipRole:
            return str(value)
        return None

    def headerData(self, section, orientation, role=Qt.DisplayRole):
        if orientation == Qt.Horizontal and role == Qt.DisplayRole:
            return self.columns[section][1]
        return None

    def replace(self, rows):
        self.beginResetModel()
        self.rows = rows
        self.endResetModel()


def table(model):
    w = QTableView()
    w.setModel(model)
    w.setSelectionBehavior(QAbstractItemView.SelectRows)
    w.setSelectionMode(QAbstractItemView.ExtendedSelection)
    w.setEditTriggers(QAbstractItemView.NoEditTriggers)
    w.verticalHeader().hide()
    w.verticalHeader().setDefaultSectionSize(38)
    w.setAlternatingRowColors(True)
    w.setShowGrid(False)
    w.horizontalHeader().setSectionResizeMode(QHeaderView.Interactive)
    w.horizontalHeader().setStretchLastSection(True)
    return w


class ReadTasks(QObject):
    """Read queries off the GUI thread; discard superseded filter results."""

    error = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="studio-read")
        self.pending = {}
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.poll)
        self.timer.start(80)

    def submit(self, key, fn, callback):
        if key in self.pending:
            old, _, stop, _ = self.pending[key]
            stop.set()
            old.cancel()
        stop = threading.Event()

        def run():
            with cancellable(stop):
                if not stop.is_set():
                    return fn()

        self.pending[key] = (self.pool.submit(run), callback, stop, fn)

    def poll(self):
        for key, (future, callback, stop, fn) in list(self.pending.items()):
            if future.done():
                self.pending.pop(key)
                try:
                    callback(future.result())
                except sqlite3.OperationalError as exc:
                    if getattr(exc, "sqlite_errorcode", 0) & 255 in (
                        sqlite3.SQLITE_BUSY,
                        sqlite3.SQLITE_LOCKED,
                    ):
                        # An exclusive maintenance operation may briefly block even
                        # a WAL reader. Keep the current display and retry on the
                        # next refresh; normal engine writes do not block reads.
                        continue
                    self.error.emit(str(exc))
                except Exception as exc:
                    self.error.emit(str(exc))

    def close(self):
        self.timer.stop()
        for future, _, stop, _ in self.pending.values():
            stop.set()
            future.cancel()
        self.pool.shutdown(wait=True, cancel_futures=True)
        self.pending.clear()
