from __future__ import annotations

import unittest

from external.xiangqi_explorer.name_romanization import name_forms, normalized_name_key


class NameRomanizationTest(unittest.TestCase):
    def test_formats_chinese_name_as_surname_and_joined_given_name(self) -> None:
        forms = name_forms("王天一")
        self.assertEqual("Wang Tianyi", forms.romanized)
        self.assertEqual("Wang Tianyi (王天一)", forms.display)
        self.assertEqual("zh-Latn-pinyin-auto", forms.system)
        self.assertEqual("wangtianyi", forms.search_key)

    def test_preserves_compound_chinese_surname(self) -> None:
        self.assertEqual("Ouyang Nana", name_forms("欧阳娜娜").romanized)

    def test_uses_hepburn_when_japanese_kana_identifies_the_script(self) -> None:
        forms = name_forms("羽生よしはる")
        self.assertEqual("Hanyuu Yoshiharu", forms.romanized)
        self.assertEqual("ja-Latn-hepburn-auto", forms.system)

    def test_uses_revised_romanization_for_hangul(self) -> None:
        forms = name_forms("김민수")
        self.assertEqual("Gim Minsu", forms.romanized)
        self.assertEqual("ko-Latn-rr-auto", forms.system)

    def test_keeps_latin_name_and_normalizes_search_spacing(self) -> None:
        forms = name_forms("  Wang   Tianyi ")
        self.assertEqual("Wang Tianyi", forms.native)
        self.assertIsNone(forms.romanized)
        self.assertEqual("wangtianyi", forms.search_key)
        self.assertEqual("wangtianyi", normalized_name_key("Wáng Tiānyī"))


if __name__ == "__main__":
    unittest.main()
