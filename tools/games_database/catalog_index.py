"""Persistent read model for Games Database facets and timeline totals.

The public catalog must not aggregate the raw games table on an HTTP request.
This projection keeps one compact source/date row per canonical game and rolls
those rows up by exact source membership and date. SQLite triggers maintain the
projection in the same transaction as every catalog write.
"""

from __future__ import annotations

import sqlite3
import time
from collections.abc import Sequence
from pathlib import Path
from typing import Final

from .storage import SCHEMA_PATH, SCHEMA_VERSION, database_path

INDEX_VERSION: Final = 2

# Stable API source identifiers map to independent bits. A game can have more
# than one witness/category; summing distinct powers of two is therefore an OR.
SOURCE_MEMBERSHIP: Final = {
    "m": ("dpxq", "m", 1 << 0),
    "am": ("dpxq", "ancient_manuals", 1 << 1),
    "n": ("dpxq", "n", 1 << 2),
    "t": ("dpxq", "t", 1 << 3),
    "k": ("dpxq", "k", 1 << 4),
    "o": ("dpxq", "o", 1 << 5),
    "b": ("dpxq", "b", 1 << 6),
    "u": ("dpxq", "u", 1 << 7),
    "w": ("dpxq", "w", 1 << 8),
    "gd": ("gdchess_01xq", "games", 1 << 9),
    "xqd": ("xqdao", "games", 1 << 10),
    "ec": ("elephantchess", "games", 1 << 11),
}
SOURCE_BITS: Final = {
    source_id: bit for source_id, (_source, _collection, bit) in SOURCE_MEMBERSHIP.items()
}
ONLINE_SOURCE_IDS: Final = ("n", "t", "k", "o", "b", "u", "w")


def source_mask(source_ids: Sequence[str]) -> int:
    """Return the membership mask for already-validated public source IDs."""

    return sum(SOURCE_BITS[source_id] for source_id in source_ids)


def _metadata(connection: sqlite3.Connection, key: str) -> str | None:
    row = connection.execute(
        "SELECT value FROM metadata WHERE key = ?", (key,)
    ).fetchone()
    return str(row[0]) if row is not None else None


def configure_sources(connection: sqlite3.Connection) -> None:
    """Install the canonical source-to-bit mapping used by SQL triggers."""

    connection.executemany(
        """
        INSERT INTO catalog_source_types(id, source, collection, source_bit)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          source = excluded.source,
          collection = excluded.collection,
          source_bit = excluded.source_bit
        """,
        (
            (source_id, source, collection, bit)
            for source_id, (source, collection, bit) in SOURCE_MEMBERSHIP.items()
        ),
    )
    placeholders = ",".join("?" for _ in SOURCE_MEMBERSHIP)
    connection.execute(
        f"DELETE FROM catalog_source_types WHERE id NOT IN ({placeholders})",
        tuple(SOURCE_MEMBERSHIP),
    )


def index_is_current(connection: sqlite3.Connection) -> bool:
    if (
        _metadata(connection, "catalog_index_version") != str(INDEX_VERSION)
        or _metadata(connection, "catalog_index_state") != "ready"
    ):
        return False
    projected, searchable, search_documents, games = connection.execute(
        """
        SELECT
          (SELECT count(*) FROM catalog_game_facets),
          (SELECT count(*) FROM catalog_search),
          (SELECT count(*) FROM catalog_search_documents),
          (SELECT count(*) FROM games)
        """
    ).fetchone()
    aggregated = connection.execute(
        "SELECT coalesce(sum(game_count), 0) FROM catalog_timeline_stats"
    ).fetchone()[0]
    return (
        int(projected)
        == int(searchable)
        == int(search_documents)
        == int(games)
        == int(aggregated)
    )


def rebuild(connection: sqlite3.Connection, *, progress: bool = False) -> None:
    """Rebuild the read model once during an explicit schema/index upgrade."""

    started = time.monotonic()

    def report(message: str) -> None:
        if progress:
            print(
                f"Catalog index: {message} ({time.monotonic() - started:.1f}s)",
                flush=True,
            )

    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    configure_sources(connection)
    connection.execute(
        "INSERT OR REPLACE INTO metadata(key, value) "
        "VALUES ('catalog_index_state', 'building')"
    )
    # Facet-maintenance triggers observe the building state and pause while the
    # historical projection is replaced. The ready marker and all replacement
    # rows become visible atomically when the caller commits.
    connection.execute("DELETE FROM catalog_timeline_stats")
    connection.execute("DELETE FROM catalog_game_facets")
    connection.execute("DELETE FROM catalog_search")
    connection.execute("DELETE FROM catalog_search_documents")
    report("projecting source and date facets")
    connection.execute(
        """
        INSERT INTO catalog_game_facets(game_id, source_mask, year_bucket, month_bucket)
        SELECT
          g.id,
          coalesce(sum(DISTINCT source_type.source_bit), 0),
          CASE WHEN g.year BETWEEN 1 AND 9999 THEN g.year ELSE 0 END,
          CASE
            WHEN length(g.month) = 7
              AND g.month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
              AND CAST(substr(g.month, 1, 4) AS INTEGER) BETWEEN 1 AND 9999
              AND CAST(substr(g.month, 6, 2) AS INTEGER) BETWEEN 1 AND 12
            THEN g.month ELSE ''
          END
        FROM games g
        LEFT JOIN game_sources source ON source.game_id = g.id
        LEFT JOIN catalog_source_types source_type
          ON source_type.source = source.source
         AND source_type.collection = source.collection
        GROUP BY g.id
        """
    )
    report("indexing searchable fields")
    connection.execute(
        """
        INSERT INTO catalog_search_documents(game_id)
        SELECT id FROM games ORDER BY id
        """
    )
    connection.execute(
        """
        INSERT INTO catalog_search(
          rowid, game_id, red_name, black_name,
          red_name_romanized, black_name_romanized,
          red_name_key, black_name_key, event, opening, place, title
        )
        SELECT
          document.search_id, g.id, g.red_name, g.black_name,
          g.red_name_romanized, g.black_name_romanized,
          g.red_name_key, g.black_name_key, g.event, g.opening, g.place, g.title
        FROM catalog_search_documents document
        JOIN games g ON g.id = document.game_id
        """
    )
    report("rolling up timeline totals")
    connection.execute(
        """
        INSERT INTO catalog_timeline_stats(
          source_mask, year_bucket, month_bucket, game_count
        )
        SELECT source_mask, year_bucket, month_bucket, count(*)
        FROM catalog_game_facets
        GROUP BY source_mask, year_bucket, month_bucket
        """
    )
    connection.execute(
        "INSERT OR REPLACE INTO metadata(key, value) VALUES "
        "('catalog_index_version', ?), ('catalog_index_state', 'ready'), "
        "('schema_version', ?)",
        (str(INDEX_VERSION), str(SCHEMA_VERSION)),
    )
    report("complete")


def ensure_current(
    connection: sqlite3.Connection, *, progress: bool = False
) -> bool:
    """Ensure the schema exists and rebuild only when the projection is obsolete."""

    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    configure_sources(connection)
    if index_is_current(connection):
        connection.execute(
            "INSERT OR REPLACE INTO metadata(key, value) VALUES ('schema_version', ?)",
            (str(SCHEMA_VERSION),),
        )
        return False
    rebuild(connection, progress=progress)
    return True


def ensure(path: Path, *, progress: bool = False) -> bool:
    if not path.is_file():
        return False
    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA synchronous = NORMAL")
        connection.execute("PRAGMA temp_store = MEMORY")
        connection.execute("PRAGMA cache_size = -262144")
        ensure_current(connection, progress=progress)
        connection.commit()
    return True


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command", choices=("ensure", "rebuild"), nargs="?", default="ensure"
    )
    parser.add_argument("--database", type=Path, default=database_path())
    args = parser.parse_args(argv)
    if not args.database.is_file():
        print(f"Games database is not installed: {args.database}")
        return 0
    with sqlite3.connect(args.database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA synchronous = NORMAL")
        connection.execute("PRAGMA temp_store = MEMORY")
        connection.execute("PRAGMA cache_size = -262144")
        if args.command == "rebuild":
            rebuild(connection, progress=True)
        else:
            changed = ensure_current(connection, progress=True)
            if not changed:
                print("Catalog index is current.", flush=True)
        connection.commit()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
