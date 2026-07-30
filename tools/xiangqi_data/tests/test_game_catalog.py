from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

from tools.xiangqi_data.dpxq_import import DpxqImporter
from tools.xiangqi_data.gdchess_import import GdchessImporter
from external.xiangqi_explorer.game_catalog import (
    _pacific_week,
    get_game,
    get_source_game,
    query_ancient_manuals,
    query_event,
    query_games,
    query_player,
)
from tools.games_database.dpxq_ancient_manuals import (
    AncientManualImporter,
    Manual,
    RecordRef,
)
from tools.games_database.provenance import (
    AnnotationLayer,
    AnnotationValue,
    SourceTreeNode,
    upsert_source_record,
)
from tools.games_database.storage import initialize as initialize_catalog
from tools.xiangqi_data.pikafish_rules import START_FEN
from tools.xiangqi_data.xqdao_import import XqdaoImporter
from tools.xiangqi_data.tests.test_dpxq_scrape import record_html
from tools.xiangqi_data.tests.test_gdchess_scrape import GAME_HTML as GDCHESS_HTML, listing as gdchess_listing
from tools.xiangqi_data.tests.test_xqdao_scrape import GAME_HTML as XQDAO_HTML, listing as xqdao_listing


def distinct_record(game_id: int, red: str, black: str, date: str, event: str) -> bytes:
    return (
        record_html(game_id)
        .replace(b"Red Master", red.encode("ascii"))
        .replace(b"Black Master", black.encode("ascii"))
        .replace(b"2024-05-01", date.encode("ascii"))
        .replace(b"Test Masters", event.encode("ascii"))
    )


class GameCatalogTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.database = self.root / "explorer.sqlite3"

        master = self.root / "view_m_100.html"
        network = self.root / "view_n_1.html"
        blitz = self.root / "view_k_2.html"
        master.write_bytes(distinct_record(100, "Master Red", "Master Black", "2024-05-03", "Masters"))
        network.write_bytes(distinct_record(1, "Network Red", "Network Black", "2024-05-02", "Online Cup"))
        blitz.write_bytes(distinct_record(2, "Blitz Red", "Blitz Black", "2024-05-01", "Blitz Arena"))

        with DpxqImporter(self.database, commit_each=True) as importer:
            importer.import_path(master, "100", "m")
        with DpxqImporter(
            self.database,
            game_source="dpxq_online",
            default_collection="n",
            commit_each=True,
        ) as importer:
            importer.import_path(network, "1", "n")
            importer.import_path(blitz, "2", "k")

        gdchess = self.root / "03930251245792.html"
        gdchess.write_text(GDCHESS_HTML, encoding="utf-8")
        with GdchessImporter(self.database) as importer:
            importer.import_page(gdchess, gdchess_listing())

        xqdao = self.root / "408.html"
        xqdao.write_text(XQDAO_HTML, encoding="utf-8")
        with XqdaoImporter(self.database) as importer:
            importer.import_page(xqdao, xqdao_listing())

        self.environment = patch.dict(
            os.environ, {"LIXIANGQI_EXPLORER_DB": str(self.database)}
        )
        self.environment.start()

    def tearDown(self) -> None:
        self.environment.stop()
        self.directory.cleanup()

    def test_filters_distinct_games_by_source(self) -> None:
        result = query_games(
            {
                "sources": ["n", "k"],
                "search": "",
                "sort": "date",
                "direction": "desc",
                "page": 1,
                "pageSize": 100,
            }
        )
        self.assertTrue(result["available"])
        self.assertEqual(2, result["total"])
        self.assertEqual(["Network Red", "Blitz Red"], [game["red"]["name"] for game in result["games"]])
        self.assertEqual("Online Tournaments", result["games"][0]["sources"][0]["name"])
        self.assertEqual("Top Blitz Games", result["games"][1]["sources"][0]["name"])

    def test_reports_the_quantity_available_in_every_source(self) -> None:
        result = query_games(
            {
                "sources": ["m"],
                "sort": "date",
                "direction": "desc",
                "page": 1,
                "pageSize": 100,
            }
        )

        self.assertEqual(5, result["totalUniqueGames"])
        self.assertEqual(
            {
                "m": 1,
                "am": 0,
                "n": 1,
                "t": 0,
                "k": 1,
                "o": 0,
                "b": 0,
                "u": 0,
                "w": 0,
                "gd": 1,
                "xqd": 1,
                "ec": 0,
                "online": 2,
            },
            result["sourceCounts"],
        )

    def test_ancient_manuals_are_grouped_by_manual_chapter_and_game(self) -> None:
        page = self.root / "view_u_424242.html"
        page.write_text(
            """
            [DhtmlXQ_title]第一局 当头炮[/DhtmlXQ_title]
            [DhtmlXQ_result][/DhtmlXQ_result]
            [DhtmlXQ_movelist]7967[/DhtmlXQ_movelist]
            """,
            encoding="utf-8",
        )
        manual = Manual("meihuaquan", "梅花泉", 1)
        reference = RecordRef(
            "u",
            "424242",
            "第一局 当头炮",
            "http://www.dpxq.com/hldcg/search/view_u_424242.html",
            chapter_title="上卷",
            chapter_url="http://www.dpxq.com/manual/meihuaquan/upper/",
            chapter_order=1,
            game_order=1,
        )
        with AncientManualImporter(self.database) as importer:
            importer.import_path(page, manual, reference)

        result = query_ancient_manuals({})
        meihuaquan = next(
            manual for manual in result["manuals"] if manual["slug"] == "meihuaquan"
        )

        self.assertTrue(result["available"])
        self.assertEqual(13, len(result["manuals"]))
        self.assertEqual(1, result["totalGames"])
        self.assertEqual(1, meihuaquan["gameCount"])
        self.assertEqual("上卷", meihuaquan["chapters"][0]["title"])
        self.assertEqual(
            "第一局 当头炮", meihuaquan["chapters"][0]["games"][0]["title"]
        )
        self.assertEqual(
            START_FEN,
            meihuaquan["chapters"][0]["games"][0]["initialFen"],
        )
        self.assertEqual(
            ["h1g3"],
            meihuaquan["chapters"][0]["games"][0]["moves"],
        )
        self.assertTrue(
            meihuaquan["chapters"][0]["games"][0]["id"].startswith("g:")
        )
        catalog = query_games(
            {
                "sources": ["am"],
                "sort": "date",
                "direction": "desc",
                "page": 1,
                "pageSize": 100,
            }
        )
        self.assertEqual("Ancient Manuals", catalog["games"][0]["sources"][0]["name"])

        english = query_ancient_manuals({"language": "en"})
        english_meihuaquan = next(
            manual
            for manual in english["manuals"]
            if manual["slug"] == "meihuaquan"
        )
        self.assertEqual("Plum Flower Springs Manual", english_meihuaquan["title"])
        self.assertEqual("Volume I", english_meihuaquan["chapters"][0]["title"])

    def test_timeline_uses_the_same_source_and_search_filters(self) -> None:
        all_selected = query_games(
            {
                "sources": ["m", "n", "k"],
                "timelineUnit": "year",
                "page": 1,
                "pageSize": 100,
            }
        )
        self.assertEqual(
            [{"start": "2024", "count": 3}],
            all_selected["timeline"]["buckets"],
        )
        self.assertEqual(0, all_selected["timeline"]["undated"])

        searched = query_games(
            {
                "sources": ["m", "n", "k"],
                "search": "Online Cup",
                "timelineUnit": "month",
                "page": 1,
                "pageSize": 100,
            }
        )
        self.assertEqual(1, searched["total"])
        self.assertEqual(
            [{"start": "2024-05", "count": 1}],
            searched["timeline"]["buckets"],
        )

        decade = query_games(
            {
                "sources": ["m", "n", "k"],
                "timelineUnit": "decade",
                "page": 1,
                "pageSize": 100,
            }
        )
        self.assertEqual(
            [{"start": "2020", "count": 3}],
            decade["timeline"]["buckets"],
        )

    def test_timeline_treats_zero_dates_as_undated(self) -> None:
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute(
                """
                UPDATE games
                SET played_at = '0000-00-00', year = 0, month = '0000-00'
                WHERE red_name = 'Master Red'
                """
            )
            connection.commit()

        expected = {
            "month": "2024-05",
            "year": "2024",
            "decade": "2020",
        }
        for unit, bucket in expected.items():
            result = query_games(
                {
                    "sources": ["m", "n", "k"],
                    "timelineUnit": unit,
                    "page": 1,
                    "pageSize": 100,
                }
            )
            self.assertEqual(3, result["total"])
            self.assertEqual(1, result["timeline"]["undated"])
            self.assertEqual(
                [{"start": bucket, "count": 2}],
                result["timeline"]["buckets"],
            )

    def test_weekly_growth_is_automatic_and_schema_upgrade_starts_at_zero(self) -> None:
        result = query_games(
            {
                "sources": ["m"],
                "page": 1,
                "pageSize": 100,
            }
        )
        self.assertEqual(5, result["weeklyAdded"]["count"])
        self.assertEqual("America/Los_Angeles", result["weeklyAdded"]["timeZone"])

        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute("DELETE FROM catalog_growth_hourly")
            connection.execute("DROP TRIGGER games_track_catalog_growth")
            initialize_catalog(connection)
            connection.commit()
            self.assertEqual(
                0,
                connection.execute(
                    "SELECT COALESCE(sum(games_added), 0) FROM catalog_growth_hourly"
                ).fetchone()[0],
            )

        new_master = self.root / "view_m_101.html"
        new_master.write_bytes(
            distinct_record(101, "New Red", "New Black", "2024-06-01", "New Masters")
        )
        with DpxqImporter(self.database, commit_each=True) as importer:
            importer.import_path(new_master, "101", "m")
        with closing(sqlite3.connect(self.database)) as connection:
            self.assertEqual(
                1,
                connection.execute(
                    "SELECT COALESCE(sum(games_added), 0) FROM catalog_growth_hourly"
                ).fetchone()[0],
            )

    def test_week_boundaries_follow_pacific_daylight_saving_time(self) -> None:
        pacific = ZoneInfo("America/Los_Angeles")
        spring_start, spring_end = _pacific_week(
            datetime(2026, 3, 10, 12, tzinfo=pacific)
        )
        autumn_start, autumn_end = _pacific_week(
            datetime(2026, 11, 3, 12, tzinfo=pacific)
        )

        self.assertEqual(167 * 60 * 60, (spring_end - spring_start).total_seconds())
        self.assertEqual(169 * 60 * 60, (autumn_end - autumn_start).total_seconds())

    def test_search_sort_and_pagination_are_server_side(self) -> None:
        searched = query_games(
            {
                "sources": ["m", "n", "k"],
                "search": "Online Cup",
                "sort": "red",
                "direction": "asc",
                "page": 1,
                "pageSize": 1,
            }
        )
        self.assertEqual(1, searched["total"])
        self.assertEqual("Network Red", searched["games"][0]["red"]["name"])

        paged = query_games(
            {
                "sources": ["m", "n", "k"],
                "sort": "red",
                "direction": "asc",
                "page": 2,
                "pageSize": 1,
            }
        )
        self.assertEqual(3, paged["total"])
        self.assertEqual("Master Red", paged["games"][0]["red"]["name"])

    def test_player_profile_is_exact_side_relative_and_source_filterable(self) -> None:
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute(
                """
                UPDATE games
                SET black_name = 'Master Red',
                    black_name_romanized = NULL,
                    black_name_romanization = NULL,
                    black_name_key = 'masterred'
                WHERE red_name = 'Network Red'
                """
            )
            connection.commit()

        result = query_player(
            {
                "player": "Master Red",
                "sources": ["m", "n"],
                "timelineUnit": "year",
                "sort": "date",
                "direction": "desc",
                "page": 1,
                "pageSize": 100,
            }
        )

        self.assertTrue(result["available"])
        self.assertEqual("Master Red", result["player"]["name"])
        self.assertEqual(2, result["total"])
        self.assertEqual(
            {"games": 1, "wins": 1, "draws": 0, "losses": 0},
            result["summary"]["red"],
        )
        self.assertEqual(
            {"games": 1, "wins": 0, "draws": 0, "losses": 1},
            result["summary"]["black"],
        )
        self.assertEqual(
            {"games": 2, "wins": 1, "draws": 0, "losses": 1},
            result["summary"]["overall"],
        )
        self.assertEqual({"m": 1, "n": 1}, {
            source: result["sourceCounts"][source] for source in ("m", "n")
        })
        self.assertEqual(
            {"red", "black"}, {game["playerColor"] for game in result["games"]}
        )

        masters_only = query_player(
            {
                "player": "masterred",
                "sources": ["m"],
                "page": 1,
                "pageSize": 100,
            }
        )
        self.assertEqual(1, masters_only["summary"]["totalGames"])
        self.assertEqual(1, masters_only["summary"]["red"]["wins"])

    def test_event_profile_has_complete_standings_rounds_and_source_filters(self) -> None:
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute(
                """
                UPDATE games
                SET round = '1', opening = 'Central Cannon', place = 'Hanoi', result = 1
                WHERE red_name = 'Master Red'
                """
            )
            connection.execute(
                """
                UPDATE games
                SET event = 'Masters', round = '2', opening = 'Screen Horse',
                    place = 'Hanoi', result = 0,
                    black_name = 'Master Red',
                    black_name_romanized = NULL,
                    black_name_romanization = NULL,
                    black_name_key = 'masterred'
                WHERE red_name = 'Network Red'
                """
            )
            connection.commit()

        result = query_event({"event": "masters", "sources": ["m", "n"]})

        self.assertTrue(result["available"])
        self.assertEqual("Masters", result["event"]["name"])
        self.assertEqual(2, result["summary"]["totalGames"])
        self.assertEqual(3, result["summary"]["players"])
        self.assertEqual(2, result["summary"]["rounds"])
        self.assertEqual(2, result["summary"]["recordedOpenings"])
        self.assertEqual(
            {
                "games": 2,
                "wins": 1,
                "draws": 1,
                "losses": 0,
                "score": 3,
            },
            {
                key: result["summary"]["standings"][0][key]
                for key in ("games", "wins", "draws", "losses", "score")
            },
        )
        self.assertEqual("Master Red", result["summary"]["standings"][0]["name"])
        self.assertEqual(
            ["1", "2"], [round_data["name"] for round_data in result["rounds"]]
        )
        self.assertEqual(
            {"m": 1, "n": 1},
            {source: result["sourceCounts"][source] for source in ("m", "n")},
        )
        self.assertTrue(all(round_data["games"] for round_data in result["rounds"]))

        masters_only = query_event({"event": "Masters", "sources": ["m"]})
        self.assertEqual(1, masters_only["summary"]["totalGames"])
        self.assertEqual(1, len(masters_only["rounds"]))
        self.assertEqual("1", masters_only["rounds"][0]["name"])

    def test_gdchess_is_a_filterable_source_with_native_catalog_games(self) -> None:
        result = query_games(
            {
                "sources": ["gd"],
                "sort": "date",
                "direction": "desc",
                "page": 1,
                "pageSize": 100,
            }
        )
        self.assertEqual(1, result["total"])
        self.assertEqual("Ma Qing (马晴)", result["games"][0]["red"]["name"])
        self.assertEqual("GDChess/01xq", result["games"][0]["sources"][0]["name"])

    def test_xqdao_is_a_filterable_top_level_source(self) -> None:
        result = query_games(
            {
                "sources": ["xqd"],
                "sort": "date",
                "direction": "desc",
                "page": 1,
                "pageSize": 100,
            }
        )
        self.assertEqual(1, result["total"])
        self.assertEqual("Wang Xiao (王晓)", result["games"][0]["red"]["name"])
        self.assertEqual("XQDao", result["games"][0]["sources"][0]["name"])

    def test_catalog_game_returns_native_analysis_payload(self) -> None:
        game = get_game({"id": "dpxq_online:n:1"})
        self.assertTrue(game["id"].startswith("g:"))
        self.assertEqual(["h1g3", "h10g8"], game["moves"])
        self.assertEqual(["H2+3", "H8+7"], game["notations"])
        self.assertEqual("Network Red", game["red"]["name"])
        self.assertEqual("Online Tournaments", game["sources"][0]["name"])

    def test_source_game_resolves_directly_for_puzzle_history(self) -> None:
        game = get_source_game(self.database.name, "dpxq_online:n:1")
        self.assertIsNotNone(game)
        assert game is not None
        self.assertEqual(["h1g3", "h10g8"], game["moves"])
        self.assertEqual(["H2+3", "H8+7"], game["notations"])
        self.assertEqual("Network Red", game["red"]["name"])
        master = get_source_game("xiangqi-explorer-dpxq.sqlite3", "100")
        self.assertIsNotNone(master)
        assert master is not None
        self.assertEqual("Master Red", master["red"]["name"])

    def test_catalog_game_can_be_resolved_from_an_explicit_database(self) -> None:
        game = get_game(
            {"database": self.database.name, "id": "dpxq_online:n:1"}
        )
        self.assertTrue(game["id"].startswith("g:"))
        self.assertEqual("Network Red", game["red"]["name"])

    def test_source_witness_preserves_annotations_and_variation_structure(self) -> None:
        with closing(sqlite3.connect(self.database)) as connection:
            connection.row_factory = sqlite3.Row
            witness = connection.execute(
                """
                SELECT s.*, g.moves FROM game_sources s
                JOIN games g ON g.id = s.game_id
                WHERE s.source = 'dpxq' AND s.collection = 'm'
                """
            ).fetchone()
            assert witness is not None
            upsert_source_record(
                connection,
                source=witness["source"],
                collection=witness["collection"],
                collection_name=witness["collection_name"],
                external_id=witness["external_id"],
                game_id=witness["game_id"],
                source_url=witness["source_url"],
                metadata={},
                moves=json.loads(witness["moves"]),
                parser_version="test-manual-v1",
                notation_text="H2+3 H8+7 (H8+9)",
                annotation_layers=(
                    AnnotationLayer(
                        kind="historical_commentary",
                        annotator="Manual author",
                        language="zh",
                        annotations=(
                            AnnotationValue(
                                anchor_kind="variation",
                                anchor_path="h1g3 b10a8",
                                annotation_type="comment",
                                body="The manual prefers this branch.",
                            ),
                        ),
                    ),
                ),
                tree_nodes=(
                    SourceTreeNode(
                        path="h1g3 b10a8",
                        ply=2,
                        move="b10a8",
                        notation="H8+9",
                        child_order=1,
                    ),
                ),
            )
            connection.commit()

        game = get_game({"id": "dpxq:100"})
        self.assertEqual("H2+3 H8+7 (H8+9)", game["notation"])
        witness_payload = game["witnesses"][0]
        self.assertEqual(64, len(witness_payload["rawChecksum"]))
        self.assertTrue(witness_payload["acquiredAt"])
        self.assertEqual("h1g3 b10a8", witness_payload["treeNodes"][0]["path"])
        annotation = witness_payload["annotations"][0]["annotations"][0]
        self.assertEqual("variation", annotation["anchor"])
        self.assertEqual("h1g3 b10a8", annotation["path"])
        self.assertEqual("The manual prefers this branch.", annotation["body"])

    def test_one_authoritative_database_exposes_every_source(self) -> None:
        result = query_games(
            {
                "sources": ["m", "n", "k", "gd", "xqd"],
                "sort": "date",
                "direction": "desc",
                "page": 1,
                "pageSize": 100,
            }
        )
        self.assertEqual(5, result["total"])
        self.assertEqual(1, result["sourceCounts"]["gd"])
        self.assertEqual(1, result["sourceCounts"]["xqd"])

    def test_rejects_unbounded_or_injected_query_values(self) -> None:
        with self.assertRaises(ValueError):
            query_games({"sources": ["m'); DROP TABLE games; --"]})
        with self.assertRaises(ValueError):
            query_games({"sources": ["m"], "sort": "g.external_id"})
        with self.assertRaises(ValueError):
            query_games({"sources": ["m"], "timelineUnit": "century"})
        with self.assertRaises(ValueError):
            get_game({"id": "'; DELETE FROM games; --"})


if __name__ == "__main__":
    unittest.main()
