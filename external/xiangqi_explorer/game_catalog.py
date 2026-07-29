"""Paginated catalog and complete source-aware game queries."""

from __future__ import annotations

import json
import re
import sqlite3
from typing import Any

from .catalog_databases import catalog_database_id, open_catalog_connection
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
SOURCE_IDS = {
    (source, collection): source_id
    for source_id, (source, collection, _label) in SOURCE_SPECS.items()
}
ONLINE_SOURCES = ("n", "t", "k", "o", "b", "u", "w")
CATALOG_ID_PATTERN = re.compile(r"^[a-z0-9:_-]{1,160}$", re.IGNORECASE)

SORTS = {
    "date": "g.played_at",
    "red": "COALESCE(NULLIF(g.red_name_key, ''), g.red_name) COLLATE NOCASE",
    "black": "COALESCE(NULLIF(g.black_name_key, ''), g.black_name) COLLATE NOCASE",
    "result": "g.result",
    "event": "g.event COLLATE NOCASE",
    "round": "g.round COLLATE NOCASE",
    "moves": "json_array_length(g.moves)",
}


def _integer(value: Any, name: str, minimum: int, maximum: int) -> int:
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or not minimum <= value <= maximum
    ):
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


def _source_filter(selected: list[str], alias: str = "selected_source") -> tuple[str, list[str]]:
    specs = [SOURCE_SPECS[source_id] for source_id in selected]
    clause = " OR ".join(
        f"({alias}.source = ? AND {alias}.collection = ?)" for _ in specs
    )
    parameters = [
        value for source, collection, _label in specs for value in (source, collection)
    ]
    return clause or "0", parameters


def _source_rows(
    connection: sqlite3.Connection, game_ids: list[str]
) -> dict[str, list[dict[str, str]]]:
    result = {game_id: [] for game_id in game_ids}
    if not game_ids:
        return result
    placeholders = ",".join("?" for _ in game_ids)
    rows = connection.execute(
        f"""
        SELECT game_id, source, collection, external_id, source_url
        FROM game_sources
        WHERE game_id IN ({placeholders})
        ORDER BY game_id, source, collection, CAST(external_id AS INTEGER), external_id
        """,
        game_ids,
    ).fetchall()
    for row in rows:
        source_id = SOURCE_IDS.get((row["source"], row["collection"]))
        if source_id is None:
            continue
        result[row["game_id"]].append(
            {
                "id": source_id,
                "name": SOURCE_SPECS[source_id][2],
                "externalId": row["external_id"],
                "url": row["source_url"],
            }
        )
    return result


def _source_counts(connection: sqlite3.Connection) -> dict[str, int]:
    counts = {source_id: 0 for source_id in SOURCE_SPECS}
    rows = connection.execute(
        """
        SELECT source, collection, count(DISTINCT game_id) AS game_count
        FROM game_sources
        GROUP BY source, collection
        """
    ).fetchall()
    for row in rows:
        source_id = SOURCE_IDS.get((row["source"], row["collection"]))
        if source_id is not None:
            counts[source_id] = row["game_count"]
    online_clause, parameters = _source_filter(list(ONLINE_SOURCES), "online_source")
    counts["online"] = connection.execute(
        f"""
        SELECT count(DISTINCT game_id) FROM game_sources online_source
        WHERE {online_clause}
        """,
        parameters,
    ).fetchone()[0]
    return counts


def _display_name(row: sqlite3.Row, color: str) -> str:
    native = row[f"{color}_name"]
    romanized = row[f"{color}_name_romanized"]
    return f"{romanized} ({native})" if romanized else native


def _catalog_game(
    row: sqlite3.Row, sources: list[dict[str, str]]
) -> dict[str, Any]:
    return {
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
        "playedAt": row["played_at"],
        "year": row["year"],
        "event": row["event"],
        "round": row["round"],
        "moves": row["move_count"],
    }


def query_games(query: dict[str, Any]) -> dict[str, Any]:
    selected = _collections(query.get("sources"))
    search = _search(query.get("search"))
    sort = query.get("sort", "date")
    direction = query.get("direction", "desc")
    if sort not in {*SORTS, "source"}:
        raise ValueError(f"unsupported game sort: {sort}")
    if direction not in {"asc", "desc"}:
        raise ValueError("direction must be asc or desc")
    page = _integer(query.get("page", 1), "page", 1, 100_000)
    page_size = _integer(query.get("pageSize", 100), "pageSize", 1, 100)

    connection = open_catalog_connection()
    if connection is None:
        return {
            "available": False,
            "total": 0,
            "page": page,
            "pageSize": page_size,
            "games": [],
            "sourceCounts": {
                **{source_id: 0 for source_id in SOURCE_SPECS},
                "online": 0,
            },
            "error": "Games database is not installed",
        }

    try:
        counts = _source_counts(connection)
        if not selected:
            return {
                "available": True,
                "total": 0,
                "page": page,
                "pageSize": page_size,
                "games": [],
                "sourceCounts": counts,
            }
        source_clause, source_parameters = _source_filter(selected)
        clauses = [
            "EXISTS (SELECT 1 FROM game_sources selected_source "
            f"WHERE selected_source.game_id = g.id AND ({source_clause}))"
        ]
        parameters: list[Any] = [*source_parameters]
        if search:
            escaped = (
                search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            )
            pattern = f"%{escaped}%"
            key = normalized_name_key(search)
            clauses.append(
                """
                (
                  g.red_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR
                  g.black_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR
                  g.red_name_romanized LIKE ? ESCAPE '\\' COLLATE NOCASE OR
                  g.black_name_romanized LIKE ? ESCAPE '\\' COLLATE NOCASE OR
                  g.event LIKE ? ESCAPE '\\' COLLATE NOCASE OR
                  g.opening LIKE ? ESCAPE '\\' COLLATE NOCASE OR
                  g.place LIKE ? ESCAPE '\\' COLLATE NOCASE OR
                  g.title LIKE ? ESCAPE '\\' COLLATE NOCASE OR
                  g.red_name_key = ? OR g.black_name_key = ?
                )
                """
            )
            parameters.extend([pattern] * 8 + [key, key])
        where = " AND ".join(clauses)
        total = connection.execute(
            f"SELECT count(*) FROM games g WHERE {where}", parameters
        ).fetchone()[0]
        if sort == "source":
            order = (
                "(SELECT min(CASE "
                + " ".join(
                    f"WHEN sort_source.source = '{source}' "
                    f"AND sort_source.collection = '{collection}' THEN {index}"
                    for index, (_id, (source, collection, _label)) in enumerate(
                        SOURCE_SPECS.items()
                    )
                )
                + " ELSE 999 END) FROM game_sources sort_source "
                "WHERE sort_source.game_id = g.id)"
            )
        else:
            order = SORTS[sort]
        rows = connection.execute(
            f"""
            SELECT g.*, json_array_length(g.moves) AS move_count
            FROM games g
            WHERE {where}
            ORDER BY {order} {direction.upper()}, g.id ASC
            LIMIT ? OFFSET ?
            """,
            (*parameters, page_size, (page - 1) * page_size),
        ).fetchall()
        ids = [row["id"] for row in rows]
        sources = _source_rows(connection, ids)
        return {
            "available": True,
            "total": total,
            "page": page,
            "pageSize": page_size,
            "games": [_catalog_game(row, sources[row["id"]]) for row in rows],
            "sourceCounts": counts,
        }
    finally:
        connection.close()


def _witnesses(connection: sqlite3.Connection, game_id: str) -> list[dict[str, Any]]:
    witnesses: list[dict[str, Any]] = []
    rows = connection.execute(
        """
        SELECT * FROM game_sources
        WHERE game_id = ?
        ORDER BY source, collection, CAST(external_id AS INTEGER), external_id
        """,
        (game_id,),
    ).fetchall()
    for source in rows:
        sets: list[dict[str, Any]] = []
        set_rows = connection.execute(
            "SELECT * FROM annotation_sets WHERE source_record_id = ? ORDER BY id",
            (source["id"],),
        ).fetchall()
        for annotation_set in set_rows:
            annotations = [
                {
                    "id": item["id"],
                    "anchor": item["anchor_kind"],
                    "ply": item["anchor_ply"],
                    "path": item["anchor_path"],
                    "type": item["annotation_type"],
                    "body": item["body"],
                    "payload": json.loads(item["payload_json"] or "{}"),
                    "sourceKey": item["source_key"],
                    "ordinal": item["ordinal"],
                    "translationOf": item["translation_of"],
                    "supersedes": item["supersedes"],
                }
                for item in connection.execute(
                    """
                    SELECT * FROM annotations
                    WHERE annotation_set_id = ?
                    ORDER BY ordinal, id
                    """,
                    (annotation_set["id"],),
                ).fetchall()
            ]
            series = [
                {
                    "type": item["series_type"],
                    "values": json.loads(item["values_json"]),
                    "moves": json.loads(item["moves_json"]),
                    "metadata": json.loads(item["metadata_json"] or "{}"),
                }
                for item in connection.execute(
                    """
                    SELECT * FROM annotation_series
                    WHERE annotation_set_id = ? ORDER BY id
                    """,
                    (annotation_set["id"],),
                ).fetchall()
            ]
            sets.append(
                {
                    "id": annotation_set["id"],
                    "kind": annotation_set["kind"],
                    "annotator": annotation_set["annotator"],
                    "language": annotation_set["language"],
                    "engine": annotation_set["engine"],
                    "engineVersion": annotation_set["engine_version"],
                    "createdAt": annotation_set["created_at"],
                    "license": annotation_set["license"],
                    "metadata": json.loads(annotation_set["metadata_json"] or "{}"),
                    "annotations": annotations,
                    "series": series,
                }
            )
        nodes = [
            {
                "id": node["id"],
                "parentId": node["parent_id"],
                "path": node["path"],
                "ply": node["ply"],
                "move": node["move"],
                "notation": node["notation"],
                "positionKey": node["position_key"],
                "isMainline": bool(node["is_mainline"]),
                "order": node["child_order"],
                "canonicalPly": node["canonical_ply"],
            }
            for node in connection.execute(
                """
                SELECT * FROM source_tree_nodes
                WHERE source_record_id = ?
                ORDER BY ply, child_order, id
                """,
                (source["id"],),
            ).fetchall()
        ]
        witnesses.append(
            {
                "id": source["id"],
                "source": source["source"],
                "collection": source["collection"],
                "collectionName": source["collection_name"],
                "externalId": source["external_id"],
                "url": source["source_url"],
                "editionId": source["edition_id"],
                "metadata": json.loads(source["metadata_json"] or "{}"),
                "parserVersion": source["parser_version"],
                "rawChecksum": source["raw_checksum"],
                "acquiredAt": source["acquired_at"],
                "locator": json.loads(source["locator_json"] or "{}"),
                "matchMethod": source["match_method"],
                "matchConfidence": source["match_confidence"],
                "mainlineHash": (
                    bytes(source["mainline_hash"]).hex()
                    if source["mainline_hash"] is not None
                    else ""
                ),
                "notation": source["notation_text"],
                "annotations": sets,
                "treeNodes": nodes,
            }
        )
    return witnesses


def _complete_game(connection: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    game = _game(row, json.loads(row["notations"]))
    game["id"] = row["id"]
    game["initialFen"] = row["initial_fen"]
    game["recordKind"] = row["record_kind"]
    game["statisticalEligible"] = bool(row["statistical_eligible"])
    game["sources"] = _source_rows(connection, [row["id"]])[row["id"]]
    game["witnesses"] = _witnesses(connection, row["id"])
    game["notation"] = next(
        (
            witness["notation"]
            for witness in game["witnesses"]
            if witness.get("notation")
        ),
        "",
    )
    return game


def _legacy_source_locator(game_id: str) -> tuple[str, str | None, str] | None:
    """Resolve storage identifiers emitted before canonical game IDs were introduced."""

    if game_id.startswith("dpxq_online:"):
        remainder = game_id.removeprefix("dpxq_online:")
        collection, separator, external_id = remainder.partition(":")
        if separator and collection in ONLINE_SOURCES and external_id:
            return "dpxq", collection, external_id
    for prefix, source in (
        ("dpxq:", "dpxq"),
        ("gdchess_01xq:", "gdchess_01xq"),
        ("xqdao:", "xqdao"),
    ):
        if game_id.startswith(prefix):
            external_id = game_id.removeprefix(prefix)
            if external_id:
                return source, None, external_id
    return None


def get_game(query: dict[str, Any]) -> dict[str, Any]:
    game_id = query.get("id")
    if not isinstance(game_id, str) or not CATALOG_ID_PATTERN.fullmatch(game_id):
        raise ValueError("id must be a valid catalog game identifier")
    connection = open_catalog_connection()
    if connection is None:
        raise ValueError("Games database is not installed")
    try:
        row = connection.execute(
            """
            SELECT g.*, COALESCE(json_extract(g.moves, '$[0]'), '') AS move
            FROM games g WHERE g.id = ?
            """,
            (game_id,),
        ).fetchone()
        if row is None:
            requested_source = query.get("database")
            if isinstance(requested_source, str):
                requested_source = catalog_database_id(requested_source)
            source_name = {
                "dpxq": "dpxq",
                "gdchess": "gdchess_01xq",
                "xqdao": "xqdao",
            }.get(requested_source)
            external_id = game_id
            requested_collection: str | None = None
            legacy_locator = _legacy_source_locator(game_id)
            if legacy_locator is not None:
                source_name, requested_collection, external_id = legacy_locator
            parameters: list[Any] = [external_id]
            condition = ""
            if source_name:
                condition = " AND s.source = ?"
                parameters.append(source_name)
            if requested_collection:
                condition += " AND s.collection = ?"
                parameters.append(requested_collection)
            row = connection.execute(
                f"""
                SELECT g.*, COALESCE(json_extract(g.moves, '$[0]'), '') AS move
                FROM game_sources s JOIN games g ON g.id = s.game_id
                WHERE s.external_id = ? {condition}
                ORDER BY s.id LIMIT 1
                """,
                parameters,
            ).fetchone()
        if row is None:
            raise ValueError("Catalog game was not found")
        return _complete_game(connection, row)
    finally:
        connection.close()


def get_source_game(source_database: str, game_id: str) -> dict[str, Any] | None:
    """Compatibility lookup for puzzle records created before catalog unification."""

    if not isinstance(source_database, str) or not source_database:
        raise ValueError("source database is required")
    try:
        return get_game({"id": game_id, "database": source_database})
    except ValueError as error:
        if str(error) == "Catalog game was not found":
            return None
        raise
