from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.xiangqi_data.dpxq_import import DpxqImporter
from tools.xiangqi_data.gdchess_import import GdchessImporter
from external.xiangqi_explorer.game_catalog import get_game, get_source_game, query_games
from tools.xiangqi_data.split_explorer_database import split_database
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

        self.assertEqual(
            {
                "m": 1,
                "n": 1,
                "t": 0,
                "k": 1,
                "o": 0,
                "b": 0,
                "u": 0,
                "w": 0,
                "gd": 1,
                "xqd": 1,
                "online": 2,
            },
            result["sourceCounts"],
        )

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
        self.assertEqual("dpxq_online:n:1", game["id"])
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

    def test_catalog_game_can_be_resolved_from_an_explicit_database(self) -> None:
        game = get_game(
            {"database": self.database.name, "id": "dpxq_online:n:1"}
        )
        self.assertEqual("dpxq_online:n:1", game["id"])
        self.assertEqual("Network Red", game["red"]["name"])

    def test_split_source_databases_are_aggregated_without_a_shared_writer(self) -> None:
        dpxq = self.root / "dpxq.sqlite3"
        gdchess = self.root / "gdchess.sqlite3"
        xqdao = self.root / "xqdao.sqlite3"
        split_database(
            self.database,
            (
                ("DPXQ", "dpxq", dpxq),
                ("GDChess/01xq", "gdchess_01xq", gdchess),
                ("XQDao", "xqdao", xqdao),
            ),
        )
        environment = {
            "LIXIANGQI_DPXQ_DB": str(dpxq),
            "LIXIANGQI_GDCHESS_DB": str(gdchess),
            "LIXIANGQI_XQDAO_DB": str(xqdao),
        }
        with patch.dict(os.environ, environment):
            del os.environ["LIXIANGQI_EXPLORER_DB"]
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
            get_game({"id": "'; DELETE FROM games; --"})


if __name__ == "__main__":
    unittest.main()
