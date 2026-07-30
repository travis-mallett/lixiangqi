"""Write-time opening-explorer projection.

Lichess's explorer does not aggregate raw games for each HTTP request. Its
importers merge compact statistics and bounded game samples into records keyed
by position and time bucket. This module applies the same design to the
authoritative Xiangqi SQLite catalog.
"""

from __future__ import annotations

import argparse
import sqlite3
import time
from pathlib import Path
from typing import Final

from .storage import SCHEMA_PATH, database_path

INDEX_VERSION: Final = 2
HOT_POSITION_GAMES: Final = 8
TOP_GAMES_PER_BUCKET: Final = 4
RECENT_GAMES_PER_BUCKET: Final = 8

DATABASE_IDS: Final = {
    "all": 0,
    "masters": 1,
    "dpxq": 2,
    "gdchess": 3,
    "xqdao": 4,
}
DATABASE_NAMES: Final = {value: key for key, value in DATABASE_IDS.items()}
STAT_PREFIXES: Final = {
    "all": "all",
    "lixiangqi": "all",
    "masters": "masters",
    "dpxq": "dpxq",
    "gdchess": "gdchess",
    "xqdao": "xqdao",
}

ELIGIBLE = "g.statistical_eligible = 1 AND g.record_kind = 'played_game'"
CATEGORY_PREDICATES: Final = {
    "all": "1 = 1",
    "masters": (
        "EXISTS (SELECT 1 FROM game_sources s WHERE s.game_id = g.id "
        "AND s.source = 'dpxq' AND s.collection = 'm')"
    ),
    "dpxq": (
        "EXISTS (SELECT 1 FROM game_sources s WHERE s.game_id = g.id "
        "AND s.source = 'dpxq')"
    ),
    "gdchess": (
        "EXISTS (SELECT 1 FROM game_sources s WHERE s.game_id = g.id "
        "AND s.source = 'gdchess_01xq')"
    ),
    "xqdao": (
        "EXISTS (SELECT 1 FROM game_sources s WHERE s.game_id = g.id "
        "AND s.source = 'xqdao')"
    ),
}


def _metadata(connection: sqlite3.Connection, key: str) -> str | None:
    row = connection.execute(
        "SELECT value FROM metadata WHERE key = ?", (key,)
    ).fetchone()
    return str(row[0]) if row is not None else None


def index_is_current(connection: sqlite3.Connection) -> bool:
    return _metadata(connection, "explorer_index_version") == str(INDEX_VERSION)


def _bump_generation(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        INSERT INTO metadata(key, value) VALUES ('explorer_index_generation', '1')
        ON CONFLICT(key) DO UPDATE
        SET value = CAST(CAST(metadata.value AS INTEGER) + 1 AS TEXT)
        """
    )


def mark_empty_index_current(connection: sqlite3.Connection) -> None:
    connection.execute(
        "INSERT OR REPLACE INTO metadata(key, value) VALUES "
        "('explorer_index_version', ?), ('explorer_hot_position_games', ?)",
        (str(INDEX_VERSION), str(HOT_POSITION_GAMES)),
    )
    _bump_generation(connection)


def _stats_select(position_filter: str = "") -> str:
    condition = f" AND p.position_key = ?" if position_filter else ""
    return f"""
        SELECT ep.id, g.month, p.move, min(p.notation),
               sum(g.result = 1),
               sum(g.result = 0),
               sum(g.result = -1),
               sum((g.result = 1) AND f.masters),
               sum((g.result = 0) AND f.masters),
               sum((g.result = -1) AND f.masters),
               sum((g.result = 1) AND f.dpxq),
               sum((g.result = 0) AND f.dpxq),
               sum((g.result = -1) AND f.dpxq),
               sum((g.result = 1) AND f.gdchess),
               sum((g.result = 0) AND f.gdchess),
               sum((g.result = -1) AND f.gdchess),
               sum((g.result = 1) AND f.xqdao),
               sum((g.result = 0) AND f.xqdao),
               sum((g.result = -1) AND f.xqdao)
        FROM explorer_positions ep
        JOIN game_positions p ON p.position_key = ep.position_key
        JOIN games g ON g.id = p.game_id
        JOIN temp.explorer_source_flags f ON f.game_id = g.id
        WHERE {ELIGIBLE}{condition}
        GROUP BY ep.id, g.month, p.move
    """


def _create_source_flags(
    connection: sqlite3.Connection, position_key: str | None = None
) -> None:
    connection.execute("DROP TABLE IF EXISTS temp.explorer_source_flags")
    connection.execute(
        """
        CREATE TEMP TABLE explorer_source_flags(
          game_id TEXT PRIMARY KEY,
          masters INTEGER NOT NULL,
          dpxq INTEGER NOT NULL,
          gdchess INTEGER NOT NULL,
          xqdao INTEGER NOT NULL
        ) WITHOUT ROWID
        """
    )
    position_join = (
        "JOIN game_positions p ON p.game_id = g.id"
        if position_key is not None
        else ""
    )
    position_condition = (
        "AND p.position_key = ?" if position_key is not None else ""
    )
    connection.execute(
        f"""
        INSERT INTO temp.explorer_source_flags
        SELECT g.id,
               coalesce(max(s.source = 'dpxq' AND s.collection = 'm'), 0),
               coalesce(max(s.source = 'dpxq'), 0),
               coalesce(max(s.source = 'gdchess_01xq'), 0),
               coalesce(max(s.source = 'xqdao'), 0)
        FROM games g {position_join}
        LEFT JOIN game_sources s ON s.game_id = g.id
        WHERE {ELIGIBLE} {position_condition}
        GROUP BY g.id
        """,
        (position_key,) if position_key is not None else (),
    )


def _insert_stats(
    connection: sqlite3.Connection, position_key: str | None = None
) -> None:
    sql = """
        INSERT INTO explorer_stats(
          position_id, month, move, notation,
          all_red, all_draws, all_black,
          masters_red, masters_draws, masters_black,
          dpxq_red, dpxq_draws, dpxq_black,
          gdchess_red, gdchess_draws, gdchess_black,
          xqdao_red, xqdao_draws, xqdao_black
        )
    """ + _stats_select("one" if position_key is not None else "")
    connection.execute(sql, (position_key,) if position_key is not None else ())


def _insert_samples(
    connection: sqlite3.Connection,
    database: str,
    position_key: str | None = None,
) -> None:
    database_id = DATABASE_IDS[database]
    predicate = "1 = 1" if database == "all" else f"f.{database} = 1"
    position_condition = " AND p.position_key = ?" if position_key is not None else ""
    parameters: tuple[object, ...] = (
        (position_key, database_id) if position_key is not None else (database_id,)
    )
    connection.execute(
        f"""
        WITH ranked AS (
          SELECT ep.id AS position_id, g.month, g.id AS game_id, p.move,
                 coalesce(g.red_rating, 0) + coalesce(g.black_rating, 0) AS rating_sum,
                 g.played_at, g.external_id AS sort_id,
                 row_number() OVER (
                   PARTITION BY ep.id, g.month
                   ORDER BY coalesce(g.red_rating, 0) + coalesce(g.black_rating, 0) DESC,
                            g.played_at DESC, g.external_id DESC
                 ) AS top_rank,
                 row_number() OVER (
                   PARTITION BY ep.id, g.month
                   ORDER BY g.played_at DESC, g.external_id DESC
                 ) AS recent_rank
          FROM explorer_positions ep
          JOIN game_positions p ON p.position_key = ep.position_key
          JOIN games g ON g.id = p.game_id
          JOIN temp.explorer_source_flags f ON f.game_id = g.id
          WHERE {ELIGIBLE} AND ({predicate}){position_condition}
        )
        INSERT INTO explorer_samples(
          position_id, database_id, month, game_id, move, rating_sum, played_at, sort_id
        )
        SELECT position_id, ?, month, game_id, move, rating_sum, played_at, sort_id
        FROM ranked
        WHERE top_rank <= {TOP_GAMES_PER_BUCKET}
           OR recent_rank <= {RECENT_GAMES_PER_BUCKET}
        """,
        parameters,
    )


def _insert_membership_markers(connection: sqlite3.Connection) -> None:
    for database, database_id in DATABASE_IDS.items():
        connection.execute(
            f"""
            INSERT OR IGNORE INTO explorer_indexed_games(game_id, database_id)
            SELECT g.id, ? FROM games g
            WHERE {ELIGIBLE} AND ({CATEGORY_PREDICATES[database]})
            """,
            (database_id,),
        )


def rebuild(connection: sqlite3.Connection, *, progress: bool = False) -> None:
    """Rebuild the compact projection from the authoritative raw catalog."""

    started = time.monotonic()

    def report(message: str) -> None:
        if progress:
            print(
                f"Explorer index: {message} ({time.monotonic() - started:.1f}s)",
                flush=True,
            )

    connection.executescript(
        """
        DROP TABLE IF EXISTS explorer_stats;
        DROP TABLE IF EXISTS explorer_samples;
        DROP TABLE IF EXISTS explorer_indexed_games;
        DROP TABLE IF EXISTS explorer_positions;
        """
    )
    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    connection.execute(
        "INSERT OR REPLACE INTO metadata(key, value) "
        "VALUES ('explorer_index_state', 'building')"
    )
    connection.execute("DELETE FROM explorer_stats")
    connection.execute("DELETE FROM explorer_samples")
    connection.execute("DELETE FROM explorer_indexed_games")
    connection.execute("DELETE FROM explorer_positions")
    report("finding shared positions")
    connection.execute(
        f"""
        INSERT INTO explorer_positions(position_key, game_count)
        SELECT p.position_key, count(*)
        FROM game_positions p JOIN games g ON g.id = p.game_id
        WHERE {ELIGIBLE}
        GROUP BY p.position_key
        HAVING count(*) >= ?
        """,
        (HOT_POSITION_GAMES,),
    )
    report("building source membership flags")
    _create_source_flags(connection)
    report("aggregating position statistics")
    _insert_stats(connection)
    for database in DATABASE_IDS:
        report(f"selecting bounded {database} game samples")
        _insert_samples(connection, database)
    report("recording indexed game memberships")
    _insert_membership_markers(connection)
    connection.execute(
        "INSERT OR REPLACE INTO metadata(key, value) VALUES "
        "('explorer_index_version', ?), "
        "('explorer_hot_position_games', ?), "
        "('explorer_index_state', 'ready')",
        (str(INDEX_VERSION), str(HOT_POSITION_GAMES)),
    )
    _bump_generation(connection)
    connection.execute("DROP TABLE IF EXISTS temp.explorer_source_flags")
    report("complete")


def _game_categories(connection: sqlite3.Connection, game_id: str) -> list[str]:
    row = connection.execute(
        f"""
        SELECT {", ".join(
            f"({CATEGORY_PREDICATES[name]}) AS category_{index}"
            for index, name in enumerate(DATABASE_IDS)
        )}
        FROM games g WHERE g.id = ? AND {ELIGIBLE}
        """,
        (game_id,),
    ).fetchone()
    if row is None:
        return []
    return [name for index, name in enumerate(DATABASE_IDS) if row[index]]


def _build_position(
    connection: sqlite3.Connection, position_key: str, game_count: int
) -> None:
    connection.execute(
        """
        INSERT INTO explorer_positions(position_key, game_count) VALUES (?, ?)
        ON CONFLICT(position_key) DO UPDATE SET game_count = excluded.game_count
        """,
        (position_key, game_count),
    )
    position_id = connection.execute(
        "SELECT id FROM explorer_positions WHERE position_key = ?", (position_key,)
    ).fetchone()[0]
    connection.execute(
        "DELETE FROM explorer_stats WHERE position_id = ?", (position_id,)
    )
    connection.execute(
        "DELETE FROM explorer_samples WHERE position_id = ?", (position_id,)
    )
    _create_source_flags(connection, position_key)
    _insert_stats(connection, position_key)
    for database in DATABASE_IDS:
        _insert_samples(connection, database, position_key)
    connection.execute("DROP TABLE IF EXISTS temp.explorer_source_flags")


def _merge_game(
    connection: sqlite3.Connection,
    position_id: int,
    position_key: str,
    database: str,
    game: sqlite3.Row,
) -> None:
    prefix = STAT_PREFIXES[database]
    red = int(game["result"] == 1)
    draws = int(game["result"] == 0)
    black = int(game["result"] == -1)
    connection.execute(
        f"""
        INSERT INTO explorer_stats(
          position_id, month, move, notation,
          {prefix}_red, {prefix}_draws, {prefix}_black
        )
        SELECT ?, g.month, p.move, p.notation, ?, ?, ?
        FROM game_positions p JOIN games g ON g.id = p.game_id
        WHERE p.game_id = ? AND p.position_key = ?
        ON CONFLICT(position_id, month, move) DO UPDATE SET
          notation = min(explorer_stats.notation, excluded.notation),
          {prefix}_red = explorer_stats.{prefix}_red + excluded.{prefix}_red,
          {prefix}_draws = explorer_stats.{prefix}_draws + excluded.{prefix}_draws,
          {prefix}_black = explorer_stats.{prefix}_black + excluded.{prefix}_black
        """,
        (position_id, red, draws, black, game["id"], position_key),
    )
    position = connection.execute(
        "SELECT move FROM game_positions WHERE game_id = ? AND position_key = ?",
        (game["id"], position_key),
    ).fetchone()
    if position is None:
        return
    database_id = DATABASE_IDS[database]
    connection.execute(
        """
        INSERT OR IGNORE INTO explorer_samples(
          position_id, database_id, month, game_id, move, rating_sum, played_at, sort_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            position_id,
            database_id,
            game["month"],
            game["id"],
            position[0],
            int(game["rating_sum"]),
            game["played_at"],
            game["external_id"],
        ),
    )
    connection.execute(
        f"""
        DELETE FROM explorer_samples
        WHERE position_id = ? AND database_id = ? AND month = ?
          AND game_id NOT IN (
            SELECT game_id FROM explorer_samples
            WHERE position_id = ? AND database_id = ? AND month = ?
            ORDER BY rating_sum DESC, played_at DESC, sort_id DESC
            LIMIT {TOP_GAMES_PER_BUCKET}
          )
          AND game_id NOT IN (
            SELECT game_id FROM explorer_samples
            WHERE position_id = ? AND database_id = ? AND month = ?
            ORDER BY played_at DESC, sort_id DESC
            LIMIT {RECENT_GAMES_PER_BUCKET}
          )
        """,
        (
            position_id,
            database_id,
            game["month"],
            position_id,
            database_id,
            game["month"],
            position_id,
            database_id,
            game["month"],
        ),
    )


def update_game(connection: sqlite3.Connection, game_id: str) -> None:
    """Merge one canonical game's newly visible source categories."""

    if not index_is_current(connection):
        return
    connection.row_factory = sqlite3.Row
    game = connection.execute(
        """
        SELECT id, result, month, played_at, external_id,
               coalesce(red_rating, 0) + coalesce(black_rating, 0) AS rating_sum
        FROM games g WHERE id = ? AND statistical_eligible = 1
          AND record_kind = 'played_game'
        """,
        (game_id,),
    ).fetchone()
    if game is None:
        return
    categories = _game_categories(connection, game_id)
    indexed = {
        DATABASE_NAMES[int(row[0])]
        for row in connection.execute(
            "SELECT database_id FROM explorer_indexed_games WHERE game_id = ?",
            (game_id,),
        )
    }
    pending = [category for category in categories if category not in indexed]
    if not pending:
        return

    positions = [
        str(row[0])
        for row in connection.execute(
            "SELECT position_key FROM game_positions WHERE game_id = ?", (game_id,)
        )
    ]
    for position_key in positions:
        hot = connection.execute(
            "SELECT id FROM explorer_positions WHERE position_key = ?",
            (position_key,),
        ).fetchone()
        if hot is None:
            count = connection.execute(
                f"""
                SELECT count(*) FROM (
                  SELECT 1
                  FROM game_positions p JOIN games g ON g.id = p.game_id
                  WHERE p.position_key = ? AND {ELIGIBLE}
                  LIMIT ?
                )
                """,
                (position_key, HOT_POSITION_GAMES),
            ).fetchone()[0]
            if count >= HOT_POSITION_GAMES:
                _build_position(connection, position_key, count)
            continue
        if "all" in pending:
            connection.execute(
                "UPDATE explorer_positions SET game_count = game_count + 1 WHERE id = ?",
                (hot[0],),
            )
        for database in pending:
            _merge_game(connection, int(hot[0]), position_key, database, game)

    connection.executemany(
        "INSERT OR IGNORE INTO explorer_indexed_games(game_id, database_id) VALUES (?, ?)",
        ((game_id, DATABASE_IDS[database]) for database in pending),
    )
    _bump_generation(connection)


def ensure(path: Path, *, progress: bool = False) -> bool:
    """Create or rebuild the projection if the installed index is obsolete."""

    if not path.is_file():
        return False
    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA synchronous = NORMAL")
        connection.execute("PRAGMA temp_store = MEMORY")
        connection.execute("PRAGMA cache_size = -262144")
        if not index_is_current(connection):
            rebuild(connection, progress=progress)
        else:
            connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        connection.commit()
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("ensure", "rebuild"), nargs="?", default="ensure")
    parser.add_argument("--database", type=Path, default=database_path())
    args = parser.parse_args(argv)
    if not args.database.is_file():
        print(f"Explorer database is not installed: {args.database}")
        return 0
    with sqlite3.connect(args.database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA synchronous = NORMAL")
        connection.execute("PRAGMA temp_store = MEMORY")
        connection.execute("PRAGMA cache_size = -262144")
        if args.command == "rebuild" or not index_is_current(connection):
            rebuild(connection, progress=True)
        else:
            connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
            print("Explorer index is current.", flush=True)
        connection.commit()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
