"""Authoritative SQLite path and read-only connection factory."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from tools.games_database.storage import DATA_DIRECTORY, DEFAULT_DATABASE

GAMES_DATABASE = DEFAULT_DATABASE

# Migration-only legacy locations. Writers and readers never select these.
LEGACY_DATABASE = DATA_DIRECTORY / "xiangqi-explorer.sqlite3"
DPXQ_DATABASE = DATA_DIRECTORY / "xiangqi-explorer-dpxq.sqlite3"
GDCHESS_DATABASE = DATA_DIRECTORY / "xiangqi-explorer-gdchess.sqlite3"
XQDAO_DATABASE = DATA_DIRECTORY / "xiangqi-explorer-xqdao.sqlite3"
LEGACY_SOURCE_DATABASES = {
    "dpxq": DPXQ_DATABASE,
    "gdchess": GDCHESS_DATABASE,
    "xqdao": XQDAO_DATABASE,
}
CATALOG_GAME_COLUMNS = (
    "id",
    "canonical_hash",
    "record_kind",
    "statistical_eligible",
    "red_name",
    "red_name_romanized",
    "red_name_key",
    "red_rating",
    "black_name",
    "black_name_romanized",
    "black_name_key",
    "black_rating",
    "result",
    "played_at",
    "event",
    "title",
    "round",
    "opening",
    "game_class",
    "group_name",
    "place",
    "time_rule",
    "notations",
)


def games_database_path() -> Path:
    configured = os.environ.get("LIXIANGQI_GAMES_DB") or os.environ.get(
        "LIXIANGQI_EXPLORER_DB"
    )
    return Path(configured).resolve() if configured else GAMES_DATABASE


def source_database_path(source: str) -> Path:
    """Compatibility API: every source now writes to the same catalog."""

    if source not in LEGACY_SOURCE_DATABASES:
        raise KeyError(source)
    return games_database_path()


def catalog_database_paths() -> tuple[Path, ...]:
    return (games_database_path(),)


def installed_catalog_database_paths() -> tuple[Path, ...]:
    path = games_database_path()
    return (path,) if path.is_file() else ()


def catalog_database_id(value: str | Path) -> str:
    raw = str(value)
    if raw in LEGACY_SOURCE_DATABASES:
        return raw
    path = Path(raw)
    for source, legacy_path in LEGACY_SOURCE_DATABASES.items():
        if path.name == legacy_path.name:
            return source
    if path.name == games_database_path().name:
        return "catalog"
    return path.name


def _open_readonly(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(
        f"{path.resolve().as_uri()}?mode=ro&immutable=1",
        uri=True,
        timeout=5,
        check_same_thread=False,
    )
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    # The position projection is several gigabytes. Memory mapping lets the OS
    # share clean database pages across request-scoped connections without a
    # duplicate application cache or a large per-thread SQLite page cache.
    connection.execute("PRAGMA mmap_size = 2147483648")
    connection.execute("PRAGMA cache_size = -16384")
    connection.execute("PRAGMA temp_store = MEMORY")
    columns = {
        row[1] for row in connection.execute("PRAGMA table_info(games)").fetchall()
    }
    if not set(CATALOG_GAME_COLUMNS).issubset(columns):
        connection.close()
        raise sqlite3.DatabaseError("games database schema is missing or obsolete")
    return connection


def open_catalog_connection():
    """Open an independent read-only connection for one request."""

    path = games_database_path()
    if not path.is_file():
        return None
    return _open_readonly(path)


def catalog_is_readable() -> bool:
    """Verify that the mounted catalog can serve a real request."""

    connection = open_catalog_connection()
    if connection is None:
        return False
    try:
        return connection.execute("SELECT 1 FROM games LIMIT 1").fetchone() is not None
    finally:
        connection.close()
