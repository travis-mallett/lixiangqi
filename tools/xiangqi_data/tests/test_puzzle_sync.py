import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from tools.xiangqi_data.puzzle_mining.puzzle_sync import (
    PATH_SIZE,
    PUZZLE_DATABASE,
    SELECTOR_THEMES,
    path_documents,
    read_puzzles,
    synchronize,
)


class PuzzleSyncTest(unittest.TestCase):
    def test_targets_reactivemongo_default_database(self) -> None:
        self.assertEqual(PUZZLE_DATABASE, "lichess")

    def test_reads_source_database_and_native_game_key(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "puzzles.sqlite3"
            connection = sqlite3.connect(database)
            connection.executescript(
                """
                CREATE TABLE candidates (
                  id INTEGER PRIMARY KEY,
                  source_database TEXT NOT NULL
                );
                CREATE TABLE puzzles (
                  id TEXT, candidate_id INTEGER, game_id TEXT, fen TEXT, line TEXT,
                  rating REAL, rating_deviation REAL, plays INTEGER, vote REAL,
                  themes TEXT, created_at TEXT
                );
                """
            )
            connection.execute(
                "INSERT INTO candidates VALUES (?, ?)",
                (7, "xiangqi-explorer-dpxq.sqlite3"),
            )
            connection.execute(
                "INSERT INTO puzzles VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    "abc12",
                    7,
                    "dpxq:42",
                    "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1",
                    json.dumps(["a1a2", "a9a8"]),
                    1500,
                    350,
                    0,
                    1,
                    json.dumps(["centroidPawnMate", "mateIn1"]),
                    "2026-07-25T00:00:00Z",
                ),
            )
            connection.commit()
            connection.close()

            puzzle = read_puzzles(database)[0]

        self.assertEqual(puzzle.puzzle_id, "abc12")
        self.assertEqual(puzzle.line, ("a1a2", "a9a8"))
        self.assertEqual(puzzle.document()["gameId"], "dpxq:42")
        self.assertEqual(
            puzzle.document()["gameSource"],
            {
                "type": "catalog",
                "database": "dpxq",
            },
        )

    def test_builds_chunked_selector_paths(self) -> None:
        ids = [f"p{i:04d}" for i in range(PATH_SIZE + 1)]

        paths = path_documents(ids, "centroidPawnMate", 123)

        self.assertEqual(len(paths), 2)
        self.assertEqual(paths[0]["_id"], "centroidPawnMate|all|0000")
        self.assertEqual(paths[0]["min"], "centroidPawnMate|all|0000")
        self.assertEqual(paths[0]["max"], "centroidPawnMate|all|9999")
        self.assertEqual(len(paths[0]["ids"]), PATH_SIZE)
        self.assertEqual(paths[1]["ids"], [f"p{PATH_SIZE:04d}"])

    def test_builds_selector_paths_for_each_visible_mate_length(self) -> None:
        self.assertEqual(
            SELECTOR_THEMES,
            ("centroidPawnMate", "mateIn1", "mateIn2", "mateIn3", "mateIn4", "mateIn5"),
        )

    def test_empty_staging_database_does_not_contact_or_clear_mongo(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "puzzles.sqlite3"
            connection = sqlite3.connect(database)
            connection.executescript(
                """
                CREATE TABLE candidates (
                  id INTEGER PRIMARY KEY,
                  source_database TEXT NOT NULL
                );
                CREATE TABLE puzzles (
                  id TEXT, candidate_id INTEGER, game_id TEXT, fen TEXT, line TEXT,
                  rating REAL, rating_deviation REAL, plays INTEGER, vote REAL,
                  themes TEXT, created_at TEXT
                );
                """
            )
            connection.close()

            self.assertEqual(synchronize(database, "mongodb://invalid"), (0, 0))


if __name__ == "__main__":
    unittest.main()
