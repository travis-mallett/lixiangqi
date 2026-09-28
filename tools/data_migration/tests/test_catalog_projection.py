from contextlib import closing
from importlib import import_module
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from tools.games_database.catalog_index import ensure

migration = import_module("tools.data_migration.20260912_games_catalog_projection")


class CatalogMigrationTests(unittest.TestCase):
    def test_catalog_preparation_hands_real_wal_catalog_to_puzzle_migration(self):
        from tools.puzzle_catalog.test_catalog import puzzle

        publication = import_module(
            "tools.data_migration.20260912_puzzle_publication_v1"
        )
        with closing(sqlite3.connect(self.path)) as writer:
            writer.execute(
                "UPDATE games SET moves=? WHERE id='g:1'", ('["a4a5","a7a6"]',)
            )
            writer.commit()
            migration.prepare(self.path, self.backups)
            original = puzzle()
            original["gameId"] = "g:1"
            original["gameSource"] = {"type": "catalog", "database": "dpxq"}
            del original["sourceSnapshot"]
            fields = publication.additions(
                original, self.path, lambda _: None, "https://example.test"
            )
            self.assertEqual(fields["sourceSnapshot"]["moves"], ["a4a5", "a7a6"])

    def test_checkpoint_preserves_committed_wal_and_allows_immutable_reader(self):
        with closing(sqlite3.connect(self.path)) as writer:
            writer.execute("PRAGMA wal_autocheckpoint=0")
            writer.execute(
                "UPDATE games SET red_name='Committed in WAL' WHERE id='g:1'"
            )
            writer.commit()
            wal = Path(str(self.path) + "-wal")
            self.assertGreater(wal.stat().st_size, 0)
            migration.prepare(self.path, self.backups)
            self.assertTrue(not wal.exists() or wal.stat().st_size == 0)
            with closing(
                sqlite3.connect(
                    self.path.resolve().as_uri() + "?mode=ro&immutable=1", uri=True
                )
            ) as frozen:
                self.assertEqual(
                    frozen.execute(
                        "SELECT red_name FROM games WHERE id='g:1'"
                    ).fetchone()[0],
                    "Committed in WAL",
                )

    def test_busy_checkpoint_keeps_committed_frames(self):
        with closing(sqlite3.connect(self.path)) as reader, closing(
            sqlite3.connect(self.path)
        ) as writer:
            reader.execute("BEGIN")
            reader.execute("SELECT * FROM games").fetchall()
            writer.execute(
                "UPDATE games SET red_name='Still recoverable' WHERE id='g:1'"
            )
            writer.commit()
            with self.assertRaisesRegex(ValueError, "busy"):
                migration.checkpoint_catalog(self.path)
            self.assertGreater(Path(str(self.path) + "-wal").stat().st_size, 0)
            reader.rollback()
            migration.checkpoint_catalog(self.path)
            self.assertEqual(
                writer.execute("SELECT red_name FROM games WHERE id='g:1'").fetchone()[
                    0
                ],
                "Still recoverable",
            )

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "games.sqlite3"
        self.backups = Path(self.temp.name) / "backups"
        self.path.touch()
        ensure(self.path)
        with closing(sqlite3.connect(self.path)) as db:
            db.execute(
                "INSERT INTO games(id, source, external_id, canonical_hash, line_hash, red_name, black_name, result, played_at, moves, notations, source_url) VALUES ('g:1', 'dpxq', '1', X'1234', X'5678', 'Red', 'Black', 1, '2026-09-12', '[]', '[]', 'https://example.test')"
            )
            db.commit()

    def test_current_catalog_has_no_schema_writes_or_backup(self):
        ensure(self.path)
        original = self.path.read_bytes()
        migration.prepare(self.path, self.backups)
        self.assertEqual(original, self.path.read_bytes())
        self.assertFalse(self.backups.exists())

    def test_upgrade_retains_original_and_verifies_content(self):
        with closing(sqlite3.connect(self.path)) as db:
            db.execute(
                "UPDATE metadata SET value='0' WHERE key='catalog_index_version'"
            )
            db.commit()
            original = migration.content_digest(db)
        migration.prepare(self.path, self.backups)
        archives = list(self.backups.glob("*.sqlite3"))
        self.assertEqual(len(archives), 1)
        with closing(sqlite3.connect(archives[0])) as db:
            self.assertEqual(
                db.execute(
                    "SELECT value FROM metadata WHERE key='catalog_index_version'"
                ).fetchone()[0],
                "0",
            )
            self.assertEqual(migration.content_digest(db), original)
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(migration.content_digest(db), original)
        self.assertTrue(archives[0].with_suffix(".sha256").is_file())

    def test_backup_failure_cannot_start_upgrade(self):
        with closing(sqlite3.connect(self.path)) as db:
            db.execute(
                "UPDATE metadata SET value='0' WHERE key='catalog_index_version'"
            )
            db.commit()
        with patch.object(
            migration,
            "content_digest",
            side_effect=RuntimeError("backup verification failed"),
        ), patch.object(migration, "ensure") as upgrade:
            with self.assertRaises(RuntimeError):
                migration.prepare(self.path, self.backups)
            upgrade.assert_not_called()


if __name__ == "__main__":
    unittest.main()
