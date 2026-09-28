import json
import tempfile
import unittest
from unittest.mock import Mock, patch
from pathlib import Path
from tools.environment_data.snapshot import (
    capture,
    refresh_preview,
    verify_snapshot,
    build_manifest,
    PREVIEW_DATABASE,
)
from tools.environment_data.prepare_preview import prepare
from tools.puzzle_catalog.test_catalog import puzzle, make_snapshot


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "snapshot"
        make_snapshot(self.source, [puzzle()])
        self.dump = self.root / "mongodump"
        self.dump.touch()
        self.restore = self.root / "mongorestore"
        self.restore.touch()

    def tearDown(self):
        self.temp.cleanup()

    def test_restore_failure_recovers_only_disposable_namespace(self):
        drops = []
        commands = []

        class Mongo:
            def drop_database(self, name):
                drops.append(name)

        def run(argv, **kwargs):
            commands.append(argv)
            if argv[0] == str(self.dump):
                Path(
                    next(a.split("=", 1)[1] for a in argv if a.startswith("--archive="))
                ).write_bytes(b"backup")
            elif len(commands) == 2:
                raise RuntimeError("restore interrupted")

        with self.assertRaisesRegex(RuntimeError, "interrupted"):
            refresh_preview(
                self.source,
                self.root / "preview",
                self.restore,
                self.dump,
                client=Mongo(),
                run=run,
            )
        self.assertEqual(drops, [PREVIEW_DATABASE, PREVIEW_DATABASE])
        self.assertIn("--nsTo=lixiangqi_preview.*", commands[1])
        self.assertIn("--nsInclude=lixiangqi_preview.*", commands[2])
        self.assertNotIn("--drop", commands[2])
        self.assertFalse((self.root / "preview" / "state.json").exists())

    def test_no_backup_means_no_drop(self):
        class Mongo:
            def drop_database(self, name):
                raise AssertionError("must not drop without backup")

        with self.assertRaisesRegex(RuntimeError, "backup"):
            refresh_preview(
                self.source,
                self.root / "preview",
                self.restore,
                self.dump,
                client=Mongo(),
                run=lambda *a, **k: None,
            )

    def test_tamper_and_incomplete_exports_rejected(self):
        (self.source / "native-games.jsonl").write_text("tampered")
        with self.assertRaises(ValueError):
            capture(self.source, self.root / "copy")
        self.assertFalse((self.root / "copy").exists())
        (self.source / "native-games.jsonl").write_text("")
        manifest = build_manifest(self.source, "id")
        del manifest["files"]["mongo.archive.gz"]
        (self.source / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaises(ValueError):
            verify_snapshot(self.source)

    def test_preview_validates_restored_content_without_installing(self):
        self.assertEqual(prepare(self.source), 1)

    def test_preview_enriches_legacy_sources_without_replacing_runtime_fields(self):
        original = puzzle()
        original["gameSource"] = {"type": "catalog", "database": "dpxq"}
        legacy = {**original, "sourceSnapshot": None}
        (self.source / "puzzle-inventory.json").write_text(
            json.dumps({"puzzles": [legacy]})
        )
        (self.source / "manifest.json").write_text(
            json.dumps(build_manifest(self.source, "legacy"))
        )
        restored = {**legacy, "plays": 123, "vote": 0.8}
        del restored["retired"]
        collection = Mock()
        collection.count_documents.return_value = 1
        collection.find_one.side_effect = lambda selector: restored.copy()

        def update(selector, operation):
            restored.update(operation["$set"])
            return Mock(matched_count=1)

        collection.update_one.side_effect = update
        with patch(
            "tools.environment_data.prepare_preview.catalog_source",
            return_value=original["sourceSnapshot"],
        ) as source:
            self.assertEqual(prepare(self.source, "games.db", collection=collection), 1)
            source.assert_called_once_with("games.db", "g1", "dpxq")
            prepare(self.source, "games.db", collection=collection)
        self.assertEqual(collection.update_one.call_count, 1)
        self.assertEqual(restored["plays"], 123)
        self.assertEqual(restored["vote"], 0.8)
        self.assertEqual(restored["sourceSnapshot"], original["sourceSnapshot"])
        self.assertIsNone(
            json.loads((self.source / "puzzle-inventory.json").read_text())["puzzles"][
                0
            ]["sourceSnapshot"]
        )

    def test_missing_source_fails_before_any_preview_write(self):
        legacy = {**puzzle(), "sourceSnapshot": None}
        (self.source / "puzzle-inventory.json").write_text(
            json.dumps({"puzzles": [legacy]})
        )
        (self.source / "manifest.json").write_text(
            json.dumps(build_manifest(self.source, "legacy"))
        )
        collection = Mock()
        with self.assertRaisesRegex(
            ValueError, "Puzzle 00001: source snapshot required"
        ):
            prepare(self.source, collection=collection)
        collection.update_one.assert_not_called()

    def test_native_import_quarantines_unprovenanced_local_games(self):
        from tools.xiangqi_data.puzzle_mining import storage
        from tools.xiangqi_data.puzzle_mining.snapshot_import import import_snapshot
        from tools.xiangqi_data.puzzle_mining.sources import load_game

        row = {
            "id": "game0001",
            "initialFen": puzzle()["fen"],
            "moves": ["a4a5", "a7a6"],
            "players": ["", "blackuser"],
            "completedAt": 1234,
        }
        (self.source / "native-games.jsonl").write_text(json.dumps(row) + "\n")
        (self.source / "manifest.json").write_text(
            json.dumps(build_manifest(self.source, "id"))
        )
        db = storage.open_database(self.root / "mining.db")
        try:
            self.assertEqual(import_snapshot(db, self.source), 1)
            source = "lixiangqi:https://lixiangqi.com"
            self.assertEqual(
                load_game(db, {}, source, row["id"]).moves, tuple(row["moves"])
            )
            db.execute("UPDATE native_games SET snapshot_id=NULL")
            db.commit()
            with self.assertRaises(LookupError):
                load_game(db, {}, source, row["id"])
            row["moves"] = ["a4a5", "c7c6"]
            (self.source / "native-games.jsonl").write_text(json.dumps(row) + "\n")
            (self.source / "manifest.json").write_text(
                json.dumps(build_manifest(self.source, "new-id"))
            )
            with self.assertRaisesRegex(ValueError, "moves changed"):
                import_snapshot(db, self.source)
            self.assertIsNone(
                db.execute(
                    "SELECT * FROM source_snapshots WHERE snapshot_id='new-id'"
                ).fetchone()
            )
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
