from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.bot_levels_optimization.openings import export_suite, load_suite
from tools.xiangqi_data.pikafish_rules import START_FEN


class OpeningSuiteTests(unittest.TestCase):
    def catalog(self):
        connection = sqlite3.connect(":memory:")
        connection.executescript("""
            CREATE TABLE metadata(key TEXT, value TEXT);
            CREATE TABLE games(id TEXT, initial_fen TEXT, moves TEXT,
                statistical_eligible INTEGER, record_kind TEXT);
            CREATE TABLE game_sources(game_id TEXT, source TEXT, collection TEXT);
        """)
        for number in range(8):
            connection.execute(
                "INSERT INTO games VALUES (?, ?, ?, 1, 'played_game')",
                (str(number), START_FEN, json.dumps([f"{number}"] * 40)),
            )
            connection.execute(
                "INSERT INTO game_sources VALUES (?, 'dpxq', ?)",
                (str(number), "m" if number < 6 else "n"),
            )
        # Duplicate source witnesses must not overweight the same master game.
        connection.execute("INSERT INTO game_sources VALUES ('0', 'dpxq', 'm')")
        return connection

    def test_master_only_export_is_fixed_deterministic_and_after_fade(self):
        with tempfile.TemporaryDirectory() as directory:
            first, second = Path(directory) / "a.json", Path(directory) / "b.json"
            results = []
            for path in (first, second):
                with (
                    patch(
                        "tools.bot_levels_optimization.openings.open_catalog_connection",
                        return_value=self.catalog(),
                    ),
                    patch(
                        "tools.bot_levels_optimization.openings.CalibrationEngine"
                    ) as engine,
                ):
                    engine.return_value.book_position.side_effect = lambda work: (
                        f"board-{work.moves[0]} w - - 0 11",
                        (),
                    )
                    results.append(export_suite(path, 4, 123))
                    engine.return_value.close.assert_called_once()
                self.assertEqual(4, len(load_suite(path)["openings"]))
            self.assertEqual(results[0], results[1])
            self.assertEqual(6, results[0]["eligibleGames"])
            for opening in results[0]["openings"]:
                self.assertLess(int(opening["sourceGameId"]), 6)
                self.assertTrue(20 <= opening["ply"] <= 28)
                self.assertEqual(opening["ply"], len(opening["moves"]))
            with self.assertRaises(FileExistsError):
                export_suite(first, 4, 123)

    def test_suite_rejects_pre_fade_positions_and_wrong_database(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "suite.json"
            path.write_text(
                json.dumps({"version": 1, "database": "all", "openings": [1]})
            )
            with self.assertRaises(ValueError):
                load_suite(path)
            path.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "database": "masters",
                        "openings": [
                            {
                                "id": "one",
                                "fen": START_FEN,
                                "initialFen": START_FEN,
                                "moves": [],
                            }
                        ],
                    }
                )
            )
            with self.assertRaises(ValueError):
                load_suite(path)


if __name__ == "__main__":
    unittest.main()
