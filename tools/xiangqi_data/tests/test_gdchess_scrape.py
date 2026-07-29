from __future__ import annotations

import json
import sqlite3
import tempfile
import threading
import unittest
from contextlib import closing
from dataclasses import replace
from pathlib import Path
from unittest.mock import MagicMock, patch

from tools.xiangqi_data.gdchess_import import GdchessImporter, GdchessListing, parse_game_page
from tools.xiangqi_data.gdchess_scrape import (
    RateLimiter,
    catalog_validator,
    fetch_cached,
    infer_resume_cursor,
    parse_catalog,
    parse_listing,
)


GAME_ID = "03930251245792"
GAME_HTML = """<!doctype html>
<html><head><meta charset="utf-8"><title>马晴 胜 郑柯睿 - 测试赛</title></head>
<body><script>
MOVE_STR = "774770627967";
AIScores = [12, -3, 20];
AIMoves = ["7747", "7062", "7967"];
</script></body></html>
"""


def listing() -> GdchessListing:
    return GdchessListing(
        game_id=GAME_ID,
        event_id="100003663",
        event_native="",
        event_english="Test Tournament",
        played_at="2026-07-22",
        round="2",
        table="5",
        red_english="Ma Qing",
        black_english="Zheng Kerui",
        result=1,
        listed_plies=3,
        opening_english="Central Cannon",
        views=12,
        updated_at="2026-07-22T10:00:00",
        listing_url="http://www.01xq.com/XQData/GameList.asp?eid=100003663",
    )


class GdchessScrapeTest(unittest.TestCase):
    def test_fast_resume_uses_only_the_furthest_cached_event(self) -> None:
        game_ids = ["03930251245790", "03930251245791", GAME_ID]

        def event_document(ids: list[str]) -> str:
            rows = "".join(
                f"""
                <tr><td>20260722</td><td>2</td><td>Ma</td><td>2+0</td><td>Li</td>
                <td><a href="javascript:g('{game_id}')">view</a></td>
                <td>3</td><td>Opening</td><td>12</td><td>2026-07-22 10:00:00</td></tr>
                """
                for game_id in ids
            )
            return f"<title>Test - Game list - XiangQi Database</title><table>{rows}</table>"

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            events = output / "events"
            events.mkdir()
            (events / "100.html").write_text(event_document([game_ids[0]]), encoding="utf-8")
            (events / "101.html").write_text(event_document(game_ids[1:]), encoding="utf-8")

            cursor = infer_resume_cursor(
                ["100", "101", "102"],
                output,
                {game_ids[0], game_ids[1]},
            )

        self.assertEqual((1, 1), cursor)

    def test_fast_resume_starts_over_when_database_has_no_committed_games(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            events = output / "events"
            events.mkdir()
            (events / "100.html").write_text(
                "<title>Empty - Game list - XiangQi Database</title>game list(0)",
                encoding="utf-8",
            )

            cursor = infer_resume_cursor(["100", "101"], output, set())

        self.assertEqual((0, 0), cursor)

    def test_fast_resume_ignores_scattered_targeted_event_listings(self) -> None:
        empty_listing = "<title>Empty - Game list - XiangQi Database</title>game list(0)"
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            events = output / "events"
            events.mkdir()
            (events / "100.html").write_text(empty_listing, encoding="utf-8")
            (events / "102.html").write_text(empty_listing, encoding="utf-8")

            cursor = infer_resume_cursor(["100", "101", "102"], output)

        self.assertEqual((1, 0), cursor)

    def test_download_only_resume_requires_html_and_json_sidecar(self) -> None:
        document = f"""
        <title>Test - Game list - XiangQi Database</title><table>
        <tr><td>20260722</td><td>2</td><td>Ma</td><td>2+0</td><td>Li</td>
        <td><a href="javascript:g('{GAME_ID}')">view</a></td>
        <td>3</td><td>Opening</td><td>12</td><td>2026-07-22 10:00:00</td></tr>
        </table>
        """
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "events").mkdir()
            (output / "games").mkdir()
            (output / "events" / "100.html").write_text(document, encoding="utf-8")
            (output / "games" / f"{GAME_ID}.html").write_text(GAME_HTML, encoding="utf-8")

            incomplete = infer_resume_cursor(["100", "101"], output)
            (output / "games" / f"{GAME_ID}.json").write_text("{}", encoding="utf-8")
            complete = infer_resume_cursor(["100", "101"], output)

        self.assertEqual((0, 0), incomplete)
        self.assertEqual((1, 0), complete)

    def test_fetch_preserves_a_rejected_response_and_clears_it_after_recovery(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "page.html"

            def response(payload: bytes) -> MagicMock:
                value = MagicMock()
                value.__enter__.return_value = value
                value.getcode.return_value = 200
                value.geturl.return_value = "http://example.test/page"
                value.headers.get_content_type.return_value = "text/html"
                value.read.return_value = payload
                return value

            bad = b"<html><title>Maintenance</title></html>"
            with patch("tools.xiangqi_data.gdchess_scrape.urllib.request.urlopen", return_value=response(bad)):
                with self.assertRaisesRegex(RuntimeError, "title='Maintenance'"):
                    fetch_cached(
                        "http://example.test/page",
                        destination,
                        validator=lambda document: "expected marker" in document,
                        limiter=RateLimiter(0),
                        timeout=1,
                        retries=0,
                        retry_backoff=0,
                        user_agent="test",
                    )

            rejected = destination.with_suffix(".rejected.html")
            self.assertEqual(bad, rejected.read_bytes())

            good = b"<html><title>Catalog</title>expected marker</html>"
            with patch("tools.xiangqi_data.gdchess_scrape.urllib.request.urlopen", return_value=response(good)):
                path, cached = fetch_cached(
                    "http://example.test/page",
                    destination,
                    validator=lambda document: "expected marker" in document,
                    limiter=RateLimiter(0),
                    timeout=1,
                    retries=0,
                    retry_backoff=0,
                    user_agent="test",
                )

            self.assertEqual(destination, path)
            self.assertFalse(cached)
            self.assertEqual(good, destination.read_bytes())
            self.assertFalse(rejected.exists())

    def test_import_waits_for_a_database_writer_and_then_continues(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / f"{GAME_ID}.html"
            path.write_text(GAME_HTML, encoding="utf-8")
            database = root / "explorer.sqlite3"
            locked = threading.Event()
            release = threading.Event()
            messages: list[str] = []

            def hold_write_lock() -> None:
                with closing(sqlite3.connect(database, timeout=0)) as connection:
                    connection.execute("BEGIN IMMEDIATE")
                    connection.execute(
                        "INSERT OR REPLACE INTO metadata(key, value) VALUES ('lock_test', '1')"
                    )
                    locked.set()
                    release.wait(timeout=10)
                    connection.commit()

            def message(value: str) -> None:
                messages.append(value)
                if "retrying every 1 second" in value:
                    release.set()

            with GdchessImporter(database, message=message) as importer:
                holder = threading.Thread(target=hold_write_lock)
                holder.start()
                self.assertTrue(locked.wait(timeout=5))
                self.assertEqual("imported", importer.import_page(path, listing()))
                holder.join(timeout=5)
                self.assertFalse(holder.is_alive())

            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(
                    1,
                    connection.execute(
                        "SELECT count(*) FROM game_sources WHERE source = 'gdchess_01xq'"
                    ).fetchone()[0],
                )
            self.assertTrue(any("database is locked" in value for value in messages))
            self.assertIn("Explorer database is available; continuing.", messages)

    def test_catalog_discovers_opaque_event_ids_and_page_count(self) -> None:
        document = """
        <a href="XQData/GameList.asp?eid=100003663">One</a>
        <a href="XQData/GameList.asp?eid=100003662">Two</a>
        共 119 页
        """
        self.assertEqual((["100003663", "100003662"], 119), parse_catalog(document))

    def test_catalog_page_without_downloadable_games_is_still_valid(self) -> None:
        document = """
        <title>象棋赛事风向标 - 广象网</title>
        <a href="../XQData/EventInfo.asp?eid=100001234">比赛</a>
        共119页
        """
        self.assertEqual(([], 119), parse_catalog(document))
        self.assertTrue(catalog_validator(document))

    def test_old_catalog_page_without_event_detail_links_is_still_valid(self) -> None:
        document = """
        <title>象棋赛事风向标 - 广象网</title>
        <a href="../XQData/GameList.asp?eid=100000024">棋谱</a>
        共119页
        """
        self.assertTrue(catalog_validator(document))

    def test_modern_event_listing_preserves_all_available_columns(self) -> None:
        document = f"""
        <title>Test Tournament - Game list - XiangQi Database</title>
        <table><tr>
          <td>20260722</td><td>2</td><td>5</td><td>Ma Qing</td><td>2+0</td>
          <td>Zheng Kerui</td><td><a href="javascript:g('{GAME_ID}')">view</a></td>
          <td>3</td><td>Central Cannon</td><td>12</td><td>2026-07-22 10:00:00</td>
        </tr></table>
        """
        games = parse_listing(document, "100003663", "http://example/list")
        self.assertEqual(1, len(games))
        self.assertEqual(listing().game_id, games[0].game_id)
        self.assertEqual(("5", "Ma Qing", "Zheng Kerui"), (
            games[0].table, games[0].red_english, games[0].black_english
        ))
        self.assertEqual((1, 3, "Central Cannon"), (
            games[0].result, games[0].listed_plies, games[0].opening_english
        ))

    def test_event_listing_uses_headers_to_skip_optional_structure_columns(self) -> None:
        document = f"""
        <title>Team Event - Game list - XiangQi Database</title>
        <table><tr>
          <th>Match Date</th><th>Round</th><th>Table</th><th>Match</th><th>Set</th>
          <th>Red</th><th>Result</th><th>Black</th><th>Game</th><th>Moves</th>
          <th>Opening</th><th>Views</th><th>Last Update</th>
        </tr><tr>
          <td>20110811</td><td>1</td><td>3</td><td>0</td><td>1</td>
          <td>Lu BenJie</td><td>2+0</td><td>Li JunFeng</td>
          <td><a href="javascript:g('{GAME_ID}')">view</a></td>
          <td>71</td><td>Pawn VS Pawn</td><td>4537</td><td>2011-08-14 10:10:03</td>
        </tr></table>
        """
        games = parse_listing(document, "100000980", "http://example/list")
        self.assertEqual(1, len(games))
        self.assertEqual(("3", "Lu BenJie", "Li JunFeng"), (
            games[0].table, games[0].red_english, games[0].black_english
        ))
        self.assertEqual((1, 71, "Pawn VS Pawn"), (
            games[0].result, games[0].listed_plies, games[0].opening_english
        ))

    def test_game_page_parses_native_metadata_moves_and_analysis_arrays(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / f"{GAME_ID}.html"
            path.write_text(GAME_HTML, encoding="utf-8")
            game = parse_game_page(path, listing())

        self.assertEqual(("马晴", "郑柯睿", "测试赛"), (
            game.red_name, game.black_name, game.event
        ))
        self.assertEqual(("h3e3", "h10g8", "h1g3"), game.moves)
        self.assertEqual([12, -3, 20], game.source_metadata["ai_scores"])
        self.assertEqual(["7747", "7062", "7967"], game.source_metadata["ai_moves"])

    def test_game_page_keeps_a_legal_line_when_the_listing_ply_count_is_wrong(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / f"{GAME_ID}.html"
            path.write_text(GAME_HTML, encoding="utf-8")
            game = parse_game_page(path, replace(listing(), listed_plies=4))

        self.assertEqual(3, len(game.moves))
        self.assertEqual(
            {"listed": 4, "supplied": 3},
            game.source_metadata["listed_plies_mismatch"],
        )

    def test_import_is_immediate_and_an_identical_restart_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / f"{GAME_ID}.html"
            path.write_text(GAME_HTML, encoding="utf-8")
            database = root / "explorer.sqlite3"

            with GdchessImporter(database) as importer:
                self.assertEqual("imported", importer.import_page(path, listing()))
                with closing(sqlite3.connect(database)) as reader:
                    self.assertEqual(1, reader.execute("SELECT count(*) FROM games").fetchone()[0])
                    self.assertEqual(3, reader.execute("SELECT count(*) FROM game_positions").fetchone()[0])

            with GdchessImporter(database) as importer:
                importer.validator.validate = lambda *_args, **_kwargs: self.fail(
                    "an existing source record was unnecessarily revalidated"
                )
                self.assertEqual("existing", importer.import_page(path, listing()))

            with closing(sqlite3.connect(database)) as reader:
                metadata = json.loads(reader.execute(
                    "SELECT metadata_json FROM game_sources WHERE source = 'gdchess_01xq'"
                ).fetchone()[0])
                self.assertEqual("Ma Qing", metadata["redeng"])
                self.assertEqual("马晴", metadata["red_native"])


if __name__ == "__main__":
    unittest.main()
