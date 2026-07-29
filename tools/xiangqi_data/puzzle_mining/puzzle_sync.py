"""Synchronize mined Xiangqi puzzles into Lila's puzzle collections."""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
import sqlite3
from typing import Any, Iterable

from pymongo import ASCENDING, DESCENDING, MongoClient, UpdateOne

from external.xiangqi_explorer.catalog_databases import catalog_database_id


DEFAULT_SOURCE = Path("data/local/xiangqi-puzzle-mining.sqlite3")
DEFAULT_MONGO_URI = "mongodb://127.0.0.1:27017"
# ReactiveMongo falls back to "lichess" when the configured URI has no database.
# The "puzzle" argument in mongo.asyncDb("puzzle", ...) is only a connection name.
PUZZLE_DATABASE = "lichess"
PUZZLE_COLLECTION = "puzzle2_puzzle"
PATH_COLLECTION = "puzzle2_path"
THEME_COUNT_CACHE_ID = "puzzle:themeCount:"
MANAGED_BY = "lixiangqi-puzzle-sync"
PATH_SIZE = 24
SELECTOR_THEMES = (
    "centroidPawnMate",
    "mateIn1",
    "mateIn2",
    "mateIn3",
    "mateIn4",
    "mateIn5",
)


@dataclass(frozen=True)
class SyncedPuzzle:
    puzzle_id: str
    source_database: str
    game_id: str
    fen: str
    line: tuple[str, ...]
    rating: float
    deviation: float
    plays: int
    vote: float
    themes: tuple[str, ...]

    def document(self) -> dict[str, Any]:
        return {
            "_id": self.puzzle_id,
            "gameId": self.game_id,
            "gameSource": {
                "type": "catalog",
                "database": self.source_database,
            },
            "fen": self.fen,
            "line": " ".join(self.line),
            "glicko": {"r": self.rating, "d": self.deviation, "v": 0.09},
            "plays": self.plays,
            "vote": self.vote,
            "themes": list(self.themes),
            "managedBy": MANAGED_BY,
            "tagMe": True,
        }


def read_puzzles(path: Path) -> list[SyncedPuzzle]:
    connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            """
            SELECT p.id, c.source_database, p.game_id, p.fen, p.line,
                   p.rating, p.rating_deviation, p.plays, p.vote,
                   p.themes, p.created_at
            FROM puzzles p
            JOIN candidates c ON c.id = p.candidate_id
            ORDER BY p.created_at, p.id
            """
        )
        puzzles = [_synced_puzzle(row) for row in rows]
    finally:
        connection.close()
    return puzzles


def _synced_puzzle(row: sqlite3.Row) -> SyncedPuzzle:
    line = tuple(json.loads(row["line"]))
    themes = tuple(json.loads(row["themes"]))
    if len(row["id"]) != 5:
        raise ValueError(f"Puzzle ID must contain five characters: {row['id']!r}")
    if not row["source_database"]:
        raise ValueError(f"Puzzle {row['id']} has no source database")
    if len(line) < 2:
        raise ValueError(f"Puzzle {row['id']} must have a setup move and a solution")
    if not themes:
        raise ValueError(f"Puzzle {row['id']} has no themes")
    return SyncedPuzzle(
        puzzle_id=row["id"],
        source_database=catalog_database_id(row["source_database"]),
        game_id=row["game_id"],
        fen=row["fen"],
        line=line,
        rating=float(row["rating"]),
        deviation=float(row["rating_deviation"]),
        plays=int(row["plays"]),
        vote=float(row["vote"]),
        themes=themes,
    )


def path_documents(
    puzzle_ids: Iterable[str], angle: str, generated_at: int
) -> list[dict[str, Any]]:
    ids = sorted(set(puzzle_ids))
    return [
        {
            "_id": f"{angle}|all|{index:04d}",
            "min": f"{angle}|all|0000",
            "max": f"{angle}|all|9999",
            "ids": ids[offset : offset + PATH_SIZE],
            "gen": generated_at,
            "managedBy": MANAGED_BY,
        }
        for index, offset in enumerate(range(0, len(ids), PATH_SIZE))
    ]


def synchronize(source: Path, mongo_uri: str) -> tuple[int, int]:
    puzzles = read_puzzles(source)
    if not puzzles:
        return 0, 0
    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5_000)
    client.admin.command("ping")
    puzzle_database = client[PUZZLE_DATABASE]
    puzzle_collection = puzzle_database[PUZZLE_COLLECTION]
    path_collection = puzzle_database[PATH_COLLECTION]

    operations = []
    for puzzle in puzzles:
        document = puzzle.document()
        mutable = {
            key: value
            for key, value in document.items()
            if key not in {"_id", "glicko", "plays", "vote", "tagMe"}
        }
        operations.append(
            UpdateOne(
                {"_id": puzzle.puzzle_id},
                {
                    "$set": mutable,
                    "$unset": {"sourceUrl": ""},
                    "$setOnInsert": {
                        "glicko": document["glicko"],
                        "plays": document["plays"],
                        "vote": document["vote"],
                        "tagMe": document["tagMe"],
                    },
                },
                upsert=True,
            )
        )
    puzzle_collection.bulk_write(operations, ordered=False)
    puzzle_collection.delete_many(
        {
            "managedBy": MANAGED_BY,
            "_id": {"$nin": [puzzle.puzzle_id for puzzle in puzzles]},
        }
    )
    puzzle_collection.create_index([("themes", ASCENDING)])
    puzzle_collection.create_index([("themes", ASCENDING), ("vote", DESCENDING)])

    generated_at = int(datetime.now(UTC).timestamp() * 1_000)
    all_ids = puzzle_collection.distinct("_id")
    paths = path_documents(all_ids, "mix", generated_at)
    for theme in SELECTOR_THEMES:
        paths.extend(
            path_documents(
                puzzle_collection.distinct("_id", {"themes": theme}), theme, generated_at
            )
        )
    if paths:
        path_collection.bulk_write(
            [UpdateOne({"_id": path["_id"]}, {"$set": path}, upsert=True) for path in paths],
            ordered=False,
        )
    path_collection.delete_many(
        {
            "managedBy": MANAGED_BY,
            "_id": {"$nin": [path["_id"] for path in paths]},
        }
    )
    path_collection.create_index([("min", ASCENDING), ("max", DESCENDING)])

    theme_counts: Counter[str] = Counter()
    for document in puzzle_collection.find({}, {"themes": 1}):
        theme_counts.update(document.get("themes", []))
    theme_counts["mix"] = len(all_ids)
    client[PUZZLE_DATABASE]["cache"].update_one(
        {"_id": THEME_COUNT_CACHE_ID},
        {
            "$set": {
                "v": dict(theme_counts),
                "e": datetime.now(UTC) + timedelta(hours=25),
            }
        },
        upsert=True,
    )
    client.close()
    return len(puzzles), len(paths)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--mongo-uri", default=DEFAULT_MONGO_URI)
    return parser


def main() -> int:
    args = _parser().parse_args()
    count, paths = synchronize(args.source, args.mongo_uri)
    print(f"Synchronized {count} puzzles across {paths} selector paths.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
