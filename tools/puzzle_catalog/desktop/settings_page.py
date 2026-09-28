"""Operator settings, with path pickers and script-owned resource estimates."""

from __future__ import annotations
import os
import psutil
from PySide6.QtCore import Signal
from PySide6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QFormLayout,
    QLineEdit,
    QSpinBox,
    QCheckBox,
    QScrollArea,
    QFileDialog,
)
from .settings import Settings
from .widgets import card, label, button

HELP = {
    "verifier_workers": (
        "Verification workers per type",
        "Each of the checkmate and tactic verifier jobs uses this many engines.",
    ),
    "discovery_workers": (
        "Discovery workers",
        "Parallel games analyzed. Each worker runs its own engine. All stages share machine resources.",
    ),
    "categorizer_workers": (
        "Categorization workers per type",
        "Each of the checkmate and tactic categorizer jobs uses this many workers.",
    ),
    "poll_seconds": (
        "Worker idle poll (seconds)",
        "How often continuous verification and categorization check for new work when caught up.",
    ),
    "discovery_interval": (
        "Discovery idle interval (seconds)",
        "After a pass finishes, rescan local sources after this delay. This never downloads another production snapshot.",
    ),
    "refresh_seconds": (
        "Dashboard refresh (seconds)",
        "How often to read persisted progress. Does not change engine performance.",
    ),
    "page_size": (
        "Library page size",
        "Bounded table pages keep the library responsive as the collection grows.",
    ),
}
PATH_LABELS = {
    "python": "Worker Python",
    "mining_db": "Mining database",
    "catalog_db": "Authored puzzle catalog",
    "source_catalog": "Games database",
    "snapshot_dir": "Production snapshots",
    "engine": "Pikafish executable",
}


class SettingsPage(QWidget):
    saved = Signal(object)

    def __init__(self, settings, parent=None):
        super().__init__(parent)
        self.inputs = {}
        layout = QVBoxLayout(self)
        layout.addWidget(label("Settings", "title"))
        layout.addWidget(
            label(
                "Changes apply to the next run. Stop active operations before saving. Engine evaluation settings are fixed by each script version.",
                "muted",
            )
        )
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        layout.addWidget(scroll)
        body = QWidget()
        boxes = QVBoxLayout(body)
        scroll.setWidget(body)
        for title, names in [
            ("Compute & throughput", list(HELP)),
            ("Local paths & tools", list(PATH_LABELS)),
        ]:
            surface, inside = card(title)
            form = QFormLayout()
            form.setVerticalSpacing(12)
            inside.addLayout(form)
            boxes.addWidget(surface)
            for name in names:
                value = getattr(settings, name)
                if name in HELP:
                    text, tip = HELP[name]
                    field = QSpinBox()
                    field.setRange(1, 100_000_000)
                    if name in (
                        "discovery_workers",
                        "categorizer_workers",
                        "verifier_workers",
                    ):
                        field.setMaximum(128)
                    if name == "page_size":
                        field.setMaximum(500)
                    if name == "poll_seconds":
                        field.setMaximum(3600)
                    field.setValue(value)
                    field.setToolTip(tip)
                    caption = QWidget()
                    row = QHBoxLayout(caption)
                    row.setContentsMargins(0, 0, 0, 0)
                    row.addWidget(label(text))
                    info = label("i", "muted")
                    info.setObjectName("HelpIcon")
                    info.setToolTip(tip)
                    row.addWidget(info)
                    row.addStretch()
                else:
                    caption = PATH_LABELS[name]
                    field = QLineEdit(value)
                self.inputs[name] = field
                if name in PATH_LABELS:
                    holder = QWidget()
                    row = QHBoxLayout(holder)
                    row.setContentsMargins(0, 0, 0, 0)
                    row.addWidget(field)
                    row.addWidget(button("Browse…", lambda _, n=name: self.browse(n)))
                    form.addRow(caption, holder)
                else:
                    form.addRow(caption, field)
        surface, inside = card("Publication")
        for name, title in [
            ("preview_publication_origin", "Local Preview origin"),
            ("publication_origin", "Live Site HTTPS origin"),
        ]:
            origin = QLineEdit(getattr(settings, name))
            inside.addWidget(label(title))
            inside.addWidget(origin)
            self.inputs[name] = origin
        inside.addWidget(
            label(
                "Preview setup creates testing123 / testing123 and configures publishing automatically. Live uses your own puzzle:publish token and PuzzleCurator account.",
                "muted",
            )
        )
        boxes.addWidget(surface)
        boxes.addStretch()
        self.budget = label("", "muted")
        layout.addWidget(self.budget)
        for field in self.inputs.values():
            if isinstance(field, QSpinBox):
                field.valueChanged.connect(self.update_budget)
        self.update_budget()
        layout.addWidget(button("Save settings", self.save, True))

    def update_budget(self):
        val = lambda n: self.inputs[n].value()
        from tools.xiangqi_data.puzzle_mining.discovery import DiscoveryConfig
        from tools.xiangqi_data.puzzle_mining.verification import VerifierConfig
        from tools.xiangqi_data.puzzle_mining.checkmate import CategorizerConfig

        stages = (
            (val("discovery_workers"), DiscoveryConfig()),
            (val("verifier_workers"), VerifierConfig()),
            (val("categorizer_workers"), CategorizerConfig()),
            (val("verifier_workers"), VerifierConfig()),
            (val("categorizer_workers"), CategorizerConfig()),
        )
        threads = sum(workers * config.engine_threads for workers, config in stages)
        memory = sum(workers * config.hash_mb for workers, config in stages)
        available = int(psutil.virtual_memory().available / 1048576)
        warning = (
            "  High resource budget: leave room for Windows and the preview server."
            if threads > (os.cpu_count() or 1) or memory > available * 0.7
            else ""
        )
        self.budget.setText(
            f"Combined: up to {threads:,} CPU threads · {memory:,} MB hash memory, plus overhead. Machine: {os.cpu_count()} logical CPUs · {available:,} MB currently available."
            + warning
        )

    def browse(self, name):
        field = self.inputs[name]
        if name == "snapshot_dir":
            path = QFileDialog.getExistingDirectory(
                self, "Choose directory", field.text()
            )
        elif name in ("mining_db", "catalog_db"):
            path, _ = QFileDialog.getSaveFileName(
                self,
                "Choose database location",
                field.text(),
                "SQLite databases (*.sqlite3 *.db)",
            )
        else:
            path, _ = QFileDialog.getOpenFileName(self, "Choose file", field.text())
        if path:
            field.setText(path)

    def save(self):
        self.saved.emit(
            Settings(
                **{
                    name: (
                        field.isChecked()
                        if isinstance(field, QCheckBox)
                        else (
                            field.value()
                            if isinstance(field, QSpinBox)
                            else field.text().strip()
                        )
                    )
                    for name, field in self.inputs.items()
                }
            )
        )
