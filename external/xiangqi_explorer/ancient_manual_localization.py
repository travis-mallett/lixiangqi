"""Locale selection for the versioned ancient-manual translation catalog."""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

CATALOG_PATH = Path(__file__).with_name("ancient_manuals.en.json")
SECTIONS = ("chapters", "games", "metadata", "annotations")


def _key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def language(query: dict[str, Any]) -> str:
    value = query.get("language", "zh")
    if not isinstance(value, str) or len(value) > 35:
        raise ValueError("language must be a valid locale identifier")
    normalized = value.strip().replace("_", "-").casefold()
    return normalized or "zh"


def is_chinese(locale: str) -> bool:
    return locale == "zh" or locale.startswith("zh-")


@lru_cache(maxsize=1)
def _catalog() -> dict[str, Any]:
    value = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("language") != "en":
        raise ValueError("invalid ancient-manual translation catalog")
    return value


def manual_title(slug: str, source: str, locale: str) -> str:
    if is_chinese(locale):
        return source
    return str(_catalog().get("manuals", {}).get(slug) or source)


def text(section: str, source: str, locale: str) -> str:
    if is_chinese(locale) or not source:
        return source
    if section not in SECTIONS:
        raise ValueError(f"unsupported ancient-manual translation section: {section}")
    entry = _catalog().get(section, {}).get(_key(source))
    if not isinstance(entry, dict) or entry.get("source") != source:
        return source
    translated = entry.get("text")
    return str(translated) if isinstance(translated, str) and translated else source


def display_text(source: str, locale: str) -> str:
    """Translate an arbitrary display field using the most specific catalog."""

    if is_chinese(locale) or not source:
        return source
    for section in ("games", "chapters", "metadata", "annotations"):
        translated = text(section, source, locale)
        if translated != source:
            return translated
    return source


def localized_value(value: Any, locale: str) -> Any:
    """Localize string leaves in source metadata without changing its shape."""

    if isinstance(value, str):
        return display_text(value, locale)
    if isinstance(value, list):
        return [localized_value(item, locale) for item in value]
    if isinstance(value, dict):
        return {key: localized_value(item, locale) for key, item in value.items()}
    return value
