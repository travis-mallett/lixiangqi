"""Paginated, category-aware queries for the Xiangqi explorer."""

from __future__ import annotations

import re
import sqlite3
from typing import Any

from .catalog_databases import (
    CATALOG_GAME_COLUMNS,
    catalog_database_id,
    installed_catalog_database_paths,
    open_catalog_connection,
)
from .explorer import _game
from .name_romanization import normalized_name_key


SOURCE_SPECS = {
    "m": ("dpxq", "m", "Master Games"),
    "n": ("dpxq", "n", "Online Tournaments"),
    "t": ("dpxq", "t", "Top Games"),
    "k": ("dpxq", "k", "Top Blitz Games"),
    "o": ("dpxq", "o", "Other Games"),
    "b": ("dpxq", "b", "Games Under 24 Moves"),
    "u": ("dpxq", "u", "Player Uploads"),
    "w": ("dpxq", "w", "Unassigned Games"),
    "gd": ("gdchess_01xq", "games", "GDChess/01xq"),
    "xqd": ("xqdao", "games", "XQDao"),
}
SOURCES = frozenset(SOURCE_SPECS)
SOURCE_IDS = {(source, collection): source_id for source_id, (source, collection, _label) in SOURCE_SPECS.items()}
ONLINE_SOURCES = ("n", "t", "k", "o", "b", "u", "w")
SORTS = {
    "source": "source_sort",
    "date": "g.played_at",
    "red": "COALESCE(NULLIF(g.red_name_key, ''), g.red_name)",
    "black": "COALESCE(NULLIF(g.black_name_key, ''), g.black_name)",
    "result": "g.result",
    "event": "g.event COLLATE NOCASE",
    "round": "g.round COLLATE NOCASE",
    "moves": "move_count",
}
CATALOG_ID_PATTERN = re.compile(r"^[a-z0-9:_-]{1,160}$", re.IGNORECASE)


def _integer(value: Any, name: str, minimum: int, maximum: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not minimum <= value <= maximum:
        raise ValueError(f"{name} must be an integer from {minimum} to {maximum}")
    return value


def _collections(value: Any) -> list[str]:
    if value is None:
        return list(SOURCE_SPECS)
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError("sources must be an array of source identifiers")
    selected = list(dict.fromkeys(value))
    invalid = [item for item in selected if item not in SOURCES]
    if invalid:
        raise ValueError(f"unsupported game source: {invalid[0]}")
    return selected


def _search(value: Any) -> str:
    if value in (None, ""):
        return ""
    if not isinstance(value, str):
        raise ValueError("search must be a string")
    normalized = " ".join(value.split())
    if len(normalized) > 100:
        raise ValueError("search cannot exceed 100 characters")
    return normalized


def _source_rows(connection: sqlite3.Connection, game_ids: list[str]) -> dict[str, list[dict[str, str]]]:
    sources = {game_id: [] for game_id in game_ids}
    if not game_ids:
        return sources
    placeholders = ",".join("?" for _ in game_ids)
    rows = connection.execute(
        f"""
        SELECT game_id, source, collection, external_id, source_url
        FROM game_sources
        WHERE (source, collection) IN ({",".join("(?, ?)" for _ in SOURCE_IDS)})
          AND game_id IN ({placeholders})
        ORDER BY game_id, source, collection, CAST(external_id AS INTEGER), external_id
        """,
        (*[value for source_pair in SOURCE_IDS for value in source_pair], *game_ids),
    ).fetchall()
    for row in rows:
        source_id = SOURCE_IDS[(row["source"], row["collection"])]
        sources[row["game_id"]].append(
            {
                "id": source_id,
                "name": SOURCE_SPECS[source_id][2],
                "externalId": row["external_id"],
                "url": row["source_url"],
            }
        )
    return sources


def _display_name(row: sqlite3.Row, color: str) -> str:
    native = row[f"{color}_name"]
    romanized = row[f"{color}_name_romanized"]
    return f"{romanized} ({native})" if romanized else native


def _source_counts(connection: sqlite3.Connection) -> dict[str, int]:
    counts = {source_id: 0 for source_id in SOURCE_SPECS}
    rows = connection.execute(
        f"""
        SELECT source, collection, count(DISTINCT game_id) AS game_count
        FROM game_sources
        WHERE (source, collection) IN ({",".join("(?, ?)" for _ in SOURCE_IDS)})
        GROUP BY source, collection
        """,
        [value for source_pair in SOURCE_IDS for value in source_pair],
    ).fetchall()
    for row in rows:
        counts[SOURCE_IDS[(row["source"], row["collection"])]] = row["game_count"]

    online_specs = [SOURCE_SPECS[source_id] for source_id in ONLINE_SOURCES]
    online_clause = " OR ".join(
        "(source = ? AND collection = ?)" for _ in online_specs
    )
    counts["online"] = connection.execute(
        f"SELECT count(DISTINCT game_id) FROM game_sources WHERE {online_clause}",
        [value for source, collection, _label in online_specs for value in (source, collection)],
    ).fetchone()[0]
    return counts


def query_games(query: dict[str, Any]) -> dict[str, Any]:
    selected = _collections(query.get("sources"))
    search = _search(query.get("search"))
    sort = query.get("sort", "date")
    direction = query.get("direction", "desc")
    if sort not in SORTS:
        raise ValueError(f"unsupported game sort: {sort}")
    if direction not in {"asc", "desc"}:
        raise ValueError("direction must be asc or desc")
    page = _integer(query.get("page", 1), "page", 1, 100_000)
    page_size = _integer(query.get("pageSize", 100), "pageSize", 1, 100)
    if search:
        return _query_games_search(selected, search, sort, direction, page, page_size)

    connection = open_catalog_connection()
    if connection is None:
        return {
            "available": False,
            "total": 0,
            "page": page,
            "pageSize": page_size,
            "games": [],
            "sourceCounts": {**{source_id: 0 for source_id in SOURCE_SPECS}, "online": 0},
            "error": "Games database is not installed",
        }

    try:
        source_counts = _source_counts(connection)
        if not selected:
            return {
                "available": True,
                "total": 0,
                "page": page,
                "pageSize": page_size,
                "games": [],
                "sourceCounts": source_counts,
            }
        selected_specs = [SOURCE_SPECS[source_id] for source_id in selected]
        selected_source_clause = " OR ".join(
            "(selected_source.source = ? AND selected_source.collection = ?)"
            for _ in selected_specs
        )
        clauses = [
            "EXISTS (SELECT 1 FROM game_sources selected_source "
            "WHERE selected_source.game_id = g.id AND "
            f"({selected_source_clause}))"
        ]
        parameters: list[Any] = [
            value for source, collection, _label in selected_specs for value in (source, collection)
        ]
        if search:
            like = f"%{search}%"
            normalized_key = normalized_name_key(search)
            key_like = f"%{normalized_key}%" if normalized_key else "\0"
            clauses.append(
                "("
                "g.red_name LIKE ? OR g.black_name LIKE ? OR "
                "g.red_name_romanized LIKE ? COLLATE NOCASE OR "
                "g.black_name_romanized LIKE ? COLLATE NOCASE OR "
                "g.red_name_key LIKE ? OR g.black_name_key LIKE ? OR "
                "g.event LIKE ? OR g.title LIKE ? OR g.game_class LIKE ? OR "
                "g.group_name LIKE ? OR g.place LIKE ? OR g.opening LIKE ? OR g.round LIKE ?"
                ")"
            )
            parameters.extend(
                (like, like, like, like, key_like, key_like, like, like, like, like, like, like, like)
            )
        where = " AND ".join(clauses)
        total = connection.execute(
            f"SELECT count(*) FROM games g WHERE {where}", parameters
        ).fetchone()[0]
        offset = (page - 1) * page_size
        source_sort = (
            "(SELECT MIN(CASE "
            + " ".join(
                f"WHEN sort_source.source = '{source}' AND sort_source.collection = '{collection}' "
                f"THEN '{source_id}'"
                for source_id, (source, collection, _label) in SOURCE_SPECS.items()
            )
            + " END) FROM game_sources sort_source WHERE sort_source.game_id = g.id)"
        )
        rows = connection.execute(
            f"""
            SELECT g.id, g.red_name, g.red_name_romanized, g.red_rating,
                   g.black_name, g.black_name_romanized, g.black_rating,
                   g.result, g.played_at, g.event, g.round, g.opening,
                   g.game_class, g.group_name, g.place, g.time_rule,
                   g.move_count,
                   {source_sort} AS source_sort
            FROM games g
            WHERE {where}
            ORDER BY {SORTS[sort]} {direction.upper()}, g.id ASC
            LIMIT ? OFFSET ?
            """,
            (*parameters, page_size, offset),
        ).fetchall()
        source_map = _source_rows(connection, [row["id"] for row in rows])
        games = []
        for row in rows:
            games.append(
                {
                    "id": row["id"],
                    "sources": source_map[row["id"]],
                    "red": {
                        "name": _display_name(row, "red"),
                        "nativeName": row["red_name"],
                        "romanizedName": row["red_name_romanized"],
                        "rating": row["red_rating"],
                    },
                    "black": {
                        "name": _display_name(row, "black"),
                        "nativeName": row["black_name"],
                        "romanizedName": row["black_name_romanized"],
                        "rating": row["black_rating"],
                    },
                    "result": row["result"],
                    "playedAt": "" if row["played_at"].startswith("0000") else row["played_at"],
                    "event": row["event"],
                    "round": row["round"],
                    "opening": row["opening"],
                    "class": row["game_class"],
                    "group": row["group_name"],
                    "place": row["place"],
                    "timeRule": row["time_rule"],
                    "moves": row["move_count"],
                }
            )
        return {
            "available": True,
            "total": total,
            "page": page,
            "pageSize": page_size,
            "games": games,
            "sourceCounts": source_counts,
        }
    finally:
        connection.close()


def _query_games_search(
    selected: list[str],
    search: str,
    sort: str,
    direction: str,
    page: int,
    page_size: int,
) -> dict[str, Any]:
    """Search source databases directly instead of warming the full catalog.

    A player link always supplies a search term. Applying that predicate inside
    each source database before cross-source deduplication keeps cold searches
    below the web request timeout.
    """

    paths = installed_catalog_database_paths()
    empty_counts = {**{source_id: 0 for source_id in SOURCE_SPECS}, "online": 0}
    if not paths:
        return {
            "available": False,
            "total": 0,
            "page": page,
            "pageSize": page_size,
            "games": [],
            "sourceCounts": empty_counts,
            "error": "Games database is not installed",
        }
    if not selected:
        return {
            "available": True,
            "total": 0,
            "page": page,
            "pageSize": page_size,
            "games": [],
            "sourceCounts": empty_counts,
        }

    connection = sqlite3.connect(":memory:", timeout=5)
    connection.row_factory = sqlite3.Row
    aliases: list[str] = []
    try:
        for index, path in enumerate(paths):
            alias = f"source_{index}"
            connection.execute(f"ATTACH DATABASE ? AS {_quoted_identifier(alias)}", (str(path.resolve()),))
            aliases.append(alias)

        selected_specs = [SOURCE_SPECS[source_id] for source_id in selected]
        membership = " OR ".join(
            "(s.source = ? AND s.collection = ?)" for _ in selected_specs
        )
        membership_parameters = [
            value for source, collection, _label in selected_specs for value in (source, collection)
        ]
        like = f"%{search}%"
        normalized_key = normalized_name_key(search)
        key_like = f"%{normalized_key}%" if normalized_key else "\0"
        search_parameters = (
            like,
            like,
            like,
            like,
            key_like,
            key_like,
            like,
            like,
            like,
            like,
            like,
            like,
            like,
        )
        search_clause = (
            "(g.red_name LIKE ? OR g.black_name LIKE ? OR "
            "g.red_name_romanized LIKE ? COLLATE NOCASE OR "
            "g.black_name_romanized LIKE ? COLLATE NOCASE OR "
            "g.red_name_key LIKE ? OR g.black_name_key LIKE ? OR "
            "g.event LIKE ? OR g.title LIKE ? OR g.game_class LIKE ? OR "
            "g.group_name LIKE ? OR g.place LIKE ? OR g.opening LIKE ? OR g.round LIKE ?)"
        )
        source_case = " ".join(
            f"WHEN s.source = '{source}' AND s.collection = '{collection}' THEN '{source_id}'"
            for source_id, (source, collection, _label) in SOURCE_SPECS.items()
        )
        columns = ", ".join(f"g.{column}" for column in CATALOG_GAME_COLUMNS)
        raw_parts: list[str] = []
        parameters: list[Any] = []
        for priority, alias in enumerate(aliases):
            quoted = _quoted_identifier(alias)
            raw_parts.append(
                f"""
                SELECT {columns}, json_array_length(g.moves) AS move_count,
                       {priority} AS _catalog_priority, '{alias}' AS _catalog_db,
                       (SELECT MIN(CASE {source_case} END)
                        FROM {quoted}.game_sources s
                        WHERE s.game_id = g.id AND ({membership})) AS source_sort
                FROM {quoted}.games g
                WHERE EXISTS (
                  SELECT 1 FROM {quoted}.game_sources s
                  WHERE s.game_id = g.id AND ({membership})
                )
                  AND {search_clause}
                """
            )
            parameters.extend(membership_parameters)
            parameters.extend(membership_parameters)
            parameters.extend(search_parameters)

        raw = " UNION ALL ".join(raw_parts)
        common = f"""
            WITH raw AS ({raw}),
            ranked AS (
              SELECT *, row_number() OVER (
                PARTITION BY canonical_hash ORDER BY _catalog_priority, id
              ) AS _catalog_rank
              FROM raw
            )
        """
        direct_sorts = {
            "source": "source_sort",
            "date": "played_at",
            "red": "COALESCE(NULLIF(red_name_key, ''), red_name)",
            "black": "COALESCE(NULLIF(black_name_key, ''), black_name)",
            "result": "result",
            "event": "event COLLATE NOCASE",
            "round": "round COLLATE NOCASE",
            "moves": "move_count",
        }
        offset = (page - 1) * page_size
        rows = connection.execute(
            common
            + f"""
              SELECT *, count(*) OVER () AS _catalog_total
              FROM ranked
              WHERE _catalog_rank = 1
              ORDER BY {direct_sorts[sort]} {direction.upper()}, id ASC
              LIMIT ? OFFSET ?
            """,
            (*parameters, page_size, offset),
        ).fetchall()
        total = (
            rows[0]["_catalog_total"]
            if rows
            else (
                connection.execute(
                    common + "SELECT count(*) FROM ranked WHERE _catalog_rank = 1",
                    parameters,
                ).fetchone()[0]
                if page > 1
                else 0
            )
        )

        counts = _attached_source_counts(connection, aliases)
        games = []
        for row in rows:
            sources = _attached_source_rows(connection, row["_catalog_db"], row["id"])
            games.append(
                {
                    "id": row["id"],
                    "sources": sources,
                    "red": {
                        "name": _display_name(row, "red"),
                        "nativeName": row["red_name"],
                        "romanizedName": row["red_name_romanized"],
                        "rating": row["red_rating"],
                    },
                    "black": {
                        "name": _display_name(row, "black"),
                        "nativeName": row["black_name"],
                        "romanizedName": row["black_name_romanized"],
                        "rating": row["black_rating"],
                    },
                    "result": row["result"],
                    "playedAt": "" if row["played_at"].startswith("0000") else row["played_at"],
                    "event": row["event"],
                    "round": row["round"],
                    "opening": row["opening"],
                    "class": row["game_class"],
                    "group": row["group_name"],
                    "place": row["place"],
                    "timeRule": row["time_rule"],
                    "moves": row["move_count"],
                }
            )
        return {
            "available": True,
            "total": total,
            "page": page,
            "pageSize": page_size,
            "games": games,
            "sourceCounts": counts,
        }
    finally:
        connection.close()


def _quoted_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _attached_source_rows(
    connection: sqlite3.Connection, alias: str, game_id: str
) -> list[dict[str, str]]:
    rows = connection.execute(
        f"""
        SELECT source, collection, external_id, source_url
        FROM {_quoted_identifier(alias)}.game_sources
        WHERE game_id = ?
        ORDER BY source, collection, CAST(external_id AS INTEGER), external_id
        """,
        (game_id,),
    ).fetchall()
    sources: list[dict[str, str]] = []
    for row in rows:
        source_id = SOURCE_IDS.get((row["source"], row["collection"]))
        if source_id is not None:
            sources.append(
                {
                    "id": source_id,
                    "name": SOURCE_SPECS[source_id][2],
                    "externalId": row["external_id"],
                    "url": row["source_url"],
                }
            )
    return sources


def _attached_source_counts(
    connection: sqlite3.Connection, aliases: list[str]
) -> dict[str, int]:
    counts = {source_id: 0 for source_id in SOURCE_SPECS}
    online_specs = [SOURCE_SPECS[source_id] for source_id in ONLINE_SOURCES]
    online_clause = " OR ".join("(source = ? AND collection = ?)" for _ in online_specs)
    online_parameters = [
        value for source, collection, _label in online_specs for value in (source, collection)
    ]
    for alias in aliases:
        quoted = _quoted_identifier(alias)
        rows = connection.execute(
            f"""
            SELECT source, collection, count(DISTINCT game_id) AS game_count
            FROM {quoted}.game_sources
            GROUP BY source, collection
            """
        ).fetchall()
        for row in rows:
            source_id = SOURCE_IDS.get((row["source"], row["collection"]))
            if source_id is not None:
                counts[source_id] += row["game_count"]
        counts["online"] = counts.get("online", 0) + connection.execute(
            f"""
            SELECT count(DISTINCT game_id)
            FROM {quoted}.game_sources
            WHERE {online_clause}
            """,
            online_parameters,
        ).fetchone()[0]
    return {**counts, "online": counts.get("online", 0)}


def get_game(query: dict[str, Any]) -> dict[str, Any]:
    game_id = query.get("id")
    if not isinstance(game_id, str) or not CATALOG_ID_PATTERN.fullmatch(game_id):
        raise ValueError("id must be a valid catalog game identifier")

    source_database = query.get("database")
    if source_database is not None:
        game = get_source_game(source_database, game_id)
        if game is None:
            raise ValueError("Catalog game was not found")
        return game

    # Analysis links carry the catalog game's stable native ID. Resolve that
    # indexed row directly before falling back to the deduplicated aggregate
    # view used by catalog browsing.
    for path in installed_catalog_database_paths():
        game = get_source_game(path.name, game_id)
        if game is not None:
            return game

    connection = open_catalog_connection()
    if connection is None:
        raise ValueError("Games database is not installed")

    try:
        locator = connection.execute(
            """
            SELECT _catalog_db, _catalog_original_id
            FROM games g
            WHERE g.id = ?
            """,
            (game_id,),
        ).fetchone()
        if locator is None:
            raise ValueError("Catalog game was not found")
        source_database = locator["_catalog_db"]
        original_id = locator["_catalog_original_id"]
        row = connection.execute(
            f'SELECT g.*, COALESCE(json_extract(g.moves, \'$[0]\'), \'\') AS move '
            f'FROM "{source_database}".games g WHERE g.id = ?',
            (original_id,),
        ).fetchone()
        if row is None:
            raise ValueError("Catalog game was not found")
        notations = [
            notation[0]
            for notation in connection.execute(
                f'SELECT notation FROM "{source_database}".game_positions '
                "WHERE game_id = ? ORDER BY ply",
                (original_id,),
            ).fetchall()
        ]
        game = _game(row, notations)
        game["id"] = game_id
        game["sources"] = _source_rows(connection, [game_id])[game_id]
        return game
    finally:
        connection.close()


def get_source_game(source_database: str, game_id: str) -> dict[str, Any] | None:
    """Load one game directly from the source database recorded by a puzzle.

    Puzzle generation records both the source database filename and its native
    game ID. Resolving that exact row avoids constructing the aggregated catalog
    snapshot on every puzzle request while preserving the complete source game.
    """

    if not isinstance(source_database, str) or not source_database:
        raise ValueError("source database is required")
    if not isinstance(game_id, str) or not CATALOG_ID_PATTERN.fullmatch(game_id):
        raise ValueError("id must be a valid catalog game identifier")

    path = next(
        (
            candidate
            for candidate in installed_catalog_database_paths()
            if catalog_database_id(candidate) == source_database
            or candidate.name == source_database
        ),
        None,
    )
    if path is None:
        return None

    connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True, timeout=3)
    connection.row_factory = sqlite3.Row
    try:
        row = connection.execute(
            "SELECT g.*, COALESCE(json_extract(g.moves, '$[0]'), '') AS move "
            "FROM games g WHERE g.id = ?",
            (game_id,),
        ).fetchone()
        if row is None:
            return None
        notations = [
            notation[0]
            for notation in connection.execute(
                "SELECT notation FROM game_positions WHERE game_id = ? ORDER BY ply",
                (game_id,),
            ).fetchall()
        ]
        game = _game(row, notations)
        game["id"] = game_id
        game["sources"] = _direct_source_rows(connection, game_id)
        return game
    finally:
        connection.close()


def _direct_source_rows(connection: sqlite3.Connection, game_id: str) -> list[dict[str, str]]:
    rows = connection.execute(
        """
        SELECT source, collection, external_id, source_url
        FROM game_sources
        WHERE game_id = ?
        ORDER BY source, collection, CAST(external_id AS INTEGER), external_id
        """,
        (game_id,),
    ).fetchall()
    sources: list[dict[str, str]] = []
    for row in rows:
        source_id = SOURCE_IDS.get((row["source"], row["collection"]))
        if source_id is None:
            continue
        sources.append(
            {
                "id": source_id,
                "name": SOURCE_SPECS[source_id][2],
                "externalId": row["external_id"],
                "url": row["source_url"],
            }
        )
    return sources
