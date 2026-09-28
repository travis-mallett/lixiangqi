"""Daily operations, live publication, and job monitoring for Puzzle Studio."""

from __future__ import annotations
from datetime import datetime, UTC
import json
from pathlib import Path
import uuid
from PySide6.QtCore import Qt, QTimer, QUrl
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (
    QMainWindow,
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QGridLayout,
    QStackedWidget,
    QProgressBar,
    QPlainTextEdit,
    QComboBox,
    QCheckBox,
    QDialog,
    QDialogButtonBox,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QScrollArea,
)
from .settings import Settings, ROOT, STATE, current_snapshot, atomic_json
from .settings_page import SettingsPage
from .library_page import LibraryPage
from .repository import ContentRepository
from .jobs import JobManager
from .credentials import publication_credentials
from .operations import command
from .widgets import label, button, card, ReadTasks, theme_name

GENERATION_JOBS = (
    "discovery",
    "verifier",
    "categorizer",
    "tactic_verifier",
    "tactic_categorizer",
)


class StudioWindow(QMainWindow):
    def __init__(self, settings_path: Path = STATE / "settings.json"):
        super().__init__()
        self.settings_path = Path(settings_path)
        self.state_dir = self.settings_path.parent
        self.settings = Settings.load(self.settings_path)
        self.settings.save(self.settings_path)
        self.repo = ContentRepository(
            Path(self.settings.catalog_db),
            Path(self.settings.mining_db),
            self.state_dir,
        )
        self.jobs = JobManager(ROOT, self.state_dir / "runs")
        self.tasks = ReadTasks(self)
        self.tasks.error.connect(self.read_error)
        self.audit_pending = self.state_dir / "pending-audit.json"
        self.auto_pending = False
        self.publish_pending = False
        self.close_pending = False
        self.last_stats = {}
        self.publication = {}
        self.publication_output_buffer = ""
        self.audit_output_buffer = ""
        self.setWindowTitle("LiXiangQi · Puzzle Studio")
        self.resize(1500, 960)
        self.setMinimumSize(1050, 720)
        self._build()
        self.jobs.output.connect(self.log_output)
        self.jobs.changed.connect(self.job_changed)
        self.jobs.finished.connect(self.job_finished)
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.refresh)
        self.timer.start(self.settings.refresh_seconds * 1000)
        QTimer.singleShot(0, self.refresh)
        self.job_changed("")
        for name, code in self.jobs.history()[-12:]:
            self.activity.appendPlainText(
                f"Previous run · {name}: "
                + (
                    "completed"
                    if code == 0
                    else (
                        "cancelled"
                        if code == 130
                        else f"exit {code}; saved log available"
                    )
                )
            )

    def _build(self):
        root = QWidget()
        self.setCentralWidget(root)
        layout = QHBoxLayout(root)
        layout.setContentsMargins(18, 18, 18, 18)
        layout.setSpacing(20)
        sidebar, side = card()
        sidebar.setFixedWidth(208)
        layout.addWidget(sidebar)
        side.addWidget(label("象", "brand"))
        side.addWidget(label("PUZZLE\nSTUDIO", "section"))
        side.addWidget(label("LiXiangQi authoring", "muted"))
        side.addSpacing(28)
        self.pages = QStackedWidget()
        layout.addWidget(self.pages, 1)
        self.nav = []
        for index, title in enumerate(
            ("Overview", "Puzzle library", "Publish", "Settings")
        ):
            b = button(title, lambda _, i=index: self.navigate(i))
            b.setCheckable(True)
            b.setObjectName("WorkspaceTab")
            side.addWidget(b)
            self.nav.append(b)
        side.addStretch()
        side.addWidget(label("LOCAL AUTHORING", "eyebrow"))
        side.addWidget(
            label(
                "User data stays owned by production. Preview writes are disposable.",
                "muted",
            )
        )
        side.addWidget(
            button(
                "Operating guide",
                lambda: QDesktopServices.openUrl(
                    QUrl.fromLocalFile(str(ROOT / "doc/PUZZLE_OPERATIONS.md"))
                ),
            )
        )
        self.pages.addWidget(self.overview())
        self.library = LibraryPage(
            self.repo, self.tasks, self.state_dir, self.settings.page_size
        )
        self.library.actionRequested.connect(self.moderate)
        self.library.publishRequested.connect(self.publish_all)
        self.pages.addWidget(self.library)
        self.pages.addWidget(self.publish_page())
        self.settings_page = SettingsPage(self.settings)
        self.settings_page.saved.connect(self.save_settings)
        self.pages.addWidget(self.settings_page)
        self.navigate(0)

    def overview(self):
        page = QWidget()
        outer = QVBoxLayout(page)
        outer.setSpacing(16)
        header = QHBoxLayout()
        titles = QVBoxLayout()
        titles.addWidget(label("Make the next great puzzle.", "title"))
        titles.addWidget(label("Discover → verify → categorize → publish", "muted"))
        header.addLayout(titles, 1)
        self.auto = button("Auto Start", self.auto_start, True)
        header.addWidget(self.auto)
        self.stop_all = button("Stop generation", self.stop_generation)
        header.addWidget(self.stop_all)
        outer.addLayout(header)
        self.banner = label(
            "Auto Start refreshes the published inventory, then starts discovery, verification and categorization. Discovery uploads each completed game analysis to the Live Site.",
            "notice",
        )
        outer.addWidget(self.banner)
        self.operation_progress = QProgressBar()
        self.operation_progress.setRange(0, 0)
        self.operation_progress.setTextVisible(True)
        self.operation_progress.hide()
        outer.addWidget(self.operation_progress)
        self.audit_status = label("", "muted")
        self.audit_status.hide()
        outer.addWidget(self.audit_status)
        metrics = self.pipeline_grid = QGridLayout()
        self.metrics = {}
        self.pipeline_cards = []
        for key, title, caption in [
            (
                "candidates",
                "Retained candidates",
                "All source positions, including unverified candidates",
            ),
            (
                "verified",
                "Verified solutions",
                "Verified checkmate and tactic solutions",
            ),
            (
                "awaiting_category",
                "Needs category updates",
                "Pool members not yet up to date",
            ),
            (
                "categorized",
                "Ready to publish",
                "Categorized puzzles ready to publish",
            ),
            ("published", "Published", "Active in the reconciled production snapshot"),
        ]:
            surface, inside = card()
            inside.addWidget(label(title, "muted"))
            value = label("—", "metric")
            inside.addWidget(value)
            inside.addWidget(label(caption, "small"))
            self.pipeline_cards.append(surface)
            self.metrics[key] = value
        outer.addLayout(metrics)
        stages = self.stage_grid = QGridLayout()
        self.stage_cards = []
        self.reconstruct_buttons = {}
        self.reclassify_buttons = {}
        self.stage_labels = {}
        self.stage_progress = {}
        self.stage_buttons = {}
        for name, title, caption in [
            (
                "discovery",
                "01  Discover candidates",
                "Search local games; upload each completed analysis to the Live Site.",
            ),
            (
                "verifier",
                "02  Verify & construct checkmates",
                "Save the mainline and all required equal-mate branches.",
            ),
            (
                "categorizer",
                "03  Categorize checkmates",
                "Check new or changed categories; reuse completed results.",
            ),
            (
                "tactic_verifier",
                "04  Verify & construct tactics",
                "Follow unique winning moves and best defense; retain endpoint evidence.",
            ),
            (
                "tactic_categorizer",
                "05  Categorize tactics",
                "Find Winning Material by Double Attack (捉双得子) and its capture endpoint.",
            ),
        ]:
            surface, inside = card(title, caption)
            status = label("Stopped", "section")
            inside.addWidget(status)
            progress = QProgressBar()
            progress.setRange(0, 100)
            progress.setValue(0)
            progress.setFormat("%p% of current queue resolved")
            inside.addWidget(progress)
            summary = label("Waiting for local data", "muted")
            inside.addWidget(summary)
            controls = QHBoxLayout()
            start = button("Start", lambda _, n=name: self.start_generation(n), True)
            stop = button("Stop", lambda _, n=name: self.jobs.stop(n))
            controls.addWidget(start)
            controls.addWidget(stop)
            if name == "discovery":
                self.rescan = button("Re-scan all…", self.rescan_discovery)
                controls.addWidget(self.rescan)
            if name in {"verifier", "tactic_verifier"}:
                self.reconstruct = button(
                    "Reconstruct old puzzles…",
                    lambda _, n=name: self.reconstruct_puzzles(n),
                )
                controls.addWidget(self.reconstruct)
                self.reconstruct_buttons[name] = self.reconstruct
            if name in {"categorizer", "tactic_categorizer"}:
                self.reclassify_all = button(
                    "Force recheck…", lambda _, n=name: self.reclassify_puzzles(n)
                )
                controls.addWidget(self.reclassify_all)
                self.reclassify_buttons[name] = self.reclassify_all
            controls.addStretch()
            inside.addLayout(controls)
            self.stage_labels[name] = (status, summary)
            self.stage_progress[name] = progress
            self.stage_buttons[name] = (start, stop)
            self.stage_cards.append(surface)
            stages.addWidget(surface, 0, len(self.stage_cards) - 1)
        self.reconstruct = self.reconstruct_buttons["verifier"]
        self.reclassify_all = self.reclassify_buttons["categorizer"]
        outer.addLayout(stages)
        self.generation_actions = [
            button("Refresh live snapshot", lambda: self.capture(False)),
            button("Use downloaded snapshot", self.reconcile),
            button(
                "Initialize local databases", lambda: self.start_operation("initialize")
            ),
            button("Audit published themes…", self.reclassify),
            button("Stop audit", lambda: self.jobs.stop("reclassify")),
        ]
        self.generation_action_grid = QGridLayout()
        outer.addLayout(self.generation_action_grid)
        self.reflow_generation()
        self.snapshot_status = label("Snapshot not loaded", "muted")
        outer.addWidget(self.snapshot_status)
        log_card, log_l = card("Activity & job output")
        outer.addWidget(log_card, 1)
        self.activity = QPlainTextEdit()
        self.activity.setReadOnly(True)
        self.activity.setMaximumBlockCount(1800)
        self.activity.setObjectName("ActivityLog")
        log_l.addWidget(self.activity, 1)
        log_actions = QHBoxLayout()
        self.log_choice = QComboBox()
        self.log_choice.addItem("Live activity")
        log_actions.addWidget(self.log_choice)
        log_actions.addWidget(button("Open selected log", self.open_log))
        log_actions.addWidget(
            button(
                "Open run history",
                lambda: QDesktopServices.openUrl(
                    QUrl.fromLocalFile(str(self.state_dir / "runs"))
                ),
            )
        )
        log_actions.addStretch()
        log_l.addLayout(log_actions)
        page.setMinimumHeight(850)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setWidget(page)
        return scroll

    def publish_page(self):
        page = QWidget()
        outer = QVBoxLayout(page)
        outer.addWidget(label("Publish", "title"))
        outer.addWidget(
            label(
                "Send ready puzzles, withdrawals, restorations, tag edits, and completed game analyses to the website. Existing analyses are replaced only by greater depth.",
                "muted",
            )
        )
        self.publish_preview = QCheckBox("Publish to Local Preview")
        self.publish_preview.setChecked(True)
        self.publish_live = QCheckBox("Publish to Live Site")
        outer.addWidget(self.publish_preview)
        self.preview_origin_label = label(
            self.settings.preview_publication_origin, "muted"
        )
        outer.addWidget(self.preview_origin_label)
        outer.addWidget(self.publish_live)
        self.live_origin_label = label(self.settings.publication_origin, "muted")
        outer.addWidget(self.live_origin_label)
        outer.addWidget(
            label(
                "Preview connects automatically as testing123. Live publishing prompts for your API token.",
                "muted",
            )
        )
        self.publish_button = button("Publish", self.publish_all, True)
        outer.addWidget(self.publish_button)
        self.publish_info = label(
            "Changes stay local until you publish. If the connection fails, click Publish again to resume safely.",
            "notice",
        )
        outer.addWidget(self.publish_info)
        self.publish_progress = QProgressBar()
        self.publish_progress.setRange(0, 1)
        self.publish_progress.setValue(0)
        self.publish_progress.setFormat("Ready to publish")
        outer.addWidget(self.publish_progress)
        outer.addStretch()
        return page

    def navigate(self, index):
        self.pages.setCurrentIndex(index)
        for i, b in enumerate(self.nav):
            b.setChecked(i == index)
        if index == 1:
            self.library.refresh()
            self.library.refresh_facets()

    def notice(self, text, error=False):
        self.banner.setText(text)
        self.banner.setProperty("error", error)
        self.banner.style().unpolish(self.banner)
        self.banner.style().polish(self.banner)
        self.statusBar().showMessage(text)

    def resizeEvent(self, event):
        super().resizeEvent(event)
        if hasattr(self, "generation_action_grid"):
            self.reflow_generation()

    def reflow_generation(self):
        horizontal = self.width() >= 1350
        columns = 5 if horizontal else 3
        for index, surface in enumerate(self.pipeline_cards):
            self.pipeline_grid.removeWidget(surface)
            self.pipeline_grid.addWidget(surface, index // columns, index % columns)
        for column in range(5):
            self.pipeline_grid.setColumnStretch(column, int(column < columns))
        columns = 3 if self.width() >= 1500 else 2 if self.width() >= 1200 else 1
        for index, card_widget in enumerate(self.stage_cards):
            self.stage_grid.removeWidget(card_widget)
            slot = (
                index
                if index < 5
                else ((5 + columns - 1) // columns) * columns + index - 5
            )
            self.stage_grid.addWidget(card_widget, slot // columns, slot % columns)
        action_columns = 5 if self.width() >= 1350 else 3
        for index, action in enumerate(self.generation_actions):
            self.generation_action_grid.removeWidget(action)
            self.generation_action_grid.addWidget(
                action, index // action_columns, index % action_columns
            )

    def read_error(self, text):
        self.notice(
            "Data view unavailable: "
            + text
            + ". If this is an older local mining database, choose Initialize local databases.",
            True,
        )

    def refresh(self):
        if "overview" not in self.tasks.pending:
            repo = self.repo
            self.tasks.submit(
                "overview",
                lambda: repo.cached(
                    "overview", lambda: (repo.stats(), repo.publication())
                ),
                self.stats_loaded,
            )
        if self.pages.currentIndex() == 1:
            self.library.refresh(automatic=True)
            if "facets" not in self.tasks.pending:
                self.library.refresh_facets()
        try:
            path = current_snapshot(self.settings)
            m = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
            timestamp = datetime.fromisoformat(m["createdAt"].replace("Z", "+00:00"))
            age = datetime.now(UTC) - timestamp
            self.snapshot_status.setText(
                f"Production snapshot: {m['createdAt']} · {max(0, int(age.total_seconds() / 3600)):,} hours old · {m['snapshotId']}"
            )
        except (OSError, ValueError, KeyError):
            self.snapshot_status.setText(
                "No downloaded preview snapshot yet. Publishing to Local Preview prepares one."
            )

    def stats_loaded(self, data):
        stats, self.publication = data
        self.last_stats = stats
        mining = stats["mining"]
        for key, value in stats["pipeline"].items():
            self.metrics[key].setText(f"{value:,}")
        discovery = mining["job_statuses"]
        total = sum(discovery.values())
        scanned = discovery.get("complete", 0) + discovery.get("rejected", 0)
        self.stage_progress["discovery"].setValue(
            round(scanned * 100 / total) if total else 0
        )
        self.stage_progress["discovery"].setFormat("%p% of source games scanned")
        self.stage_labels["discovery"][1].setText(
            f"{scanned:,} / {total:,} source games scanned · {discovery.get('retry', 0):,} retries · {discovery.get('failed', 0):,} failed"
        )
        verification = stats["verification"]
        total = verification["work_total"]
        ready = verification["eligible"]
        self.stage_progress["verifier"].setValue(
            round(verification["finished"] * 100 / total) if total else 0
        )
        self.stage_progress["verifier"].setFormat("%p% of verification work complete")
        self.stage_labels["verifier"][1].setText(
            f"{verification['finished']:,} / {total:,} candidates processed · {verification['remaining']:,} remaining\n"
            f"{ready:,} category-eligible solutions saved · {verification['older_proofs']:,} older complete proofs retained"
        )
        category = stats["category"]
        total = category["total_checks"]
        self.stage_progress["categorizer"].setValue(
            round(category["completed_checks"] * 100 / total) if total else 0
        )
        self.stage_progress["categorizer"].setFormat("%p% of category checks complete")
        self.stage_labels["categorizer"][1].setText(
            f"Pool: {category['pool']:,} solutions · {category['current']:,} up to date · {category['needs_checks']:,} need updates\n"
            f"Up to date: {category['matched']:,} with categories · {category['unmatched']:,} with no matching category\n"
            f"Category checks: {category['completed_checks']:,} / {total:,} complete · {category['inconclusive_checks']:,} inconclusive (retryable)"
        )
        for name in self.stage_labels:
            self.stage_labels[name][0].setText(
                "Running" if self.jobs.active(name) else "Stopped"
            )
        tactic = stats["tactic_category"]
        total = stats["tactic_verification"]["candidates"]
        ready = tactic["pool"]
        self.stage_progress["tactic_verifier"].setValue(
            round(ready * 100 / total) if total else 0
        )
        self.stage_progress["tactic_verifier"].setFormat("%p% have eligible solutions")
        self.stage_labels["tactic_verifier"][1].setText(
            f"{ready:,} / {total:,} tactic candidates have eligible solutions"
        )
        total = tactic["total_checks"]
        self.stage_progress["tactic_categorizer"].setValue(
            round(tactic["completed_checks"] * 100 / total) if total else 0
        )
        self.stage_progress["tactic_categorizer"].setFormat(
            "%p% of category checks complete"
        )
        self.stage_labels["tactic_categorizer"][1].setText(
            f"Pool: {ready:,} solutions · {tactic['matched']:,} categorized · {tactic['needs_checks']:,} need updates\n"
            f"{tactic['unmatched']:,} without a matching fork · {tactic['inconclusive_checks']:,} inconclusive"
        )
        if (
            not self.settings.preflight()
            and not self.jobs.any_active()
            and not self.last_stats["total"]
        ):
            self.notice(
                "Auto Start refreshes the published inventory. Categorized puzzles appear in the library; Publish syncs your local changes."
            )

    def check_idle(self, allow_generation=False):
        active = self.jobs.running_names()
        if allow_generation:
            active = [n for n in active if n not in GENERATION_JOBS]
        if active:
            self.notice(
                "Wait for or stop the active operation first: " + ", ".join(active),
                True,
            )
            return False
        return True

    def preflight(self, network=False):
        errors = self.settings.preflight(network)
        if errors:
            QMessageBox.warning(
                self,
                "Setup needed",
                "\n\n".join(errors) + "\n\nCorrect these paths in Settings.",
            )
            self.navigate(3)
            return False
        return True

    def start_operation(self, name, extra=(), cancellable=False):
        if not self.check_idle():
            return False
        if name == "publish":
            self.publication_output_buffer = ""
            self.publish_progress.setRange(0, 0)
            self.publish_progress.setFormat("Connecting and preparing changes…")
        argv = command(self.settings, name, self.settings_path, *extra)
        self.notice("Running " + name + "…")
        return self.jobs.start(name, argv, cancellable)

    def auto_start(self):
        self.capture(True)

    def capture(self, auto=False):
        if not self.check_idle() or not self.preflight(True):
            return
        if not publication_credentials(self, self.settings, ["live"]):
            return
        self.auto_pending = auto
        self.start_operation("prepare")

    def reconcile(self):
        if not self.check_idle() or not self.preflight():
            return
        self.start_operation("reconcile")

    def start_generation(self, name):
        if not self.check_idle(allow_generation=True) or not self.preflight():
            return
        if name == "discovery" and not publication_credentials(
            self, self.settings, ["live"]
        ):
            return
        self.jobs.start(name, command(self.settings, name, self.settings_path), True)
        self.notice(
            "Discovery uploads each completed game analysis to the Live Site."
            if name == "discovery"
            else "Generating puzzles locally. Review and publication remain separate."
        )

    def rescan_discovery(self):
        if not self.check_idle(allow_generation=True) or not self.preflight():
            return
        if (
            QMessageBox.question(
                self,
                "Re-scan all games?",
                "Reconcile known games again? Games are skipped only when a complete analysis reached the requested depth or higher.",
            )
            != QMessageBox.Yes
        ):
            return
        if not publication_credentials(self, self.settings, ["live"]):
            return
        self.jobs.start(
            "discovery",
            command(self.settings, "discovery", self.settings_path, "--rescan"),
            True,
        )
        self.notice("Reconciling games without sufficient completed analysis depth.")

    def reclassify_puzzles(self, name="categorizer"):
        if not self.check_idle(allow_generation=True) or not self.preflight():
            return
        if self.jobs.active(name):
            self.notice("Stop the categorizer before reclassifying puzzles.", True)
            return
        if (
            QMessageBox.question(
                self,
                "Force recheck category results?",
                "Repeat every category check on eligible saved solutions, even at the same version. Published puzzles run first. Normal Start already checks new and updated category versions automatically. Solutions are not reconstructed.",
            )
            != QMessageBox.Yes
        ):
            return
        self.draft_changed(
            "Classification may change categories. Publish when it finishes."
        )
        self.jobs.start(
            name,
            command(
                self.settings,
                name,
                self.settings_path,
                "--force-reclassify-same-version",
            ),
            True,
        )

    def reconstruct_puzzles(self, name="verifier"):
        if not self.check_idle(allow_generation=True) or not self.preflight():
            return
        if self.jobs.active(name):
            self.notice("Stop the verifier before reconstructing old puzzles.", True)
            return
        if (
            QMessageBox.question(
                self,
                "Reconstruct old puzzles?",
                "Verify published puzzles first, then candidates (including previously verified solutions and local drafts), with the current verifier configuration. Completed work under this configuration is skipped. Solutions remain unchanged until new verification completes.",
            )
            != QMessageBox.Yes
        ):
            return
        self.draft_changed(
            "Reconstruction may change solutions. Publish after categorization completes."
        )
        self.jobs.start(
            name,
            command(
                self.settings,
                name,
                self.settings_path,
                "--reconstruct-old-puzzles",
            ),
            True,
        )

    def stop_generation(self):
        self.auto_pending = False
        for name in GENERATION_JOBS:
            self.jobs.stop(name)
        self.notice(
            "Stopping owned generation workers. Completed work is saved; interrupted work resumes through the existing claim leases."
        )

    def moderate(self, keys, action, reason):
        if not self.check_idle(allow_generation=True):
            return
        request = self.state_dir / ("moderation-" + uuid.uuid4().hex + ".json")
        request.write_text(
            json.dumps(dict(keys=keys, action=action, reason=reason)), encoding="utf-8"
        )
        self.draft_changed("Local changes are ready to publish.")
        self.jobs.start(
            "moderate",
            command(
                self.settings, "moderate", self.settings_path, "--request", str(request)
            ),
            False,
        )

    def draft_changed(self, reason):
        self.publish_info.setText("Local changes are ready to sync with Publish.")

    def publish_all(self):
        destinations = [
            name
            for name, control in [
                ("preview", self.publish_preview),
                ("live", self.publish_live),
            ]
            if control.isChecked()
        ]
        if not destinations:
            self.notice(
                "Select Local Preview or Live Site in the Publish section.", True
            )
            self.navigate(2)
            return
        if not self.check_idle(allow_generation=True):
            return
        if not publication_credentials(self, self.settings, destinations):
            self.notice("Publication cancelled; no requests were sent.")
            return
        self.publication_destinations = destinations
        if self.jobs.any_active():
            self.publish_pending = True
            self.stop_generation()
            self.notice(
                "Pausing local generation; publication will start automatically."
            )
            return
        self.start_operation(
            "publish",
            ("--destinations", *self.publication_destinations),
            cancellable=True,
        )

    def reclassify(self):
        if not self.check_idle() or not self.preflight():
            return
        if not self.publication.get("snapshotId"):
            self.notice(
                "Refresh/reconcile the production snapshot before reclassifying published puzzles.",
                True,
            )
            return
        if self.audit_pending.exists():
            self.draft_changed("Resuming the interrupted frozen audit.")
            self.start_operation(
                "reclassify", ("--request", str(self.audit_pending)), cancellable=True
            )
            return
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            all_theme_versions,
        )

        dialog = QDialog(self)
        dialog.setWindowTitle("Reclassify published puzzles")
        dialog.resize(500, 550)
        layout = QVBoxLayout(dialog)
        layout.addWidget(
            label(
                "Optional audit: choose published themes to check against current logic. This is not required to prepare or publish changes. Membership is frozen from the last reconciled production inventory.",
                "muted",
            )
        )
        themes = QListWidget()
        layout.addWidget(themes, 1)
        for theme in sorted(all_theme_versions()):
            item = QListWidgetItem(theme_name(theme))
            item.setData(Qt.UserRole, theme)
            item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
            item.setCheckState(Qt.Unchecked)
            themes.addItem(item)
        layout.addWidget(
            label(
                "Completed category changes replace the puzzle; ineligible results retire it. Incomplete verification leaves publication unchanged. Changes remain local until you publish them.",
                "muted",
            )
        )
        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(dialog.accept)
        buttons.rejected.connect(dialog.reject)
        layout.addWidget(buttons)
        if dialog.exec() != QDialog.Accepted:
            return
        selected = [
            themes.item(i).data(Qt.UserRole)
            for i in range(themes.count())
            if themes.item(i).checkState() == Qt.Checked
        ]
        if not selected:
            return
        self.draft_changed(
            "Reclassification is updating the draft. Publish when the audit completes."
        )
        release = self.publication.get("deployedReleaseId") or "snapshot"
        atomic_json(
            self.audit_pending,
            dict(release=release, themes=selected),
        )
        self.start_operation(
            "reclassify", ("--request", str(self.audit_pending)), cancellable=True
        )

    def job_changed(self, name):
        busy = self.jobs.any_active()
        protected = [n for n in self.jobs.running_names() if n not in GENERATION_JOBS]
        auditing = self.jobs.active("reclassify")
        self.operation_progress.setVisible(bool(protected) or auditing)
        self.audit_status.setVisible(auditing or self.audit_pending.exists())
        if auditing:
            self.operation_progress.setTextVisible(True)
        elif protected:
            self.operation_progress.setRange(0, 0)
            self.operation_progress.setTextVisible(False)
        elif self.audit_pending.exists():
            self.show_pending_audit()
        self.auto.setEnabled(not busy)
        self.stop_all.setEnabled(any(self.jobs.active(n) for n in GENERATION_JOBS))
        for key, (start, stop) in self.stage_buttons.items():
            active = self.jobs.active(key)
            start.setEnabled(not active and not protected)
            stop.setEnabled(active)
            self.stage_labels[key][0].setText("Running" if active else "Stopped")
        self.rescan.setEnabled(not self.jobs.active("discovery") and not protected)
        for job, control in {
            **self.reclassify_buttons,
            **self.reconstruct_buttons,
        }.items():
            control.setEnabled(not self.jobs.active(job) and not protected)
        self.publish_button.setEnabled(not protected and not self.publish_pending)
        self.publish_preview.setEnabled(not protected and not self.publish_pending)
        self.publish_live.setEnabled(not protected and not self.publish_pending)
        self.log_choice.blockSignals(True)
        selected = self.log_choice.currentText()
        self.log_choice.clear()
        self.log_choice.addItem("Live activity")
        self.log_choice.addItems(self.jobs.log_paths())
        index = self.log_choice.findText(selected)
        self.log_choice.setCurrentIndex(max(0, index))
        self.log_choice.blockSignals(False)

    def log_output(self, name, text):
        if name == "publish":
            lines = (self.publication_output_buffer + text).splitlines(keepends=True)
            self.publication_output_buffer = ""
            if lines and not lines[-1].endswith(("\n", "\r")):
                self.publication_output_buffer = lines.pop()
            for line in lines:
                if not line.startswith("PUBLICATION_PROGRESS "):
                    self.activity.appendPlainText(f"[publish] {line.rstrip()}")
                    continue
                try:
                    progress = json.loads(line.removeprefix("PUBLICATION_PROGRESS "))
                    completed, total = (
                        int(progress["completed"]),
                        int(progress["total"]),
                    )
                    destination = progress["destination"]
                except (ValueError, KeyError, TypeError):
                    continue
                self.publish_progress.setRange(0, max(1, total))
                self.publish_progress.setValue(completed)
                action = (
                    "game analyses checked"
                    if progress.get("phase") == "analysis"
                    else "changes published"
                )
                self.publish_progress.setFormat(
                    f"{destination}: {completed:,} / {total:,} {action}"
                )
            return
        if name != "reclassify":
            self.activity.appendPlainText(f"[{name}] {text.rstrip()}")
            return
        buffered = self.audit_output_buffer + text
        lines = buffered.splitlines(keepends=True)
        self.audit_output_buffer = ""
        if lines and not lines[-1].endswith(("\n", "\r")):
            self.audit_output_buffer = lines.pop()
        for line in lines:
            line = line.rstrip("\r\n")
            if not line.startswith("AUDIT_PROGRESS "):
                if line:
                    self.activity.appendPlainText(f"[{name}] {line}")
                continue
            try:
                progress = json.loads(line.removeprefix("AUDIT_PROGRESS "))
                total = int(progress.get("overallTotal", progress["total"]))
                completed = int(progress.get("overallCompleted", progress["completed"]))
                remaining = int(progress.get("overallRemaining", progress["remaining"]))
                outcomes = progress["outcomes"]
            except (ValueError, KeyError, TypeError, json.JSONDecodeError):
                continue
            self.operation_progress.setRange(0, max(1, total))
            self.operation_progress.setValue(completed)
            self.operation_progress.setFormat(
                f"{progress['theme']} · {completed:,} / {total:,} evaluated · {remaining:,} remaining"
            )
            self.audit_status.setText(
                f"{progress['theme']} logic {progress['version']} · "
                f"{outcomes['qualifies']:,} qualify · "
                f"{outcomes['does_not_qualify']:,} do not qualify · "
                f"{outcomes['unresolved']:,} inconclusive"
            )

    def show_pending_audit(self):
        try:
            request = json.loads(self.audit_pending.read_text(encoding="utf-8"))
            from ..catalog import PuzzleCatalog

            with PuzzleCatalog(Path(self.settings.catalog_db)) as catalog:
                plans = [
                    catalog.audit_plan(request["release"], theme)
                    for theme in request["themes"]
                ]
            total = sum(plan["total"] for plan in plans)
            completed = sum(plan["completed"] for plan in plans)
            remaining = sum(plan["remaining"] for plan in plans)
            self.operation_progress.setRange(0, max(1, total))
            self.operation_progress.setValue(completed)
            self.operation_progress.setTextVisible(True)
            self.operation_progress.setFormat(
                f"Paused audit · {completed:,} / {total:,} evaluated · {remaining:,} remaining"
            )
            details = " · ".join(
                f"{theme_name(plan['theme'])} {plan['completed']:,}/{plan['total']:,}"
                for plan in plans
            )
            self.audit_status.setText(
                f"{details}. Reclassify published resumes this optional audit; publishing remains available."
            )
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
            self.audit_status.setText(
                "A paused audit request could not be read. Publishing remains available."
            )

    def job_finished(self, name, code):
        self.activity.appendPlainText(
            f"[{name}] "
            + (
                "Completed successfully"
                if code == 0
                else f"Stopped (exit {code}). Inspect the log for details."
            )
        )
        self.notice(
            f"{name}: "
            + (
                "completed"
                if code == 0
                else f"exit {code}; see Activity and the saved log"
            ),
            code not in (0, 130),
        )
        if self.publish_pending and not self.jobs.any_active():
            self.publish_pending = False
            self.start_operation(
                "publish",
                ("--destinations", *self.publication_destinations),
                cancellable=True,
            )
        if name == "prepare" and self.auto_pending:
            self.auto_pending = False
            if code == 0:
                for job in GENERATION_JOBS:
                    self.start_generation(job)
        if name == "publish":
            if self.publish_progress.maximum() == 0:
                self.publish_progress.setRange(0, 1)
                self.publish_progress.setValue(1 if code == 0 else 0)
                self.publish_progress.setFormat(
                    "Publication complete"
                    if code == 0
                    else "Publication stopped; see Activity"
                )
            if code == 0:
                self.notice("Publication confirmed for the selected destinations.")
        self.refresh()
        self.library.refresh()
        self.library.refresh_facets()
        if self.close_pending and not self.jobs.any_active():
            self.close()

    def open_log(self):
        path = self.jobs.log_paths().get(self.log_choice.currentText())
        QDesktopServices.openUrl(
            QUrl.fromLocalFile(str(path or self.state_dir / "runs"))
        )

    def save_settings(self, settings):
        if not self.check_idle():
            return
        try:
            settings.save(self.settings_path)
        except ValueError as exc:
            QMessageBox.warning(self, "Invalid settings", str(exc))
            return
        self.settings = settings
        self.tasks.close()
        self.repo.close()
        self.tasks = ReadTasks(self)
        self.tasks.error.connect(self.read_error)
        self.library.tasks = self.tasks
        self.repo = ContentRepository(
            Path(settings.catalog_db), Path(settings.mining_db), self.state_dir
        )
        self.library.repo = self.repo
        self.library.page_size = settings.page_size
        self.timer.setInterval(settings.refresh_seconds * 1000)
        self.preview_origin_label.setText(settings.preview_publication_origin)
        self.live_origin_label.setText(settings.publication_origin)
        self.draft_changed("Settings changed. Changes apply to the next publication.")
        self.notice("Settings saved. They will be used for the next run.")
        self.refresh()
        self.library.apply_filters()
        self.library.refresh_facets()

    def closeEvent(self, event):
        protected = self.jobs.protected()
        if protected:
            QMessageBox.information(
                self,
                "Operation in progress",
                "Wait for "
                + ", ".join(protected)
                + " to finish before closing. Its progress and logs remain available here.",
            )
            event.ignore()
            return
        if self.jobs.any_active():
            if (
                not self.close_pending
                and QMessageBox.question(
                    self,
                    "Stop generation and close?",
                    "Completed work is saved. Stop this panel’s workers and close?",
                    QMessageBox.Yes | QMessageBox.Cancel,
                    QMessageBox.Cancel,
                )
                != QMessageBox.Yes
            ):
                event.ignore()
                return
            self.close_pending = True
            self.publish_pending = False
            for name in self.jobs.running_names():
                self.jobs.stop(name)
            event.ignore()
            return
        self.timer.stop()
        self.tasks.close()
        self.repo.close()
        event.accept()
