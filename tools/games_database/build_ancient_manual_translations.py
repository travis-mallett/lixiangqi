"""Build the checked-in English catalog for DPXQ's ancient manuals.

The imported SQLite catalog remains the authoritative Chinese source. This
tool extracts its user-visible manual text, converts Chinese move notation to
WXF, obtains a first-pass English translation, and writes the versioned catalog
consumed by the explorer API.

Existing entries are retained, so translators can edit the JSON by hand and
rerun this tool after new source records are imported without losing reviews.
Use --refresh to regenerate every machine-translated entry.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import urllib.error
import urllib.request
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

from tools.games_database.dpxq_ancient_manuals import (
    COMMENT_TAG_PATTERN,
    parse_dhtmlxq_tags,
)
from tools.xiangqi_data.dpxq_import import decode_html

from .storage import database_path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "external" / "xiangqi_explorer" / "ancient_manuals.en.json"
DEFAULT_RAW_HTML = ROOT / "data" / "local" / "dpxq-ancient-html"
TRANSLATOR_AUTH_URL = "https://edge.microsoft.com/translate/auth"
TRANSLATOR_URL = (
    "https://api-edge.cognitive.microsofttranslator.com/translate"
    "?api-version=3.0&from=zh-Hans&to=en"
)
CHINESE_PATTERN = re.compile(r"[\u3400-\u9fff]")

MANUAL_TITLES = {
    "zichudonglaiwudishou": "The Invincible Xiangqi Manual",
    "yicheng": "Yicheng",
    "wushimeihuapu": "Wu's Plum Flower Manual",
    "wushuangpinmeihuapu": "Unparalleled Plum Flower Manual",
    "shilinguangji": "Encyclopedia of Everything",
    "shanqingtang": "Shan Qing Tang Revised Plum Flower Variations",
    "meihuaquan": "Plum Flower Springs Manual",
    "meihuapu": "Plum Flower Manual",
    "meihuabianfa": "Plum Flower Variations Manual",
    "juzhongmi": "Secret in the Tangerine",
    "jinpengshibabian": "The 18 Stances of the Golden Roc",
    "fanmeihuapu": "Anti-Plum Flower Manual",
    "chongbentang": "Chong Ben Tang Plum Flower Manual",
}

EXACT_TRANSLATIONS = {
    "": "",
    "和": "Draw",
    "和棋": "Draw",
    "和局": "Draw",
    "红胜": "Red wins",
    "黑胜": "Black wins",
    "红方胜": "Red wins",
    "黑方胜": "Black wins",
    "黑劣红胜": "Red wins; Black is worse",
    "红劣黑胜": "Black wins; Red is worse",
    "以下略": "Continuation omitted.",
    "原谱着法": "Move from the original manual",
    "原谱无注": "No comment in the original manual.",
    "（原谱无注）": "(No comment in the original manual.)",
    "饶先顺手取胜局": "First-Move Handicap: Same Direction Cannons Win",
    "第01局饶双先顺手炮吐士角直车": (
        "Game 1: Two-Move Handicap — Same Direction Cannons, "
        "Palcorner Cannon, and Filed Chariot"
    ),
    "第02局饶双先顺手炮直车巡河": (
        "Game 2: Two-Move Handicap — Same Direction Cannons, "
        "Filed Chariot, and Riverbank Chariot"
    ),
    "第03局饶右炮应炮直车破当头炮": (
        "Game 3: Right-Cannon Handicap — Filed Chariot Defeats Central Cannon"
    ),
    "第04局饶左马当头炮横车盘头马": (
        "Game 4: Left-Horse Handicap — Central Cannon, Ranked Chariot, "
        "and Central Horse"
    ),
    "第05局饶左马顺手炮横车破直车": (
        "Game 5: Left-Horse Handicap — Same Direction Cannons, "
        "Ranked Chariot Defeats Filed Chariot"
    ),
    "第06局饶左马顺手炮直车破横车": (
        "Game 6: Left-Horse Handicap — Same Direction Cannons, "
        "Filed Chariot Defeats Ranked Chariot"
    ),
    "第07局饶左马顺手炮横车破先背补": (
        "Game 7: Left-Horse Handicap — Same Direction Cannons and Ranked Chariot"
    ),
    "第08局饶左马列手炮直车炮压马": (
        "Game 8: Left-Horse Handicap — Opposite Direction Cannons, "
        "Filed Chariot, and Cannon Pinning the Horse"
    ),
    "第09局饶左马一先当头炮横车": (
        "Game 9: Left-Horse and One-Move Handicap — Central Cannon and Ranked Chariot"
    ),
    "第09局单提马炮二平三": "Game 9: Single Horse Defense, C2=3",
    "让先屏风马破士角马局 局五": (
        "Game 5: First-Move Handicap — Screen Horse Defense Defeats the Palcorner Horse"
    ),
    "第七局 香山曾展鸿(先) 平阳谢侠逊(胜)": (
        "Game 7: Zeng Zhanhong of Xiangshan vs. Xie Xiaxun of Pingyang — Black Wins"
    ),
    "第一局 嘉善顾水如(先) 合肥段芝泉(让右马胜)": (
        "Game 1: Gu Shuiru of Jiashan vs. Duan Zhiquan of Hefei — "
        "Duan Wins Despite Giving His Right Horse"
    ),
    "第五局 江都周德裕(先) 汉阳雷海山(胜)": (
        "Game 5: Zhou Deyu of Jiangdu vs. Lei Haishan of Hanyang — Black Wins"
    ),
    "第十一局 香山曾展鸿(先) 平阳谢侠逊(和)": (
        "Game 11: Zeng Zhanhong of Xiangshan vs. Xie Xiaxun of Pingyang — Draw"
    ),
    (
        "黑伸车巡河着法工稳，是王嘉良喜用的套路。以往着法是：车8进6， "
        "士六进五马2进3，兵三进一车8平7，炮二退一车7退1，相七进九炮2进4，"
        "车九平六，演变下去，红方占优。"
    ): (
        "Black's Chariot advance to the riverbank is a solid move and a line "
        "favored by Wang Jialiang. The older continuation was: R8+6, A6+5 H2+3, "
        "P3+1 R8=7, C2-1 R7-1, E7+9 C2+4, R9=6. In the resulting position, "
        "Red has the advantage."
    ),
    "第10局饶左马一先单提马变顺手炮": (
        "Game 10: Left-Horse and One-Move Handicap — Single Horse Defense "
        "Transposes into Same Direction Cannons"
    ),
    "第11局饶右马一先顺手炮横车": (
        "Game 11: Right-Horse and One-Move Handicap — Same Direction Cannons "
        "and Ranked Chariot"
    ),
    "第12局饶双马应当头卒不打出林车": (
        "Game 12: Two-Horse Handicap — Meeting the Central Pawn Without "
        "Capturing, Then Developing the Chariot"
    ),
    "第13局饶双马同上例双直车": (
        "Game 13: Two-Horse Handicap — Two Filed Chariots, as in the Previous Game"
    ),
    "第14局饶双马应当头卒不打出林车": (
        "Game 14: Two-Horse Handicap — Meeting the Central Pawn Without "
        "Capturing, Then Developing the Chariot"
    ),
    "第16局饶双马右炮巡河左炮当头": (
        "Game 16: Two-Horse Handicap — Right Riverbank Cannon and Left Central Cannon"
    ),
    "第17局饶双马右炮巡河破列手炮": (
        "Game 17: Two-Horse Handicap — Right Riverbank Cannon "
        "Defeats Opposite Direction Cannons"
    ),
    "第18局饶左车顺手炮直车破横车": (
        "Game 18: Left-Chariot Handicap — Same Direction Cannons, "
        "Filed Chariot Defeats Ranked Chariot"
    ),
    "第19局饶左车当头炮横车破直车": (
        "Game 19: Left-Chariot Handicap — Central Cannon, "
        "Ranked Chariot Defeats Filed Chariot"
    ),
    "第20局饶左车当头炮横车进中兵": (
        "Game 20: Left-Chariot Handicap — Central Cannon and Ranked Chariot "
        "Advance the Central Pawn"
    ),
    "第21局饶左车直车骑河化窝心炮": (
        "Game 21: Left-Chariot Handicap — Filed Chariot on the Riverbank "
        "Transposes into a Smothered Cannon"
    ),
    "进兵缓难救急，应马三退五，黑如车2进8，则炮五平七，力免丧象为稳": (
        "Advancing the Pawn is too slow to meet the emergency; Red should play "
        "H3-5. If Black then plays R2+8, C5=7 securely avoids losing the Elephant."
    ),
    "橘中秘 卷上\n\n   第一编  全局着法（得先）\n\n第十八局 列炮破[佥欠]炮着法": (
        "Secret in the Tangerine, Volume I\n\n"
        "Part One: Full-Game Lines (Red to Move)\n\n"
        "Game 18: Opposite Direction Cannons Defeat the Restrained Cannon"
    ),
    "上卷": "Volume I",
    "中卷": "Volume II",
    "下卷": "Volume III",
    "杂局": "Miscellaneous Games",
    "得先": "Red to Move",
    "让先": "Black Gives the First Move",
    "让双马": "Black Gives Both Horses",
    "让左马": "Black Gives the Left Horse",
}

EXTRA_SOURCE_TEXT = {
    "games": ["第十一局 香山曾展鸿(先) 平阳谢侠逊(和)"],
    "metadata": [
        "第十一局 香山曾展鸿(先) 平阳谢侠逊(和)",
        "象棋谱大全-古谱全局",
        "奕乘",
        "奕乘──平阳谢侠逊奕棋选",
    ],
    "annotations": [
        (
            "黑伸车巡河着法工稳，是王嘉良喜用的套路。以往着法是：车8进6， "
            "士六进五马2进3，兵三进一车8平7，炮二退一车7退1，相七进九炮2进4，"
            "车九平六，演变下去，红方占优。"
        )
    ],
}

_DIGITS = str.maketrans("一二三四五六七八九１２３４５６７８９", "123456789123456789")
_PIECES = {
    "车": "R",
    "車": "R",
    "马": "H",
    "馬": "H",
    "傌": "H",
    "炮": "C",
    "砲": "C",
    "包": "C",
    "兵": "P",
    "卒": "P",
    "相": "E",
    "象": "E",
    "仕": "A",
    "士": "A",
    "帅": "K",
    "帥": "K",
    "将": "K",
    "將": "K",
}
_DIRECTIONS = {"进": "+", "進": "+", "退": "-", "平": "="}
_PREFIXES = {"前": "+", "中": "=", "后": "-", "後": "-"}
_TOKEN = r"[一二三四五六七八九１２３４５６７８９1-9]"
_PIECE = r"[车車马馬傌炮砲包兵卒相象仕士帅帥将將]"
_DIRECTION = r"[进進退平]"
_PREFIXED_MOVE = re.compile(
    rf"(?P<prefix>[前中后後]|{_TOKEN})\s*(?P<piece>{_PIECE})\s*"
    rf"(?P<direction>{_DIRECTION})\s*(?P<target>{_TOKEN})"
)
_ORDINARY_MOVE = re.compile(
    rf"(?P<piece>{_PIECE})\s*(?P<file>{_TOKEN})\s*"
    rf"(?P<direction>{_DIRECTION})\s*(?P<target>{_TOKEN})"
)


def _digit(value: str) -> str:
    return value.translate(_DIGITS)


def chinese_moves_to_wxf(text: str) -> str:
    """Convert embedded Chinese descriptive moves without altering game data."""

    def prefixed(match: re.Match[str]) -> str:
        prefix = match["prefix"]
        return (
            f"{_PREFIXES.get(prefix, _digit(prefix))}{_PIECES[match['piece']]}"
            f"{_DIRECTIONS[match['direction']]}{_digit(match['target'])}"
        )

    def ordinary(match: re.Match[str]) -> str:
        return (
            f"{_PIECES[match['piece']]}{_digit(match['file'])}"
            f"{_DIRECTIONS[match['direction']]}{_digit(match['target'])}"
        )

    return _ORDINARY_MOVE.sub(ordinary, _PREFIXED_MOVE.sub(prefixed, text))


def _translation_key(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _load_existing(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError(f"{path} must contain a JSON object")
    return value


def _raw_source_text(raw_html: Path) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {
        "games": [],
        "metadata": [],
        "annotations": [],
    }
    if raw_html.is_dir():
        for path in sorted(raw_html.glob("*/view_*.html")):
            try:
                tags = parse_dhtmlxq_tags(decode_html(path.read_bytes()))
            except (OSError, UnicodeError):
                continue
            title = tags.get("title", "")
            if title:
                result["games"].append(title)
            for name, value in tags.items():
                if not value:
                    continue
                if COMMENT_TAG_PATTERN.fullmatch(name):
                    result["annotations"].append(
                        value.replace("||||", "\n\n").replace("||", "\n").strip()
                    )
                elif CHINESE_PATTERN.search(value):
                    result["metadata"].append(value)
    for section, values in EXTRA_SOURCE_TEXT.items():
        result[section].extend(values)
    return {section: list(dict.fromkeys(values)) for section, values in result.items()}


def _source_text(
    connection: sqlite3.Connection,
    raw_html: Path = DEFAULT_RAW_HTML,
) -> dict[str, list[str]]:
    rows = connection.execute(
        """
        SELECT
          json_extract(source.locator_json, '$.chapter') AS chapter,
          game.title,
          game.red_name,
          game.black_name,
          game.event,
          game.round,
          game.opening,
          game.place,
          source.metadata_json,
          source.locator_json
        FROM game_sources source
        JOIN games game ON game.id = source.game_id
        WHERE source.source = 'dpxq'
          AND source.collection = 'ancient_manuals'
        ORDER BY source.id
        """
    ).fetchall()
    annotations = connection.execute(
        """
        SELECT annotation.body
        FROM annotations annotation
        JOIN annotation_sets layer ON layer.id = annotation.annotation_set_id
        JOIN game_sources source ON source.id = layer.source_record_id
        WHERE source.source = 'dpxq'
          AND source.collection = 'ancient_manuals'
          AND layer.language = 'zh'
        ORDER BY annotation.id
        """
    ).fetchall()
    metadata: list[str] = []

    def collect(value: Any) -> None:
        if isinstance(value, str) and CHINESE_PATTERN.search(value):
            metadata.append(value)
        elif isinstance(value, dict):
            for item in value.values():
                collect(item)
        elif isinstance(value, list):
            for item in value:
                collect(item)

    for row in rows:
        for value in row[1:7]:
            collect(value)
        collect(json.loads(row[7] or "{}"))
        collect(json.loads(row[8] or "{}"))
    raw = _raw_source_text(raw_html)
    return {
        "chapters": list(
            dict.fromkeys(str(row[0]).strip() for row in rows if str(row[0]).strip())
        ),
        "games": list(
            dict.fromkeys(
                [
                    *(str(row[1]).strip() for row in rows if str(row[1]).strip()),
                    *raw["games"],
                ]
            )
        ),
        "annotations": list(
            dict.fromkeys(
                [
                    *(str(row[0]) for row in annotations if str(row[0])),
                    *raw["annotations"],
                ]
            )
        ),
        "metadata": list(dict.fromkeys([*metadata, *raw["metadata"]])),
    }


def _batches(values: Sequence[str], max_items: int = 80, max_chars: int = 25_000):
    batch: list[str] = []
    chars = 0
    for value in values:
        if batch and (len(batch) >= max_items or chars + len(value) > max_chars):
            yield batch
            batch = []
            chars = 0
        batch.append(value)
        chars += len(value)
    if batch:
        yield batch


class MicrosoftTranslator:
    def __init__(self) -> None:
        self._token = ""

    def _authenticate(self) -> None:
        with urllib.request.urlopen(TRANSLATOR_AUTH_URL, timeout=30) as response:
            self._token = response.read().decode("ascii")

    def translate(self, texts: Sequence[str]) -> list[str]:
        if not self._token:
            self._authenticate()
        body = json.dumps(
            [{"Text": chinese_moves_to_wxf(text)} for text in texts],
            ensure_ascii=False,
        ).encode("utf-8")
        request = urllib.request.Request(
            TRANSLATOR_URL,
            data=body,
            headers={
                "Authorization": f"Bearer {self._token}",
                "Content-Type": "application/json; charset=utf-8",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as error:
            if error.code != 401:
                raise
            self._authenticate()
            return self.translate(texts)
        return [str(item["translations"][0]["text"]).strip() for item in payload]


def _polish(text: str) -> str:
    replacements = (
        ("the red side", "Red"),
        ("The red side", "Red"),
        ("the black side", "Black"),
        ("The black side", "Black"),
        ("red side", "Red"),
        ("black side", "Black"),
        ("chess score", "manual"),
        ("chess manual", "manual"),
        ("original score", "original manual"),
        ("Original score", "Original manual"),
        ("red wins", "Red wins"),
        ("black wins", "Black wins"),
        ("drawn game", "draw"),
        ("Drawn game", "Draw"),
        ("Checkmate!", "Mate!"),
    )
    result = text
    for source, target in replacements:
        result = result.replace(source, target)
    result = re.sub(r"[ \t]+([,.;:!?])", r"\1", result)
    result = re.sub(r" {2,}", " ", result)
    return result


def _translate_section(
    source_values: Iterable[str],
    existing: dict[str, dict[str, str]],
    *,
    refresh: bool,
    translator: MicrosoftTranslator,
) -> dict[str, dict[str, str]]:
    result = {} if refresh else dict(existing)
    pending = [
        value
        for value in source_values
        if value not in EXACT_TRANSLATIONS
        and (refresh or _translation_key(value) not in result)
    ]
    translated: dict[str, str] = {}
    for batch in _batches(pending):
        for source, english in zip(batch, translator.translate(batch), strict=True):
            translated[_translation_key(source)] = {
                "source": source,
                "text": _polish(english),
            }
    for source in source_values:
        if source in EXACT_TRANSLATIONS:
            translated[_translation_key(source)] = {
                "source": source,
                "text": EXACT_TRANSLATIONS[source],
                "reviewedBy": "manual",
            }
    result.update(translated)
    # Retain reviewed historical entries even when an invalid source page is
    # absent from a particular machine's untracked raw-page cache.
    return {key: result[key] for key in sorted(result)}


def build(database: Path, output: Path, *, refresh: bool = False) -> dict[str, Any]:
    existing = _load_existing(output)
    with sqlite3.connect(database) as connection:
        source = _source_text(connection)
    translator = MicrosoftTranslator()
    catalog: dict[str, Any] = {
        "language": "en",
        "manuals": MANUAL_TITLES,
    }
    for section in ("chapters", "games", "metadata", "annotations"):
        catalog[section] = _translate_section(
            source[section],
            existing.get(section, {}),
            refresh=refresh,
            translator=translator,
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return catalog


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build the English DPXQ ancient-manual translation catalog"
    )
    parser.add_argument("--database", type=Path, default=database_path())
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args(argv)
    catalog = build(args.database, args.output, refresh=args.refresh)
    print(
        json.dumps(
            {
                "output": str(args.output),
                "manuals": len(catalog["manuals"]),
                "chapters": len(catalog["chapters"]),
                "games": len(catalog["games"]),
                "metadata": len(catalog["metadata"]),
                "annotations": len(catalog["annotations"]),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
