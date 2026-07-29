"""Parse and import complete GDChess/01xq games into the Xiangqi catalog."""

from __future__ import annotations

import html
import json
import re
import sqlite3
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

from .dpxq_import import (
    GAME_COLUMNS,
    ImportedGame,
    _game_row,
    decode_html,
    initialize,
    require_import_environment,
    validate_and_index,
)
from external.xiangqi_explorer.name_romanization import name_forms
from .pikafish_rules import PikafishGameValidator
from .sqlite_lock_retry import SqliteLockRetry


SOURCE = "gdchess_01xq"
COLLECTION = "games"
COLLECTION_NAME = "GDChess/01xq Games"
GAME_ID_PATTERN = re.compile(r"^[0-9A-F-]{6,32}$", re.IGNORECASE)
MOVE_PATTERN = re.compile(r'MOVE_STR\s*=\s*["\'](?P<moves>\d+)["\']', re.IGNORECASE)
AI_SCORES_PATTERN = re.compile(r"AIScores\s*=\s*(?P<values>\[[^;]*?\])\s*;", re.DOTALL)
AI_MOVES_PATTERN = re.compile(r"AIMoves\s*=\s*(?P<values>\[[^;]*?\])\s*;", re.DOTALL)
TITLE_PATTERN = re.compile(
    r"^(?P<red>.+?)\s+(?P<result>胜|負|负|和)\s+(?P<black>.+?)\s+-\s+(?P<event>.+)$"
)
RESULTS = {"胜": 1, "負": -1, "负": -1, "和": 0}


@dataclass(frozen=True)
class GdchessListing:
    game_id: str
    event_id: str
    event_native: str
    event_english: str
    played_at: str
    round: str
    table: str
    red_english: str
    black_english: str
    result: int
    listed_plies: int
    opening_english: str
    views: int | None
    updated_at: str
    listing_url: str


def _text(value: str) -> str:
    value = re.sub(r"<br\s*/?>", " ", value, flags=re.IGNORECASE)
    value = re.sub(r"<[^>]+>", "", value)
    return " ".join(html.unescape(value).replace("\u3000", " ").split())


def _native_name(value: str) -> str:
    value = _text(value)
    if re.search(r"[\u3400-\u9fff]", value):
        return re.sub(r"\s+", "", value)
    return value


def _move_to_uci(move: str) -> str:
    if not re.fullmatch(r"\d{4}", move):
        raise ValueError(f"invalid GDChess move: {move}")
    from_file, from_row, to_file, to_row = map(int, move)
    if from_file > 8 or to_file > 8 or from_row > 9 or to_row > 9:
        raise ValueError(f"GDChess coordinate is outside the Xiangqi board: {move}")
    return (
        f"{chr(ord('a') + from_file)}{10 - from_row}"
        f"{chr(ord('a') + to_file)}{10 - to_row}"
    )


def _json_array(document: str, pattern: re.Pattern[str]) -> list[object]:
    match = pattern.search(document)
    if not match:
        return []
    try:
        values = json.loads(match.group("values"))
    except json.JSONDecodeError as exc:
        raise ValueError("GDChess page has malformed analysis metadata") from exc
    if not isinstance(values, list):
        raise ValueError("GDChess analysis metadata is not an array")
    return values


def parse_game_page(path: Path, listing: GdchessListing) -> ImportedGame:
    if not GAME_ID_PATTERN.fullmatch(listing.game_id):
        raise ValueError("invalid GDChess/01xq game id")
    document = decode_html(path.read_bytes())
    move_match = MOVE_PATTERN.search(document)
    if not move_match:
        raise ValueError("GDChess page has no complete MOVE_STR")
    encoded = move_match.group("moves")
    if len(encoded) % 4:
        raise ValueError("GDChess MOVE_STR has a partial move")
    moves = tuple(_move_to_uci(encoded[index : index + 4]) for index in range(0, len(encoded), 4))
    title_match = re.search(r"<title>(?P<title>.*?)</title>", document, re.IGNORECASE | re.DOTALL)
    title = _text(title_match.group("title")) if title_match else ""
    game_match = TITLE_PATTERN.fullmatch(title)
    if not game_match:
        raise ValueError(f"unsupported GDChess game title: {title or '(missing)'}")
    result = RESULTS[game_match.group("result")]
    if result != listing.result:
        raise ValueError("GDChess game result disagrees with its 01xq listing")

    red = _native_name(game_match.group("red"))
    black = _native_name(game_match.group("black"))
    event = _text(game_match.group("event")) or listing.event_native or listing.event_english
    metadata = {
        **asdict(listing),
        "title": title,
        "event_native": event,
        "red_native": red,
        "black_native": black,
        "redeng": listing.red_english,
        "blackeng": listing.black_english,
        "table": listing.table,
        "editdate": listing.updated_at,
        "openingeng": listing.opening_english,
        "source": "GDChess/01xq",
        "refer": listing.listing_url,
    }
    if listing.listed_plies and listing.listed_plies != len(moves):
        # The 01xq event listing is occasionally one ply ahead of the game
        # page. The complete coordinate stream is the import authority; it is
        # subsequently checked by Pikafish before being committed.
        metadata["listed_plies_mismatch"] = {
            "listed": listing.listed_plies,
            "supplied": len(moves),
        }
    ai_scores = _json_array(document, AI_SCORES_PATTERN)
    ai_moves = _json_array(document, AI_MOVES_PATTERN)
    if ai_scores:
        metadata["ai_scores"] = ai_scores
    if ai_moves:
        metadata["ai_moves"] = ai_moves
    return ImportedGame(
        owner=COLLECTION,
        external_id=listing.game_id.upper(),
        red_name=red,
        black_name=black,
        result=result,
        played_at=listing.played_at,
        event=event,
        round=listing.round,
        opening=listing.opening_english,
        moves=moves,
        source_url=f"http://www.gdchess.com/xqgame/gview.asp?id={listing.game_id.upper()}",
        source_metadata=metadata,
    )


class GdchessImporter:
    """Immediate-commit importer with canonical deduplication across sources."""

    def __init__(self, database: Path, *, message: Callable[[str], None] | None = None) -> None:
        self.database = database
        self.message = message
        self.lock_retry = SqliteLockRetry(message=message)
        self.connection: sqlite3.Connection | None = None
        self.validator = PikafishGameValidator()
        self.existing_records: set[str] = set()
        self.existing_hashes: dict[bytes, str] = {}
        self.counts = {"seen": 0, "imported": 0, "duplicate": 0, "invalid": 0}

    def __enter__(self) -> "GdchessImporter":
        require_import_environment()
        self.validator.start()
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.database, timeout=0)

        def open_database() -> tuple[set[str], dict[bytes, str]]:
            assert self.connection is not None
            initialize(self.connection)
            self.connection.commit()
            records = {
                row[0]
                for row in self.connection.execute(
                    "SELECT external_id FROM game_sources WHERE source = ? AND collection = ?",
                    (SOURCE, COLLECTION),
                )
            }
            hashes = {
                bytes(row[0]): row[1]
                for row in self.connection.execute("SELECT canonical_hash, id FROM games")
            }
            return records, hashes

        self.existing_records, self.existing_hashes = self.lock_retry.run(
            open_database, context="opening the catalog"
        )
        return self

    def __exit__(self, *_exc: object) -> None:
        if self.connection is not None:
            self.lock_retry.run(
                self.connection.commit, context="committing imported games"
            )
            self.connection.close()
            self.connection = None
        self.validator.close()

    def _record_source(self, game: ImportedGame, game_id: str) -> None:
        if self.connection is None:
            raise RuntimeError("GDChess importer is not open")
        self._execute(
            """
            INSERT INTO game_sources(
              source, collection, collection_name, external_id, game_id,
              source_url, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source, collection, external_id) DO UPDATE SET
              collection_name = excluded.collection_name,
              game_id = excluded.game_id,
              source_url = excluded.source_url,
              metadata_json = excluded.metadata_json
            """,
            (
                SOURCE,
                COLLECTION,
                COLLECTION_NAME,
                game.external_id,
                game_id,
                game.source_url,
                json.dumps(game.source_metadata, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            ),
        )
        self.existing_records.add(game.external_id)

    def _execute(self, sql: str, parameters=()):
        if self.connection is None:
            raise RuntimeError("GDChess importer is not open")
        return self.lock_retry.run(
            lambda: self.connection.execute(sql, parameters),
            context="updating the catalog",
        )

    def _executemany(self, sql: str, parameters):
        if self.connection is None:
            raise RuntimeError("GDChess importer is not open")
        rows = tuple(parameters)
        return self.lock_retry.run(
            lambda: self.connection.executemany(sql, rows),
            context="indexing game positions",
        )

    def import_page(self, path: Path, listing: GdchessListing) -> str:
        if self.connection is None:
            raise RuntimeError("GDChess importer is not open")
        self.counts["seen"] += 1
        external_id = listing.game_id.upper()
        if external_id in self.existing_records:
            self.counts["duplicate"] += 1
            return "existing"
        try:
            game = parse_game_page(path, listing)
            positions = validate_and_index(game, self.validator)
            red_name = name_forms(game.red_name)
            black_name = name_forms(game.black_name)
            row = _game_row(
                game,
                red_name,
                black_name,
                game_source=SOURCE,
                storage_external_id=external_id,
            )
            existing_game_id = self.existing_hashes.get(game.canonical_hash)
            if existing_game_id is None:
                columns = ", ".join(GAME_COLUMNS)
                values = ", ".join(f":{column}" for column in GAME_COLUMNS)
                cursor = self._execute(
                    f"INSERT OR IGNORE INTO games(source, {columns}) VALUES (:source, {values})",
                    {**row, "source": SOURCE},
                )
            else:
                cursor = None
            if cursor is not None and cursor.rowcount:
                game_id = str(row["id"])
                self._executemany(
                    """
                    INSERT INTO game_positions(game_id, ply, position_key, move, notation)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    ((game_id, *position) for position in positions),
                )
                self.existing_hashes[game.canonical_hash] = game_id
                self.counts["imported"] += 1
                status = "imported"
            else:
                game_id = existing_game_id or self._execute(
                    "SELECT id FROM games WHERE source = ? AND external_id = ?",
                    (SOURCE, external_id),
                ).fetchone()[0]
                self.counts["duplicate"] += 1
                status = "duplicate"
            self._record_source(game, game_id)
            self.lock_retry.run(
                self.connection.commit, context="committing imported games"
            )
            return status
        except (OSError, UnicodeError, ValueError, sqlite3.DatabaseError) as exc:
            self.lock_retry.run(
                self.connection.rollback, context="rolling back a rejected game"
            )
            self.counts["invalid"] += 1
            text = f"Rejected GDChess/01xq game {external_id}: {exc}"
            if self.message:
                self.message(text)
            else:
                print(text, file=sys.stderr)
            return "invalid"
