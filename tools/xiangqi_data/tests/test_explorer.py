from __future__ import annotations

import os
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from tools.xiangqi_data.dpxq_import import dhtml_move_to_uci, import_files, parse_game
from tools.xiangqi_data.engine import PositionRequest
from external.xiangqi_explorer.explorer import explore_games


GAME_HTML = """<!doctype html><meta charset=gb2312>
<div id=dhtmlxq_view>
[DhtmlXQ_title]Red Master 胜 Black Master[/DhtmlXQ_title]<br>
[DhtmlXQ_date]2024-05-01 10:00[/DhtmlXQ_date]<br>
[DhtmlXQ_result]红胜[/DhtmlXQ_result]<br>
[DhtmlXQ_red]Vietnam Red Master[/DhtmlXQ_red]<br>
[DhtmlXQ_redname]Red Master[/DhtmlXQ_redname]<br>
[DhtmlXQ_redteam]Vietnam[/DhtmlXQ_redteam]<br>
[DhtmlXQ_redcountry]Vietnam[/DhtmlXQ_redcountry]<br>
[DhtmlXQ_redlevel]Grandmaster[/DhtmlXQ_redlevel]<br>
[DhtmlXQ_redeng]Red Master Official[/DhtmlXQ_redeng]<br>
[DhtmlXQ_redrating]2520[/DhtmlXQ_redrating]<br>
[DhtmlXQ_black]China Black Master[/DhtmlXQ_black]<br>
[DhtmlXQ_blackname]Black Master[/DhtmlXQ_blackname]<br>
[DhtmlXQ_blackteam]China[/DhtmlXQ_blackteam]<br>
[DhtmlXQ_blackcountry]China[/DhtmlXQ_blackcountry]<br>
[DhtmlXQ_blacklevel]International Master[/DhtmlXQ_blacklevel]<br>
[DhtmlXQ_blackeng]Black Master Official[/DhtmlXQ_blackeng]<br>
[DhtmlXQ_blackrating]2475[/DhtmlXQ_blackrating]<br>
[DhtmlXQ_event]Test Masters[/DhtmlXQ_event]<br>
[DhtmlXQ_class]World event[/DhtmlXQ_class]<br>
[DhtmlXQ_group]Open[/DhtmlXQ_group]<br>
[DhtmlXQ_place]Hanoi[/DhtmlXQ_place]<br>
[DhtmlXQ_gametype]Classical[/DhtmlXQ_gametype]<br>
[DhtmlXQ_timerule]60 minutes plus 30 seconds[/DhtmlXQ_timerule]<br>
[DhtmlXQ_round]1[/DhtmlXQ_round]<br>
[DhtmlXQ_table]12[/DhtmlXQ_table]<br>
[DhtmlXQ_open]A00[/DhtmlXQ_open]<br>
[DhtmlXQ_endtype]Resignation[/DhtmlXQ_endtype]<br>
[DhtmlXQ_author]Tournament recorder[/DhtmlXQ_author]<br>
[DhtmlXQ_refer]https://example.test/event[/DhtmlXQ_refer]<br>
[DhtmlXQ_comment0]Black resigned after the final move.[/DhtmlXQ_comment0]<br>
[DhtmlXQ_binit][/DhtmlXQ_binit]<br>
</div>
<script>
var DhtmlXQ_movelist = '[DhtmlXQ_movelist]79677062[/DhtmlXQ_movelist]';
</script>
"""


class XiangqiExplorerTest(unittest.TestCase):
    def test_dhtml_coordinates_use_xiangqi_intersection_ranks(self) -> None:
        self.assertEqual("h1g3", dhtml_move_to_uci("7967"))
        self.assertEqual("h10g8", dhtml_move_to_uci("7062"))

    def test_parse_legacy_variation_tree_uses_main_line(self) -> None:
        legacy_movelist = (
            "var DhtmlXQ_movelist = "
            "'[0_1_0]79677062[/0_1_0][0_1_1]7062[/0_1_1]';"
        )
        standard_movelist = (
            "var DhtmlXQ_movelist = "
            "'[DhtmlXQ_movelist]79677062[/DhtmlXQ_movelist]';"
        )
        with tempfile.TemporaryDirectory() as directory:
            record = Path(directory) / "view_m_33.html"
            record.write_text(
                GAME_HTML.replace(standard_movelist, legacy_movelist),
                encoding="gb18030",
            )
            game = parse_game(record)

        self.assertEqual(("h1g3", "h10g8"), game.moves)
        self.assertEqual("79677062", game.source_metadata["movelist"])

    def test_import_is_legal_deduplicated_and_queryable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = root / "view_m_100.html"
            duplicate = root / "view_m_101.html"
            first.write_text(GAME_HTML, encoding="gb18030")
            duplicate.write_text(GAME_HTML, encoding="gb18030")
            database = root / "explorer.sqlite3"

            counts = import_files([first, duplicate], database)
            self.assertEqual(
                {"seen": 2, "imported": 1, "duplicate": 1, "invalid": 0}, counts
            )
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(1, connection.execute("SELECT count(*) FROM games").fetchone()[0])
                self.assertEqual(
                    2, connection.execute("SELECT count(*) FROM game_positions").fetchone()[0]
                )
                metadata_row = connection.execute(
                    """
                    SELECT red_entry, red_team, red_country, red_level, red_name_english,
                           red_rating, black_entry, black_team, black_country, black_level,
                           black_name_english, black_rating, event, game_class, group_name,
                           place, game_type, time_rule, table_name, end_type, author,
                           reference, metadata_json
                    FROM games
                    """
                ).fetchone()
                source_metadata = json.loads(
                    connection.execute(
                        "SELECT metadata_json FROM game_sources"
                    ).fetchone()[0]
                )
            self.assertEqual(
                (
                    "Vietnam Red Master", "Vietnam", "Vietnam", "Grandmaster",
                    "Red Master Official", 2520, "China Black Master", "China", "China",
                    "International Master", "Black Master Official", 2475,
                    "Test Masters", "World event", "Open", "Hanoi", "Classical",
                    "60 minutes plus 30 seconds", "12", "Resignation",
                    "Tournament recorder", "https://example.test/event",
                ),
                metadata_row[:-1],
            )
            self.assertEqual({}, json.loads(metadata_row[-1]))
            self.assertEqual("79677062", source_metadata["movelist"])

            board = PositionRequest().initial_fen
            with patch.dict(os.environ, {"LIXIANGQI_EXPLORER_DB": str(database)}):
                data = explore_games(board, {"database": "masters"})
                event_data = explore_games(
                    board, {"database": "event", "event": "Test Masters"}
                )

            self.assertTrue(data["available"])
            self.assertEqual((1, 0, 0), (data["red"], data["draws"], data["black"]))
            self.assertEqual("h1g3", data["moves"][0]["move"])
            self.assertEqual("H2+3", data["moves"][0]["notation"])
            self.assertTrue(data["recentGames"][0]["id"].startswith("g:"))
            self.assertEqual(["h1g3", "h10g8"], data["recentGames"][0]["moves"])
            self.assertEqual(["H2+3", "H8+7"], data["recentGames"][0]["notations"])
            game = data["recentGames"][0]
            self.assertEqual("Vietnam", game["red"]["team"])
            self.assertEqual("Vietnam", game["red"]["country"])
            self.assertEqual("Grandmaster", game["red"]["level"])
            self.assertEqual(2520, game["red"]["rating"])
            self.assertEqual("Hanoi", game["metadata"]["place"])
            self.assertNotIn("comments", game["metadata"])
            self.assertTrue(event_data["available"])
            self.assertEqual(
                (1, 0, 0),
                (event_data["red"], event_data["draws"], event_data["black"]),
            )
            self.assertEqual("h1g3", event_data["moves"][0]["move"])

    def test_import_rejects_a_game_with_an_illegal_move(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            record = root / "view_m_102.html"
            record.write_text(
                GAME_HTML.replace("79677062", "79787062"),
                encoding="gb18030",
            )
            counts = import_files([record], root / "explorer.sqlite3")

        self.assertEqual(
            {"seen": 1, "imported": 0, "duplicate": 0, "invalid": 1}, counts
        )

    def test_provenance_failure_rolls_back_the_entire_game_record(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            record = root / "view_m_103.html"
            record.write_text(GAME_HTML, encoding="gb18030")
            database = root / "explorer.sqlite3"

            with patch(
                "tools.xiangqi_data.dpxq_import.upsert_source_record",
                side_effect=ValueError("provenance rejected"),
            ):
                counts = import_files([record], database)

            with closing(sqlite3.connect(database)) as connection:
                stored = tuple(
                    connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
                    for table in ("games", "game_positions", "game_sources")
                )
                failures = connection.execute(
                    "SELECT count(*) FROM ingest_failures"
                ).fetchone()[0]

        self.assertEqual(
            {"seen": 1, "imported": 0, "duplicate": 0, "invalid": 1}, counts
        )
        self.assertEqual((0, 0, 0), stored)
        self.assertEqual(1, failures)

    def test_utf8_export_and_sortid_keep_trailing_zeroes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            record = Path(directory) / "master.html"
            record.write_text(
                GAME_HTML.replace("charset=gb2312", "charset=utf-8").replace(
                    "[DhtmlXQ_title]", "[DhtmlXQ_sortid]1000[/DhtmlXQ_sortid]\n[DhtmlXQ_title]"
                ),
                encoding="utf-8",
            )
            game = parse_game(record)
        self.assertEqual("100", game.external_id)

    def test_import_preserves_native_names_and_adds_searchable_romanization(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            record = root / "view_m_200.html"
            record.write_text(
                GAME_HTML.replace("Red Master", "王天一").replace("Black Master", "金海英"),
                encoding="gb18030",
            )
            database = root / "explorer.sqlite3"
            import_files([record], database)

            with closing(sqlite3.connect(database)) as connection:
                names = connection.execute(
                    """
                    SELECT red_name, red_name_romanized, red_name_romanization, red_name_key,
                           black_name, black_name_romanized, black_name_romanization, black_name_key
                    FROM games
                    """
                ).fetchone()
            self.assertEqual(
                (
                    "王天一",
                    "Wang Tianyi",
                    "zh-Latn-pinyin-auto",
                    "wangtianyi",
                    "金海英",
                    "Jin Haiying",
                    "zh-Latn-pinyin-auto",
                    "jinhaiying",
                ),
                names,
            )

            board = PositionRequest().initial_fen
            with patch.dict(os.environ, {"LIXIANGQI_EXPLORER_DB": str(database)}):
                data = explore_games(board, {"database": "masters"})
            red = data["topGames"][0]["red"]
            self.assertEqual("Wang Tianyi (王天一)", red["name"])
            self.assertEqual("王天一", red["nativeName"])
            self.assertEqual("Wang Tianyi", red["romanizedName"])

            with closing(sqlite3.connect(database)) as connection:
                connection.execute("UPDATE games SET source = 'lixiangqi'")
                connection.commit()
            with patch.dict(os.environ, {"LIXIANGQI_EXPLORER_DB": str(database)}):
                spaced = explore_games(
                    board,
                    {"database": "player", "player": "Wang Tianyi", "color": "red"},
                )
                compact = explore_games(
                    board,
                    {"database": "player", "player": "wangtianyi", "color": "red"},
                )
            self.assertEqual(1, spaced["red"])
            self.assertEqual(1, compact["red"])

    def test_duplicate_reimport_backfills_missing_name_romanization(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            record = root / "view_m_201.html"
            record.write_text(GAME_HTML.replace("Red Master", "王天一"), encoding="gb18030")
            database = root / "explorer.sqlite3"
            import_files([record], database)
            with closing(sqlite3.connect(database)) as connection:
                connection.execute(
                    "UPDATE games SET red_name_romanized = NULL, red_name_romanization = NULL, "
                    "red_name_key = '', red_team = '', metadata_json = '{}'"
                )
                connection.commit()

            counts = import_files([record], database)
            self.assertEqual(1, counts["duplicate"])
            with closing(sqlite3.connect(database)) as connection:
                restored = connection.execute(
                    "SELECT red_name_romanized, red_name_romanization, red_name_key, "
                    "red_team, place, metadata_json FROM games"
                ).fetchone()
            self.assertEqual(
                ("Wang Tianyi", "zh-Latn-pinyin-auto", "wangtianyi", "Vietnam"),
                restored[:-2],
            )
            self.assertEqual("Hanoi", restored[-2])
            self.assertEqual({}, json.loads(restored[-1]))

    def test_missing_database_fails_without_cloud_fallback(self) -> None:
        board = PositionRequest().initial_fen
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing.sqlite3"
            with patch.dict(os.environ, {"LIXIANGQI_EXPLORER_DB": str(missing)}):
                data = explore_games(board, {"database": "masters"})
        self.assertFalse(data["available"])
        self.assertIn("not installed", data["error"])

    def test_shared_positions_use_the_write_time_projection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            records = []
            for index in range(8):
                record = root / f"view_m_{300 + index}.html"
                record.write_text(
                    GAME_HTML.replace("Red Master", f"Red Master {index}"),
                    encoding="gb18030",
                )
                records.append(record)
            database = root / "explorer.sqlite3"
            counts = import_files(records, database)
            self.assertEqual(8, counts["imported"])

            with closing(sqlite3.connect(database)) as connection:
                indexed = connection.execute(
                    """
                    SELECT p.game_count, s.all_red, s.masters_red, s.dpxq_red
                    FROM explorer_positions p
                    JOIN explorer_stats s ON s.position_id = p.id
                    WHERE p.position_key = ?
                    """,
                    (" ".join(PositionRequest().initial_fen.split()[:2]),),
                ).fetchone()
            self.assertEqual((8, 8, 8, 8), indexed)

            with (
                patch.dict(os.environ, {"LIXIANGQI_EXPLORER_DB": str(database)}),
                patch(
                    "external.xiangqi_explorer.explorer._raw_explore",
                    side_effect=AssertionError("shared position fell back to raw games"),
                ),
            ):
                data = explore_games(
                    PositionRequest().initial_fen, {"database": "masters"}
                )
            self.assertEqual((8, 0, 0), (data["red"], data["draws"], data["black"]))
            self.assertEqual(4, len(data["topGames"]))
            self.assertEqual(8, len(data["recentGames"]))


if __name__ == "__main__":
    unittest.main()
