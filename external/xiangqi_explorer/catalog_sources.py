"""Shared source identities and selection for catalog and opening queries."""

from typing import Any

SOURCE_SPECS = {
    "m": ("dpxq", "m", "Master Games"),
    "am": ("dpxq", "ancient_manuals", "Ancient Manuals"),
    "n": ("dpxq", "n", "Online Tournaments"),
    "t": ("dpxq", "t", "Top Games"),
    "k": ("dpxq", "k", "Top Blitz Games"),
    "o": ("dpxq", "o", "Other Games"),
    "b": ("dpxq", "b", "Games Under 24 Moves"),
    "u": ("dpxq", "u", "Player Uploads"),
    "w": ("dpxq", "w", "Unassigned Games"),
    "gd": ("gdchess_01xq", "games", "GDChess/01xq"),
    "xqd": ("xqdao", "games", "XQDao"),
    "ec": ("elephantchess", "games", "Elephantchess.io"),
}
SOURCES = frozenset(SOURCE_SPECS)
SOURCE_IDS = {
    (source, collection): source_id
    for source_id, (source, collection, _label) in SOURCE_SPECS.items()
}

def parse_sources(value: Any) -> list[str]:
    if value is None:
        return list(SOURCE_SPECS)
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError("sources must be an array of source identifiers")
    requested = set(value)
    invalid = [item for item in requested if item not in SOURCES]
    if invalid:
        raise ValueError(f"unsupported game source: {invalid[0]}")
    # Canonical ordering gives equivalent source sets one aggregate-cache key.
    return [source_id for source_id in SOURCE_SPECS if source_id in requested]


def source_filter(selected: list[str], alias: str = "selected_source") -> tuple[str, list[str]]:
    specs = [SOURCE_SPECS[source_id] for source_id in selected]
    clause = " OR ".join(
        f"({alias}.source = ? AND {alias}.collection = ?)" for _ in specs
    )
    parameters = [
        value for source, collection, _label in specs for value in (source, collection)
    ]
    return clause or "0", parameters
