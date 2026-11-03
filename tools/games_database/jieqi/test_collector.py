import contextlib
import io
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.request

from .collector import process, run
from .records import START_FEN, Unsupported, normalize, parse_record
from .sources import blocked_reason, canonical_url, discover
from .store import Store, exclusive
from .transport import FetchError, ScopedRedirect, retry_after
from .validation import Validator

URL = "https://www.xqipu.com/qipu/test"


def payload(**changes):
    return dict(schema="lixiangqi-jieqi-record-v1", variant="jieqi",
                moves=["a4a5~soldier", "a7a6~horse"], red="甲", black="乙", result="1-0", **changes)


class Accept:
    def validate(self, record):
        pass


class RecordsTest(unittest.TestCase):
    def test_unverified_sources_are_not_enabled_by_default(self):
        from .__main__ import main
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
            main(["run"])
        self.assertEqual(error.exception.code, 2)

    def test_tiantian_is_out_of_scope(self):
        from .sources import SOURCES
        self.assertNotIn("tiantian", SOURCES)

    def test_reveals_and_capture_knowledge_affect_identity(self):
        a = normalize(payload())
        b = normalize({**payload(), "moves": ["a4a5~chariot", "a7a6~horse"]})
        self.assertNotEqual(a.hashes(URL), b.hashes(URL))
        c = normalize({**payload(), "moves": ["a4a7~soldier~horse"]})
        d = normalize({**payload(), "moves": ["a4a7~soldier"]})
        self.assertNotEqual(c.hashes(URL), d.hashes(URL))

    def test_duplicates_across_sources_but_anonymous_are_candidates_only(self):
        record = normalize(payload())
        self.assertEqual(record.hashes(URL), record.hashes("https://www.dpxq.com/a"))
        anonymous = normalize({**payload(), "red": ""})
        self.assertNotEqual(anonymous.hashes(URL)[0], anonymous.hashes(URL + "2")[0])
        self.assertEqual(anonymous.hashes(URL)[1], anonymous.hashes(URL + "2")[1])

    def test_ordinary_xiangqi_team_named_jieqi_not_imported(self):
        text = "<title>香港中弈揭棋队</title>[DhtmlXQ_movelist]7774[/DhtmlXQ_movelist]"
        with self.assertRaises(Unsupported):
            parse_record(text)
        self.assertIsNone(parse_record("<title>普通象棋</title><p>评论：揭棋太多</p>"))

    def test_xqipu_published_fragment_coordinates(self):
        text = """<title>揭棋局面分析 | 象棋谱</title>
          <p>g8f8e7e6h9f7d9e9e4d6a0c0f8e8e9d9e8h8d9e9h8h9</p>
          <p>3k3B1/6R2/bp2p2cr/9/7C1/4N4/2p1P4/4P4/5P3/c3K4 w</p>"""
        record = parse_record(text)
        self.assertEqual(record.kind, "fragment")
        self.assertEqual(len(record.moves), 11)
        self.assertEqual(record.moves[:2], ("g9f9", "e8e7"))
        self.assertEqual(record.result, "*")

    def test_coordinate_pgn_and_no_silent_variation_loss(self):
        record = parse_record('[Variant "Jieqi"]\n[Result "1-0"]\n1. a4a5~soldier a7a6~horse 1-0')
        self.assertEqual(record.moves, ("a4a5~soldier", "a7a6~horse"))
        with self.assertRaises(Unsupported):
            parse_record('[Variant "Jieqi"]\na4a5~soldier (c4c5~horse) *')

    def test_no_guessed_json_mapping_or_variant(self):
        with self.assertRaises(Unsupported):
            parse_record('{"data":{"movelist":"7774"}}')
        with self.assertRaises(Unsupported):
            normalize({**payload(), "variant": "xiangqi"})

    def test_block_pages_not_successful_empty_lists(self):
        for text in ("AI爬虫机器人太多了,请先登陆一下棋谱仓库", "正在进行人机验证，请耐心等待"):
            self.assertIsNotNone(blocked_reason(text))

    def test_source_bounded_links(self):
        html = '<title>揭棋赛事</title><a href="/hldcg/tour_12.html">赛事</a><a href="https://mistboard.com/games">揭棋</a><a href="/login">登录</a>'
        self.assertEqual(discover("dpxq", "https://www.dpxq.com/hldcg/index.html", html), ["https://www.dpxq.com/hldcg/tour_12.html"])
        with self.assertRaises(ValueError):
            canonical_url("dpxq", "https://www.dpxq.com.evil.test/")

    def test_mixed_event_does_not_follow_standard_tournament(self):
        html = '<a href="/XQData/EventInfo.asp?eid=1">双棋公开赛（揭棋）</a><a href="/XQData/EventInfo.asp?eid=2">双棋公开赛（象棋）</a>'
        self.assertEqual(discover("gdchess", "https://www.gdchess.com/article/list.asp?id=1", html), ["https://www.gdchess.com/XQData/EventInfo.asp?eid=1"])

    def test_search_pagination_retains_real_keyword(self):
        html = '<a href="/search/qipu?keyword=%E6%8F%AD%E6%A3%8B&amp;page=1">下一页</a><a href="/search/qipu?keyword=象棋">其他</a><a href="/search/qipu?keyword=揭棋&amp;f%5B0%5D=created:2024">筛选</a>'
        self.assertEqual(discover("xqipu", "https://www.xqipu.com/search/qipu?keyword=%E6%8F%AD%E6%A3%8B", html), ["https://www.xqipu.com/search/qipu?keyword=%E6%8F%AD%E6%A3%8B&page=1"])

    def test_redirect_cookie_is_host_scoped(self):
        handler = ScopedRedirect("dpxq")
        req = urllib.request.Request("https://www.dpxq.com/a", headers={"Cookie": "private=value"})
        redirected = handler.redirect_request(req, None, 302, "", {}, "https://dpxq.com/b")
        self.assertFalse(redirected.has_header("Cookie"))
        with self.assertRaises(FetchError):
            handler.redirect_request(req, None, 302, "", {}, "https://mistboard.com/")
        with self.assertRaises(FetchError):
            handler.redirect_request(req, None, 302, "", {}, "http://www.dpxq.com/b")

    def test_retry_after_numeric_and_date(self):
        self.assertEqual(retry_after({"Retry-After": "120"}), 120)
        self.assertEqual(retry_after({"Retry-After": "nonsense"}), 0)
        with patch("tools.games_database.jieqi.transport.time.time", return_value=0):
            self.assertEqual(retry_after({"Retry-After": "Thu, 01 Jan 1970 00:02:00 GMT"}), 120)


class PersistenceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)
        self.store = Store(self.path)
        with self.store.db:
            self.store.enqueue("xqipu", URL)
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()

    def tearDown(self):
        self.output.__exit__(None, None, None)
        self.store.close()
        self.temp.cleanup()

    def job(self):
        return self.store.db.execute("SELECT * FROM jobs ORDER BY id LIMIT 1").fetchone()

    def fetch(self, *_):
        return json.dumps(payload()).encode(), 200, "application/json"

    def test_cancel_during_download_then_resume(self):
        def cancelled(*_):
            raise KeyboardInterrupt
        with self.assertRaises(KeyboardInterrupt):
            run(self.store, ["xqipu"], cancelled, Accept())
        self.assertEqual(self.job()["state"], "pending")
        self.store.close()
        self.store = Store(self.path)
        run(self.store, ["xqipu"], self.fetch, Accept())
        self.assertEqual(self.store.summary()["unique_records"], 1)

    def test_cancel_after_cache_offline_resume_and_idempotence(self):
        class Cancel:
            def validate(self, record):
                raise KeyboardInterrupt
        with self.assertRaises(KeyboardInterrupt):
            run(self.store, ["xqipu"], self.fetch, Cancel())
        self.assertIsNotNone(self.job()["raw_hash"])
        def no_network(*_):
            self.fail("Resume must use cached response")
        run(self.store, ["xqipu"], no_network, Accept(), offline=True)
        run(self.store, ["xqipu"], no_network, Accept())
        self.assertEqual(self.store.summary()["witnesses"], 1)

    def test_transaction_rolls_back_records_children_and_done(self):
        self.store.cache(self.job()["id"], b"evidence")
        self.store.db.executescript("CREATE TRIGGER fail_done BEFORE UPDATE OF state ON jobs BEGIN SELECT RAISE(ABORT,'injected crash'); END;")
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.finish(self.job(), normalize(payload()), [URL + "2"], "game")
        self.assertEqual(self.store.summary()["unique_records"], 0)
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM jobs").fetchone()[0], 1)
        self.assertEqual(self.job()["state"], "pending")

    def test_dedup_preserves_both_source_witnesses(self):
        with self.store.db:
            self.store.enqueue("dpxq", "https://www.dpxq.com/hldcg/a")
        run(self.store, ["xqipu", "dpxq"], self.fetch, Accept())
        self.assertEqual(self.store.summary()["unique_records"], 1)
        self.assertEqual(self.store.summary()["witnesses"], 2)
        self.store.export(self.path / "out.jsonl")
        exported = json.loads((self.path / "out.jsonl").read_text(encoding="utf-8"))
        self.assertEqual(len(exported["witnesses"]), 2)
        self.assertEqual(parse_record(json.dumps(exported)).moves, normalize(payload()).moves)

    def test_refresh_preserves_revisions(self):
        run(self.store, ["xqipu"], self.fetch, Accept())
        self.store.cache(self.job()["id"], json.dumps({**payload(), "moves": ["a4a5~cannon"]}).encode())
        process(self.store, self.job(), Accept())
        self.assertEqual(self.store.summary()["unique_records"], 2)
        self.assertEqual(self.store.summary()["witnesses"], 2)

    def test_retry_exhaustion_not_skipped(self):
        def failure(*_):
            raise FetchError("HTTP 503", retryable=True)
        run(self.store, ["xqipu"], failure, Accept(), retries=2, backoff=0)
        self.assertEqual(self.job()["attempts"], 3)
        self.assertEqual(self.job()["state"], "failed")

    def test_retry_after_persisted_no_sleep(self):
        def limited(*_):
            raise FetchError("HTTP 429", retryable=True, retry_after=120)
        with patch("tools.games_database.jieqi.collector.time.sleep") as sleep:
            run(self.store, ["xqipu"], limited, Accept())
            sleep.assert_not_called()
        self.assertEqual(self.job()["state"], "pending")
        self.assertGreater(self.job()["next_attempt"], 0)

    def test_auth_challenge_pauses_source(self):
        with self.store.db:
            self.store.enqueue("xqipu", URL + "2")
        run(self.store, ["xqipu"], lambda *_: ("正在进行人机验证".encode(), 200, "text/html"), Accept())
        self.assertEqual(self.job()["state"], "blocked")
        self.assertEqual(self.store.db.execute("SELECT attempts FROM jobs WHERE url=?", (URL + "2",)).fetchone()[0], 0)
        run(self.store, ["xqipu"], lambda *_: self.fail("Blocked sources stay paused across runs"), Accept())

    def test_depth_limit_preserves_frontier_for_continuation(self):
        html = b'<title>Jieqi</title><a href="/qipu/child">Jieqi</a>'
        run(self.store, ["xqipu"], lambda *_: (html, 200, "text/html"), Accept(), max_depth=0)
        child = self.store.db.execute("SELECT * FROM jobs WHERE depth=1").fetchone()
        self.assertEqual(child["state"], "pending")
        run(self.store, ["xqipu"], self.fetch, Accept(), max_depth=1)
        self.assertEqual(self.store.summary()["unique_records"], 1)

    def test_invalid_record_quarantined(self):
        class Invalid:
            def validate(self, record):
                raise ValueError("Missing reveal")
        run(self.store, ["xqipu"], self.fetch, Invalid())
        self.assertEqual(self.job()["state"], "review")
        self.assertEqual(self.store.summary()["unique_records"], 0)

    def test_corrupt_cache_fails_loudly(self):
        digest = self.store.cache(self.job()["id"], b"original")
        with self.store.db:
            self.store.db.execute("UPDATE blobs SET body=?", (b"bad",))
        with self.assertRaises(ValueError):
            self.store.body(digest)

    def test_interrupted_export_preserves_previous_file(self):
        run(self.store, ["xqipu"], self.fetch, Accept())
        output = self.path / "out.jsonl"
        output.write_text("previous", encoding="utf-8")
        with patch("tools.games_database.jieqi.store.os.replace", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.store.export(output)
        self.assertEqual(output.read_text(encoding="utf-8"), "previous")
        self.assertFalse(output.with_suffix(".jsonl.tmp").exists())

    def test_single_writer_lock(self):
        with exclusive(self.path):
            with self.assertRaises(RuntimeError):
                with exclusive(self.path):
                    pass
        with exclusive(self.path):
            pass

    def test_abrupt_process_death_rolls_back_and_releases_lock(self):
        # os._exit bypasses all finally blocks, unlike a simulated exception.
        program = """
import os, sys
from pathlib import Path
from tools.games_database.jieqi.store import Store, exclusive
with exclusive(Path(sys.argv[1])):
    s = Store(Path(sys.argv[1]))
    s.db.execute("UPDATE jobs SET state='done'")
    os._exit(17)
"""
        result = subprocess.run([sys.executable, "-c", program, str(self.path)], capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 17, result.stderr.decode(errors="replace"))
        self.assertEqual(self.job()["state"], "pending")
        with exclusive(self.path):
            run(self.store, ["xqipu"], self.fetch, Accept())
        self.assertEqual(self.store.summary()["unique_records"], 1)


class NativeValidationTest(unittest.TestCase):
    """Requires staged native rules; no silent skips of the owning-layer check."""
    def test_real_jieqi_replay_and_invalid_reveals(self):
        validator = Validator()
        try:
            root = Path(__file__).resolve().parents[3]
            fixture = root / "modules/xiangqi/src/test/resources/jieqi-fPL0UJju-coordinate.pgn"
            validator.validate(parse_record(fixture.read_text(encoding="utf-8")))
            with self.assertRaises(ValueError):
                validator.validate(normalize({**payload(), "moves": ["a4a5"]}))
            with self.assertRaises(ValueError):
                validator.validate(normalize({**payload(), "moves": ["a4a6~horse"]}))
        finally:
            validator.close()


if __name__ == "__main__":
    unittest.main()
