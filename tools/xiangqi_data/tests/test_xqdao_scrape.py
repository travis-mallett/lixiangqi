from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from tools.xiangqi_data.xqdao_import import STANDARD_BINIT, XqdaoImporter, XqdaoListing, parse_game_page
from tools.xiangqi_data.xqdao_scrape import parse_event, parse_index


GAME_HTML = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Test game</title></head><body>
<div id="left-div">
<h1>Vietnam Nguyen Van A wins Beijing Wang Xiao</h1>
<div class="qipu_info"><span>赛事：<a href="/zhuanti/test/">Test Cup</a></span>
<span><span>红方：王晓(中国)</span><span>黑方：阮文安(越南)</span></span>
<span>轮次：第02轮</span><span>开局：C01 中炮</span><span>结果：红胜</span></div>
<div class="vschess"><!--
[DhtmlXQ]
[DhtmlXQ_title]中国 王晓 胜 越南 阮文安[/DhtmlXQ_title]
[DhtmlXQ_event]测试杯[/DhtmlXQ_event]
[DhtmlXQ_date]2026-07-22[/DhtmlXQ_date]
[DhtmlXQ_place]河内[/DhtmlXQ_place]
[DhtmlXQ_round]第02轮[/DhtmlXQ_round]
[DhtmlXQ_table]第05台[/DhtmlXQ_table]
[DhtmlXQ_result]红胜[/DhtmlXQ_result]
[DhtmlXQ_binit]{STANDARD_BINIT}[/DhtmlXQ_binit]
[DhtmlXQ_movelist]774770627967[/DhtmlXQ_movelist]
[DhtmlXQ_length]3[/DhtmlXQ_length]
[/DhtmlXQ]
--></div></div><div id="sidebar"></div>
</body></html>"""


def listing() -> XqdaoListing:
    return XqdaoListing(
        game_id="408",
        listing_title="中国 王晓 胜 越南 阮文安",
        event_name="测试杯",
        event_url="https://www.xqdao.com/zhuanti/test/",
        index_page=1,
        listing_page=1,
        collections=({"name": "测试杯", "url": "https://www.xqdao.com/zhuanti/test/"},),
    )


class XqdaoScrapeTest(unittest.TestCase):
    def test_hidden_index_pagination_discovers_event_urls(self) -> None:
        document = """
        <div id="left-div"><table>
          <a href="/zhuanti/one/" title="第一赛事" target="_blank">one</a>
          <a href="/zhuanti/two/" title="第二赛事" target="_blank">two</a>
        </table></div><div id="sidebar"></div>
        """
        self.assertEqual(
            [
                ("https://www.xqdao.com/zhuanti/one/", "第一赛事", 36),
                ("https://www.xqdao.com/zhuanti/two/", "第二赛事", 36),
            ],
            parse_index(document, 36),
        )

    def test_event_listing_discovers_games_and_true_last_page(self) -> None:
        document = """
        <div id="left-div"><table class="xq_list">
          <a href="/qipu/show/408/" target="_blank">Red wins Black</a>
          <a href="/qipu/show/409/" target="_blank">One draws Two</a>
        </table><a href="?page=16">16</a><a href="?page=17">17</a>
        </div><div id="sidebar"></div>
        """
        games, last_page = parse_event(
            document,
            event_name="Other Events",
            event_url="https://www.xqdao.com/zhuanti/other/",
            index_page=1,
            listing_page=1,
        )
        self.assertEqual(17, last_page)
        self.assertEqual(["408", "409"], [game.game_id for game in games])
        self.assertEqual("Other Events", games[0].collections[0]["name"])

    def test_game_page_preserves_metadata_affiliations_and_moves(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "408.html"
            path.write_text(GAME_HTML, encoding="utf-8")
            game = parse_game_page(path, listing())

        self.assertEqual(("王晓", "阮文安", "测试杯"), (
            game.red_name, game.black_name, game.event
        ))
        self.assertEqual(("h3e3", "h10g8", "h1g3"), game.moves)
        self.assertEqual("中国", game.source_metadata["redcountry"])
        self.assertEqual("越南", game.source_metadata["blackcountry"])
        self.assertEqual("河内", game.source_metadata["place"])
        self.assertEqual("第05台", game.source_metadata["table"])

    def test_nonstandard_position_is_not_imported_as_a_full_game(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "408.html"
            path.write_text(GAME_HTML.replace(STANDARD_BINIT, "0010"), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "standard-start"):
                parse_game_page(path, listing())

    def test_import_is_immediate_deduplicated_and_restart_safe(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "408.html"
            path.write_text(GAME_HTML, encoding="utf-8")
            database = root / "explorer.sqlite3"

            with XqdaoImporter(database) as importer:
                self.assertEqual("imported", importer.import_page(path, listing()))
                with closing(sqlite3.connect(database)) as reader:
                    self.assertEqual(1, reader.execute("SELECT count(*) FROM games").fetchone()[0])
                    self.assertEqual(3, reader.execute("SELECT count(*) FROM game_positions").fetchone()[0])

            with XqdaoImporter(database) as importer:
                self.assertTrue(importer.has_record("408"))
                importer.validator.validate = lambda *_args, **_kwargs: self.fail(
                    "an existing XQDao source record was unnecessarily revalidated"
                )
                self.assertEqual("existing", importer.import_page(path, listing()))

            with closing(sqlite3.connect(database)) as reader:
                metadata = json.loads(reader.execute(
                    "SELECT metadata_json FROM game_sources WHERE source = 'xqdao'"
                ).fetchone()[0])
                self.assertEqual("中国", metadata["redcountry"])
                self.assertEqual("测试杯", metadata["event"])


if __name__ == "__main__":
    unittest.main()
