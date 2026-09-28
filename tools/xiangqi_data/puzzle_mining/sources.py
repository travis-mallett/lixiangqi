"""Source-neutral game loading for puzzle mining.

Native games enter the mining database only through verified production
snapshots, together with provenance and resumable jobs.  Catalog games remain
read-only external SQLite databases.  The ``source_database`` prefix is the
stable provenance boundary: ``lixiangqi:<origin>`` is never folded into a
catalog identifier.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from tools.xiangqi_data.pikafish_rules import START_FEN
from tools.games_database.identity import CATALOG_SOURCE_ALIASES, resolve_catalog_game
from external.xiangqi_explorer.catalog_databases import catalog_database_id

NATIVE_PREFIX = "lixiangqi:"


def catalog_source_paths(paths):
    """Route retained source witnesses to their unified catalog, not old files."""
    result = {}
    for raw in paths:
        path = Path(raw).resolve()
        source = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)
        try:
            unified = source.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='game_sources'"
            ).fetchone() is not None
        finally:
            source.close()
        names = [catalog_database_id(path)]
        if unified:
            names.extend(("catalog", *CATALOG_SOURCE_ALIASES))
        for name in names:
            if name in result and result[name] != str(path):
                raise ValueError(f"Multiple catalogs configured for source {name}")
            result[name] = str(path)
    return result


@dataclass(frozen=True)
class SourceGame:
    game_id: str
    origin: str
    initial_fen: str
    moves: tuple[str, ...]
    players: tuple[str, ...]
    source_url: str = ""

    @property
    def source_database(self) -> str:
        return native_source_database(self.origin)



def native_source_database(origin: str) -> str:
    origin = str(origin).strip()
    if not origin:
        raise ValueError("native origin must be non-empty")
    return f"{NATIVE_PREFIX}{origin}"


def is_native_source(source_database: str) -> bool:
    return str(source_database).startswith(NATIVE_PREFIX)


def native_origin(source_database: str) -> str:
    if not is_native_source(source_database) or len(source_database) == len(NATIVE_PREFIX):
        raise ValueError(f"not a native source database: {source_database!r}")
    return source_database[len(NATIVE_PREFIX):]


def _decode_moves(raw: Any) -> tuple[str, ...]:
    value = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError("source game has an invalid move list")
    return tuple(value)


def _decode_players(raw: Any) -> tuple[str, ...]:
    value = json.loads(raw) if isinstance(raw, str) else raw
    if value is None:
        return ()
    if isinstance(value, dict):
        value = list(value.values())
    if not isinstance(value, list):
        raise ValueError("source game has invalid players")
    return tuple(str(item) for item in value if item is not None and str(item))


def load_game(
    connection: sqlite3.Connection,
    source_paths: Mapping[str, Path] | None,
    source_database: str,
    game_id: str,
) -> SourceGame:
    """Load either an immutable native row or a read-only catalog row.

    Retained source IDs resolve through catalog provenance to canonical games.
    Catalog rows default to the standard starting position when ``initial_fen``
    is absent or empty.
    """
    if is_native_source(source_database):
        row = connection.execute(
            "SELECT ng.game_id, ng.origin, ng.initial_fen, ng.moves_json, ng.players_json, ng.source_url "
            "FROM native_games ng JOIN source_snapshots ss ON ss.snapshot_id = ng.snapshot_id "
            "WHERE ng.source_database = ? AND ng.game_id = ?",
            (source_database, game_id),
        ).fetchone()
        if row is None:
            raise LookupError(f"source game {game_id} was not found")
        return SourceGame(
            game_id=row["game_id"], origin=row["origin"],
            initial_fen=row["initial_fen"] or START_FEN, moves=_decode_moves(row["moves_json"]),
            players=_decode_players(row["players_json"]), source_url=row["source_url"] or "",
        )
    path = (source_paths or {}).get(source_database)
    if path is None:
        raise LookupError(f"source database {source_database} is not installed")
    source = sqlite3.connect(f"{Path(path).resolve().as_uri()}?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    try:
        row = resolve_catalog_game(source, game_id, source_database)
    finally:
        source.close()
    if row is None:
        raise LookupError(f"source game {game_id} was not found")
    return SourceGame(
        game_id=row["id"], origin=source_database,
        initial_fen=(row["initial_fen"] if "initial_fen" in row.keys() else "") or START_FEN,
        moves=_decode_moves(row["moves"]), players=(), source_url=(row["source_url"] if "source_url" in row.keys() else "") or "",
    )
