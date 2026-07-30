from __future__ import annotations

import csv
import os
import sqlite3
import tempfile
import unittest
import zipfile
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from external.xiangqi_explorer.game_catalog import query_games
from tools.games_database.elephantchess_scraper import (
    COLLECTION,
    SOURCE,
    ElephantchessImporter,
    csv_game_groups,
    dataset_archives,
    extract_csvs,
    parse_csv_game,
    zero_based_move_to_uci,
)


HEADER = (
    "timestamp",
    "move_index",
    "move",
    "game_id",
    "red_player",
    "black_player",
    "red_elo_before",
    "red_elo_after",
    "black_elo_before",
    "black_elo_after",
    "time_control",
    "time_control_category",
    "rating_mode",
    "game_status",
    "outcome",
    "game_join_source",
    "analysis",
    "cpl",
)


def sample_rows(game_id: str = "opaqueGame01") -> list[dict[str, str]]:
    moves = ("h2e2", "h9g7", "h0g2", "b9c7")
    return [
        {
            "timestamp": f"2026-06-05T10:18:{47 + index:02d}.000000Z",
            "move_index": str(index),
            "move": move,
            "game_id": game_id,
            "red_player": "opaqueRed001",
            "black_player": "opaqueBlack1",
            "red_elo_before": "1000",
            "red_elo_after": "1008",
            "black_elo_before": "1022",
            "black_elo_after": "1014",
            "time_control": "900+10",
            "time_control_category": "RAPID",
            "rating_mode": "rated",
            "game_status": "CHECKMATED",
            "outcome": "RED_WINS",
            "game_join_source": "LINK",
            "analysis": "",
            "cpl": "",
        }
        for index, move in enumerate(moves)
    ]


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=HEADER, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(rows)


class ElephantchessScraperTest(unittest.TestCase):
    def test_discovers_the_latest_unique_xiangqi_archive(self) -> None:
        document = """
        <a href="https://cdn.elephantchess.io/data/pvp_game_moves_xiangqi_2026-05.zip">May</a>
        <a href="https://cdn.elephantchess.io/data/pvp_game_moves_xiangqi_2026-06.zip">June</a>
        <a href="https://cdn.elephantchess.io/data/pvp_game_moves_xiangqi_2026-06.zip">Duplicate</a>
        <a href="https://cdn.elephantchess.io/data/pvp_game_moves_manchu_2026-07.zip">Manchu</a>
        """
        archives = dataset_archives(document)
        self.assertEqual(["2026-05", "2026-06"], [item.month for item in archives])

    def test_converts_zero_based_ranks_and_parses_anonymized_game(self) -> None:
        self.assertEqual("h10g8", zero_based_move_to_uci("h9g7"))
        game = parse_csv_game(
            list(reversed(sample_rows())),
            archive_name="pvp_game_moves_xiangqi_2026-06.zip",
            csv_name="pvp_game_moves_xiangqi_001.csv",
        )
        self.assertEqual(("h3e3", "h10g8", "h1g3", "b10c8"), game.moves)
        self.assertEqual(1, game.result)
        self.assertEqual(1000, game.red_rating)
        self.assertEqual("2026-06-05T10:18:47Z", game.played_at)

    def test_extracts_only_flat_expected_csv_members(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "pvp_game_moves_xiangqi_2026-06.zip"
            with zipfile.ZipFile(archive, "w") as output:
                output.writestr("pvp_game_moves_xiangqi_001.csv", "game_id\none\n")
                output.writestr("notes.txt", "ignored")
            paths = extract_csvs(archive, root / "output", "a" * 64)
            self.assertEqual(["pvp_game_moves_xiangqi_001.csv"], [path.name for path in paths])

    def test_imports_valid_games_with_anonymous_display_names(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "games.sqlite3"
            source = root / "pvp_game_moves_xiangqi_001.csv"
            write_csv(source, sample_rows())

            with ElephantchessImporter(database) as importer:
                counts = importer.import_groups(
                    csv_game_groups((source,)),
                    archive_name="pvp_game_moves_xiangqi_2026-06.zip",
                    acquired_at="2026-06-15T00:00:00+00:00",
                )

            self.assertEqual(1, counts["imported"])
            with closing(sqlite3.connect(database)) as connection:
                game = connection.execute(
                    "SELECT red_name, black_name, red_rating, black_rating, moves FROM games"
                ).fetchone()
                self.assertEqual(("Anonymous", "Anonymous", 1000, 1022), game[:4])
                self.assertEqual(
                    '["h3e3","h10g8","h1g3","b10c8"]',
                    game[4],
                )
                source_count = connection.execute(
                    """
                    SELECT count(*) FROM game_sources
                    WHERE source = ? AND collection = ?
                    """,
                    (SOURCE, COLLECTION),
                ).fetchone()[0]
                self.assertEqual(1, source_count)

            with patch.dict(
                os.environ, {"LIXIANGQI_EXPLORER_DB": str(database)}
            ):
                result = query_games(
                    {
                        "sources": ["ec"],
                        "page": 1,
                        "pageSize": 100,
                    }
                )
            self.assertEqual(1, result["total"])
            self.assertEqual("Elephantchess.io", result["games"][0]["sources"][0]["name"])


if __name__ == "__main__":
    unittest.main()
