"""Offline UI fixtures and rendered smoke checks; never connect to production."""

import json
import os

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from PySide6.QtWidgets import QApplication, QMessageBox
from PySide6.QtGui import QFontDatabase
from tools.puzzle_catalog.desktop.settings import Settings
from tools.puzzle_catalog.desktop.window import StudioWindow
from tools.puzzle_catalog.desktop.theme import apply
from tools.puzzle_catalog.catalog import PuzzleCatalog, _json
from tools.xiangqi_data.puzzle_mining.storage import open_database
from tools.xiangqi_data.pikafish_rules import START_FEN


def fixture(root):
    mining = root / "mining.sqlite3"
    db = open_database(mining)
    db.close()
    catalog = root / "catalog.sqlite3"
    with PuzzleCatalog(catalog) as c:
        baseline = []
        for i in range(18):
            p = dict(
                _id=f"A{i:04}",
                gameId=f"game{i:04}",
                gameSource=dict(type="catalog", database="masters"),
                fen=START_FEN,
                line="a4a5 a7a6",
                themes=["centroidPawnMate"] if i % 2 else ["fork", "mate"],
                retired=False,
                retirementReason=None,
                sourceSnapshot=dict(
                    initialFen=START_FEN, moves=["a4a5", "a7a6"], players=[]
                ),
            )
            baseline.append(p)
            c.db.execute(
                "INSERT INTO catalog_puzzles VALUES(?,?,?)",
                (p["_id"], _json(p), _json({"status": "inherited"})),
            )
        c._set_meta("baseline", baseline)
        c._set_meta("snapshotId", "fixture-snapshot")
        c.db.commit()
    s = Settings(
        python=sys.executable,
        catalog_db=str(catalog),
        mining_db=str(mining),
        source_catalog=str(root / "source.sqlite3"),
        snapshot_dir=str(root / "snapshots"),
    )
    path = root / "settings.json"
    s.save(path)
    return path


class WindowTests(unittest.TestCase):
    def test_verification_progress_counts_attempts_including_rejections(self):
        from copy import deepcopy

        stats = deepcopy(self.window.last_stats)
        stats["verification"].update(
            work_total=10, finished=3, remaining=7, eligible=5329, older_proofs=7
        )
        self.window.stats_loaded((stats, self.window.publication))
        bar = self.window.stage_progress["verifier"]
        self.assertEqual(bar.value(), 30)
        self.assertIn("verification work", bar.format())
        label = self.window.stage_labels["verifier"][1].text()
        self.assertIn("3 / 10 candidates processed", label)
        self.assertIn("7 remaining", label)
        self.assertNotIn("need re-verification", label)
        out = Path("data/local/verification-queue-card.png")
        out.parent.mkdir(parents=True, exist_ok=True)
        self.assertTrue(bar.parentWidget().grab().save(str(out)))

    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])
        for font in ("segoeui.ttf", "segoeuib.ttf", "msyh.ttc", "consola.ttf"):
            path = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / font
            if path.is_file():
                QFontDatabase.addApplicationFont(str(path))
        apply(cls.app)

    def setUp(self):
        credentials = patch(
            "tools.puzzle_catalog.desktop.window.publication_credentials",
            return_value=True,
        )
        credentials.start()
        self.addCleanup(credentials.stop)
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.window = StudioWindow(fixture(self.root))
        self.window.show()
        self.pump()

    def pump(self):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            self.app.processEvents()
            time.sleep(0.02)

    def tearDown(self):
        self.window.close()
        self.app.processEvents()
        self.tmp.cleanup()

    def test_publication_progress_handles_split_process_output(self):
        event = 'PUBLICATION_PROGRESS {"completed":133,"total":949,"destination":"Local Preview"}\n'
        self.window.log_output("publish", event[:30])
        self.window.log_output("publish", event[30:])
        self.assertEqual(self.window.publish_progress.value(), 133)
        self.assertEqual(self.window.publish_progress.maximum(), 949)
        self.assertIn(
            "133 / 949 changes published", self.window.publish_progress.format()
        )
        self.window.log_output(
            "publish",
            'PUBLICATION_PROGRESS {"completed":10,"total":20,"destination":"Local Preview","phase":"analysis"}\n',
        )
        self.assertIn(
            "10 / 20 game analyses checked", self.window.publish_progress.format()
        )

    def test_settings_expose_only_administration_and_worker_counts(self):
        from tools.puzzle_catalog.desktop.settings import RETIRED_ENGINE_SETTINGS

        controls = self.window.settings_page.inputs
        self.assertFalse(set(controls) & RETIRED_ENGINE_SETTINGS)
        for name in ("discovery_workers", "verifier_workers", "categorizer_workers"):
            self.assertIn(name, controls)
        self.assertIn("CPU threads", self.window.settings_page.budget.text())

    def test_library_board_and_overview_are_live_views(self):
        self.assertEqual(self.window.metrics["published"].text(), "18")
        self.window.navigate(1)
        self.pump()
        self.assertEqual(self.window.library.total, 18)
        self.assertEqual(self.window.library.navigator.board.error, "")
        self.assertEqual(self.window.library.navigator.board.index, 2)
        self.window.library.navigator.board.navigate(1)
        self.assertEqual(self.window.library.navigator.board.index, 2)

    def test_theme_filter_and_pending_retirement(self):
        self.window.navigate(1)
        self.pump()
        library = self.window.library
        library.theme.setCurrentIndex(library.theme.findData("centroidPawnMate"))
        self.pump()
        self.assertEqual(library.total, 9)
        result = self.window.repo.moderate(["A0001"], "retire", "Manual review")
        self.assertTrue(result[0]["ok"])
        self.assertEqual(
            self.window.repo.detail("A0001")["status"], "pending_retirement"
        )
        self.assertEqual(self.window.repo.stats()["published"], 18)
        self.assertTrue(self.window.repo.moderate(["A0001"], "restore")[0]["ok"])
        self.assertEqual(self.window.repo.detail("A0001")["status"], "published")

    def test_live_library_refresh_preserves_selection_and_board_position(self):
        from PySide6.QtCore import QItemSelectionModel

        self.window.navigate(1)
        self.pump()
        library = self.window.library
        library.table.selectRow(1)
        library.table.selectionModel().select(
            library.model.index(3, 0),
            QItemSelectionModel.Select | QItemSelectionModel.Rows,
        )
        self.pump()
        library.navigator.board.navigate(-10000)
        selected = {
            library.model.rows[i.row()]["key"]
            for i in library.table.selectionModel().selectedRows()
        }
        with PuzzleCatalog(self.window.settings.catalog_db) as catalog, catalog.db:
            document = json.loads(
                catalog.db.execute(
                    "SELECT document FROM catalog_puzzles LIMIT 1"
                ).fetchone()[0]
            )
            document["_id"] = "Z9999"
            document["themes"] = ["anglerHorse"]
            catalog.db.execute(
                "INSERT INTO catalog_puzzles VALUES(?,?,?)",
                ("Z9999", _json(document), "{}"),
            )
        self.window.refresh()
        self.pump()
        self.assertEqual(library.total, 19)
        self.assertEqual(
            {
                library.model.rows[i.row()]["key"]
                for i in library.table.selectionModel().selectedRows()
            },
            selected,
        )
        self.assertEqual(library.navigator.board.index, 0)

    def test_incomplete_optional_audit_does_not_block_publish(self):
        self.window.audit_pending.write_text("{}")
        with (
            patch.object(self.window, "preflight", return_value=True),
            patch.object(self.window.jobs, "start", return_value=True) as start,
        ):
            self.window.publish_all()
        start.assert_called_once()
        self.assertEqual(start.call_args.args[0], "publish")

    def test_audit_output_sets_determinate_progress(self):
        payload = {
            "theme": "centroidPawnMate",
            "version": "1.3",
            "total": 108,
            "completed": 45,
            "remaining": 63,
            "outcomes": {
                "qualifies": 40,
                "does_not_qualify": 3,
                "unresolved": 2,
            },
        }
        line = "AUDIT_PROGRESS " + json.dumps(payload) + "\n"
        self.window.log_output("reclassify", line[:19])
        self.window.log_output("reclassify", line[19:])
        self.assertEqual(self.window.operation_progress.maximum(), 108)
        self.assertEqual(self.window.operation_progress.value(), 45)
        self.assertIn("63 remaining", self.window.operation_progress.format())
        self.assertIn("2 inconclusive", self.window.audit_status.text())

    def test_auto_start_waits_for_successful_preparation(self):
        with (
            patch.object(self.window, "preflight", return_value=True),
            patch.object(self.window.jobs, "start", return_value=True) as start,
        ):
            self.window.auto_start()
            self.assertEqual(
                [call.args[0] for call in start.call_args_list], ["prepare"]
            )
            self.window.job_finished("prepare", 0)
            self.assertEqual(
                [call.args[0] for call in start.call_args_list],
                [
                    "prepare",
                    "discovery",
                    "verifier",
                    "categorizer",
                    "tactic_verifier",
                    "tactic_categorizer",
                ],
            )
        self.window.auto_pending = True
        with patch.object(self.window.jobs, "start") as start:
            self.window.job_finished("prepare", 1)
            start.assert_not_called()

    def test_discovery_start_rescan_and_auto_start_require_live_credentials(self):
        for action in (
            self.window.auto_start,
            self.window.rescan_discovery,
            lambda: self.window.start_generation("discovery"),
        ):
            with (
                patch.object(self.window, "preflight", return_value=True),
                patch.object(QMessageBox, "question", return_value=QMessageBox.Yes),
                patch(
                    "tools.puzzle_catalog.desktop.window.publication_credentials",
                    return_value=False,
                ) as credentials,
                patch.object(self.window.jobs, "start") as start,
            ):
                action()
                credentials.assert_called_once_with(
                    self.window, self.window.settings, ["live"]
                )
                start.assert_not_called()

    def test_reconstruction_dispatches_only_explicit_verifier_work(self):
        with (
            patch.object(self.window, "preflight", return_value=True),
            patch.object(self.window.jobs, "start", return_value=True) as start,
            patch.object(QMessageBox, "question", return_value=QMessageBox.Yes),
        ):
            self.window.reconstruct_puzzles()
        self.assertEqual(start.call_args.args[0], "verifier")
        self.assertIn("--reconstruct-old-puzzles", start.call_args.args[1])

    def test_reclassification_button_dispatches_finite_category_pass(self):
        self.assertTrue(self.window.reclassify_all.isEnabled())
        with (
            patch.object(self.window, "preflight", return_value=True),
            patch.object(self.window.jobs, "start", return_value=True) as start,
            patch.object(QMessageBox, "question", return_value=QMessageBox.Yes),
        ):
            self.window.reclassify_all.click()
        self.assertEqual(start.call_args.args[0], "categorizer")
        self.assertIn("--force-reclassify-same-version", start.call_args.args[1])
        self.assertEqual(
            set(self.window.metrics),
            {"candidates", "verified", "awaiting_category", "categorized", "published"},
        )

    def test_rescan_requires_confirmation_and_uses_explicit_flag(self):
        with (
            patch.object(self.window, "preflight", return_value=True),
            patch.object(self.window.jobs, "start", return_value=True) as start,
            patch(
                "tools.puzzle_catalog.desktop.window.QMessageBox.question",
                return_value=QMessageBox.Yes,
            ),
        ):
            self.window.rescan_discovery()
        start.assert_called_once()
        self.assertEqual(start.call_args.args[0], "discovery")
        self.assertIn("--rescan", start.call_args.args[1])

        with (
            patch.object(self.window, "preflight", return_value=True),
            patch.object(self.window.jobs, "start") as start,
            patch(
                "tools.puzzle_catalog.desktop.window.QMessageBox.question",
                return_value=QMessageBox.No,
            ),
        ):
            self.window.rescan_discovery()
        start.assert_not_called()

    def test_publish_pauses_generation_and_continues_automatically(self):
        with (
            patch.object(
                self.window.jobs, "running_names", return_value=["categorizer"]
            ),
            patch.object(self.window.jobs, "any_active", return_value=True),
            patch.object(self.window.jobs, "stop") as stop,
        ):
            self.window.publish_all()
            self.assertTrue(self.window.publish_pending)
            self.assertEqual(stop.call_count, 5)
        with patch.object(self.window, "start_operation") as start:
            self.window.job_finished("categorizer", 130)
            start.assert_called_once_with(
                "publish", ("--destinations", "preview"), cancellable=True
            )
            self.assertFalse(self.window.publish_pending)

    def test_publication_destinations_default_preview_and_allow_both(self):
        self.assertTrue(self.window.publish_preview.isChecked())
        self.assertFalse(self.window.publish_live.isChecked())
        with patch.object(self.window, "start_operation") as start:
            self.window.publish_all()
            start.assert_called_with(
                "publish", ("--destinations", "preview"), cancellable=True
            )
            self.window.publish_live.setChecked(True)
            self.window.publish_all()
            start.assert_called_with(
                "publish", ("--destinations", "preview", "live"), cancellable=True
            )
            self.window.publish_preview.setChecked(False)
            self.window.publish_all()
            start.assert_called_with(
                "publish", ("--destinations", "live"), cancellable=True
            )
            self.window.publish_live.setChecked(False)
            start.reset_mock()
            self.window.publish_all()
            start.assert_not_called()

    def test_publish_is_one_step_without_review_or_confirmation(self):
        with (
            patch.object(self.window.jobs, "start") as start,
            patch.object(QMessageBox, "exec") as confirm,
        ):
            self.window.publish_all()
            self.assertEqual(start.call_args.args[0], "publish")
            self.assertNotIn("--request", start.call_args.args[1])
            confirm.assert_not_called()
        library = self.window.library
        self.assertEqual(
            [library.status.itemData(i) for i in range(library.status.count())],
            [
                "all",
                "unpublished",
                "published",
                "retired",
                "uncategorized_checkmate",
                "single_solution_uncategorized_checkmate",
                "uncategorized_tactic",
            ],
        )

    def test_category_inventory_and_process_activity_are_distinct(self):
        import copy

        stats = copy.deepcopy(self.window.last_stats)
        stats["mining"]["candidate_statuses"] = {"processing": 15, "published": 7396}
        stats["category"] = dict(
            pool=191,
            current=184,
            needs_checks=7,
            matched=32,
            unmatched=152,
            total_checks=764,
            completed_checks=736,
            pending_checks=28,
            inconclusive_checks=0,
        )
        stats["pipeline"].update(verified=191, awaiting_category=7)
        self.window.stats_loaded((stats, self.window.publication))
        self.assertEqual(self.window.metrics["verified"].text(), "191")
        self.assertEqual(self.window.stage_labels["categorizer"][0].text(), "Stopped")
        text = self.window.stage_labels["categorizer"][1].text()
        self.assertIn("Pool: 191 solutions", text)
        self.assertIn("736 / 764", text)
        self.assertNotIn("in progress", text)
        with patch.object(self.window.jobs, "active", return_value=True):
            self.window.stats_loaded((stats, self.window.publication))
        self.assertEqual(self.window.stage_labels["categorizer"][0].text(), "Running")

    def test_render_desktop_and_compact(self):
        out = Path("data/local/puzzle-studio-verification")
        out.mkdir(parents=True, exist_ok=True)
        for width, height in [(1500, 960), (1350, 850), (1120, 780), (1050, 720)]:
            self.window.resize(width, height)
            for index, name in [
                (0, "overview"),
                (1, "library"),
                (2, "releases"),
                (3, "settings"),
            ]:
                self.window.navigate(index)
                self.pump()
                if index == 0:
                    self.assertEqual(
                        self.window.pages.widget(0).horizontalScrollBar().maximum(), 0
                    )
                self.assertTrue(
                    self.window.grab().save(str(out / f"{name}-{width}.png"))
                )
                if index == 0:
                    scroll = self.window.pages.widget(0).verticalScrollBar()
                    scroll.setValue(scroll.maximum())
                    self.app.processEvents()
                    self.assertTrue(
                        self.window.grab().save(str(out / f"{name}-{width}-bottom.png"))
                    )
                    scroll.setValue(0)

    def test_tactic_controls_dispatch_independent_jobs(self):
        with (
            patch.object(self.window, "preflight", return_value=True),
            patch.object(self.window.jobs, "start", return_value=True) as start,
            patch.object(QMessageBox, "question", return_value=QMessageBox.Yes),
        ):
            for name in ("tactic_verifier", "tactic_categorizer"):
                self.window.stage_buttons[name][0].click()
                self.assertEqual(start.call_args.args[0], name)
                self.assertIn(name, start.call_args.args[1])
            self.window.reconstruct_buttons["tactic_verifier"].click()
            self.assertEqual(start.call_args.args[0], "tactic_verifier")
            self.assertIn("--reconstruct-old-puzzles", start.call_args.args[1])
            self.window.reclassify_buttons["tactic_categorizer"].click()
            self.assertEqual(start.call_args.args[0], "tactic_categorizer")
            self.assertIn("--force-reclassify-same-version", start.call_args.args[1])


if __name__ == "__main__":
    unittest.main()
