"""Lossless, script-aware player-name romanization for explorer records."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache

from hangulpy import romanize as romanize_hangul
from pykakasi import kakasi
from pypinyin import lazy_pinyin


HAN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
KANA = re.compile(r"[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]")
HANGUL = re.compile(r"[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff]")
COMPOUND_CHINESE_SURNAMES = {
    "欧阳",
    "太史",
    "端木",
    "上官",
    "司马",
    "东方",
    "独孤",
    "南宫",
    "万俟",
    "闻人",
    "夏侯",
    "诸葛",
    "尉迟",
    "公羊",
    "赫连",
    "澹台",
    "皇甫",
    "宗政",
    "濮阳",
    "公冶",
    "太叔",
    "申屠",
    "公孙",
    "慕容",
    "仲孙",
    "钟离",
    "长孙",
    "宇文",
    "司徒",
    "鲜于",
    "司空",
    "闾丘",
    "子车",
    "亓官",
    "司寇",
    "巫马",
    "公西",
    "颛孙",
    "壤驷",
    "公良",
    "漆雕",
    "乐正",
    "宰父",
    "谷梁",
    "拓跋",
    "夹谷",
    "轩辕",
    "令狐",
    "段干",
    "百里",
    "呼延",
    "东郭",
    "南门",
    "羊舌",
    "微生",
    "梁丘",
    "左丘",
    "东门",
    "西门",
    "第五",
}
JAPANESE_ROMANIZER = kakasi()


@dataclass(frozen=True)
class NameForms:
    native: str
    romanized: str | None
    system: str | None
    search_key: str

    @property
    def display(self) -> str:
        return f"{self.romanized} ({self.native})" if self.romanized else self.native


@lru_cache(maxsize=16_384)
def name_forms(value: str) -> NameForms:
    native = " ".join(unicodedata.normalize("NFKC", value).split())
    if not native:
        return NameForms(native="", romanized=None, system=None, search_key="")

    if HANGUL.search(native):
        romanized = _korean_name(native)
        system = "ko-Latn-rr-auto"
    elif KANA.search(native):
        romanized = _japanese_name(native)
        system = "ja-Latn-hepburn-auto"
    elif HAN.search(native):
        romanized = _chinese_name(native)
        system = "zh-Latn-pinyin-auto"
    else:
        romanized = None
        system = None

    if not romanized or romanized.casefold() == native.casefold():
        romanized = None
        system = None
    return NameForms(
        native=native,
        romanized=romanized,
        system=system,
        search_key=normalized_name_key(romanized or native),
    )


def normalized_name_key(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value).casefold()
    return "".join(char for char in decomposed if char.isalnum())


def _chinese_name(name: str) -> str:
    compact = re.sub(r"\s+", "", name)
    if "·" in compact:
        return " ".join(_title_join(lazy_pinyin(part)) for part in compact.split("·") if part)
    syllables = lazy_pinyin(compact)
    if not syllables:
        return name
    surname_length = 2 if compact[:2] in COMPOUND_CHINESE_SURNAMES else 1
    surname = _title_join(syllables[:surname_length])
    given = _title_join(syllables[surname_length:])
    return " ".join(part for part in (surname, given) if part)


def _japanese_name(name: str) -> str:
    converted = JAPANESE_ROMANIZER.convert(name)
    return " ".join(item["hepburn"].strip().capitalize() for item in converted if item["hepburn"].strip())


def _korean_name(name: str) -> str:
    words = name.split()
    if len(words) > 1:
        return " ".join(romanize_hangul(word, "revised").capitalize() for word in words)
    characters = list(name)
    if len(characters) > 1:
        family = romanize_hangul(characters[0], "revised").capitalize()
        given = romanize_hangul("".join(characters[1:]), "revised").capitalize()
        return f"{family} {given}"
    return romanize_hangul(name, "revised").capitalize()


def _title_join(parts: list[str]) -> str:
    return "".join(parts).capitalize()
