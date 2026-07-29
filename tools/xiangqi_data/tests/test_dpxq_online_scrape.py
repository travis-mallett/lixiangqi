from __future__ import annotations

import sqlite3
import tempfile
import unittest
import os
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from tools.xiangqi_data.dpxq_import import DpxqImporter
from tools.xiangqi_data.dpxq_online_scrape import listed_collection_ids
from tools.xiangqi_data.dpxq_scrape import record_path, scrape_records, validated_record
from tools.xiangqi_data.engine import PositionRequest
from external.xiangqi_explorer.explorer import explore_games
from tools.xiangqi_data.tests.test_dpxq_scrape import record_html


class MemoryResponse:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload

    def __enter__(self) -> "MemoryResponse":
        return self

    def __exit__(self, *_exc: object) -> None:
        pass

    def read(self, _limit: int = -1) -> bytes:
        return self.payload


class DpxqOnlineScrapeTest(unittest.TestCase):
    def test_online_record_is_stored_under_its_collection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "html" / "n"
            database = root / "explorer.sqlite3"
            with DpxqImporter(
                database,
                game_source="dpxq_online",
                default_collection="n",
                commit_each=True,
            ) as importer:
                counts, paths = scrape_records(
                    range(1, 2),
                    output,
                    base_url="http://test/{owner}/{id}",
                    owner="n",
                    delay=0,
                    fetch=lambda _url, **_options: record_html(1),
                    record_ready=lambda path, game_id, _cached: importer.import_path(
                        path, str(game_id), "n"
                    ),
                )

            self.assertEqual((1, 0), (counts.downloaded, counts.failed))
            self.assertEqual("view_n_1.html", paths[0].name)
            self.assertTrue(validated_record(record_path(output, 1, "n"), 1, "n"))
            with closing(sqlite3.connect(database)) as connection:
                game = connection.execute(
                    "SELECT id, source, external_id FROM games"
                ).fetchone()
                source = connection.execute(
                    """
                    SELECT source, collection, collection_name, external_id, game_id
                    FROM game_sources
                    """
                ).fetchone()
            self.assertTrue(game[0].startswith("g:"))
            self.assertEqual(("dpxq_online", "n:1"), game[1:])
            self.assertEqual(
                ("dpxq", "n", "网络赛事", "1"), source[:-1]
            )
            self.assertEqual(game[0], source[-1])

    def test_duplicate_game_keeps_every_collection_membership(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            n_record = root / "view_n_1.html"
            k_record = root / "view_k_1.html"
            n_record.write_bytes(record_html(1))
            k_record.write_bytes(record_html(1))
            database = root / "explorer.sqlite3"
            with DpxqImporter(
                database,
                game_source="dpxq_online",
                default_collection="n",
                commit_each=True,
            ) as importer:
                importer.import_path(n_record, "1", "n")
                importer.import_path(k_record, "1", "k")
                self.assertEqual(1, importer.counts["imported"])
                self.assertEqual(1, importer.counts["duplicate"])

            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(1, connection.execute("SELECT count(*) FROM games").fetchone()[0])
                self.assertEqual(
                    [("k", "1"), ("n", "1")],
                    connection.execute(
                        "SELECT collection, external_id FROM game_sources ORDER BY collection"
                    ).fetchall(),
                )
                self.assertEqual(
                    2,
                    connection.execute(
                        "SELECT count(*) FROM game_positions"
                    ).fetchone()[0],
                )

    def test_cached_restart_skips_a_committed_online_source_record(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            record = root / "view_o_5.html"
            record.write_bytes(record_html(5))
            database = root / "explorer.sqlite3"
            with DpxqImporter(
                database,
                game_source="dpxq_online",
                default_collection="o",
                commit_each=True,
            ) as importer:
                importer.import_path(record, "5", "o")
            with DpxqImporter(
                database,
                game_source="dpxq_online",
                default_collection="o",
                commit_each=True,
            ) as importer:
                importer.import_if_missing(record, "5", "o")
                self.assertEqual(
                    {"seen": 1, "imported": 0, "duplicate": 1, "invalid": 0},
                    importer.counts,
                )

    def test_master_membership_survives_cross_collection_deduplication(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            online_record = root / "view_n_9.html"
            master_record = root / "view_m_90.html"
            online_record.write_bytes(record_html(9))
            master_record.write_bytes(record_html(90))
            database = root / "explorer.sqlite3"
            with DpxqImporter(
                database,
                game_source="dpxq_online",
                default_collection="n",
                commit_each=True,
            ) as importer:
                importer.import_path(online_record, "9", "n")
            with DpxqImporter(database, commit_each=True) as importer:
                importer.import_path(master_record, "90", "m")

            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(1, connection.execute("SELECT count(*) FROM games").fetchone()[0])
                self.assertEqual(
                    [("m", "90"), ("n", "9")],
                    connection.execute(
                        "SELECT collection, external_id FROM game_sources ORDER BY collection"
                    ).fetchall(),
                )
            board = PositionRequest().initial_fen
            with patch.dict(os.environ, {"LIXIANGQI_EXPLORER_DB": str(database)}):
                masters = explore_games(board, {"database": "masters"})
            self.assertEqual(1, masters["red"])
            self.assertTrue(masters["topGames"][0]["id"].startswith("g:"))
            self.assertIn("view_m_90.html", masters["topGames"][0]["sourceUrl"])

    def test_unowned_ids_are_enumerated_from_the_sparse_listing(self) -> None:
        listing = b"""
        <a href="javascript:view('owner=u&id=1966001')">one</a>
        <a href="javascript:view('owner=u&id=1965990')">two</a>
        <a href="javascript:view('owner=u&id=1966001&isSave=yes')">duplicate</a>
        <a href="javascript:view('owner=u&id=1965800')">three</a>
        """
        with patch(
            "tools.xiangqi_data.dpxq_online_scrape.urllib.request.urlopen",
            return_value=MemoryResponse(listing),
        ):
            ids = listed_collection_ids(
                "w", pages=1, limit=3, timeout=1, user_agent="test"
            )
        self.assertEqual([1966001, 1965990, 1965800], ids)


if __name__ == "__main__":
    unittest.main()
