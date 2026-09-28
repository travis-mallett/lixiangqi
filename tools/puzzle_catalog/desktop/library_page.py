"""A paged, filterable library with solution inspection and bulk moderation."""

from __future__ import annotations
import json
from pathlib import Path
from PySide6.QtCore import Signal, QTimer, Qt
from PySide6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QComboBox,
    QLineEdit,
    QSplitter,
    QInputDialog,
    QMessageBox,
    QDialog,
    QHeaderView,
    QDialogButtonBox,
    QListWidget,
    QListWidgetItem,
)
from .board import MoveNavigator
from .widgets import RowsModel, table, label, button, STATUS_LABELS, card, theme_name


class LibraryPage(QWidget):
    actionRequested = Signal(list, str, str)
    publishRequested = Signal()

    def __init__(self, repo, tasks, state_dir, page_size=100, parent=None):
        super().__init__(parent)
        self.repo = repo
        self.tasks = tasks
        self.state_dir = Path(state_dir)
        self.page_size = page_size
        self.offset = 0
        self.total = 0
        self._loaded = False
        self._facets = None
        self.selected_key = None
        self.current = None
        self.filters_path = self.state_dir / "saved-views.json"
        try:
            self.saved_views = json.loads(self.filters_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.saved_views = {}
        migrated = False
        for view in self.saved_views.values():
            if view.get("status") in {"new", "approved"}:
                view["status"] = "unpublished"
                migrated = True
        if migrated:
            from .settings import atomic_json
            import uuid

            backup = self.filters_path.with_name(
                f"saved-views.before-pipeline-status-{uuid.uuid4().hex[:8]}.json"
            )
            backup.write_bytes(self.filters_path.read_bytes())
            atomic_json(self.filters_path, self.saved_views)
        outer = QVBoxLayout(self)
        outer.addWidget(label("Puzzle library", "title"))
        outer.addWidget(
            label(
                "Verified uncategorized puzzles, new ready puzzles, and your local copy of published and retired puzzles. Changes are sent when you click Publish.",
                "muted",
            )
        )
        filters = QHBoxLayout()
        outer.addLayout(filters)
        self.search = QLineEdit()
        self.search.setPlaceholderText("Search puzzle ID or source game…")
        self.search.setClearButtonEnabled(True)
        filters.addWidget(self.search, 2)
        self.status = QComboBox()
        self.status.addItem("All pools", "all")
        for key in repo.LIBRARY_STATUSES:
            self.status.addItem(STATUS_LABELS[key], key)
        self.theme = QComboBox()
        self.theme.addItem("All themes", "")
        self.theme.setMinimumWidth(150)
        self.source = QComboBox()
        self.source.addItem("All sources", "")
        self.source.setMinimumWidth(130)
        for combo in (self.status, self.theme, self.source):
            filters.addWidget(combo, 1)
        views = QHBoxLayout()
        outer.addLayout(views)
        self.saved = QComboBox()
        self.saved.addItem("Saved views…")
        self.saved.addItems(sorted(self.saved_views))
        self.saved.activated.connect(self.apply_view)
        views.addWidget(self.saved)
        views.addWidget(button("Save view", self.save_view))
        views.addWidget(button("Select this page", lambda: self.table.selectAll()))
        views.addWidget(button("Reset filters", self.reset_filters))
        views.addStretch()
        self.sort = QComboBox()
        for text, key in [
            ("Newest first", "updated"),
            ("Puzzle ID", "id"),
            ("Source", "source"),
            ("Longest solution", "length"),
        ]:
            self.sort.addItem(text, key)
        views.addWidget(self.sort)
        views.addWidget(button("Refresh", self.refresh))
        split = QSplitter(Qt.Horizontal)
        outer.addWidget(split, 1)
        listing = QWidget()
        listing_l = QVBoxLayout(listing)
        listing_l.setContentsMargins(0, 0, 8, 0)
        self.model = RowsModel(
            [
                ("id", "Puzzle"),
                ("status", "Pool"),
                ("themes", "Tags"),
                ("changes", "Changes"),
            ]
        )
        self.table = table(self.model)
        self.table.setWordWrap(True)
        self.table.verticalHeader().setDefaultSectionSize(46)
        self.table.setColumnWidth(0, 65)
        self.table.setColumnWidth(1, 150)
        self.table.setColumnWidth(3, 90)
        self.table.horizontalHeader().setStretchLastSection(False)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
        listing_l.addWidget(self.table, 1)
        paging = QHBoxLayout()
        self.previous = button("← Previous", lambda: self.page(-1))
        self.next = button("Next →", lambda: self.page(1))
        self.count = label("Loading…", "muted")
        paging.addWidget(self.previous)
        paging.addWidget(self.count, 1)
        paging.addWidget(self.next)
        listing_l.addLayout(paging)
        moderation = QHBoxLayout()
        listing_l.addLayout(moderation)
        self.action_buttons = {}
        for title, action in [
            ("Reject", "reject"),
            ("Withdraw", "retire"),
            ("Restore", "restore"),
            ("Edit tags", "tags"),
        ]:
            control = button(title, lambda _, a=action: self.moderate(a))
            self.action_buttons[action] = control
            control.setEnabled(False)
            moderation.addWidget(control)
        moderation.addWidget(button("Publish", self.publishRequested.emit, True))
        self.selection = label(
            "Select puzzles to act on. Shift/Ctrl selects multiple puzzles.", "muted"
        )
        listing_l.addWidget(self.selection)
        split.addWidget(listing)
        detail, detail_l = card("Solution review")
        split.addWidget(detail)
        self.title = label("Select a puzzle", "section")
        detail_l.addWidget(self.title)
        self.navigator = MoveNavigator()
        detail_l.addWidget(self.navigator, 1)
        self.description = label(
            "Use the arrows to review the setup and accepted solution.", "muted"
        )
        self.description.setTextInteractionFlags(Qt.TextSelectableByMouse)
        detail_l.addWidget(self.description)
        notes = QHBoxLayout()
        notes.addWidget(button("Evidence && history", self.show_evidence))
        detail_l.addLayout(notes)
        split.setSizes([840, 460])
        split.setChildrenCollapsible(False)
        self.table.selectionModel().selectionChanged.connect(self.selected)
        self.debounce = QTimer(self)
        self.debounce.setSingleShot(True)
        self.debounce.setInterval(250)
        self.debounce.timeout.connect(self.apply_filters)
        self.search.textChanged.connect(lambda: self.debounce.start())
        for c in (self.status, self.theme, self.source, self.sort):
            c.currentIndexChanged.connect(self.apply_filters)

    def filter_args(self):
        return dict(
            query=self.search.text().strip(),
            status=self.status.currentData(),
            theme=self.theme.currentData() or "",
            source=self.source.currentData() or "",
            sort=self.sort.currentData(),
            offset=self.offset,
            limit=self.page_size,
            library=True,
        )

    def refresh(self, *, automatic=False):
        if automatic and "library" in self.tasks.pending:
            return
        args = self.filter_args()
        repo = self.repo
        self.tasks.submit(
            "library",
            lambda: repo.cached(
                ("page", tuple(args.items())), lambda: repo.page(**args)
            ),
            self.loaded,
        )

    def refresh_facets(self):
        repo = self.repo
        self.tasks.submit(
            "facets", lambda: repo.cached("facets", repo.facets), self.facets_loaded
        )

    def facets_loaded(self, data):
        if data == self._facets:
            return
        self._facets = data
        for combo, key, title in [
            (self.theme, "themes", "All themes"),
            (self.source, "sources", "All sources"),
        ]:
            previous = combo.currentData()
            combo.blockSignals(True)
            combo.clear()
            combo.addItem(title, "")
            for item in data[key]:
                combo.addItem(theme_name(item) if key == "themes" else item, item)
            if previous and combo.findData(previous) < 0:
                # Keep an active filter even if its last matching row vanished.
                combo.addItem(
                    theme_name(previous) if key == "themes" else previous, previous
                )
            index = combo.findData(previous)
            combo.setCurrentIndex(max(0, index))
            combo.blockSignals(False)

    def loaded(self, data):
        selected = self.selected_key
        if self.offset and self.offset >= data["total"]:
            self.offset = max(0, (data["total"] - 1) // self.page_size * self.page_size)
            self.refresh()
            return
        if (
            self._loaded
            and self.model.rows == data["rows"]
            and self.total == data["total"]
        ):
            # Selection/evidence may have changed while the compact listing did
            # not (for example a newly saved audit). Refresh only that detail.
            if selected and "detail" not in self.tasks.pending:
                self.load_detail(selected)
            return
        self._loaded = True
        selected_keys = {
            self.model.rows[index.row()]["key"]
            for index in self.table.selectionModel().selectedRows()
        }
        self.total = data["total"]
        self.table.selectionModel().blockSignals(True)
        self.model.replace(data["rows"])
        self.count.setText(
            f"{self.offset+1 if self.total else 0:,}–{min(self.offset+self.page_size,self.total):,} of {self.total:,}"
        )
        self.previous.setEnabled(self.offset > 0)
        self.next.setEnabled(self.offset + self.page_size < self.total)
        from PySide6.QtCore import QItemSelectionModel

        restored = False
        for index, row in enumerate(self.model.rows):
            if row["key"] in selected_keys:
                self.table.selectionModel().select(
                    self.model.index(index, 0),
                    QItemSelectionModel.Select | QItemSelectionModel.Rows,
                )
                restored = True
            if row["key"] == selected:
                self.table.selectionModel().setCurrentIndex(
                    self.model.index(index, 0), QItemSelectionModel.NoUpdate
                )
        if self.model.rows and not restored:
            self.table.selectRow(0)
        self.table.selectionModel().blockSignals(False)
        self.selected()
        if not self.model.rows:
            self.selected_key = None
            self.current = None
            self.title.setText("No matching puzzles")
            self.navigator.set_puzzle({})
            self.description.setText("Try another status, theme, or source filter.")

    def page(self, direction):
        self.offset = max(0, self.offset + direction * self.page_size)
        self.refresh()

    def apply_filters(self, *_):
        self.offset = 0
        self.refresh()

    def selected(self, *_):
        rows = self.table.selectionModel().selectedRows()
        items = [self.model.rows[r.row()] for r in rows]
        for action, control in self.action_buttons.items():
            control.setEnabled(
                bool(items)
                and all(
                    (
                        not item["published"]
                        if action == "reject"
                        else (
                            item["published"] and not item["document"].get("retired")
                            if action == "retire"
                            else (
                                item["published"] and item["document"].get("retired")
                                if action == "restore"
                                else True
                            )
                        )
                    )
                    for item in items
                )
            )
        self.selection.setText(
            f"{len(rows):,} selected · changes stay local until Publish"
        )
        index = self.table.currentIndex().row()
        if index < 0 and rows:
            index = rows[0].row()
        if not 0 <= index < len(self.model.rows):
            return
        key = self.model.rows[index]["key"]
        self.selected_key = key
        self.load_detail(key)

    def load_detail(self, key):
        repo = self.repo
        self.tasks.submit(
            "detail",
            lambda: repo.cached(("detail", key), lambda: repo.detail(key)),
            self.detail_loaded,
        )

    def detail_loaded(self, item):
        if not item or item["key"] != self.selected_key:
            return
        if item == self.current:
            return
        same_board = self.current and all(
            self.current.get(field) == item.get(field)
            for field in ("key", "fen", "line")
        )
        self.current = item
        self.title.setText(f"{item['id']} · {STATUS_LABELS[item['pool']]}")
        if not same_board:
            self.navigator.set_puzzle(item)
        lines = [
            ", ".join(theme_name(t) for t in item["themes"]) or "No themes assigned",
            f"Source: {item['source']} · Game: {item['gameId']}",
        ]
        if item["kind"] == "candidate":
            lines.append(
                "Unverified candidate: only the source setup is shown; no accepted solution exists yet."
            )
        if item["published"] and item["changed"]:
            lines.append("Changes will sync when you click Publish.")
        if item["diagnostic"]:
            lines.append(item["diagnostic"])
        self.description.setText("\n".join(lines))

    def moderate(self, action):
        keys = [
            self.model.rows[x.row()]["key"]
            for x in self.table.selectionModel().selectedRows()
        ]
        if not keys:
            return
        reason = ""
        if action == "tags":
            from ..publication import EDITABLE_THEMES

            dialog = QDialog(self)
            dialog.setWindowTitle("Edit tags")
            layout = QVBoxLayout(dialog)
            layout.addWidget(label("Replace tags for all selected puzzles:"))
            choices = QListWidget()
            current = (
                set(self.current["themes"])
                if len(keys) == 1 and self.current
                else set()
            )
            for tag in sorted(EDITABLE_THEMES | current):
                item = QListWidgetItem(theme_name(tag), choices)
                item.setData(Qt.UserRole, tag)
                item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
                item.setCheckState(Qt.Checked if tag in current else Qt.Unchecked)
            layout.addWidget(choices)
            controls = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
            controls.accepted.connect(dialog.accept)
            controls.rejected.connect(dialog.reject)
            layout.addWidget(controls)
            if dialog.exec() != QDialog.Accepted:
                return
            tags = [
                choices.item(i).data(Qt.UserRole)
                for i in range(choices.count())
                if choices.item(i).checkState() == Qt.Checked
            ]
            if not tags:
                return
            reason = json.dumps(tags)
        self.actionRequested.emit(keys, action, reason)

    def show_evidence(self):
        if not self.current:
            return
        box = QMessageBox(self)
        box.setWindowTitle("Puzzle evidence & review history")
        box.setText(self.current["id"])
        box.setInformativeText(
            "Read the retained verification evidence and moderation history below."
        )
        box.setDetailedText(
            json.dumps(
                {
                    "evidence": self.current["evidence"],
                    "moderation": self.current["moderation"],
                    "audit": self.current.get("audit", []),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        box.exec()

    def save_view(self):
        name, ok = QInputDialog.getText(self, "Save view", "View name:")
        if not ok or not name.strip():
            return
        view = self.filter_args()
        view.pop("offset")
        view.pop("limit")
        view.pop("library")
        self.saved_views[name.strip()] = view
        self.filters_path.write_text(
            json.dumps(self.saved_views, indent=2), encoding="utf-8"
        )
        self.saved.clear()
        self.saved.addItem("Saved views…")
        self.saved.addItems(sorted(self.saved_views))

    def apply_view(self, index):
        value = self.saved_views.get(self.saved.currentText())
        if not value:
            return
        self.search.setText(value["query"])
        for c, key in [
            (self.status, "status"),
            (self.theme, "theme"),
            (self.source, "source"),
            (self.sort, "sort"),
        ]:
            c.setCurrentIndex(max(0, c.findData(value[key])))
        self.apply_filters()

    def reset_filters(self):
        self.search.clear()
        for c in (self.status, self.theme, self.source):
            c.setCurrentIndex(0)
        self.apply_filters()
