"""Workflow contracts: snapshots precede workers; GUI never supplies live user data."""

from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
from tools.puzzle_catalog.desktop.settings import (
    Settings,
    current_snapshot,
    RETIRED_ENGINE_SETTINGS,
)
from tools.puzzle_catalog.desktop.operations import (
    prepare,
    discovery_command,
    categorizer_command,
    verifier_command,
    reclassify,
)
from tools.puzzle_catalog.test_catalog import make_snapshot, puzzle
from tools.puzzle_catalog.catalog import PuzzleCatalog


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.snapshots = self.root / "snapshots"
        self.snapshots.mkdir()
        self.snapshot = self.snapshots / "snap"
        make_snapshot(self.snapshot, [puzzle()])
        (self.snapshots / "current.json").write_text(json.dumps({"snapshotId": "snap"}))
        self.source = self.root / "source.sqlite3"
        with closing(sqlite3.connect(self.source)) as db:
            db.execute("CREATE TABLE test(id INTEGER)")
        self.s = Settings(
            python=sys.executable,
            mining_db=str(self.root / "mining.sqlite3"),
            catalog_db=str(self.root / "catalog.sqlite3"),
            source_catalog=str(self.source),
            snapshot_dir=str(self.snapshots),
        )
        from tools.puzzle_catalog.live import wire_digest

        content = {**puzzle(), "retirementReason": None}
        self.publisher = patch("tools.puzzle_catalog.live.Publisher")
        fake = self.publisher.start()
        self.addCleanup(self.publisher.stop)
        fake.return_value.inventory.return_value = [
            {"puzzle": content, "digest": wire_digest(content), "revision": None}
        ]

    def tearDown(self):
        self.tmp.cleanup()

    def test_worker_commands_only_override_administrative_options(self):
        verify = verifier_command(self.s)
        classify = categorizer_command(self.s)
        self.assertIn("tools.xiangqi_data.puzzle_mining.verification", verify)
        self.assertIn("tools.xiangqi_data.puzzle_mining.checkmate", classify)
        allowed = {
            "--output",
            "--source-db",
            "--catalog-db",
            "--engine",
            "--workers",
            "--database",
            "--continuous",
            "--poll-interval",
            "--publication-origin",
        }
        for command, workers in (
            (discovery_command(self.s), self.s.discovery_workers),
            (verify, self.s.verifier_workers),
            (classify, self.s.categorizer_workers),
        ):
            self.assertLessEqual(
                {
                    arg
                    for arg in command
                    if isinstance(arg, str) and arg.startswith("--")
                },
                allowed,
            )
            self.assertEqual(command[command.index("--workers") + 1], workers)
        self.assertNotIn("--reconstruct-old-puzzles", verify)
        self.assertNotIn("--force-reverify", verify)
        reconstruct = verifier_command(self.s, reconstruct=True)
        self.assertIn("--reconstruct-old-puzzles", reconstruct)
        self.assertNotIn("--continuous", reconstruct)
        self.assertNotIn("--source-db", "--catalog-db", classify)

    def test_prepare_reconciles_baseline_before_worker_commands(self):
        prepare(self.s, False)
        with PuzzleCatalog(self.s.catalog_db) as c:
            self.assertEqual([p["_id"] for p in c.puzzles()], ["00001"])
        with closing(sqlite3.connect(self.s.mining_db)) as db:
            self.assertEqual(
                db.execute("SELECT count(*) FROM source_snapshots").fetchone()[0], 1
            )
            self.assertEqual(
                db.execute("SELECT id FROM puzzles").fetchone()[0], "00001"
            )
        discovery = discovery_command(self.s)
        categorize = categorizer_command(self.s)
        self.assertNotIn("--live-url", discovery)
        self.assertNotIn("--continuous", discovery)
        self.assertIn("--continuous", categorize)
        self.assertIn(self.s.source_catalog, discovery)
        self.assertEqual(
            discovery[discovery.index("--publication-origin") + 1],
            self.s.publication_origin,
        )
        self.assertNotIn("--rescan", discovery)
        self.assertIn("--rescan", discovery_command(self.s, True))

    def test_tactic_commands_select_separate_verifier_and_categorizer(self):
        verify = verifier_command(self.s, tactic=True)
        categorize = categorizer_command(self.s, tactic=True)
        self.assertIn("tools.xiangqi_data.puzzle_mining.tactic_verification", verify)
        self.assertIn("tools.xiangqi_data.puzzle_mining.tactic", categorize)
        self.assertNotIn("tools.xiangqi_data.puzzle_mining.verification", verify)
        self.assertNotIn("tools.xiangqi_data.puzzle_mining.checkmate", categorize)
        self.assertIn("--continuous", verify)
        self.assertNotIn(
            "--continuous", categorizer_command(self.s, reclassify=True, tactic=True)
        )

    def test_network_capture_failure_never_imports_or_initializes(self):
        with patch(
            "tools.puzzle_catalog.live.Publisher",
            side_effect=RuntimeError("network failed"),
        ):
            with self.assertRaises(RuntimeError):
                prepare(self.s, True)
        self.assertFalse(Path(self.s.catalog_db).exists())
        self.assertFalse(Path(self.s.mining_db).exists())

    def test_old_preview_loopback_setting_is_backed_up_and_migrated(self):
        from dataclasses import asdict

        path = self.root / "loopback-settings.json"
        old = {**asdict(self.s), "preview_publication_origin": "http://127.0.0.1:9663"}
        path.write_text(json.dumps(old), encoding="utf-8")
        loaded = Settings.load(path)
        self.assertEqual(loaded.preview_publication_origin, "http://localhost:9663")
        backups = list(self.root.glob("loopback-settings.json.*.bak"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(json.loads(backups[0].read_text()), old)

    def test_publish_runs_direct_sync(self):
        from tools.puzzle_catalog.desktop.operations import main

        with (
            patch.object(
                sys,
                "argv",
                ["studio", "--settings", str(self.root / "settings.json"), "publish"],
            ),
            patch.object(Settings, "load", return_value=self.s),
            patch("tools.puzzle_catalog.live.sync_destinations") as sync,
        ):
            main()
        sync.assert_called_once_with(self.s, self.root, ["preview"])

    def test_snapshot_pointer_cannot_escape(self):
        (self.snapshots / "current.json").write_text(
            json.dumps({"snapshotId": "../elsewhere"})
        )
        with self.assertRaises(ValueError):
            current_snapshot(self.s)

    def test_audit_freezes_only_published_membership_and_records_resume_identity(self):
        prepare(self.s, False)
        with PuzzleCatalog(self.s.catalog_db) as c:
            c.admit(
                {**puzzle("00002"), "gameId": "g2"},
                {"status": "verified", "assessmentId": "test"},
            )
        request = self.root / "pending.json"
        seen = []

        def audit(c, release_id, theme, *args, **kwargs):
            from tools.xiangqi_data.puzzle_mining.checkmate import CategorizerConfig

            self.assertEqual(args[1], CategorizerConfig())
            seen.extend(p["_id"] for p in c.release(release_id)["puzzles"])
            return {
                "theme": theme,
                "version": "1",
                "total": 1,
                "completed": 1,
                "remaining": 0,
                "outcomes": {
                    "qualifies": 1,
                    "does_not_qualify": 0,
                    "unresolved": 0,
                },
            }

        with (
            patch("tools.xiangqi_data.puzzle_mining.engine.OfflinePikafish") as engine,
            patch.object(PuzzleCatalog, "reclassify", audit),
        ):
            reclassify(self.s, ["centroidPawnMate"], "snapshot", request)
            engine.return_value.close.assert_called_once()
        self.assertEqual(seen, ["00001"])
        self.assertNotEqual(json.loads(request.read_text())["release"], "snapshot")
        with PuzzleCatalog(self.s.catalog_db) as c:
            self.assertEqual(len(c.puzzles()), 2)

    def test_retired_engine_preferences_are_backed_up_and_removed(self):
        path = self.root / "settings.json"
        self.s.save(path)
        data = json.loads(path.read_text())
        data.update({key: 1234 for key in RETIRED_ENGINE_SETTINGS})
        original = json.dumps(data).encode()
        path.write_bytes(original)
        loaded = Settings.load(path)
        self.assertEqual(loaded, self.s)
        self.assertFalse(set(json.loads(path.read_text())) & RETIRED_ENGINE_SETTINGS)
        backups = list(self.root.glob("settings.json.before-script-defaults-*.bak"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), original)
        Settings.load(path)
        self.assertEqual(len(list(self.root.glob("*.bak"))), 1)

    def test_unknown_settings_are_not_silently_removed(self):
        path = self.root / "settings.json"
        original = '{"screen_nodes": 1234, "unknown": true}'
        path.write_text(original)
        with self.assertRaisesRegex(ValueError, "Unknown settings"):
            Settings.load(path)
        self.assertEqual(path.read_text(), original)
        self.assertFalse(list(self.root.glob("*.bak")))

    def test_settings_reject_database_aliasing(self):
        self.s.catalog_db = self.s.mining_db
        with self.assertRaises(ValueError):
            self.s.validate()


if __name__ == "__main__":
    unittest.main()
