"""Paginated catalog and complete source-aware game queries."""

from __future__ import annotations

import json
import re
import sqlite3
import threading
import time
import urllib.parse
from collections import OrderedDict
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from .ancient_manual_localization import is_chinese, localized_value
from .ancient_manual_localization import language as manual_language
from .ancient_manual_localization import manual_title as localize_manual_title
from .ancient_manual_localization import text as localize_manual_text
from .catalog_databases import (
    catalog_database_id,
    games_database_path,
    open_catalog_connection,
)
from .explorer import _game
from .name_romanization import normalized_name_key

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
ONLINE_SOURCES = ("n", "t", "k", "o", "b", "u", "w")
ANCIENT_MANUAL_ROOT = (
    "http://www.dpxq.com/hldcg/share/"
    "chess_%E8%B1%A1%E6%A3%8B%E8%B0%B1%E5%A4%A7%E5%85%A8/"
    "%E8%B1%A1%E6%A3%8B%E8%B0%B1%E5%A4%A7%E5%85%A8-"
    "%E5%8F%A4%E8%B0%B1%E5%85%A8%E5%B1%80/"
)
ANCIENT_MANUALS = (
    ("zichudonglaiwudishou", "自出洞来无敌手", 35),
    ("yicheng", "奕乘", 138),
    ("wushimeihuapu", "吴氏梅花谱", 5),
    ("wushuangpinmeihuapu", "无双品梅花谱", 4),
    ("shilinguangji", "事林广记", 2),
    ("shanqingtang", "善庆堂重订梅花变", 17),
    ("meihuaquan", "梅花泉", 50),
    ("meihuapu", "梅花谱", 31),
    ("meihuabianfa", "梅花变法谱", 12),
    ("juzhongmi", "桔中秘", 51),
    ("jinpengshibabian", "金鹏十八变", 51),
    ("fanmeihuapu", "反梅花谱", 8),
    ("chongbentang", "崇本堂梅花谱", 20),
)
CATALOG_ID_PATTERN = re.compile(r"^[a-z0-9:_-]{1,160}$", re.IGNORECASE)
TIMELINE_UNITS = frozenset(("month", "year", "decade"))
PACIFIC_TIME = ZoneInfo("America/Los_Angeles")
AGGREGATE_CACHE_SECONDS = 60.0
AGGREGATE_CACHE_SIZE = 256

# Timeline queries can scan a large filtered result set. Cache only aggregates,
# not paginated records, and coalesce concurrent misses for the same filter so
# a traffic burst performs one SQLite query.
_aggregate_cache: OrderedDict[tuple[Any, ...], tuple[float, Any]] = OrderedDict()
_aggregate_inflight: dict[tuple[Any, ...], threading.Event] = {}
_aggregate_lock = threading.Lock()

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
    requested = set(value)
    invalid = [item for item in requested if item not in SOURCES]
    if invalid:
        raise ValueError(f"unsupported game source: {invalid[0]}")
    # Canonical ordering gives equivalent source sets one aggregate-cache key.
    return [source_id for source_id in SOURCE_SPECS if source_id in requested]


def _search(value: Any) -> str:
    if value in (None, ""):
        return ""
    if not isinstance(value, str):
        raise ValueError("search must be a string")
    normalized = " ".join(value.split())
    if len(normalized) > 100:
        raise ValueError("search cannot exceed 100 characters")
    return normalized


def _player_name(value: Any) -> str:
    player = _search(value)
    if not player:
        raise ValueError("player must contain between 1 and 100 characters")
    return player


def _event_name(value: Any) -> str:
    event = _search(value)
    if not event:
        raise ValueError("event must contain between 1 and 100 characters")
    return event


def _timeline_unit(value: Any) -> str:
    if value is None:
        return "year"
    if not isinstance(value, str) or value not in TIMELINE_UNITS:
        raise ValueError("timelineUnit must be month, year, or decade")
    return value


def _cached_aggregate(key: tuple[Any, ...], loader: Callable[[], Any]) -> Any:
    while True:
        now = time.monotonic()
        with _aggregate_lock:
            cached = _aggregate_cache.get(key)
            if cached is not None and cached[0] > now:
                _aggregate_cache.move_to_end(key)
                return cached[1]
            if cached is not None:
                del _aggregate_cache[key]

            pending = _aggregate_inflight.get(key)
            if pending is None:
                pending = threading.Event()
                _aggregate_inflight[key] = pending
                break
        pending.wait()

    try:
        value = loader()
    except BaseException:
        with _aggregate_lock:
            _aggregate_inflight.pop(key).set()
        raise

    with _aggregate_lock:
        _aggregate_cache[key] = (
            time.monotonic() + AGGREGATE_CACHE_SECONDS,
            value,
        )
        _aggregate_cache.move_to_end(key)
        while len(_aggregate_cache) > AGGREGATE_CACHE_SIZE:
            _aggregate_cache.popitem(last=False)
        _aggregate_inflight.pop(key).set()
    return value


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


def _game_filter(selected: list[str], search: str) -> tuple[str, list[Any]]:
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
    return " AND ".join(clauses), parameters


def _timeline(
    connection: sqlite3.Connection,
    where: str,
    parameters: list[Any],
    unit: str,
    *,
    cte: str = "",
    from_sql: str = "games g",
) -> dict[str, Any]:
    bucket_sql = {
        "month": """
            CASE
              WHEN length(g.month) = 7
                AND g.month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
                AND CAST(substr(g.month, 1, 4) AS INTEGER) BETWEEN 1 AND 9999
                AND CAST(substr(g.month, 6, 2) AS INTEGER) BETWEEN 1 AND 12
              THEN g.month
            END
        """,
        "year": "CASE WHEN g.year BETWEEN 1 AND 9999 THEN g.year END",
        "decade": """
            CASE
              WHEN g.year BETWEEN 1 AND 9999 THEN (g.year / 10) * 10
            END
        """,
    }[unit]
    rows = connection.execute(
        f"""
        {cte}
        SELECT {bucket_sql} AS bucket, count(*) AS game_count
        FROM {from_sql}
        WHERE {where}
        GROUP BY bucket
        ORDER BY bucket
        """,
        parameters,
    ).fetchall()
    buckets: list[dict[str, Any]] = []
    undated = 0
    for row in rows:
        bucket = row["bucket"]
        count = int(row["game_count"])
        if bucket in (None, ""):
            undated += count
        else:
            buckets.append({"start": str(bucket), "count": count})
    return {"unit": unit, "buckets": buckets, "undated": undated}


def _player_selection(player: str) -> tuple[str, list[str]]:
    key = normalized_name_key(player)
    return (
        """
        WITH matched_sides(id, player_color) AS MATERIALIZED (
          SELECT id, 'red' FROM games INDEXED BY games_by_red
          WHERE red_name = ? COLLATE NOCASE
          UNION
          SELECT id, 'red' FROM games INDEXED BY games_by_red_romanized
          WHERE red_name_romanized = ? COLLATE NOCASE
          UNION
          SELECT id, 'red' FROM games INDEXED BY games_by_red_key
          WHERE red_name_key = ?
          UNION
          SELECT id, 'black' FROM games INDEXED BY games_by_black
          WHERE black_name = ? COLLATE NOCASE
          UNION
          SELECT id, 'black' FROM games INDEXED BY games_by_black_romanized
          WHERE black_name_romanized = ? COLLATE NOCASE
          UNION
          SELECT id, 'black' FROM games INDEXED BY games_by_black_key
          WHERE black_name_key = ?
        ),
        selected_games(id, player_color) AS MATERIALIZED (
          SELECT matched.id, min(matched.player_color)
          FROM matched_sides matched
          JOIN games eligible ON eligible.id = matched.id
          WHERE eligible.statistical_eligible = 1
            AND eligible.record_kind = 'played_game'
          GROUP BY matched.id
        )
        """,
        [player, player, key, player, player, key],
    )


def _player_source_where(selected: list[str]) -> tuple[str, list[str]]:
    source_clause, parameters = _source_filter(selected)
    return (
        "EXISTS (SELECT 1 FROM game_sources selected_source "
        f"WHERE selected_source.game_id = g.id AND ({source_clause}))",
        parameters,
    )


def _relative_outcome(row: sqlite3.Row, prefix: str) -> dict[str, int]:
    return {
        "games": int(row[f"{prefix}_games"] or 0),
        "wins": int(row[f"{prefix}_wins"] or 0),
        "draws": int(row[f"{prefix}_draws"] or 0),
        "losses": int(row[f"{prefix}_losses"] or 0),
    }


def _player_identity(
    connection: sqlite3.Connection,
    cte: str,
    selection_parameters: list[str],
    requested: str,
) -> dict[str, Any] | None:
    row = connection.execute(
        f"""
        {cte}
        SELECT
          CASE selected.player_color
            WHEN 'red' THEN g.red_name ELSE g.black_name
          END AS native_name,
          CASE selected.player_color
            WHEN 'red' THEN g.red_name_romanized ELSE g.black_name_romanized
          END AS romanized_name,
          count(*) AS appearances
        FROM selected_games selected
        JOIN games g ON g.id = selected.id
        GROUP BY 1, 2
        ORDER BY appearances DESC, native_name COLLATE NOCASE
        LIMIT 1
        """,
        selection_parameters,
    ).fetchone()
    if row is None:
        return None
    native = row["native_name"] or requested
    romanized = row["romanized_name"]
    return {
        "query": requested,
        "name": f"{romanized} ({native})" if romanized else native,
        "nativeName": native,
        "romanizedName": romanized,
        "key": normalized_name_key(romanized or native),
    }


def _player_source_counts(
    connection: sqlite3.Connection,
    cte: str,
    selection_parameters: list[str],
) -> dict[str, int]:
    counts = {source_id: 0 for source_id in SOURCE_SPECS}
    rows = connection.execute(
        f"""
        {cte}
        SELECT source.source, source.collection, count(DISTINCT selected.id) AS game_count
        FROM selected_games selected
        JOIN game_sources source ON source.game_id = selected.id
        GROUP BY source.source, source.collection
        """,
        selection_parameters,
    ).fetchall()
    for row in rows:
        source_id = SOURCE_IDS.get((row["source"], row["collection"]))
        if source_id is not None:
            counts[source_id] = int(row["game_count"])
    online_clause, online_parameters = _source_filter(
        list(ONLINE_SOURCES), "online_source"
    )
    counts["online"] = int(
        connection.execute(
            f"""
            {cte}
            SELECT count(DISTINCT selected.id)
            FROM selected_games selected
            JOIN game_sources online_source ON online_source.game_id = selected.id
            WHERE {online_clause}
            """,
            [*selection_parameters, *online_parameters],
        ).fetchone()[0]
    )
    return counts


def _player_summary(
    connection: sqlite3.Connection,
    cte: str,
    selection_parameters: list[str],
    where: str,
    where_parameters: list[str],
) -> dict[str, Any]:
    row = connection.execute(
        f"""
        {cte}
        SELECT
          count(*) AS total_games,
          min(CASE WHEN g.year BETWEEN 1 AND 9999 THEN nullif(g.played_at, '') END) AS first_played_at,
          max(CASE WHEN g.year BETWEEN 1 AND 9999 THEN nullif(g.played_at, '') END) AS last_played_at,
          count(DISTINCT CASE selected.player_color
            WHEN 'red' THEN coalesce(nullif(g.black_name_key, ''), lower(g.black_name))
            ELSE coalesce(nullif(g.red_name_key, ''), lower(g.red_name))
          END) AS opponents,
          count(DISTINCT nullif(g.event, '')) AS events,
          avg(json_array_length(g.moves)) AS average_moves,
          avg(CASE selected.player_color
            WHEN 'red' THEN g.red_rating ELSE g.black_rating
          END) AS average_rating,
          sum(selected.player_color = 'red') AS red_games,
          sum(selected.player_color = 'red' AND g.result = 1) AS red_wins,
          sum(selected.player_color = 'red' AND g.result = 0) AS red_draws,
          sum(selected.player_color = 'red' AND g.result = -1) AS red_losses,
          sum(selected.player_color = 'black') AS black_games,
          sum(selected.player_color = 'black' AND g.result = -1) AS black_wins,
          sum(selected.player_color = 'black' AND g.result = 0) AS black_draws,
          sum(selected.player_color = 'black' AND g.result = 1) AS black_losses,
          sum((selected.player_color = 'red' AND g.result = 1)
            OR (selected.player_color = 'black' AND g.result = -1)) AS overall_wins,
          sum(g.result = 0) AS overall_draws,
          sum((selected.player_color = 'red' AND g.result = -1)
            OR (selected.player_color = 'black' AND g.result = 1)) AS overall_losses
        FROM selected_games selected
        JOIN games g ON g.id = selected.id
        WHERE {where}
        """,
        [*selection_parameters, *where_parameters],
    ).fetchone()
    assert row is not None
    total = int(row["total_games"] or 0)
    overall = {
        "games": total,
        "wins": int(row["overall_wins"] or 0),
        "draws": int(row["overall_draws"] or 0),
        "losses": int(row["overall_losses"] or 0),
    }
    opponents = connection.execute(
        f"""
        {cte}
        SELECT
          CASE selected.player_color
            WHEN 'red' THEN g.black_name ELSE g.red_name
          END AS native_name,
          CASE selected.player_color
            WHEN 'red' THEN g.black_name_romanized ELSE g.red_name_romanized
          END AS romanized_name,
          count(*) AS games,
          sum((selected.player_color = 'red' AND g.result = 1)
            OR (selected.player_color = 'black' AND g.result = -1)) AS wins,
          sum(g.result = 0) AS draws,
          sum((selected.player_color = 'red' AND g.result = -1)
            OR (selected.player_color = 'black' AND g.result = 1)) AS losses
        FROM selected_games selected
        JOIN games g ON g.id = selected.id
        WHERE {where}
        GROUP BY 1, 2
        ORDER BY games DESC, native_name COLLATE NOCASE
        LIMIT 8
        """,
        [*selection_parameters, *where_parameters],
    ).fetchall()
    openings = connection.execute(
        f"""
        {cte}
        SELECT g.opening AS name, count(*) AS games
        FROM selected_games selected
        JOIN games g ON g.id = selected.id
        WHERE {where} AND trim(g.opening) <> ''
        GROUP BY g.opening
        ORDER BY games DESC, name COLLATE NOCASE
        LIMIT 8
        """,
        [*selection_parameters, *where_parameters],
    ).fetchall()
    return {
        "totalGames": total,
        "firstPlayedAt": row["first_played_at"],
        "lastPlayedAt": row["last_played_at"],
        "opponents": int(row["opponents"] or 0),
        "events": int(row["events"] or 0),
        "averageMoves": round(float(row["average_moves"]), 1)
        if row["average_moves"] is not None
        else None,
        "averageRating": round(float(row["average_rating"]))
        if row["average_rating"] is not None
        else None,
        "overall": overall,
        "red": _relative_outcome(row, "red"),
        "black": _relative_outcome(row, "black"),
        "topOpponents": [
            {
                "name": (
                    f"{opponent['romanized_name']} ({opponent['native_name']})"
                    if opponent["romanized_name"]
                    else opponent["native_name"]
                ),
                "nativeName": opponent["native_name"],
                "romanizedName": opponent["romanized_name"],
                "games": int(opponent["games"]),
                "wins": int(opponent["wins"] or 0),
                "draws": int(opponent["draws"] or 0),
                "losses": int(opponent["losses"] or 0),
            }
            for opponent in opponents
        ],
        "topOpenings": [
            {"name": opening["name"], "games": int(opening["games"])}
            for opening in openings
        ],
    }


def _event_selection(event: str) -> tuple[str, list[str]]:
    return (
        """
        WITH selected_games(id) AS MATERIALIZED (
          SELECT id FROM games INDEXED BY games_by_event
          WHERE event = ? COLLATE NOCASE
            AND statistical_eligible = 1
            AND record_kind = 'played_game'
        )
        """,
        [event],
    )


def _event_identity(
    connection: sqlite3.Connection,
    cte: str,
    selection_parameters: list[str],
    requested: str,
) -> dict[str, str] | None:
    row = connection.execute(
        f"""
        {cte}
        SELECT g.event AS name, count(*) AS games
        FROM selected_games selected
        JOIN games g ON g.id = selected.id
        GROUP BY g.event
        ORDER BY games DESC, name COLLATE NOCASE
        LIMIT 1
        """,
        selection_parameters,
    ).fetchone()
    if row is None:
        return None
    return {"query": requested, "name": row["name"]}


def _event_source_counts(
    connection: sqlite3.Connection,
    cte: str,
    selection_parameters: list[str],
) -> dict[str, int]:
    counts = {source_id: 0 for source_id in SOURCE_SPECS}
    rows = connection.execute(
        f"""
        {cte}
        SELECT source.source, source.collection, count(DISTINCT selected.id) AS game_count
        FROM selected_games selected
        JOIN game_sources source ON source.game_id = selected.id
        GROUP BY source.source, source.collection
        """,
        selection_parameters,
    ).fetchall()
    for row in rows:
        source_id = SOURCE_IDS.get((row["source"], row["collection"]))
        if source_id is not None:
            counts[source_id] = int(row["game_count"])
    online_clause, online_parameters = _source_filter(
        list(ONLINE_SOURCES), "online_source"
    )
    counts["online"] = int(
        connection.execute(
            f"""
            {cte}
            SELECT count(DISTINCT selected.id)
            FROM selected_games selected
            JOIN game_sources online_source ON online_source.game_id = selected.id
            WHERE {online_clause}
            """,
            [*selection_parameters, *online_parameters],
        ).fetchone()[0]
    )
    return counts


def _event_summary(
    connection: sqlite3.Connection,
    cte: str,
    selection_parameters: list[str],
    where: str,
    where_parameters: list[str],
) -> dict[str, Any]:
    parameters = [*selection_parameters, *where_parameters]
    row = connection.execute(
        f"""
        {cte}
        SELECT
          count(*) AS total_games,
          min(CASE WHEN g.year BETWEEN 1 AND 9999 THEN nullif(g.played_at, '') END) AS first_played_at,
          max(CASE WHEN g.year BETWEEN 1 AND 9999 THEN nullif(g.played_at, '') END) AS last_played_at,
          count(DISTINCT nullif(trim(g.round), '')) AS rounds,
          count(DISTINCT nullif(trim(g.opening), '')) AS recorded_openings,
          avg(json_array_length(g.moves)) AS average_moves,
          sum(g.result = 1) AS red_wins,
          sum(g.result = 0) AS draws,
          sum(g.result = -1) AS black_wins
        FROM selected_games selected
        JOIN games g ON g.id = selected.id
        WHERE {where}
        """,
        parameters,
    ).fetchone()
    assert row is not None
    players = connection.execute(
        f"""
        {cte},
        appearances(identity_key) AS (
          SELECT coalesce(nullif(g.red_name_key, ''), lower(g.red_name))
          FROM selected_games selected JOIN games g ON g.id = selected.id
          WHERE {where}
          UNION
          SELECT coalesce(nullif(g.black_name_key, ''), lower(g.black_name))
          FROM selected_games selected JOIN games g ON g.id = selected.id
          WHERE {where}
        )
        SELECT count(*) FROM appearances
        """,
        [*parameters, *where_parameters],
    ).fetchone()[0]
    standings_rows = connection.execute(
        f"""
        {cte},
        appearances(
          identity_key, native_name, romanized_name, rating, color, result
        ) AS (
          SELECT
            coalesce(nullif(g.red_name_key, ''), lower(g.red_name)),
            g.red_name, g.red_name_romanized, g.red_rating, 'red', g.result
          FROM selected_games selected JOIN games g ON g.id = selected.id
          WHERE {where}
          UNION ALL
          SELECT
            coalesce(nullif(g.black_name_key, ''), lower(g.black_name)),
            g.black_name, g.black_name_romanized, g.black_rating, 'black', g.result
          FROM selected_games selected JOIN games g ON g.id = selected.id
          WHERE {where}
        )
        SELECT
          identity_key,
          max(native_name) AS native_name,
          max(romanized_name) AS romanized_name,
          count(*) AS games,
          sum((color = 'red' AND result = 1)
            OR (color = 'black' AND result = -1)) AS wins,
          sum(result = 0) AS draws,
          sum((color = 'red' AND result = -1)
            OR (color = 'black' AND result = 1)) AS losses,
          sum(color = 'red') AS red_games,
          sum(color = 'black') AS black_games,
          avg(rating) AS average_rating
        FROM appearances
        GROUP BY identity_key
        ORDER BY (2 * wins + draws) DESC, wins DESC, games DESC,
                 native_name COLLATE NOCASE
        """,
        [*parameters, *where_parameters],
    ).fetchall()
    standings = []
    previous_key: tuple[int, int] | None = None
    rank = 0
    for index, standing in enumerate(standings_rows, start=1):
        wins = int(standing["wins"] or 0)
        draws = int(standing["draws"] or 0)
        score = 2 * wins + draws
        ranking_key = (score, wins)
        if ranking_key != previous_key:
            rank = index
            previous_key = ranking_key
        native = standing["native_name"]
        romanized = standing["romanized_name"]
        standings.append(
            {
                "rank": rank,
                "name": f"{romanized} ({native})" if romanized else native,
                "nativeName": native,
                "romanizedName": romanized,
                "games": int(standing["games"]),
                "wins": wins,
                "draws": draws,
                "losses": int(standing["losses"] or 0),
                "score": score,
                "redGames": int(standing["red_games"] or 0),
                "blackGames": int(standing["black_games"] or 0),
                "averageRating": (
                    round(float(standing["average_rating"]))
                    if standing["average_rating"] is not None
                    else None
                ),
            }
        )
    openings = connection.execute(
        f"""
        {cte}
        SELECT g.opening AS name, count(*) AS games
        FROM selected_games selected
        JOIN games g ON g.id = selected.id
        WHERE {where} AND trim(g.opening) <> ''
        GROUP BY g.opening
        ORDER BY games DESC, name COLLATE NOCASE
        LIMIT 12
        """,
        parameters,
    ).fetchall()
    places = connection.execute(
        f"""
        {cte}
        SELECT g.place AS name, count(*) AS games
        FROM selected_games selected
        JOIN games g ON g.id = selected.id
        WHERE {where} AND trim(g.place) <> ''
        GROUP BY g.place
        ORDER BY games DESC, name COLLATE NOCASE
        LIMIT 5
        """,
        parameters,
    ).fetchall()
    return {
        "totalGames": int(row["total_games"] or 0),
        "firstPlayedAt": row["first_played_at"],
        "lastPlayedAt": row["last_played_at"],
        "players": int(players or 0),
        "rounds": int(row["rounds"] or 0),
        "averageMoves": (
            round(float(row["average_moves"]), 1)
            if row["average_moves"] is not None
            else None
        ),
        "recordedOpenings": int(row["recorded_openings"] or 0),
        "redWins": int(row["red_wins"] or 0),
        "draws": int(row["draws"] or 0),
        "blackWins": int(row["black_wins"] or 0),
        "standings": standings,
        "topOpenings": [
            {"name": opening["name"], "games": int(opening["games"])}
            for opening in openings
        ],
        "places": [
            {"name": place["name"], "games": int(place["games"])}
            for place in places
        ],
    }


def _round_sort_key(label: str) -> tuple[Any, ...]:
    if not label:
        return (2, "")
    parts = re.split(r"(\d+)", label.casefold())
    return (0, *(int(part) if part.isdigit() else part for part in parts))


def query_event(query: dict[str, Any]) -> dict[str, Any]:
    event = _event_name(query.get("event"))
    selected = _collections(query.get("sources"))
    empty_counts = {
        **{source_id: 0 for source_id in SOURCE_SPECS},
        "online": 0,
    }
    connection = open_catalog_connection()
    if connection is None:
        return {
            "available": False,
            "event": None,
            "summary": None,
            "rounds": [],
            "sourceCounts": empty_counts,
            "error": "Games database is not installed",
        }
    try:
        cte, selection_parameters = _event_selection(event)
        database_key = str(games_database_path())
        identity = _cached_aggregate(
            (database_key, "event-identity", event.casefold()),
            lambda: _event_identity(
                connection, cte, selection_parameters, requested=event
            ),
        )
        source_counts = _cached_aggregate(
            (database_key, "event-source-counts", event.casefold()),
            lambda: _event_source_counts(connection, cte, selection_parameters),
        )
        if identity is None or not selected:
            return {
                "available": True,
                "event": identity,
                "summary": None,
                "rounds": [],
                "sourceCounts": source_counts,
            }
        where, where_parameters = _player_source_where(selected)
        aggregate_key = (
            database_key,
            "event-profile",
            identity["name"].casefold(),
            tuple(selected),
        )
        summary = _cached_aggregate(
            (*aggregate_key, "summary"),
            lambda: _event_summary(
                connection,
                cte,
                selection_parameters,
                where,
                where_parameters,
            ),
        )
        rows = connection.execute(
            f"""
            {cte}
            SELECT g.*, json_array_length(g.moves) AS move_count
            FROM selected_games selected
            JOIN games g ON g.id = selected.id
            WHERE {where}
            ORDER BY g.played_at ASC, g.round COLLATE NOCASE ASC, g.id ASC
            """,
            [*selection_parameters, *where_parameters],
        ).fetchall()
        ids = [row["id"] for row in rows]
        sources = _source_rows(connection, ids)
        grouped: dict[str, dict[str, Any]] = {}
        for row in rows:
            label = row["round"].strip()
            key = label.casefold()
            round_data = grouped.setdefault(
                key,
                {
                    "name": label,
                    "dates": [],
                    "games": [],
                },
            )
            played_at = row["played_at"]
            if (
                played_at
                and row["year"]
                and played_at not in round_data["dates"]
            ):
                round_data["dates"].append(played_at)
            round_data["games"].append(_catalog_game(row, sources[row["id"]]))
        rounds = sorted(
            grouped.values(),
            key=lambda round_data: _round_sort_key(round_data["name"]),
        )
        return {
            "available": True,
            "event": identity,
            "summary": summary,
            "rounds": rounds,
            "sourceCounts": source_counts,
        }
    finally:
        connection.close()


def _pacific_week(now: datetime | None = None) -> tuple[datetime, datetime]:
    now = (now or datetime.now(PACIFIC_TIME)).astimezone(PACIFIC_TIME)
    days_since_sunday = (now.weekday() + 1) % 7
    start = (now - timedelta(days=days_since_sunday)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    # Re-resolve both local midnights through ZoneInfo so spring and autumn
    # daylight-saving transitions produce 167- and 169-hour UTC weeks.
    end = datetime.combine(
        start.date() + timedelta(days=7),
        datetime.min.time(),
        tzinfo=PACIFIC_TIME,
    )
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def _weekly_growth(connection: sqlite3.Connection) -> dict[str, Any]:
    start_utc, end_utc = _pacific_week()
    try:
        row = connection.execute(
            """
            SELECT COALESCE(sum(games_added), 0)
            FROM catalog_growth_hourly
            WHERE bucket >= ? AND bucket < ?
            """,
            (
                start_utc.strftime("%Y-%m-%dT%H:00:00Z"),
                end_utc.strftime("%Y-%m-%dT%H:00:00Z"),
            ),
        ).fetchone()
        count = int(row[0])
    except sqlite3.OperationalError as error:
        if "no such table" not in str(error):
            raise
        # An existing deployment starts at zero until its next writer runs the
        # shared schema upgrade and installs the trigger.
        count = 0
    return {
        "count": count,
        "startsAt": start_utc.isoformat().replace("+00:00", "Z"),
        "endsAt": end_utc.isoformat().replace("+00:00", "Z"),
        "timeZone": str(PACIFIC_TIME),
    }


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


def query_ancient_manuals(_query: dict[str, Any]) -> dict[str, Any]:
    locale = manual_language(_query)
    manuals = [
        {
            "slug": slug,
            "title": localize_manual_title(slug, title, locale),
            "nativeTitle": title,
            "order": order,
            "expectedGames": expected_games,
            "gameCount": 0,
            "sourceUrl": urllib.parse.urljoin(
                ANCIENT_MANUAL_ROOT, urllib.parse.quote(title, safe="") + "/"
            ),
            "chapters": [],
        }
        for order, (slug, title, expected_games) in enumerate(
            ANCIENT_MANUALS, start=1
        )
    ]
    manuals_by_slug = {str(manual["slug"]): manual for manual in manuals}
    chapters_by_manual: dict[str, dict[str, dict[str, Any]]] = {
        slug: {} for slug in manuals_by_slug
    }
    connection = open_catalog_connection()
    if connection is None:
        return {"available": False, "totalGames": 0, "manuals": manuals}
    try:
        rows = connection.execute(
            """
            SELECT
              source.external_id,
              source.source_url,
              source.metadata_json,
              source.locator_json,
              game.id AS game_id,
              game.title,
              game.initial_fen,
              game.moves
            FROM game_sources source
            JOIN games game ON game.id = source.game_id
            WHERE source.source = 'dpxq'
              AND source.collection = 'ancient_manuals'
            ORDER BY source.id
            """
        ).fetchall()
    finally:
        connection.close()

    for row in rows:
        try:
            metadata = json.loads(row["metadata_json"] or "{}")
        except (TypeError, json.JSONDecodeError):
            metadata = {}
        try:
            locator = json.loads(row["locator_json"] or "{}")
        except (TypeError, json.JSONDecodeError):
            locator = {}
        manual_slug = str(
            locator.get("manualSlug")
            or metadata.get("manualSlug")
            or str(row["external_id"]).partition(":")[0]
        )
        manual = manuals_by_slug.get(manual_slug)
        if manual is None:
            continue
        chapter_title = str(
            locator.get("chapter")
            or metadata.get("chapter")
            or metadata.get("round")
            or "Uncategorized"
        ).strip()
        chapter_title = chapter_title or "Uncategorized"
        chapter = chapters_by_manual[manual_slug].get(chapter_title)
        if chapter is None:
            raw_chapter_order = locator.get("chapterOrder") or metadata.get(
                "chapterOrder"
            )
            chapter_order = (
                int(raw_chapter_order)
                if isinstance(raw_chapter_order, int) and raw_chapter_order > 0
                else 2**31
            )
            chapter = {
                "title": localize_manual_text("chapters", chapter_title, locale),
                "nativeTitle": chapter_title,
                "order": chapter_order,
                "sourceUrl": str(
                    locator.get("chapterUrl")
                    or metadata.get("chapterUrl")
                    or ""
                ),
                "games": [],
            }
            chapters_by_manual[manual_slug][chapter_title] = chapter
            manual["chapters"].append(chapter)
        raw_game_order = locator.get("gameOrder") or metadata.get("gameOrder")
        game_order = (
            int(raw_game_order)
            if isinstance(raw_game_order, int) and raw_game_order > 0
            else 2**31
        )
        try:
            moves = [
                str(move)
                for move in json.loads(row["moves"] or "[]")
                if isinstance(move, str)
            ]
        except (TypeError, json.JSONDecodeError):
            moves = []
        chapter["games"].append(
            {
                "id": str(row["game_id"]),
                "externalId": str(row["external_id"]),
                "title": localize_manual_text(
                    "games",
                    str(row["title"] or row["external_id"]),
                    locale,
                ),
                "nativeTitle": str(row["title"] or row["external_id"]),
                "order": game_order,
                "sourceUrl": str(row["source_url"] or ""),
                "initialFen": str(row["initial_fen"] or ""),
                "moves": moves,
            }
        )
        manual["gameCount"] = int(manual["gameCount"]) + 1

    for manual in manuals:
        manual["chapters"].sort(
            key=lambda chapter: (chapter["order"], chapter["title"])
        )
        for chapter in manual["chapters"]:
            chapter["games"].sort(
                key=lambda game: (game["order"], game["externalId"])
            )
    return {
        "available": True,
        "totalGames": sum(int(manual["gameCount"]) for manual in manuals),
        "manuals": manuals,
    }


def query_games(query: dict[str, Any]) -> dict[str, Any]:
    selected = _collections(query.get("sources"))
    search = _search(query.get("search"))
    timeline_unit = _timeline_unit(query.get("timelineUnit"))
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
            "totalUniqueGames": 0,
            "sourceCounts": {
                **{source_id: 0 for source_id in SOURCE_SPECS},
                "online": 0,
            },
            "timeline": {
                "unit": timeline_unit,
                "buckets": [],
                "undated": 0,
            },
            "weeklyAdded": {
                "count": 0,
                "startsAt": "",
                "endsAt": "",
                "timeZone": str(PACIFIC_TIME),
            },
            "error": "Games database is not installed",
        }

    try:
        database_key = str(games_database_path())
        counts = _cached_aggregate(
            (database_key, "source-counts"),
            lambda: _source_counts(connection),
        )
        total_unique_games = _cached_aggregate(
            (database_key, "total-unique-games"),
            lambda: int(connection.execute("SELECT count(*) FROM games").fetchone()[0]),
        )
        weekly_added = _weekly_growth(connection)
        if not selected:
            return {
                "available": True,
                "total": 0,
                "page": page,
                "pageSize": page_size,
                "games": [],
                "totalUniqueGames": total_unique_games,
                "sourceCounts": counts,
                "timeline": {
                    "unit": timeline_unit,
                    "buckets": [],
                    "undated": 0,
                },
                "weeklyAdded": weekly_added,
            }
        where, parameters = _game_filter(selected, search)
        timeline = _cached_aggregate(
            (
                database_key,
                "timeline",
                tuple(selected),
                search,
                timeline_unit,
            ),
            lambda: _timeline(connection, where, parameters, timeline_unit),
        )
        total = timeline["undated"] + sum(
            bucket["count"] for bucket in timeline["buckets"]
        )
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
            "totalUniqueGames": total_unique_games,
            "sourceCounts": counts,
            "timeline": timeline,
            "weeklyAdded": weekly_added,
        }
    finally:
        connection.close()


def query_player(query: dict[str, Any]) -> dict[str, Any]:
    player = _player_name(query.get("player"))
    selected = _collections(query.get("sources"))
    timeline_unit = _timeline_unit(query.get("timelineUnit"))
    sort = query.get("sort", "date")
    direction = query.get("direction", "desc")
    if sort not in {*SORTS, "source"}:
        raise ValueError(f"unsupported game sort: {sort}")
    if direction not in {"asc", "desc"}:
        raise ValueError("direction must be asc or desc")
    page = _integer(query.get("page", 1), "page", 1, 100_000)
    page_size = _integer(query.get("pageSize", 100), "pageSize", 1, 100)
    empty_counts = {
        **{source_id: 0 for source_id in SOURCE_SPECS},
        "online": 0,
    }

    connection = open_catalog_connection()
    if connection is None:
        return {
            "available": False,
            "player": None,
            "summary": None,
            "total": 0,
            "page": page,
            "pageSize": page_size,
            "games": [],
            "sourceCounts": empty_counts,
            "timeline": {"unit": timeline_unit, "buckets": [], "undated": 0},
            "error": "Games database is not installed",
        }

    try:
        cte, selection_parameters = _player_selection(player)
        database_key = str(games_database_path())
        identity = _cached_aggregate(
            (database_key, "player-identity", normalized_name_key(player)),
            lambda: _player_identity(
                connection, cte, selection_parameters, requested=player
            ),
        )
        source_counts = _cached_aggregate(
            (database_key, "player-source-counts", normalized_name_key(player)),
            lambda: _player_source_counts(connection, cte, selection_parameters),
        )
        if identity is None or not selected:
            return {
                "available": True,
                "player": identity,
                "summary": None,
                "total": 0,
                "page": page,
                "pageSize": page_size,
                "games": [],
                "sourceCounts": source_counts,
                "timeline": {
                    "unit": timeline_unit,
                    "buckets": [],
                    "undated": 0,
                },
            }

        where, where_parameters = _player_source_where(selected)
        aggregate_key = (
            database_key,
            "player-profile",
            identity["key"],
            tuple(selected),
            timeline_unit,
        )
        summary = _cached_aggregate(
            (*aggregate_key, "summary"),
            lambda: _player_summary(
                connection,
                cte,
                selection_parameters,
                where,
                where_parameters,
            ),
        )
        timeline = _cached_aggregate(
            (*aggregate_key, "timeline"),
            lambda: _timeline(
                connection,
                where,
                [*selection_parameters, *where_parameters],
                timeline_unit,
                cte=cte,
                from_sql=(
                    "selected_games selected "
                    "JOIN games g ON g.id = selected.id"
                ),
            ),
        )
        total = int(summary["totalGames"])
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
            {cte}
            SELECT g.*, selected.player_color,
                   json_array_length(g.moves) AS move_count
            FROM selected_games selected
            JOIN games g ON g.id = selected.id
            WHERE {where}
            ORDER BY {order} {direction.upper()}, g.id ASC
            LIMIT ? OFFSET ?
            """,
            [
                *selection_parameters,
                *where_parameters,
                page_size,
                (page - 1) * page_size,
            ],
        ).fetchall()
        ids = [row["id"] for row in rows]
        sources = _source_rows(connection, ids)
        games = []
        for row in rows:
            game = _catalog_game(row, sources[row["id"]])
            game["playerColor"] = row["player_color"]
            games.append(game)
        return {
            "available": True,
            "player": identity,
            "summary": summary,
            "total": total,
            "page": page,
            "pageSize": page_size,
            "games": games,
            "sourceCounts": source_counts,
            "timeline": timeline,
        }
    finally:
        connection.close()


def _witnesses(
    connection: sqlite3.Connection,
    game_id: str,
    locale: str = "zh",
) -> list[dict[str, Any]]:
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
        localized_manual = (
            source["source"] == "dpxq"
            and source["collection"] == "ancient_manuals"
            and not is_chinese(locale)
        )
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
                    "body": (
                        localize_manual_text("annotations", item["body"], locale)
                        if localized_manual
                        else item["body"]
                    ),
                    "payload": json.loads(item["payload_json"] or "{}"),
                    "sourceKey": item["source_key"],
                    "ordinal": item["ordinal"],
                    "translationOf": (
                        item["id"] if localized_manual else item["translation_of"]
                    ),
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
            layer_metadata = json.loads(annotation_set["metadata_json"] or "{}")
            if localized_manual:
                layer_metadata = {
                    **layer_metadata,
                    "sourceLanguage": annotation_set["language"] or "zh",
                    "virtualTranslation": True,
                }
            sets.append(
                {
                    "id": annotation_set["id"],
                    "kind": (
                        "translation" if localized_manual else annotation_set["kind"]
                    ),
                    "annotator": annotation_set["annotator"],
                    "language": (
                        "en" if localized_manual else annotation_set["language"]
                    ),
                    "engine": annotation_set["engine"],
                    "engineVersion": annotation_set["engine_version"],
                    "createdAt": annotation_set["created_at"],
                    "license": annotation_set["license"],
                    "metadata": layer_metadata,
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
                "metadata": localized_value(
                    json.loads(source["metadata_json"] or "{}"),
                    locale,
                )
                if localized_manual
                else json.loads(source["metadata_json"] or "{}"),
                "parserVersion": source["parser_version"],
                "rawChecksum": source["raw_checksum"],
                "acquiredAt": source["acquired_at"],
                "locator": localized_value(
                    json.loads(source["locator_json"] or "{}"),
                    locale,
                )
                if localized_manual
                else json.loads(source["locator_json"] or "{}"),
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


def _complete_game(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
    locale: str = "zh",
) -> dict[str, Any]:
    game = _game(row, json.loads(row["notations"]))
    game["id"] = row["id"]
    game["initialFen"] = row["initial_fen"]
    game["recordKind"] = row["record_kind"]
    game["statisticalEligible"] = bool(row["statistical_eligible"])
    game["sources"] = _source_rows(connection, [row["id"]])[row["id"]]
    game["witnesses"] = _witnesses(connection, row["id"], locale)
    manual_witness = next(
        (
            witness
            for witness in game["witnesses"]
            if witness["source"] == "dpxq"
            and witness["collection"] == "ancient_manuals"
        ),
        None,
    )
    if manual_witness is not None and not is_chinese(locale):
        locator = manual_witness.get("locator") or {}
        slug = str(locator.get("manualSlug") or "")
        native_manual = str(game["red"].get("nativeName") or game["red"]["name"])
        native_game = str(game["black"].get("nativeName") or game["black"]["name"])
        game["red"]["name"] = localize_manual_title(slug, native_manual, locale)
        game["black"]["name"] = localize_manual_text("games", native_game, locale)
        game["event"] = localize_manual_title(
            slug,
            str(game.get("event") or native_manual),
            locale,
        )
        game["metadata"] = localized_value(game.get("metadata", {}), locale)
        if game["metadata"].get("title"):
            game["metadata"]["title"] = game["black"]["name"]
        if game["metadata"].get("event"):
            game["metadata"]["event"] = game["event"]
        if locator.get("manual"):
            locator["manual"] = game["red"]["name"]
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
    locale = manual_language(query)
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
        return _complete_game(connection, row, locale)
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
