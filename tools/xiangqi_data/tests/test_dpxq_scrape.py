from __future__ import annotations

import tempfile
import threading
import unittest
import sqlite3
from contextlib import closing
from email.message import EmailMessage
from pathlib import Path
from unittest.mock import patch

from tools.xiangqi_data.dpxq_import import DpxqImporter, parse_game
from tools.xiangqi_data.dpxq_scrape import (
    DownloadFailure,
    PersistentRecordFetcher,
    infer_resume_start,
    record_path,
    scrape_records,
    validated_record,
)
from tools.xiangqi_data.tests.test_explorer import GAME_HTML


def record_html(game_id: int) -> bytes:
    document = GAME_HTML.replace(
        "[DhtmlXQ_title]", f"[DhtmlXQ_sortid]{game_id}0[/DhtmlXQ_sortid]\n[DhtmlXQ_title]"
    )
    return document.encode("gb18030")


class DpxqScrapeTest(unittest.TestCase):
    def test_persistent_fetcher_reuses_an_open_connection(self) -> None:
        connections = []

        class Response:
            status = 200
            will_close = False

            def __init__(self) -> None:
                self.headers = EmailMessage()
                self.headers["Content-Type"] = "text/html"

            def read(self, _limit: int) -> bytes:
                return b"record"

        class Connection:
            def __init__(self, *_args, **_kwargs) -> None:
                self.requests: list[str] = []
                self.timeout = 0
                connections.append(self)

            def request(self, _method: str, target: str, **_kwargs) -> None:
                self.requests.append(target)

            def getresponse(self) -> Response:
                return Response()

            def close(self) -> None:
                pass

        with patch("tools.xiangqi_data.dpxq_scrape.http.client.HTTPConnection", Connection):
            with PersistentRecordFetcher() as fetch:
                self.assertEqual(
                    b"record",
                    fetch("http://example.test/one", timeout=2, user_agent="test"),
                )
                self.assertEqual(
                    b"record",
                    fetch("http://example.test/two?query=1", timeout=2, user_agent="test"),
                )

        self.assertEqual(1, len(connections))
        self.assertEqual(["/one", "/two?query=1"], connections[0].requests)

    def test_fast_resume_uses_highest_committed_database_id(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "explorer.sqlite3"
            with closing(sqlite3.connect(database)) as connection:
                connection.execute(
                    """
                    CREATE TABLE game_sources(
                      source TEXT, collection TEXT, external_id TEXT
                    )
                    """
                )
                connection.executemany(
                    "INSERT INTO game_sources VALUES ('dpxq', 'm', ?)",
                    [("10",), ("11",), ("12",)],
                )
                connection.commit()

            resumed = infer_resume_start(1, 20, root / "html", database=database)

        self.assertEqual(13, resumed)

    def test_download_only_fast_resume_uses_highest_atomic_final_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "view_m_40.html").write_bytes(record_html(40))
            (output / "view_m_42.html").write_bytes(record_html(42))
            partial = output / ".partial" / "view_m_99.html.part"
            partial.parent.mkdir()
            partial.write_bytes(b"incomplete")

            resumed = infer_resume_start(1, 100, output, database=None)

        self.assertEqual(43, resumed)

    def test_import_waits_for_a_database_writer_and_then_continues(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "explorer.sqlite3"
            path = root / "view_m_70.html"
            path.write_bytes(record_html(70))
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

            with DpxqImporter(database, commit_each=True, message=message) as importer:
                holder = threading.Thread(target=hold_write_lock)
                holder.start()
                self.assertTrue(locked.wait(timeout=5))
                importer.import_path(path)
                holder.join(timeout=5)
                self.assertFalse(holder.is_alive())

            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(
                    1,
                    connection.execute(
                        "SELECT count(*) FROM games WHERE external_id = '70'"
                    ).fetchone()[0],
                )
            self.assertTrue(any("database is locked" in value for value in messages))
            self.assertIn("Explorer database is available; continuing.", messages)

    def test_download_is_committed_to_database_before_the_next_game(self) -> None:
        def interrupted_fetch(url: str, **_options) -> bytes:
            game_id = int(url.rsplit("/", 1)[-1])
            if game_id == 2:
                raise KeyboardInterrupt
            return record_html(game_id)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "html"
            database = root / "explorer.sqlite3"
            with DpxqImporter(database, commit_each=True) as importer:
                with self.assertRaises(KeyboardInterrupt):
                    scrape_records(
                        range(1, 3),
                        output,
                        base_url="http://test/{id}",
                        delay=0,
                        fetch=interrupted_fetch,
                        record_ready=lambda path, _game_id, _cached: importer.import_path(path),
                    )
                with closing(sqlite3.connect(database)) as reader:
                    self.assertEqual(
                        1,
                        reader.execute(
                            "SELECT count(*) FROM games WHERE source = 'dpxq'"
                        ).fetchone()[0],
                    )
                    self.assertEqual(
                        "1",
                        reader.execute(
                            "SELECT value FROM metadata WHERE key = 'dpxq_game_count'"
                        ).fetchone()[0],
                    )

            self.assertTrue(validated_record(record_path(output, 1), 1))
            self.assertFalse(record_path(output, 2).exists())

    def test_empty_fresh_range_requests_game_one_first(self) -> None:
        calls: list[int] = []

        def fetch(url: str, **_options) -> bytes:
            game_id = int(url.rsplit("/", 1)[-1])
            calls.append(game_id)
            return record_html(game_id)

        with tempfile.TemporaryDirectory() as directory:
            counts, paths = scrape_records(
                range(1, 3),
                Path(directory),
                base_url="http://test/{id}",
                delay=0,
                fetch=fetch,
            )

        self.assertEqual([1, 2], calls)
        self.assertEqual((2, 0), (counts.downloaded, counts.cached))
        self.assertEqual(["view_m_1.html", "view_m_2.html"], [path.name for path in paths])

    def test_scrape_validates_and_resumes_cached_records(self) -> None:
        calls: list[str] = []

        def fetch(url: str, **_options) -> bytes:
            calls.append(url)
            return record_html(int(url.rsplit("/", 1)[-1]))

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            first, paths = scrape_records(
                range(10, 12), output, base_url="http://test/{id}", delay=0, fetch=fetch
            )
            second, cached = scrape_records(
                range(10, 12), output, base_url="http://test/{id}", delay=0, fetch=fetch
            )

        self.assertEqual((2, 0, 0), (first.downloaded, first.cached, first.failed))
        self.assertEqual((0, 2, 0), (second.downloaded, second.cached, second.failed))
        self.assertEqual(["http://test/10", "http://test/11"], calls)
        self.assertEqual(["view_m_10.html", "view_m_11.html"], [path.name for path in paths])
        self.assertEqual(paths, cached)

    def test_restart_only_imports_cached_records_missing_from_database(self) -> None:
        calls: list[int] = []

        def distinct_record_html(game_id: int) -> bytes:
            return record_html(game_id).replace(
                b"2024-05-01", f"2024-05-{game_id - 39:02d}".encode("ascii")
            )

        def fetch(url: str, **_options) -> bytes:
            game_id = int(url.rsplit("/", 1)[-1])
            calls.append(game_id)
            return distinct_record_html(game_id)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "html"
            database = root / "explorer.sqlite3"
            record_path(output, 40).parent.mkdir(parents=True)
            record_path(output, 40).write_bytes(distinct_record_html(40))
            record_path(output, 41).write_bytes(distinct_record_html(41))

            # Simulate a killed run: game 40 reached both disk and SQLite, game
            # 41 reached disk only, and game 42 was never downloaded.
            with DpxqImporter(database, commit_each=True) as importer:
                importer.import_path(record_path(output, 40))

            with DpxqImporter(database, commit_each=True) as importer:
                counts, _paths = scrape_records(
                    range(40, 43),
                    output,
                    base_url="http://test/{id}",
                    delay=0,
                    fetch=fetch,
                    record_ready=lambda path, game_id, cached: (
                        importer.import_if_missing(path, str(game_id))
                        if cached
                        else importer.import_path(path)
                    ),
                )
                import_counts = dict(importer.counts)

            with closing(sqlite3.connect(database)) as connection:
                ids = {
                    row[0]
                    for row in connection.execute(
                        "SELECT external_id FROM games WHERE source = 'dpxq'"
                    )
                }

        self.assertEqual([42], calls)
        self.assertEqual((1, 2, 0), (counts.downloaded, counts.cached, counts.failed))
        self.assertEqual({"40", "41", "42"}, ids)
        self.assertEqual(
            {"seen": 3, "imported": 2, "duplicate": 1, "invalid": 0},
            import_counts,
        )

    def test_restart_skips_cached_content_duplicate_without_revalidation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = root / "view_m_50.html"
            duplicate = root / "view_m_51.html"
            first.write_bytes(record_html(50))
            duplicate.write_bytes(record_html(51))
            database = root / "explorer.sqlite3"

            with DpxqImporter(database, commit_each=True) as importer:
                importer.import_path(first)

            with DpxqImporter(database, commit_each=True) as importer:
                importer.validator.validate = lambda *_args, **_kwargs: self.fail(
                    "cached content duplicate was unnecessarily revalidated"
                )
                importer.import_if_missing(duplicate, "51")
                counts = dict(importer.counts)

        self.assertEqual(
            {"seen": 1, "imported": 0, "duplicate": 1, "invalid": 0}, counts
        )

    def test_restart_after_interruption_downloads_the_first_unfinished_id(self) -> None:
        first_calls: list[int] = []

        def interrupted_fetch(url: str, **_options) -> bytes:
            game_id = int(url.rsplit("/", 1)[-1])
            first_calls.append(game_id)
            if game_id == 12:
                raise KeyboardInterrupt
            return record_html(game_id)

        restart_calls: list[int] = []

        def restart_fetch(url: str, **_options) -> bytes:
            game_id = int(url.rsplit("/", 1)[-1])
            restart_calls.append(game_id)
            return record_html(game_id)

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            with self.assertRaises(KeyboardInterrupt):
                scrape_records(
                    range(10, 15),
                    output,
                    base_url="http://test/{id}",
                    delay=0,
                    fetch=interrupted_fetch,
                )

            self.assertEqual([10, 11, 12], first_calls)
            self.assertTrue(validated_record(record_path(output, 10), 10))
            self.assertTrue(validated_record(record_path(output, 11), 11))
            self.assertFalse(record_path(output, 12).exists())

            counts, selected = scrape_records(
                range(10, 15),
                output,
                base_url="http://test/{id}",
                delay=0,
                fetch=restart_fetch,
            )

            self.assertEqual([12, 13, 14], restart_calls)
            self.assertEqual((3, 2, 0), (counts.downloaded, counts.cached, counts.failed))
            self.assertEqual(
                [f"view_m_{game_id}.html" for game_id in range(10, 15)],
                [path.name for path in selected],
            )
            self.assertTrue(
                all(
                    validated_record(path, game_id)
                    for game_id, path in zip(range(10, 15), selected)
                )
            )

    def test_restart_repairs_gaps_invalid_files_and_abandoned_partials(self) -> None:
        calls: list[int] = []

        def fetch(url: str, **_options) -> bytes:
            game_id = int(url.rsplit("/", 1)[-1])
            calls.append(game_id)
            return record_html(game_id)

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            record_path(output, 30).write_bytes(record_html(30))
            record_path(output, 31).write_bytes(b"interrupted final file")
            record_path(output, 32).write_bytes(record_html(32))
            partial = output / ".partial" / "view_m_33.html.part"
            partial.parent.mkdir()
            partial.write_bytes(b"interrupted temporary file")

            counts, selected = scrape_records(
                range(30, 34),
                output,
                base_url="http://test/{id}",
                delay=0,
                fetch=fetch,
            )

            self.assertEqual([31, 33], calls)
            self.assertEqual((2, 2, 0), (counts.downloaded, counts.cached, counts.failed))
            self.assertFalse(partial.exists())
            self.assertTrue(
                all(
                    validated_record(path, game_id)
                    for game_id, path in zip(range(30, 34), selected)
                )
            )

    def test_transient_failure_retries_but_permanent_failure_does_not(self) -> None:
        attempts: dict[int, int] = {}

        def fetch(url: str, **_options) -> bytes:
            game_id = int(url.rsplit("/", 1)[-1])
            attempts[game_id] = attempts.get(game_id, 0) + 1
            if game_id == 20 and attempts[game_id] == 1:
                raise DownloadFailure("temporary")
            if game_id == 21:
                raise DownloadFailure("missing", retryable=False)
            return record_html(game_id)

        with tempfile.TemporaryDirectory() as directory:
            counts, paths = scrape_records(
                range(20, 22),
                Path(directory),
                base_url="http://test/{id}",
                delay=0,
                retries=3,
                retry_backoff=0,
                fetch=fetch,
                sleep=lambda _delay: None,
            )

        self.assertEqual({20: 2, 21: 1}, attempts)
        self.assertEqual((1, 1), (counts.downloaded, counts.failed))
        self.assertEqual(["view_m_20.html"], [path.name for path in paths])

    def test_wrong_sortid_is_cached_under_requested_viewurl_id(self) -> None:
        calls: list[int] = []

        wrong_sortid = GAME_HTML.replace(
            "[DhtmlXQ_title]",
            "[DhtmlXQ_viewurl]?owner=m&id=60#f=#isSave=[/DhtmlXQ_viewurl]\n"
            "[DhtmlXQ_sortid]610[/DhtmlXQ_sortid]\n[DhtmlXQ_title]",
        ).encode("gb18030")

        def fetch(url: str, **_options) -> bytes:
            calls.append(int(url.rsplit("/", 1)[-1]))
            return wrong_sortid

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            first, _paths = scrape_records(
                range(60, 61),
                output,
                base_url="http://test/{id}",
                delay=0,
                fetch=fetch,
            )
            second, _paths = scrape_records(
                range(60, 61),
                output,
                base_url="http://test/{id}",
                delay=0,
                fetch=lambda *_args, **_options: self.fail(
                    "cached record with stale sortid was downloaded again"
                ),
            )
            game = parse_game(record_path(output, 60))

        self.assertEqual([60], calls)
        self.assertEqual((1, 0), (first.downloaded, first.failed))
        self.assertEqual((0, 1, 0), (second.downloaded, second.cached, second.failed))
        self.assertEqual("60", game.external_id)
        self.assertEqual("610", game.source_metadata["sortid"])

    def test_mismatched_viewurl_remains_a_gap(self) -> None:
        messages: list[str] = []
        wrong_viewurl = GAME_HTML.replace(
            "[DhtmlXQ_title]",
            "[DhtmlXQ_viewurl]?owner=m&id=61#f=#isSave=[/DhtmlXQ_viewurl]\n"
            "[DhtmlXQ_sortid]600[/DhtmlXQ_sortid]\n[DhtmlXQ_title]",
        ).encode("gb18030")

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            counts, _paths = scrape_records(
                range(60, 61),
                output,
                base_url="http://test/{id}",
                delay=0,
                fetch=lambda _url, **_options: wrong_viewurl,
                message=messages.append,
            )
            self.assertFalse(record_path(output, 60).exists())

        self.assertEqual((0, 1), (counts.downloaded, counts.failed))
        self.assertIn("view URL identifies game 61", messages[0])


if __name__ == "__main__":
    unittest.main()
