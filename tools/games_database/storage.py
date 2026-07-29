"""Storage primitives shared by importers, scrapers, and the read service."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Sequence

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIRECTORY = PROJECT_ROOT / "data" / "local"
DEFAULT_DATABASE = DATA_DIRECTORY / "xiangqi-games.sqlite3"
SCHEMA_VERSION = 5
SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def database_path() -> Path:
    configured = os.environ.get("LIXIANGQI_GAMES_DB") or os.environ.get(
        "LIXIANGQI_EXPLORER_DB"
    )
    return Path(configured).resolve() if configured else DEFAULT_DATABASE


def normalized_identity_name(native: str, search_key: str = "") -> str:
    return " ".join((search_key or native).casefold().split())


def line_hash(
    moves: Sequence[str],
    *,
    variant: str = "xiangqi",
    initial_fen: str = "",
) -> bytes:
    value = "\0".join((variant, initial_fen.strip(), ",".join(moves)))
    return hashlib.sha256(value.encode("utf-8")).digest()


def canonical_hash(
    moves: Sequence[str],
    *,
    red_name: str,
    black_name: str,
    result: int,
    red_name_key: str = "",
    black_name_key: str = "",
    variant: str = "xiangqi",
    initial_fen: str = "",
) -> bytes:
    """Source-independent played-game identity.

    Dates, event spelling, annotations, clocks, and analysis variations are
    deliberately excluded. Player identity and result prevent unrelated games
    that happen to repeat a complete line from being collapsed.
    """

    value = "\0".join(
        (
            variant,
            initial_fen.strip(),
            normalized_identity_name(red_name, red_name_key),
            normalized_identity_name(black_name, black_name_key),
            str(result),
            ",".join(moves),
        )
    )
    return hashlib.sha256(value.encode("utf-8")).digest()


def stable_game_id(identity: bytes) -> str:
    return f"g:{identity.hex()[:32]}"


def initialize(connection: sqlite3.Connection) -> None:
    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    connection.execute(
        "INSERT OR REPLACE INTO metadata(key, value) VALUES ('schema_version', ?)",
        (str(SCHEMA_VERSION),),
    )


def compact_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def source_file_provenance(path: Path) -> tuple[str, str]:
    stat = path.stat()
    return (
        hashlib.sha256(path.read_bytes()).hexdigest(),
        datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    )


def first_position_occurrences(
    positions: Iterable[tuple[int, str, str, str]],
) -> list[tuple[int, str, str, str]]:
    """Keep the first occurrence of each position, matching explorer semantics."""

    seen: set[str] = set()
    result: list[tuple[int, str, str, str]] = []
    for position in positions:
        key = position[1]
        if key not in seen:
            seen.add(key)
            result.append(position)
    return result
