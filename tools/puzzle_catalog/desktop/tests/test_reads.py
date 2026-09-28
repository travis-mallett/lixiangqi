"""Read isolation, indexed navigation, cache invalidation and cancellation."""

from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication

from tools.puzzle_catalog.catalog import PuzzleCatalog
from tools.puzzle_catalog.desktop.repository import ContentRepository
from tools.puzzle_catalog.desktop.queries import attach
from tools.puzzle_catalog.desktop.widgets import ReadTasks
from tools.puzzle_catalog.test_catalog import puzzle
from tools.xiangqi_data.puzzle_mining.storage import open_database


class InventoryReadsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.catalog = self.root / "catalog.sqlite3"
        self.mining = self.root / "mining.sqlite3"
        with closing(open_database(self.mining)):
            pass
        with PuzzleCatalog(self.catalog) as catalog, catalog.db:
            document = puzzle()
            document["themes"] = ["anglerHorse"]
            document["retired"] = False
            self.pid = document["_id"]
            self.document = document
            catalog.db.execute(
                "INSERT INTO catalog_puzzles VALUES(?,?,?)",
                (self.pid, json.dumps(document), "{}"),
            )
            catalog._set_meta("baseline", [document])
        self.repo = ContentRepository(self.catalog, self.mining, self.root / "studio")

    def tearDown(self):
        self.repo.close()
        self.temp.cleanup()

    def test_wal_reader_sees_commits_without_blocking_or_dirty_reads(self):
        def read():
            return self.repo.cached(
                "angler", lambda: self.repo.page(library=True, theme="anglerHorse")
            )

        original = read()
        self.assertEqual(original["total"], 1)
        with closing(sqlite3.connect(self.catalog, timeout=0)) as writer:
            writer.execute("BEGIN IMMEDIATE")
            document = {**self.document, "themes": ["doubleCannons"]}
            writer.execute(
                "UPDATE catalog_puzzles SET document=?", (json.dumps(document),)
            )
            self.assertIs(read(), original)
            self.assertEqual(
                self.repo.page(library=True, theme="anglerHorse")["total"], 1
            )
            writer.commit()
            self.assertEqual(read()["total"], 0)
            self.assertEqual(
                self.repo.page(library=True, theme="doubleCannons")["total"], 1
            )
            busy, frames, checkpointed = writer.execute(
                "PRAGMA wal_checkpoint(PASSIVE)"
            ).fetchone()
            self.assertEqual(busy, 0)
            self.assertEqual(frames, checkpointed, "A reader retained a WAL snapshot")

    def test_theme_index_rolls_back_and_tracks_replacement_and_deletion(self):
        with PuzzleCatalog(self.catalog) as catalog:
            catalog.db.execute("DELETE FROM catalog_puzzles")
            catalog.db.rollback()
            self.assertEqual(self.repo.page(theme="anglerHorse")["total"], 1)
            replacement = {**self.document, "themes": ["doubleCannons"]}
            with catalog.db:
                catalog.db.execute(
                    "INSERT OR REPLACE INTO catalog_puzzles VALUES(?,?,?)",
                    (self.pid, json.dumps(replacement), "{}"),
                )
            self.assertEqual(self.repo.page(theme="anglerHorse")["total"], 0)
            self.assertEqual(self.repo.page(theme="doubleCannons")["total"], 1)
            with catalog.db:
                catalog.db.execute("DELETE FROM catalog_puzzles")
            self.assertEqual(
                list(catalog.db.execute("SELECT * FROM inventory_themes")), []
            )

    def test_publication_membership_is_owned_by_catalog_and_transactional(self):
        self.assertEqual(self.repo.stats()["published"], 1)
        with PuzzleCatalog(self.catalog) as catalog:
            catalog._set_meta("baseline", [])
            self.assertEqual(self.repo.stats()["published"], 1)
            catalog.db.commit()
            self.assertEqual(self.repo.stats()["published"], 0)
            with catalog.db:
                catalog.db.execute(
                    "INSERT INTO catalog_releases VALUES('release',?)",
                    (json.dumps({"puzzles": [self.document]}),),
                )
                catalog._set_meta("deployedReleaseId", "release")
            self.assertEqual(self.repo.stats()["published"], 1)
        with closing(sqlite3.connect(self.repo.audit_path)) as audit:
            self.assertIsNone(
                audit.execute(
                    "SELECT 1 FROM sqlite_master WHERE name='published_inventory'"
                ).fetchone()
            )

    def test_library_plan_uses_theme_and_covering_indexes(self):
        with self.repo._db() as reader:
            plan = "\n".join(
                str(tuple(row))
                for row in reader.execute(
                    "EXPLAIN QUERY PLAN "
                    + self.repo._cte(library=True, theme="anglerHorse")
                    + "SELECT * FROM items",
                    {"theme": "anglerHorse"},
                )
            )
            self.assertIn("inventory_themes USING PRIMARY KEY (theme=?)", plan)
            self.assertIn("COVERING INDEX catalog_inventory_index", plan)
            # Verification eligibility also reads expression-index fields.
            # SQLite labels this INDEX rather than COVERING INDEX.
            self.assertIn("USING INDEX assessments_inventory", plan)
            self.assertNotIn("SCAN candidates", plan)

    def test_unchanged_refresh_does_not_repeat_queries(self):
        with patch.object(self.repo, "stats", wraps=self.repo.stats) as stats:
            self.repo.cached("overview", stats)
            self.repo.cached("overview", stats)
            self.assertEqual(stats.call_count, 1)
            with closing(sqlite3.connect(self.mining)) as writer, writer:
                writer.execute("INSERT INTO metadata VALUES('test-change','1')")
            self.repo.cached("overview", stats)
            self.assertEqual(stats.call_count, 2)

    def test_startup_never_opens_mining_for_maintenance(self):
        from tools.puzzle_catalog.desktop import __main__ as entry

        with (
            patch.object(entry, "QApplication") as app,
            patch.object(entry, "QLockFile"),
            patch.object(entry, "apply"),
            patch(
                "sys.argv", ["studio", "--settings", str(self.root / "settings.json")]
            ),
            patch("tools.puzzle_catalog.desktop.window.StudioWindow"),
            patch(
                "tools.xiangqi_data.puzzle_mining.storage.open_database"
            ) as maintenance,
        ):
            app.return_value.exec.return_value = 0
            self.assertEqual(entry.main(), 0)
            maintenance.assert_not_called()


class ReadCancellationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_superseded_query_releases_worker_and_shutdown_cancels_reads(self):
        tasks = ReadTasks()
        started = threading.Event()
        errors, results = [], []
        tasks.error.connect(errors.append)

        def expensive():
            with closing(sqlite3.connect(":memory:")) as db:
                attach(db)
                started.set()
                return db.execute(
                    "WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n"
                ).fetchone()

        try:
            tasks.submit("library", expensive, results.append)
            self.assertTrue(started.wait(2))
            old = tasks.pending["library"][0]
            tasks.submit("library", lambda: "latest filter", results.append)
            deadline = time.monotonic() + 2
            while (not old.done() or not results) and time.monotonic() < deadline:
                self.app.processEvents()
                time.sleep(0.01)
            self.assertTrue(old.done(), "Superseded SQL kept using a worker")
            self.assertEqual(results, ["latest filter"])
            self.assertEqual(errors, [])
            started.clear()
            tasks.submit("library", expensive, results.append)
            self.assertTrue(started.wait(2))
            before = time.monotonic()
            tasks.close()
            self.assertLess(time.monotonic() - before, 2)
        finally:
            tasks.close()
