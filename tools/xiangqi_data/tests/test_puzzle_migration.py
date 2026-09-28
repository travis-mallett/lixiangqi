import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.xiangqi_data.puzzle_mining import storage


def create_schema2_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA journal_mode = WAL")
    connection.executescript("""
        CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO metadata VALUES ('schema_version', '2');
        CREATE TABLE candidates(
          id INTEGER PRIMARY KEY,
          candidate_type TEXT
            CHECK (candidate_type IN ('checkmate_candidate', 'tactic_candidate')),
          status TEXT,
              claim_token TEXT,
              claimed_at TEXT,
          next_attempt_at TEXT,
          position_hash TEXT
          ,candidate_key TEXT,source_database TEXT,game_id TEXT,pre_fen TEXT,
          played_move TEXT,themes_json TEXT,updated_at TEXT
        );
        CREATE TABLE game_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_database TEXT NOT NULL,
          game_id TEXT NOT NULL,
          source_url TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'queued',
          attempts INTEGER NOT NULL DEFAULT 0,
          discovered_count INTEGER NOT NULL DEFAULT 0,
          claim_token TEXT,
          claimed_at TEXT,
          next_attempt_at TEXT,
          diagnostic TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (source_database, game_id)
        );
        INSERT INTO game_jobs(source_database, game_id, created_at, updated_at)
          VALUES ('catalog', 'wal-game', 'now', 'now');
        """)
    connection.commit()
    connection.close()


class PuzzleMigrationTest(unittest.TestCase):
    def test_schema6_to8_retains_candidate_without_copying_database(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "modern.sqlite3"
            connection = storage.open_database(path)
            connection.execute(
                """INSERT INTO candidates
              (candidate_key,source_database,game_id,ply,side_to_move,pre_fen,position_fen,position_hash,
               played_move,best_move,before_score_json,after_score_json,evaluation_loss,candidate_type,
               engine_version,nnue,search_settings_json,created_at,updated_at)
              VALUES ('k','db','g',1,'red','a','b','h','m','n','{}','{}',1.0,'checkmate_candidate','e','n','{}','t','t')"""
            )
            connection.commit()
            connection.close()
            raw = sqlite3.connect(path)
            # These read indexes did not exist in the legacy schema being
            # simulated. In particular its puzzle table is rebuilt by v11.
            raw.execute("DROP VIEW puzzle_inventory")
            for operation in ("insert", "update", "delete"):
                raw.execute(f"DROP TRIGGER inventory_themes_{operation}")
            raw.execute("DROP TABLE inventory_themes")
            raw.execute(
                "ALTER TABLE puzzles RENAME COLUMN verification_status TO publication_status"
            )
            raw.execute("DROP TABLE category_assessments")
            raw.execute(
                "ALTER TABLE candidates DROP COLUMN attempt_theme_versions_json"
            )
            raw.execute("UPDATE metadata SET value='6' WHERE key='schema_version'")
            raw.commit()
            raw.close()
            reopened = storage.open_database(path)
            self.assertEqual(
                reopened.execute("SELECT candidate_key FROM candidates").fetchone()[0],
                "k",
            )
            self.assertEqual(
                reopened.execute("PRAGMA integrity_check").fetchone()[0], "ok"
            )
            reopened.close()
            self.assertEqual(
                list(path.parent.glob("modern.sqlite3.pre-v*.sqlite3")), []
            )

    def test_schema2_migrates_to_current_schema(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "legacy.sqlite3"
            create_schema2_database(path)

            connection = storage.open_database(path)
            try:
                self.assertEqual(
                    connection.execute(
                        "SELECT value FROM metadata WHERE key = 'schema_version'"
                    ).fetchone()[0],
                    str(storage.SCHEMA_VERSION),
                )
                self.assertEqual(
                    connection.execute(
                        "SELECT discovery_version FROM game_jobs WHERE game_id = 'wal-game'"
                    ).fetchone()[0],
                    "1",
                )
                self.assertIsNotNone(
                    connection.execute(
                        "SELECT 1 FROM sqlite_master "
                        "WHERE type = 'table' AND name = 'taxonomy_assessments'"
                    ).fetchone()
                )
            finally:
                connection.close()

    def test_failed_next_step_leaves_reopenable_version_without_backup(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "legacy.sqlite3"
            create_schema2_database(path)

            def fail_next_step(_connection: sqlite3.Connection) -> None:
                raise RuntimeError("injected migration failure")

            with patch.object(storage, "migrate_schema_3_to_4", fail_next_step):
                with self.assertRaisesRegex(RuntimeError, "injected migration failure"):
                    storage.open_database(path)

            interrupted = sqlite3.connect(path)
            try:
                self.assertEqual(
                    interrupted.execute(
                        "SELECT value FROM metadata WHERE key = 'schema_version'"
                    ).fetchone()[0],
                    "3",
                )
                self.assertEqual(
                    interrupted.execute(
                        "SELECT discovery_version FROM game_jobs WHERE game_id = 'wal-game'"
                    ).fetchone()[0],
                    "1",
                )
            finally:
                interrupted.close()
            self.assertEqual(
                list(path.parent.glob("legacy.sqlite3.pre-v*.sqlite3")), []
            )

            recovered = storage.open_database(path)
            try:
                self.assertEqual(
                    recovered.execute(
                        "SELECT value FROM metadata WHERE key = 'schema_version'"
                    ).fetchone()[0],
                    str(storage.SCHEMA_VERSION),
                )
                self.assertEqual(
                    recovered.execute(
                        "SELECT game_id FROM game_jobs WHERE discovery_version = '1'"
                    ).fetchone()[0],
                    "wal-game",
                )
            finally:
                recovered.close()


if __name__ == "__main__":
    unittest.main()
