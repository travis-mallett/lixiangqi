from __future__ import annotations

import json
import re
import unittest

from external.xiangqi_explorer.ancient_manual_localization import (
    CATALOG_PATH,
    manual_title,
    text,
)
from tools.games_database.build_ancient_manual_translations import (
    chinese_moves_to_wxf,
)
from tools.games_database.review_ancient_manual_translations import _wxf_tokens

HAN = re.compile(r"[\u3400-\u9fff]")


class AncientManualLocalizationTest(unittest.TestCase):
    def test_standard_manual_and_chapter_names_are_locale_aware(self) -> None:
        self.assertEqual(
            "The Invincible Xiangqi Manual",
            manual_title("zichudonglaiwudishou", "自出洞来无敌手", "en"),
        )
        self.assertEqual(
            "Secret in the Tangerine",
            manual_title("juzhongmi", "桔中秘", "en-US"),
        )
        self.assertEqual("Volume I", text("chapters", "上卷", "en"))
        self.assertEqual(
            "自出洞来无敌手",
            manual_title("zichudonglaiwudishou", "自出洞来无敌手", "zh-CN"),
        )
        self.assertEqual("上卷", text("chapters", "上卷", "zh-TW"))

    def test_embedded_chinese_moves_convert_to_wxf(self) -> None:
        self.assertEqual(
            "The original line is R3=5, H4-6; +C-2.",
            chinese_moves_to_wxf("The original line is 车３平５, 马四退六; 前炮退二."),
        )

    def test_complete_catalog_has_no_chinese_in_english_or_lost_wxf(self) -> None:
        catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
        self.assertEqual(13, len(catalog["manuals"]))
        self.assertEqual(39, len(catalog["chapters"]))
        self.assertEqual(424, len(catalog["games"]))
        self.assertEqual(548, len(catalog["metadata"]))
        self.assertEqual(1942, len(catalog["annotations"]))

        for section in ("chapters", "games", "metadata", "annotations"):
            for entry in catalog[section].values():
                with self.subTest(section=section, source=entry["source"]):
                    self.assertIsNone(HAN.search(entry["text"]))
                    source_wxf = _wxf_tokens(chinese_moves_to_wxf(entry["source"]))
                    translated_wxf = _wxf_tokens(entry["text"])
                    self.assertFalse(source_wxf - translated_wxf)


if __name__ == "__main__":
    unittest.main()
