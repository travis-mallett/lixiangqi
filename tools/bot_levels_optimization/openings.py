"""Export a reproducible, read-only suite from the master games catalog."""

from __future__ import annotations

import hashlib
import json
import random
from pathlib import Path

from external.pikafish_worker.ai import MoveWork
from external.xiangqi_explorer.catalog_databases import (
    games_database_path,
    open_catalog_connection,
)
from tools.xiangqi_data.pikafish_rules import START_FEN

from .runtime import CalibrationEngine


def digest(value) -> str:
    return hashlib.sha256(
        json.dumps(
            value, sort_keys=True, separators=(",", ":"), allow_nan=False
        ).encode()
    ).hexdigest()


def load_suite(path: Path) -> dict:
    suite = json.loads(path.read_text(encoding="utf-8"))
    if (
        suite.get("version") != 1
        or suite.get("database") != "masters"
        or not suite.get("openings")
    ):
        raise ValueError("Require a version 1 master opening suite")
    seen = set()
    for opening in suite["openings"]:
        if (
            opening["id"] in seen
            or len(opening["moves"]) < 20
            or not opening["initialFen"]
            or not opening["fen"]
        ):
            raise ValueError(
                "Opening IDs must be unique and positions at least 20 plies into the game"
            )
        seen.add(opening["id"])
    return suite


def export_suite(
    path: Path, count: int, seed: int, min_ply: int = 20, max_ply: int = 28
) -> dict:
    if count < 1 or min_ply < 20 or max_ply < min_ply:
        raise ValueError("Require positive count and 20 <= min-ply <= max-ply")
    if path.exists():
        raise FileExistsError("Refusing to overwrite a fixed opening suite")
    connection = open_catalog_connection()
    if connection is None:
        raise FileNotFoundError(
            "Install the master games catalog or set LIXIANGQI_GAMES_DB"
        )
    rng = random.Random(seed)
    reservoir = []
    seen = 0
    try:
        metadata = dict(connection.execute("SELECT key, value FROM metadata"))
        rows = connection.execute("""
            SELECT DISTINCT g.id, g.initial_fen, g.moves
            FROM game_sources s JOIN games g ON g.id = s.game_id
            WHERE s.source = 'dpxq' AND s.collection = 'm'
              AND g.statistical_eligible = 1 AND g.record_kind = 'played_game'
            ORDER BY g.id
        """)
        for row in rows:
            moves = json.loads(row[2])
            if len(moves) <= min_ply:
                continue
            seen += 1
            item = (row[0], row[1] or START_FEN, moves)
            if len(reservoir) < count * 3:
                reservoir.append(item)
            else:
                index = rng.randrange(seen)
                if index < len(reservoir):
                    reservoir[index] = item
    finally:
        connection.close()
    rng.shuffle(reservoir)
    openings = []
    positions = set()
    engine = CalibrationEngine()
    try:
        for game_id, fen, moves in reservoir:
            ply = rng.randint(min_ply, min(max_ply, len(moves) - 1))
            prefix = tuple(moves[:ply])
            final_fen, _ = engine.book_position(
                MoveWork("suite", 1, fen, prefix, legal_moves=())
            )
            key = " ".join(final_fen.split()[:2])
            if key in positions:
                continue
            positions.add(key)
            openings.append(
                {
                    "id": digest([game_id, prefix])[:20],
                    "sourceGameId": game_id,
                    "initialFen": fen,
                    "moves": list(prefix),
                    "fen": final_fen,
                    "ply": ply,
                }
            )
            if len(openings) == count:
                break
    finally:
        engine.close()
    if len(openings) != count:
        raise ValueError(
            f"Only {len(openings)} unique positions found; request a smaller suite"
        )
    suite = {
        "version": 1,
        "database": "masters",
        "seed": seed,
        "minPly": min_ply,
        "maxPly": max_ply,
        "catalogPath": str(games_database_path()),
        "catalogMetadata": metadata,
        "eligibleGames": seen,
        "openings": openings,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as stream:
        json.dump(suite, stream, indent=2, ensure_ascii=False)
    return suite
