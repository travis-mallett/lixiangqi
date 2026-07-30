"""Apply a terminology-constrained editorial pass to ancient-manual English."""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from collections import Counter
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from .build_ancient_manual_translations import (
    CHINESE_PATTERN,
    DEFAULT_OUTPUT,
    _batches,
    chinese_moves_to_wxf,
)

MODEL = "gpt-5.4-mini"
WXF_PATTERN = re.compile(r"(?:[+\-=1-5][KAEHRCP][+\-=][1-9]|[KAEHRCP][1-9][+\-=][1-9])")
SYSTEM_PROMPT = """You are the senior English editor for a complete collection of
classical and early-modern Xiangqi manuals. Translate the Chinese source into
polished, natural English for serious Xiangqi players. The draft is only a
reference: repair literal, awkward, or incorrect phrasing rather than copying
it.

Preserve the source's full meaning, paragraphing, claims, uncertainty, names,
citations, labels, and tone. Do not add analysis or omit content. Transliterate
Chinese personal and place names in standard unaccented Hanyu Pinyin when no
established English form exists. Do not leave Chinese text in the English.

Use official WXF piece names: King, Advisor, Elephant, Chariot, Horse, Cannon,
and Pawn. Use Red and Black. Preserve every WXF move token from the draft
exactly, including order and repetitions. Never spell a WXF move out in words.

Use established Xiangqi opening terms where applicable:
- 当头炮 / 中炮: Central Cannon
- 顺炮 / 顺手炮: Same Direction Cannons
- 列炮 / 列手炮: Opposite Direction Cannons
- 屏风马: Screen Horse Defense
- 单提马: Single Horse Defense
- 士角炮: Palcorner Cannon
- 过宫炮: Cross-Palace Cannon
- 仙人指路: Pawn Opening
- 飞相局: Elephant Opening
- 起马局: Horse Opening
- 反宫马: Sandwiched Horse Defense
- 龟背炮: Turtle Back Cannons
- 鸳鸯炮: Tandem Cannons
- 直车: Filed Chariot
- 横车: Ranked Chariot
- 巡河车: Riverbank Chariot

In context, 子力 means pieces, forces, or development; 先手 means the initiative
or a tempo; 后手 means the second player, Black, or being a tempo behind; 局
means game, position, or line; 谱 means manual; 变 means variation; 正着 means
the correct move; 妙着 means an excellent move.
"""
REPAIR_PROMPT = """Correct each English Xiangqi annotation so every move is in
WXF notation and no Chinese characters remain. The requiredWxf array is
authoritative: every listed token must appear exactly, in the same order and
with the same repetition count. Replace Chinese notation and spelled-out moves
such as "Horse 2+3" with their required WXF tokens. Preserve all other meaning,
names, paragraphs, and natural English. Return one corrected string per input
in the same order."""


def standardize(text: str) -> str:
    """Enforce the site's established names after free-form editorial work."""

    phrases = (
        (
            "Once Out of the Cave, No One Could Match Him",
            "The Invincible Xiangqi Manual",
        ),
        ("Zichu Donglai Wudi Shou", "The Invincible Xiangqi Manual"),
        ("The Secret in the Orange Grove", "Secret in the Tangerine"),
        ("The Secret in the Orange", "Secret in the Tangerine"),
        ("The Secret of the Orange", "Secret in the Tangerine"),
        ("Secret in the Orange Grove", "Secret in the Tangerine"),
        ("Orange Secret", "Secret in the Tangerine"),
        ("Juzhongmi", "Secret in the Tangerine"),
        ("Reverse Plum Blossom Manual", "Anti-Plum Flower Manual"),
        ("Reverse Plum Flower Manual", "Anti-Plum Flower Manual"),
        ("Plum Blossom Reform Manual", "Plum Flower Variations Manual"),
        ("Peerless Plum Blossom Manual", "Unparalleled Plum Flower Manual"),
        ("Plum Blossom Springs Manual", "Plum Flower Springs Manual"),
        ("Plum Blossom Spring Manual", "Plum Flower Springs Manual"),
        ("Plum Blossom Spring", "Plum Flower Springs Manual"),
        ("Plum Blossom", "Plum Flower"),
        ("horizontal Chariot", "Ranked Chariot"),
        ("Horizontal Chariot", "Ranked Chariot"),
        ("straight Chariot", "Filed Chariot"),
        ("Straight Chariot", "Filed Chariot"),
        ("horizontal chariot", "Ranked Chariot"),
        ("straight chariot", "Filed Chariot"),
        ("Rank Chariot", "Ranked Chariot"),
        ("rank Chariot", "Ranked Chariot"),
        ("Advisor-Corner Cannon", "Palcorner Cannon"),
        ("Advisor Corner Cannon", "Palcorner Cannon"),
        ("Mandarin Duck Horses", "Tandem Horses"),
        ("return Central Cannon", "Central Cannon"),
        ("General Game Methods", "Full-Game Lines"),
        ("General Game Play", "Full-Game Lines"),
        ("Overall Game Play", "Full-Game Lines"),
        ("Complete-Game Play", "Full-Game Lines"),
        ("Complete-game moves", "Full-Game Lines"),
        ("Whole-Game Play", "Full-Game Lines"),
        ("Full-Board Play", "Full-Game Lines"),
        ("Volume Middle", "Volume II"),
        ("Middle Volume", "Volume II"),
        ("middle volume", "Volume II"),
        ("Upper Volume", "Volume I"),
        ("upper volume", "Volume I"),
        ("Lower Volume", "Volume III"),
        ("lower volume", "Volume III"),
        ("self-change", "editorial variation"),
        ("Yang Guan●", "Yang Guanlin"),
        ("rooks", "Chariots"),
        ("Rooks", "Chariots"),
        ("rook", "Chariot"),
        ("Rook", "Chariot"),
        ("knights", "Horses"),
        ("Knights", "Horses"),
        ("knight", "Horse"),
        ("Knight", "Horse"),
        ("soldiers", "Pawns"),
        ("Soldiers", "Pawns"),
        ("soldier", "Pawn"),
        ("Soldier", "Pawn"),
        ("争先", "fight for the initiative"),
    )
    result = text
    for source, target in phrases:
        result = result.replace(source, target)
    result = re.sub(
        r"^(Game \d+: )(.+?) — Red Wins; (.+)$",
        r"\1\2 vs. \3 — Red Wins",
        result,
    )
    return result


def _client():
    try:
        from openai import OpenAI
    except ImportError as error:
        raise RuntimeError(
            "The editorial pass requires the optional 'openai' Python package."
        ) from error
    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is required for the editorial pass.")
    return OpenAI()


def _wxf_tokens(text: str) -> Counter[str]:
    return Counter(WXF_PATTERN.findall(text))


def _review_batch(
    client: Any,
    section: str,
    entries: list[dict[str, Any]],
) -> list[str]:
    title_instruction = (
        " Render each result as a concise English display title in title case."
        if section in {"chapters", "games", "metadata"}
        else ""
    )
    if section == "games":
        title_instruction += """ For historical match titles, interpret result
markers rather than translating them literally: 先 means that player had Red;
先胜 means that player won as Red; 先和 means a draw with that player as Red;
二先 means a two-move handicap. Format ordinary matches naturally as
"Player A vs. Player B — Red Wins", "— Black Wins", or "— Draw" when the
source identifies the result. Never output literal labels such as "(First)",
"(Win)", "(First Win)", or "(First Draw)"."""
    payload = [{"source": entry["source"], "draft": entry["text"]} for entry in entries]
    for attempt in range(4):
        try:
            response = client.responses.create(
                model=MODEL,
                reasoning={"effort": "low"},
                input=[
                    {
                        "role": "system",
                        "content": SYSTEM_PROMPT + title_instruction,
                    },
                    {
                        "role": "user",
                        "content": json.dumps(payload, ensure_ascii=False),
                    },
                ],
                text={
                    "format": {
                        "type": "json_schema",
                        "name": "ancient_manual_translations",
                        "strict": True,
                        "schema": {
                            "type": "object",
                            "properties": {
                                "translations": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                }
                            },
                            "required": ["translations"],
                            "additionalProperties": False,
                        },
                    }
                },
            )
            result = json.loads(response.output_text)["translations"]
            if len(result) != len(entries):
                raise ValueError("editorial response changed the item count")
            return [str(text).strip() for text in result]
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2**attempt)
    raise AssertionError("unreachable")


def _repair_batch(client: Any, entries: list[dict[str, Any]]) -> list[str]:
    payload = []
    for entry in entries:
        source_wxf = chinese_moves_to_wxf(entry["source"])
        payload.append(
            {
                "sourceWithWxf": source_wxf,
                "currentEnglish": entry["text"],
                "requiredWxf": WXF_PATTERN.findall(source_wxf),
            }
        )
    for attempt in range(4):
        try:
            response = client.responses.create(
                model=MODEL,
                reasoning={"effort": "low"},
                input=[
                    {"role": "system", "content": REPAIR_PROMPT},
                    {
                        "role": "user",
                        "content": json.dumps(payload, ensure_ascii=False),
                    },
                ],
                text={
                    "format": {
                        "type": "json_schema",
                        "name": "repaired_ancient_manual_translations",
                        "strict": True,
                        "schema": {
                            "type": "object",
                            "properties": {
                                "translations": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                }
                            },
                            "required": ["translations"],
                            "additionalProperties": False,
                        },
                    }
                },
            )
            result = json.loads(response.output_text)["translations"]
            if len(result) != len(entries):
                raise ValueError("repair response changed the item count")
            repaired = [
                standardize(chinese_moves_to_wxf(str(text).strip())) for text in result
            ]
            for entry, item, text in zip(entries, payload, repaired, strict=True):
                expected = Counter(item["requiredWxf"])
                missing = expected - _wxf_tokens(text)
                if missing:
                    raise ValueError(
                        f"repair response dropped {missing} in {entry['source']!r}: {text!r}"
                    )
                if CHINESE_PATTERN.search(text):
                    raise ValueError(
                        f"repair response retained Chinese text in {entry['source']!r}: {text!r}"
                    )
            return repaired
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2**attempt)
    raise AssertionError("unreachable")


def repair_notation(path: Path) -> dict[str, Any]:
    catalog = json.loads(path.read_text(encoding="utf-8"))
    client = _client()
    entries = list(catalog["annotations"].values())
    pending = []
    for entry in entries:
        expected = _wxf_tokens(chinese_moves_to_wxf(entry["source"]))
        if CHINESE_PATTERN.search(entry["text"]) or expected - _wxf_tokens(
            entry["text"]
        ):
            pending.append(entry)
    for offset in range(0, len(pending), 18):
        batch = pending[offset : offset + 18]
        translations = _repair_batch(client, batch)
        for entry, text in zip(batch, translations, strict=True):
            entry["text"] = text
        path.write_text(
            json.dumps(catalog, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(
            f"notation: repaired {min(offset + len(batch), len(pending))}/{len(pending)}",
            flush=True,
        )
    return catalog


def review(path: Path, sections: Sequence[str], *, refresh: bool) -> dict[str, Any]:
    catalog = json.loads(path.read_text(encoding="utf-8"))
    client = _client()
    for section in sections:
        entries = list(catalog[section].values())
        pending = [entry for entry in entries if refresh or not entry.get("reviewedBy")]
        source_batches = list(
            _batches(
                [entry["source"] for entry in pending],
                max_items=45,
                max_chars=9_000,
            )
        )
        offset = 0
        for source_batch in source_batches:
            batch = pending[offset : offset + len(source_batch)]
            translations = _review_batch(client, section, batch)
            for entry, text in zip(batch, translations, strict=True):
                entry["text"] = standardize(text)
                entry["reviewedBy"] = MODEL
            offset += len(batch)
            path.write_text(
                json.dumps(catalog, ensure_ascii=False, indent=2, sort_keys=True)
                + "\n",
                encoding="utf-8",
            )
            print(
                f"{section}: reviewed {offset}/{len(pending)}",
                flush=True,
            )
    return catalog


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Editorially review the English ancient-manual catalog"
    )
    parser.add_argument("--catalog", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--section",
        action="append",
        choices=("chapters", "games", "metadata", "annotations"),
    )
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--repair-notation", action="store_true")
    args = parser.parse_args(argv)
    if args.repair_notation:
        catalog = repair_notation(args.catalog)
        print(json.dumps({"annotations": len(catalog["annotations"])}))
        return 0
    sections = args.section or ["chapters", "games", "metadata", "annotations"]
    catalog = review(args.catalog, sections, refresh=args.refresh)
    print(
        json.dumps(
            {section: len(catalog[section]) for section in sections},
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
