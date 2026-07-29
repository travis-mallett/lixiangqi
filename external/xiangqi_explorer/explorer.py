"""Read-only Xiangqi opening statistics from the explorer catalog."""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
from typing import Any

from .catalog_databases import games_database_path, open_catalog_connection
from .name_romanization import normalized_name_key


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
}
DATE_PATTERN = re.compile(r"^\d{4}-(?:0[1-9]|1[0-2])$")


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


def explore_games(fen: str, query: dict[str, Any]) -> dict[str, Any]:
    """Return the Lichess opening-explorer response shape for Xiangqi games."""

    database = query.get("database", "masters")
    if database not in DATABASES:
        raise ValueError(
            "database must be masters, all, dpxq, gdchess, xqdao, or player"
        )
    source_name, source_predicate, source_url = DATABASES[database]
    since = _month(query.get("since"), "since")
    until = _month(query.get("until"), "until")
    player = _player(query.get("player")) if database == "player" else None
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

    connection = open_catalog_connection()
    if connection is None:
        empty["error"] = "Explorer database is not installed"
        return empty
    try:
        clauses = [
            "p.position_key = ?",
            "g.statistical_eligible = 1",
            "g.record_kind = 'played_game'",
        ]
        parameters: list[Any] = [position_key(fen)]
        if database not in {"all", "lixiangqi", "player"}:
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
        if player:
            native_column = f"g.{color}_name"
            romanized_column = f"g.{color}_name_romanized"
            key_column = f"g.{color}_name_key"
            clauses.append(
                f"(lower({native_column}) = lower(?) OR "
                f"lower({romanized_column}) = lower(?) OR {key_column} = ?)"
            )
            parameters.extend((player, player, normalized_name_key(player)))
        where = " AND ".join(clauses)

        rows = connection.execute(
            f"""
            SELECT p.move, min(p.notation) AS notation,
                   sum(g.result = 1) AS red, sum(g.result = 0) AS draws,
                   sum(g.result = -1) AS black, count(*) AS games,
                   sum(sum(g.result = 1)) OVER () AS total_red,
                   sum(sum(g.result = 0)) OVER () AS total_draws,
                   sum(sum(g.result = -1)) OVER () AS total_black
            FROM game_positions p JOIN games g ON g.id = p.game_id
            WHERE {where}
            GROUP BY p.move
            ORDER BY games DESC, p.move
            LIMIT 30
            """,
            parameters,
        ).fetchall()
        moves = [
            {
                "move": row["move"],
                "notation": row["notation"] or row["move"],
                "red": row["red"],
                "draws": row["draws"],
                "black": row["black"],
                "games": row["games"],
            }
            for row in rows
        ]
        red = int(rows[0]["total_red"] or 0) if rows else 0
        draws = int(rows[0]["total_draws"] or 0) if rows else 0
        black = int(rows[0]["total_black"] or 0) if rows else 0

        source_url_select = (
            "(SELECT gs.source_url FROM game_sources gs "
            f"WHERE gs.game_id = g.id AND ({source_predicate}) "
            "ORDER BY gs.id LIMIT 1)"
        )
        game_select = f"""
            SELECT g.id AS game_id, g.id AS external_id,
                    g.red_name, g.black_name,
                   g.red_rating, g.black_rating,
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
                    {source_url_select} AS source_url, g.moves, g.notations, p.move
            FROM game_positions p JOIN games g ON g.id = p.game_id
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
            **empty,
            "available": True,
            "red": red,
            "draws": draws,
            "black": black,
            "moves": moves,
            "topGames": [_game(row) for row in top_rows],
            "recentGames": [_game(row) for row in recent_rows],
        }
    except sqlite3.OperationalError as exc:
        print(f"Xiangqi explorer database error: {exc}", file=sys.stderr)
        empty["error"] = "Explorer database is unavailable"
        return empty
    finally:
        connection.close()
