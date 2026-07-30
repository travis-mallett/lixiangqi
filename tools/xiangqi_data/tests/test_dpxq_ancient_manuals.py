from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
import urllib.parse
from contextlib import closing
from dataclasses import replace
from pathlib import Path

from tools.games_database.dpxq_ancient_manuals import (
    ANCIENT_ROOT,
    MANUALS,
    AncientManualImporter,
    Manual,
    RecordRef,
    binit_to_fen,
    parse_manual_chapters,
    parse_manual_document,
    parse_manual_index,
    validate_tree,
)
from tools.xiangqi_data.pikafish_rules import START_FEN
from tools.xiangqi_data.pikafish_rules import PikafishGameValidator


STANDARD_BINIT = "8979695949392919097717866646260600102030405060708012720323436383"
ANNOTATED_TREE = f"""
<html><body>
[DhtmlXQ_title]第01局 注解与变着[/DhtmlXQ_title]
[DhtmlXQ_date]0000-00-00[/DhtmlXQ_date]
[DhtmlXQ_result]未知[/DhtmlXQ_result]
[DhtmlXQ_author]古谱整理者[/DhtmlXQ_author]
[DhtmlXQ_binit]{STANDARD_BINIT}[/DhtmlXQ_binit]
[DhtmlXQ_movelist]796770621927[/DhtmlXQ_movelist]
[DhtmlXQ_move_0_2_1]03041927[/DhtmlXQ_move_0_2_1]
[DhtmlXQ_move_1_3_2]0605[/DhtmlXQ_move_1_3_2]
[DhtmlXQ_comment0]全局说明。[/DhtmlXQ_comment0]
[DhtmlXQ_comment2]主线第二着注解。[/DhtmlXQ_comment2]
[DhtmlXQ_comment1_3]第一变第三着注解。[/DhtmlXQ_comment1_3]
[DhtmlXQ_comment2_3]嵌套变着注解。[/DhtmlXQ_comment2_3]
</body></html>
"""
REAL_WORLD_DHTML_FRAGMENT = f"""
[DhtmlXQ_title]DhtmlXQ annotated variation fixture[/DhtmlXQ_title]
[DhtmlXQ_result]未知[/DhtmlXQ_result]
[DhtmlXQ_binit]{STANDARD_BINIT}[/DhtmlXQ_binit]
[DhtmlXQ_movelist]26252324252420422423103123330020173720293731727469477444464544470907474619274626774729284743504107171202312140508987[/DhtmlXQ_movelist]
[DhtmlXQ_move_0_13_1]311174047707808169472920070403047967811189880405[/DhtmlXQ_move_0_13_1]
[DhtmlXQ_comment13]形势紧迫，红方飞相撵车是积极的应着。[/DhtmlXQ_comment13]
[DhtmlXQ_comment1_24]黑方优势。[/DhtmlXQ_comment1_24]
"""


class DpxqAncientManualTest(unittest.TestCase):
    manual = Manual("fixture", "梅花泉", 1)
    reference = RecordRef(
        "u",
        "424242",
        "第01局 注解与变着",
        "http://www.dpxq.com/hldcg/search/view_u_424242.html",
        chapter_title="上卷",
        chapter_url="http://www.dpxq.com/manual/上卷/",
        chapter_order=1,
        game_order=1,
    )

    def test_manifest_covers_the_published_13_manuals_and_424_records(self) -> None:
        self.assertEqual(13, len(MANUALS))
        self.assertEqual(424, sum(manual.expected_records for manual in MANUALS))
        self.assertEqual(
            {
                "自出洞来无敌手",
                "奕乘",
                "吴氏梅花谱",
                "无双品梅花谱",
                "事林广记",
                "善庆堂重订梅花变",
                "梅花泉",
                "梅花谱",
                "梅花变法谱",
                "桔中秘",
                "金鹏十八变",
                "反梅花谱",
                "崇本堂梅花谱",
            },
            {manual.title for manual in MANUALS},
        )

    def test_binit_decodes_the_standard_position_exactly(self) -> None:
        self.assertEqual(START_FEN, binit_to_fen(STANDARD_BINIT, "h1g3"))

    def test_parser_preserves_nested_variations_and_path_anchored_comments(self) -> None:
        record = parse_manual_document(ANNOTATED_TREE, self.manual, self.reference)

        self.assertEqual(("h1g3", "h10g8", "b1c3"), record.mainline)
        self.assertEqual(("h1g3", "a7a6", "b1c3"), record.line_paths[1])
        self.assertEqual(("h1g3", "a7a6", "a4a5"), record.line_paths[2])
        self.assertEqual(
            "h1g3 h10g8 (a7a6 b1c3 (a4a5)) b1c3",
            record.notation_text,
        )
        annotations = {annotation.source_key: annotation for annotation in record.annotations}
        self.assertEqual("", annotations["comment0"].anchor_path)
        self.assertEqual(
            "h1g3 h10g8", annotations["comment2"].anchor_path
        )
        self.assertEqual(
            "h1g3 a7a6 b1c3", annotations["comment1_3"].anchor_path
        )
        self.assertEqual(
            "h1g3 a7a6 a4a5", annotations["comment2_3"].anchor_path
        )
        self.assertEqual(6, len(record.tree_nodes))
        with PikafishGameValidator() as validator:
            validate_tree(record, validator)

    def test_real_world_dhtml_shape_validates_mainline_branch_and_comments(self) -> None:
        record = parse_manual_document(
            REAL_WORLD_DHTML_FRAGMENT, self.manual, self.reference
        )
        annotations = {annotation.source_key: annotation for annotation in record.annotations}

        self.assertEqual(2, len(record.line_paths))
        self.assertEqual(13, annotations["comment13"].anchor_ply)
        self.assertEqual(
            " ".join(record.line_paths[1][:24]),
            annotations["comment1_24"].anchor_path,
        )
        self.assertIn("(", record.notation_text)
        with PikafishGameValidator() as validator:
            validate_tree(record, validator)

    def test_index_parser_finds_file_query_and_javascript_record_links(self) -> None:
        manual_url = self.manual.listing_url(ANCIENT_ROOT)
        page = f"""
        <a href="../../../../search/view_u_101.html">第一局</a>
        <a href="/hldcg/search/?owner=u&id=102">第二局</a>
        <a href="javascript:view('owner=u&id=103')">第三局</a>
        <a href="{urllib.parse.unquote(manual_url)}">目录</a>
        <a href="index_2.html">下一页</a>
        <a href="3.html">末页</a>
        """
        records, pages = parse_manual_index(
            page, page_url=manual_url, manual_url=manual_url
        )

        self.assertEqual(["101", "102", "103"], [record.external_id for record in records])
        self.assertEqual(3, len(pages))
        self.assertIn(manual_url, pages)
        self.assertTrue(all(page.isascii() for page in pages))
        self.assertTrue(any(page.endswith("/index_2.html") for page in pages))
        self.assertTrue(any(page.endswith("/3.html") for page in pages))

    def test_index_table_records_chapter_and_source_order(self) -> None:
        manual_url = self.manual.listing_url(ANCIENT_ROOT)
        page = """
        <table>
          <tr>
            <td>12</td><td>0000-00-00</td>
            <td><a href="/hldcg/search/view_u_201.html">第一局</a></td>
            <td>42</td><td>上卷</td><td></td><td></td><td>100</td>
          </tr>
        </table>
        """
        records, _pages = parse_manual_index(
            page, page_url=manual_url, manual_url=manual_url
        )

        self.assertEqual(1, len(records))
        self.assertEqual("上卷", records[0].chapter_title)
        self.assertEqual(12, records[0].source_order)
        self.assertIn("%E4%B8%8A%E5%8D%B7", records[0].chapter_url)

    def test_manual_landing_page_restores_published_chapter_order(self) -> None:
        manual_url = self.manual.url(ANCIENT_ROOT)
        page = """
        <table>
          <tr><td>1</td><td>date</td><td><a href="下卷/">下卷</a></td><td>10</td></tr>
          <tr><td>2</td><td>date</td><td><a href="中卷/">中卷</a></td><td>20</td></tr>
          <tr><td>3</td><td>date</td><td><a href="上卷/">上卷</a></td><td>20</td></tr>
        </table>
        """

        chapters = parse_manual_chapters(page, manual_url=manual_url)

        self.assertEqual(["上卷", "中卷", "下卷"], [title for title, _url in chapters])
        self.assertTrue(all(url.isascii() for _title, url in chapters))

    def test_import_stores_manual_semantics_tree_and_commentary(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            page = root / "view_u_424242.html"
            page.write_text(ANNOTATED_TREE, encoding="utf-8")
            database = root / "games.sqlite3"
            with AncientManualImporter(database) as importer:
                importer.import_path(page, self.manual, self.reference)
                counts = dict(importer.counts)

            with closing(sqlite3.connect(database)) as connection:
                game = connection.execute(
                    """
                    SELECT record_kind, statistical_eligible, initial_fen
                    FROM games
                    """
                ).fetchone()
                source = connection.execute(
                    """
                    SELECT collection, collection_name, notation_text, edition_id, locator_json
                    FROM game_sources
                    """
                ).fetchone()
                edition_title = connection.execute(
                    "SELECT title FROM editions WHERE id = ?",
                    (source[3],),
                ).fetchone()[0]
                comments = connection.execute(
                    """
                    SELECT anchor_path, body
                    FROM annotations
                    WHERE annotation_type = 'comment'
                    ORDER BY ordinal
                    """
                ).fetchall()
                nodes = connection.execute(
                    "SELECT count(*) FROM source_tree_nodes"
                ).fetchone()[0]

        self.assertEqual(
            {"seen": 1, "imported": 1, "duplicate": 0, "invalid": 0}, counts
        )
        self.assertEqual(("manual_example", 0, START_FEN), game)
        self.assertEqual("ancient_manuals", source[0])
        self.assertEqual("Ancient Manuals", source[1])
        self.assertIn("(a7a6", source[2])
        self.assertEqual("dpxq:ancient:fixture:online", source[3])
        self.assertNotIn("DPXQ", edition_title)
        locator = json.loads(source[4])
        self.assertEqual("上卷", locator["chapter"])
        self.assertEqual(1, locator["chapterOrder"])
        self.assertEqual(1, locator["gameOrder"])
        self.assertEqual(4, len(comments))
        self.assertIn(("h1g3 a7a6 a4a5", "嵌套变着注解。"), comments)
        self.assertEqual(6, nodes)

    def test_resumed_import_updates_existing_chapter_hierarchy(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            page = root / "view_u_424242.html"
            page.write_text(ANNOTATED_TREE, encoding="utf-8")
            database = root / "games.sqlite3"
            with AncientManualImporter(database) as importer:
                importer.import_path(page, self.manual, self.reference)
                importer.import_path(
                    page,
                    self.manual,
                    replace(
                        self.reference,
                        chapter_title="下卷",
                        chapter_order=2,
                        game_order=3,
                    ),
                )
                counts = dict(importer.counts)

            with closing(sqlite3.connect(database)) as connection:
                locator = json.loads(
                    connection.execute(
                        "SELECT locator_json FROM game_sources"
                    ).fetchone()[0]
                )

        self.assertEqual(
            {"seen": 2, "imported": 1, "duplicate": 1, "invalid": 0}, counts
        )
        self.assertEqual("下卷", locator["chapter"])
        self.assertEqual(2, locator["chapterOrder"])
        self.assertEqual(3, locator["gameOrder"])


if __name__ == "__main__":
    unittest.main()
