"""Source-isolated SQLite paths and read-only explorer catalog aggregation."""

from __future__ import annotations

import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIRECTORY = PROJECT_ROOT / "data" / "local"
LEGACY_DATABASE = DATA_DIRECTORY / "xiangqi-explorer.sqlite3"
DPXQ_DATABASE = DATA_DIRECTORY / "xiangqi-explorer-dpxq.sqlite3"
GDCHESS_DATABASE = DATA_DIRECTORY / "xiangqi-explorer-gdchess.sqlite3"
XQDAO_DATABASE = DATA_DIRECTORY / "xiangqi-explorer-xqdao.sqlite3"

SOURCE_DATABASES = {
    "dpxq": DPXQ_DATABASE,
    "gdchess": GDCHESS_DATABASE,
    "xqdao": XQDAO_DATABASE,
}
SOURCE_DATABASE_ENV = {
    "dpxq": "LIXIANGQI_DPXQ_DB",
    "gdchess": "LIXIANGQI_GDCHESS_DB",
    "xqdao": "LIXIANGQI_XQDAO_DB",
}
CATALOG_GAME_COLUMNS = (
    "id",
    "canonical_hash",
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
)
CATALOG_REFRESH_SECONDS = 60.0
_CACHE_LOCK = threading.RLock()
_CACHE_CONNECTION: sqlite3.Connection | None = None
_CACHE_PATHS: tuple[Path, ...] = ()
_CACHE_SIGNATURE: tuple[tuple[str, int, int], ...] = ()
_CACHE_CHECKED_AT = 0.0


class _CatalogConnectionLease:
    """Serialize access to the process-wide read snapshot until close()."""

    def __init__(self, connection: sqlite3.Connection) -> None:
        self._connection = connection
        self._closed = False

    def __getattr__(self, name: str):
        return getattr(self._connection, name)

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            _CACHE_LOCK.release()


def source_database_path(source: str) -> Path:
    """Return a source writer's configured database path."""

    configured = os.environ.get(SOURCE_DATABASE_ENV[source])
    return Path(configured).resolve() if configured else SOURCE_DATABASES[source]


def catalog_database_paths() -> tuple[Path, ...]:
    """Return databases used by the read-only catalog service.

    ``LIXIANGQI_EXPLORER_DB`` remains a single-file compatibility override for
    tests and existing deployments. Source-specific overrides are used by the
    split catalog when that legacy override is absent.
    """

    legacy = os.environ.get("LIXIANGQI_EXPLORER_DB")
    if legacy:
        return (Path(legacy).resolve(),)
    return tuple(source_database_path(source) for source in SOURCE_DATABASES)


def installed_catalog_database_paths() -> tuple[Path, ...]:
    return tuple(path for path in catalog_database_paths() if path.is_file())


def catalog_database_id(value: str | Path) -> str:
    """Return the stable catalog key for a configured database.

    Unregistered databases retain their filename so legacy single-file
    deployments and temporary test catalogs remain addressable.
    """

    raw = str(value)
    path = Path(raw)
    for source in SOURCE_DATABASES:
        configured = source_database_path(source)
        if raw == source or path.name == configured.name:
            return source
    return path.name


def _identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _union(parts: Iterable[str]) -> str:
    return " UNION ALL ".join(parts)


def _database_signature(paths: tuple[Path, ...]) -> tuple[tuple[str, int, int], ...]:
    signature: list[tuple[str, int, int]] = []
    for path in paths:
        for candidate in (path, Path(str(path) + "-wal")):
            try:
                stat = candidate.stat()
            except FileNotFoundError:
                continue
            signature.append((str(candidate), stat.st_size, stat.st_mtime_ns))
    return tuple(signature)


def _uses_default_catalog() -> bool:
    return not any(
        os.environ.get(name)
        for name in ("LIXIANGQI_EXPLORER_DB", *SOURCE_DATABASE_ENV.values())
    )


def _build_catalog_connection(paths: tuple[Path, ...]) -> sqlite3.Connection:
    """Attach installed source databases behind deduplicated temporary views.

    Only the relatively small ``games`` and ``game_sources`` tables are
    aggregated. Opening-explorer position queries continue to read the DPXQ
    database directly, and catalog move counts come from the stored move list.
    """

    connection = sqlite3.connect(
        "file::memory:?cache=private", uri=True, timeout=5, check_same_thread=False
    )
    connection.row_factory = sqlite3.Row
    aliases: list[str] = []
    try:
        for index, path in enumerate(paths):
            alias = f"source_{index}"
            uri = f"{path.resolve().as_uri()}?mode=ro"
            connection.execute(f"ATTACH DATABASE ? AS {_identifier(alias)}", (uri,))
            aliases.append(alias)

        installed_game_columns = {
            row[1]
            for row in connection.execute(
                f"PRAGMA {_identifier(aliases[0])}.table_info(games)"
            ).fetchall()
        }
        source_columns = [
            row[1]
            for row in connection.execute(
                f"PRAGMA {_identifier(aliases[0])}.table_info(game_sources)"
            ).fetchall()
        ]
        if not set(CATALOG_GAME_COLUMNS).issubset(installed_game_columns) or not source_columns:
            raise sqlite3.DatabaseError("catalog database schema is missing")

        games = ", ".join(_identifier(column) for column in CATALOG_GAME_COLUMNS)
        raw_games = _union(
            f"SELECT {games}, json_array_length(moves) AS move_count, "
            f"{priority} AS _catalog_priority, '{alias}' AS _catalog_db, "
            f"id AS _catalog_original_id FROM {_identifier(alias)}.games"
            for priority, alias in enumerate(aliases)
        )
        connection.execute(f"CREATE TEMP VIEW catalog_games_raw AS {raw_games}")
        connection.execute(
            f"""
            CREATE TEMP TABLE games AS
            SELECT {games}, move_count, _catalog_db, _catalog_original_id
            FROM (
              SELECT *, row_number() OVER (
                PARTITION BY canonical_hash ORDER BY _catalog_priority, id
              ) AS _catalog_rank
              FROM catalog_games_raw
            )
            WHERE _catalog_rank = 1
            """
        )
        connection.execute("CREATE INDEX games_by_id ON games(id)")
        connection.execute("CREATE INDEX games_by_hash ON games(canonical_hash)")

        raw_sources = _union(
            "SELECT s.source, s.collection, s.collection_name, s.external_id, "
            "s.source_url, s.metadata_json, g.canonical_hash "
            f"FROM {_identifier(alias)}.game_sources s "
            f"JOIN {_identifier(alias)}.games g ON g.id = s.game_id"
            for alias in aliases
        )
        connection.execute(f"CREATE TEMP VIEW catalog_sources_raw AS {raw_sources}")
        # Keep the public table's original column order for callers that use
        # named sqlite3.Row access while remapping memberships to the selected
        # canonical row from the games view.
        ordered_source_projection = ", ".join(
            "g.id AS game_id" if column == "game_id" else f"r.{_identifier(column)}"
            for column in source_columns
        )
        connection.execute(
            f"""
            CREATE TEMP TABLE game_sources AS
            SELECT {ordered_source_projection}
            FROM catalog_sources_raw r
            JOIN games g ON g.canonical_hash = r.canonical_hash
            """
        )
        connection.execute(
            "CREATE INDEX game_sources_by_source "
            "ON game_sources(source, collection, game_id)"
        )
        connection.execute(
            "CREATE INDEX game_sources_by_game "
            "ON game_sources(game_id, source, collection)"
        )
        connection.execute("DROP VIEW catalog_sources_raw")
        connection.execute("DROP VIEW catalog_games_raw")
        return connection
    except Exception:
        connection.close()
        raise


def open_catalog_connection():
    """Open a catalog snapshot, caching the production split catalog briefly."""

    global _CACHE_CHECKED_AT, _CACHE_CONNECTION, _CACHE_PATHS, _CACHE_SIGNATURE

    paths = installed_catalog_database_paths()
    if not paths:
        return None
    if not _uses_default_catalog():
        return _build_catalog_connection(paths)

    _CACHE_LOCK.acquire()
    try:
        now = time.monotonic()
        paths_changed = paths != _CACHE_PATHS
        refresh_due = now - _CACHE_CHECKED_AT >= CATALOG_REFRESH_SECONDS
        signature = (
            _database_signature(paths)
            if _CACHE_CONNECTION is None or paths_changed or refresh_due
            else _CACHE_SIGNATURE
        )
        changed = paths_changed or signature != _CACHE_SIGNATURE
        if _CACHE_CONNECTION is None or changed:
            replacement = _build_catalog_connection(paths)
            if _CACHE_CONNECTION is not None:
                _CACHE_CONNECTION.close()
            _CACHE_CONNECTION = replacement
            _CACHE_PATHS = paths
            _CACHE_SIGNATURE = signature
        if refresh_due or changed:
            _CACHE_CHECKED_AT = now
        assert _CACHE_CONNECTION is not None
        return _CatalogConnectionLease(_CACHE_CONNECTION)
    except Exception:
        _CACHE_LOCK.release()
        raise
