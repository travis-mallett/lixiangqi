"""Read-only Xiangqi opening statistics from the explorer catalog."""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import threading
import time
from collections import OrderedDict
from typing import Any

from .catalog_databases import games_database_path, open_catalog_connection
from .name_romanization import normalized_name_key
from tools.games_database.explorer_index import DATABASE_IDS, STAT_PREFIXES


DATABASES = {
    "masters": (
        "DPXQ Master Games",
        "gs.source = 'dpxq' AND gs.collection = 'm'",
        "https://www.dpxq.com/hldcg/search/list.asp?owner=m",
    ),
    "all": ("All Games", "1 = 1", "/games/database"),
    "dpxq": ("DPXQ", "gs.source = 'dpxq'", "https://www.dpxq.com"),
    "gdchess": (
        "GDChess/01xq",
        "gs.source = 'gdchess_01xq'",
        "http://www.01xq.com/XQData/",
    ),
    "xqdao": ("XQDao", "gs.source = 'xqdao'", "https://www.xqdao.com/dashi/"),
    # Backwards-compatible request names.
    "lixiangqi": ("All Games", "1 = 1", "/games/database"),
    "player": ("Player", "1 = 1", "/games/database"),
    "event": ("Event", "1 = 1", "/games/database"),
}
DATE_PATTERN = re.compile(r"^\d{4}-(?:0[1-9]|1[0-2])$")
RESPONSE_CACHE_CAPACITY = int(os.environ.get("LIXIANGQI_EXPLORER_CACHE", "40000"))
RESPONSE_CACHE_IDLE_SECONDS = 10 * 60
RESPONSE_CACHE_TTL_SECONDS = {"masters": 4 * 60 * 60}
_response_cache: OrderedDict[
    tuple[Any, ...], tuple[float, float, dict[str, Any]]
] = OrderedDict()
_response_cache_lock = threading.Lock()


def position_key(fen: str) -> str:
    """Canonical transposition key: placement plus side to move."""

    return " ".join(fen.split()[:2])


def database_path():
    return games_database_path()


def _month(value: Any, name: str) -> str | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str) or not DATE_PATTERN.fullmatch(value):
        raise ValueError(f"{name} must use YYYY-MM format")
    return value


def _player(value: Any) -> str | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ValueError("player must be a string")
    value = value.strip()
    if not 1 <= len(value) <= 100:
        raise ValueError("player must contain between 1 and 100 characters")
    return value


def _event(value: Any) -> str | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ValueError("event must be a string")
    value = " ".join(value.split())
    if not 1 <= len(value) <= 100:
        raise ValueError("event must contain between 1 and 100 characters")
    return value


def _game(row: sqlite3.Row, notations: list[str] | None = None) -> dict[str, Any]:
    winner = "red" if row["result"] == 1 else "black" if row["result"] == -1 else None
    if notations is None:
        notations = json.loads(row["notations"])

    def player(color: str) -> dict[str, Any]:
        native = row[f"{color}_name"]
        romanized = row[f"{color}_name_romanized"]
        result = {
            "name": f"{romanized} ({native})" if romanized else native,
            "nativeName": native,
            "rating": row[f"{color}_rating"],
        }
        if romanized:
            result["romanizedName"] = romanized
            result["romanization"] = row[f"{color}_name_romanization"]
        optional_fields = {
            "entry": f"{color}_entry",
            "team": f"{color}_team",
            "country": f"{color}_country",
            "level": f"{color}_level",
            "sourceEnglishName": f"{color}_name_english",
            "recordedTime": f"{color}_time",
        }
        for key, column in optional_fields.items():
            if row[column]:
                result[key] = row[column]
        return result

    source_metadata = json.loads(row["metadata_json"] or "{}")
    comments = {
        key.removeprefix("comment"): value
        for key, value in source_metadata.items()
        if key.startswith("comment") and value
    }
    game_metadata = {
        "title": row["title"],
        "event": row["event"],
        "class": row["game_class"],
        "group": row["group_name"],
        "place": row["place"],
        "round": row["round"],
        "table": row["table_name"],
        "gameType": row["game_type"],
        "timeRule": row["time_rule"],
        "opening": row["opening"],
        "endType": row["end_type"],
        "judge": row["judge"],
        "record": row["game_record"],
        "remark": row["remark"],
        "author": row["author"],
        "reference": row["reference"],
        "other": row["other"],
        "addedAt": row["added_at"],
        "editedAt": row["edited_at"],
    }
    game_metadata = {key: value for key, value in game_metadata.items() if value}
    if comments:
        game_metadata["comments"] = comments

    return {
        "id": row["external_id"],
        "move": row["move"],
        "moves": json.loads(row["moves"]),
        "notations": notations,
        "red": player("red"),
        "black": player("black"),
        "winner": winner,
        "year": row["year"],
        "month": row["month"],
        "event": row["event"],
        "metadata": game_metadata,
        "sourceUrl": row["source_url"],
    }


def _cache_get(key: tuple[Any, ...], database: str) -> dict[str, Any] | None:
    now = time.monotonic()
    ttl = RESPONSE_CACHE_TTL_SECONDS.get(database, 2 * 60 * 60)
    with _response_cache_lock:
        cached = _response_cache.get(key)
        if cached is None:
            return None
        created, accessed, response = cached
        if now - created > ttl or now - accessed > RESPONSE_CACHE_IDLE_SECONDS:
            del _response_cache[key]
            return None
        _response_cache[key] = (created, now, response)
        _response_cache.move_to_end(key)
        return response


def _cache_put(key: tuple[Any, ...], response: dict[str, Any]) -> None:
    if RESPONSE_CACHE_CAPACITY <= 0:
        return
    now = time.monotonic()
    with _response_cache_lock:
        _response_cache[key] = (now, now, response)
        _response_cache.move_to_end(key)
        while len(_response_cache) > RESPONSE_CACHE_CAPACITY:
            _response_cache.popitem(last=False)


def _source_url_select(source_predicate: str) -> str:
    return (
        "(SELECT gs.source_url FROM game_sources gs "
        f"WHERE gs.game_id = g.id AND ({source_predicate}) "
        "ORDER BY gs.id LIMIT 1)"
    )


def _game_columns(source_predicate: str, move_expression: str) -> str:
    return f"""
        g.id AS game_id, g.id AS external_id,
        g.red_name, g.black_name, g.red_rating, g.black_rating,
        g.red_name_romanized, g.red_name_romanization,
        g.black_name_romanized, g.black_name_romanization,
        g.red_entry, g.red_team, g.red_country, g.red_level,
        g.red_name_english, g.red_time,
        g.black_entry, g.black_team, g.black_country, g.black_level,
        g.black_name_english, g.black_time,
        g.result, g.year, g.month, g.event, g.round, g.opening,
        g.title, g.game_type, g.game_class, g.group_name, g.place,
        g.time_rule, g.table_name, g.end_type, g.judge,
        g.game_record, g.remark, g.author, g.reference, g.other,
        g.added_at, g.edited_at, g.metadata_json,
        {_source_url_select(source_predicate)} AS source_url,
        g.moves, g.notations, {move_expression} AS move
    """


def _games_from_samples(
    connection: sqlite3.Connection,
    samples: list[sqlite3.Row],
    source_predicate: str,
) -> list[dict[str, Any]]:
    if not samples:
        return []
    values = ", ".join("(?, ?, ?)" for _sample in samples)
    parameters: list[Any] = []
    for index, sample in enumerate(samples):
        parameters.extend((index, sample["game_id"], sample["move"]))
    rows = connection.execute(
        f"""
        WITH selected(ord, game_id, move) AS (VALUES {values})
        SELECT {_game_columns(source_predicate, "selected.move")}
        FROM selected JOIN games g ON g.id = selected.game_id
        ORDER BY selected.ord
        """,
        parameters,
    ).fetchall()
    return [_game(row) for row in rows]


def _indexed_explore(
    connection: sqlite3.Connection,
    *,
    database: str,
    source_predicate: str,
    key: str,
    since: str | None,
    until: str | None,
) -> dict[str, Any] | None:
    if database in {"player", "event"}:
        return None
    prefix = STAT_PREFIXES[database]
    try:
        indexed_position = connection.execute(
            "SELECT id FROM explorer_positions WHERE position_key = ?", (key,)
        ).fetchone()
    except sqlite3.OperationalError:
        return None
    if indexed_position is None:
        return None
    position_id = int(indexed_position[0])
    clauses = ["position_id = ?"]
    parameters: list[Any] = [position_id]
    if since:
        clauses.append("month >= ?")
        parameters.append(since)
    if until:
        clauses.append("month <= ?")
        parameters.append(until)
    where = " AND ".join(clauses)
    rows = connection.execute(
        f"""
        SELECT move, min(notation) AS notation,
               sum({prefix}_red) AS red,
               sum({prefix}_draws) AS draws,
               sum({prefix}_black) AS black,
               sum({prefix}_red + {prefix}_draws + {prefix}_black) AS games,
               sum(sum({prefix}_red)) OVER () AS total_red,
               sum(sum({prefix}_draws)) OVER () AS total_draws,
               sum(sum({prefix}_black)) OVER () AS total_black
        FROM explorer_stats
        WHERE {where}
        GROUP BY move
        HAVING games > 0
        ORDER BY games DESC, move
        LIMIT 30
        """,
        parameters,
    ).fetchall()
    sample_clauses = ["position_id = ?", "database_id = ?"]
    sample_parameters: list[Any] = [position_id, DATABASE_IDS[prefix]]
    if since:
        sample_clauses.append("month >= ?")
        sample_parameters.append(since)
    if until:
        sample_clauses.append("month <= ?")
        sample_parameters.append(until)
    sample_where = " AND ".join(sample_clauses)
    top_rows = connection.execute(
        f"""
        SELECT game_id, move FROM explorer_samples
        WHERE {sample_where}
        ORDER BY rating_sum DESC, played_at DESC, sort_id DESC
        LIMIT 4
        """,
        sample_parameters,
    ).fetchall()
    recent_rows = connection.execute(
        f"""
        SELECT game_id, move FROM explorer_samples
        WHERE {sample_where}
        ORDER BY played_at DESC, sort_id DESC
        LIMIT 8
        """,
        sample_parameters,
    ).fetchall()
    return {
        "red": int(rows[0]["total_red"] or 0) if rows else 0,
        "draws": int(rows[0]["total_draws"] or 0) if rows else 0,
        "black": int(rows[0]["total_black"] or 0) if rows else 0,
        "moves": [
            {
                "move": row["move"],
                "notation": row["notation"] or row["move"],
                "red": row["red"],
                "draws": row["draws"],
                "black": row["black"],
                "games": row["games"],
            }
            for row in rows
        ],
        "topGames": _games_from_samples(connection, top_rows, source_predicate),
        "recentGames": _games_from_samples(connection, recent_rows, source_predicate),
    }


def _raw_explore(
    connection: sqlite3.Connection,
    *,
    database: str,
    source_predicate: str,
    key: str,
    since: str | None,
    until: str | None,
    player: str | None,
    event: str | None,
    color: str,
) -> dict[str, Any]:
    cte = ""
    if player:
        native_column = f"{color}_name"
        romanized_column = f"{color}_name_romanized"
        key_column = f"{color}_name_key"
        cte = f"""
            WITH selected_games(id) AS MATERIALIZED (
              SELECT id FROM games INDEXED BY games_by_{color}
              WHERE {native_column} = ? COLLATE NOCASE
              UNION
              SELECT id FROM games INDEXED BY games_by_{color}_romanized
              WHERE {romanized_column} = ? COLLATE NOCASE
              UNION
              SELECT id FROM games INDEXED BY games_by_{color}_key
              WHERE {key_column} = ?
            )
        """
        from_clause = """
            selected_games selected
            CROSS JOIN games g ON g.id = selected.id
            CROSS JOIN game_positions p
              ON p.game_id = selected.id AND p.position_key = ?
        """
        parameters: list[Any] = [
            player,
            player,
            normalized_name_key(player),
            key,
        ]
        clauses = [
            "g.statistical_eligible = 1",
            "g.record_kind = 'played_game'",
        ]
    elif event:
        cte = """
            WITH selected_games(id) AS MATERIALIZED (
              SELECT id FROM games INDEXED BY games_by_event
              WHERE event = ? COLLATE NOCASE
                AND statistical_eligible = 1
                AND record_kind = 'played_game'
            )
        """
        from_clause = """
            selected_games selected
            CROSS JOIN games g ON g.id = selected.id
            CROSS JOIN game_positions p
              ON p.game_id = selected.id AND p.position_key = ?
        """
        parameters = [event, key]
        clauses = ["1 = 1"]
    else:
        from_clause = "game_positions p JOIN games g ON g.id = p.game_id"
        parameters = [key]
        clauses = [
            "p.position_key = ?",
            "g.statistical_eligible = 1",
            "g.record_kind = 'played_game'",
        ]
    if database not in {"all", "lixiangqi", "player", "event"}:
        clauses.append(
            "EXISTS (SELECT 1 FROM game_sources gs "
            f"WHERE gs.game_id = g.id AND ({source_predicate}))"
        )
    if since:
        clauses.append("g.month >= ?")
        parameters.append(since)
    if until:
        clauses.append("g.month <= ?")
        parameters.append(until)
    where = " AND ".join(clauses)
    rows = connection.execute(
        f"""
        {cte}
        SELECT p.move, min(p.notation) AS notation,
               sum(g.result = 1) AS red, sum(g.result = 0) AS draws,
               sum(g.result = -1) AS black, count(*) AS games,
               sum(sum(g.result = 1)) OVER () AS total_red,
               sum(sum(g.result = 0)) OVER () AS total_draws,
               sum(sum(g.result = -1)) OVER () AS total_black
        FROM {from_clause}
        WHERE {where}
        GROUP BY p.move
        ORDER BY games DESC, p.move
        LIMIT 30
        """,
        parameters,
    ).fetchall()
    game_select = f"""
        {cte}
        SELECT {_game_columns(source_predicate, "p.move")}
        FROM {from_clause}
        WHERE {where}
    """
    top_rows = connection.execute(
        game_select
        + " ORDER BY coalesce(g.red_rating, 0) + coalesce(g.black_rating, 0) DESC, "
        + "g.played_at DESC, g.external_id DESC LIMIT 4",
        parameters,
    ).fetchall()
    recent_rows = connection.execute(
        game_select + " ORDER BY g.played_at DESC, g.external_id DESC LIMIT 8",
        parameters,
    ).fetchall()
    return {
        "red": int(rows[0]["total_red"] or 0) if rows else 0,
        "draws": int(rows[0]["total_draws"] or 0) if rows else 0,
        "black": int(rows[0]["total_black"] or 0) if rows else 0,
        "moves": [
            {
                "move": row["move"],
                "notation": row["notation"] or row["move"],
                "red": row["red"],
                "draws": row["draws"],
                "black": row["black"],
                "games": row["games"],
            }
            for row in rows
        ],
        "topGames": [_game(row) for row in top_rows],
        "recentGames": [_game(row) for row in recent_rows],
    }


def explore_games(fen: str, query: dict[str, Any]) -> dict[str, Any]:
    """Return the Lichess opening-explorer response shape for Xiangqi games."""

    database = query.get("database", "masters")
    if database not in DATABASES:
        raise ValueError(
            "database must be masters, all, dpxq, gdchess, xqdao, player, or event"
        )
    source_name, source_predicate, source_url = DATABASES[database]
    since = _month(query.get("since"), "since")
    until = _month(query.get("until"), "until")
    player = _player(query.get("player")) if database == "player" else None
    event = _event(query.get("event")) if database == "event" else None
    color = query.get("color", "red")
    if color not in {"red", "black"}:
        raise ValueError("color must be red or black")

    db_path = database_path()
    empty = {
        "available": False,
        "database": database,
        "source": source_name,
        "sourceUrl": source_url,
        "fen": fen,
        "red": 0,
        "draws": 0,
        "black": 0,
        "moves": [],
        "topGames": [],
        "recentGames": [],
    }
    if not db_path.is_file():
        empty["error"] = "Explorer database is not installed"
        return empty

    cache_key = (
        str(db_path),
        fen,
        database,
        since,
        until,
        player,
        event,
        color,
    )
    cached = _cache_get(cache_key, database)
    if cached is not None:
        return cached
    connection = open_catalog_connection()
    if connection is None:
        empty["error"] = "Explorer database is not installed"
        return empty
    try:
        key = position_key(fen)
        result = _indexed_explore(
            connection,
            database=database,
            source_predicate=source_predicate,
            key=key,
            since=since,
            until=until,
        )
        if result is None:
            result = _raw_explore(
                connection,
                database=database,
                source_predicate=source_predicate,
                key=key,
                since=since,
                until=until,
                player=player,
                event=event,
                color=color,
            )
        response = {
            **empty,
            "available": True,
            **result,
        }
        _cache_put(cache_key, response)
        return response
    except sqlite3.OperationalError as exc:
        print(f"Xiangqi explorer database error: {exc}", file=sys.stderr)
        empty["error"] = "Explorer database is unavailable"
        return empty
    finally:
        connection.close()
