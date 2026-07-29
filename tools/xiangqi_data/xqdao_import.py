"""Parse and import complete public XQDao games into the Xiangqi catalog."""

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
    dhtml_move_to_uci,
    initialize,
    parse_tags,
    require_import_environment,
    validate_and_index,
)
from external.xiangqi_explorer.name_romanization import name_forms
from .pikafish_rules import PikafishGameValidator
from .sqlite_lock_retry import SqliteLockRetry


SOURCE = "xqdao"
COLLECTION = "games"
COLLECTION_NAME = "XQDao Games"
GAME_ID_PATTERN = re.compile(r"^[1-9]\d*$")
STANDARD_BINIT = "8979695949392919097717866646260600102030405060708012720323436383"
RESULTS = {"红胜": 1, "黑胜": -1, "和棋": 0, "和": 0, "平": 0}
INFO_PATTERN = re.compile(
    r'<div\s+class=["\']qipu_info["\'][^>]*>(?P<body>.*?)</div>',
    re.IGNORECASE | re.DOTALL,
)
FIELD_PATTERNS = {
    "event": re.compile(r"赛事[：:]\s*(?P<value>.*?)(?=</span>)", re.DOTALL),
    "red": re.compile(r"红方[：:]\s*(?P<value>.*?)(?=</span>)", re.DOTALL),
    "black": re.compile(r"黑方[：:]\s*(?P<value>.*?)(?=</span>)", re.DOTALL),
    "round": re.compile(r"轮次[：:]\s*(?P<value>.*?)(?=</span>)", re.DOTALL),
    "opening": re.compile(r"开局[：:]\s*(?P<value>.*?)(?=</span>)", re.DOTALL),
    "result": re.compile(r"结果[：:]\s*(?P<value>.*?)(?=</span>)", re.DOTALL),
}
COUNTRIES = {
    "中国",
    "中国香港",
    "香港",
    "中国澳门",
    "澳门",
    "中华台北",
    "中国台北",
    "台湾",
    "越南",
    "马来西亚",
    "新加坡",
    "菲律宾",
    "泰国",
    "印度尼西亚",
    "日本",
    "韩国",
    "英国",
    "法国",
    "德国",
    "美国",
    "加拿大",
    "澳大利亚",
    "柬埔寨",
    "缅甸",
    "文莱",
}


@dataclass(frozen=True)
class XqdaoListing:
    game_id: str
    listing_title: str
    event_name: str
    event_url: str
    index_page: int
    listing_page: int
    collections: tuple[dict[str, str], ...] = ()


def _text(value: str) -> str:
    value = re.sub(r"<br\s*/?>", " ", value, flags=re.IGNORECASE)
    value = re.sub(r"<[^>]+>", "", value)
    return " ".join(html.unescape(value).replace("\u3000", " ").split())


def _info(document: str) -> dict[str, str]:
    section = INFO_PATTERN.search(document)
    if not section:
        raise ValueError("XQDao page has no game metadata block")
    body = section.group("body")
    values: dict[str, str] = {}
    for name, pattern in FIELD_PATTERNS.items():
        match = pattern.search(body)
        if match:
            values[name] = _text(match.group("value"))
    return values


def _player(value: str) -> tuple[str, str]:
    value = _text(value)
    match = re.fullmatch(r"(?P<name>.*?)\s*[（(](?P<affiliation>.*?)[）)]", value)
    if not match:
        return value, ""
    return match.group("name").strip(), match.group("affiliation").strip()


def _date(value: str) -> str:
    value = value.strip()
    if not value or value.casefold() in {"none", "null", "unknown"}:
        return "0000-00-00"
    match = re.search(r"(?P<year>\d{4})\D?(?P<month>\d{1,2})?\D?(?P<day>\d{1,2})?", value)
    if not match:
        return "0000-00-00"
    year = match.group("year")
    month = int(match.group("month") or 0)
    day = int(match.group("day") or 0)
    if not 1 <= month <= 12:
        return f"{year}-00-00"
    if not 1 <= day <= 31:
        return f"{year}-{month:02d}-00"
    return f"{year}-{month:02d}-{day:02d}"


def parse_game_page(path: Path, listing: XqdaoListing) -> ImportedGame:
    if not GAME_ID_PATTERN.fullmatch(listing.game_id):
        raise ValueError("invalid XQDao game id")
    document = decode_html(path.read_bytes())
    tags = parse_tags(document)
    if tags.get("binit", "") != STANDARD_BINIT:
        raise ValueError("XQDao record is not a complete standard-start game")
    encoded_moves = re.sub(r"\s+", "", tags.get("movelist", ""))
    if not encoded_moves or len(encoded_moves) % 4:
        raise ValueError("XQDao page has a missing or partial move list")
    moves = tuple(
        dhtml_move_to_uci(encoded_moves[index : index + 4])
        for index in range(0, len(encoded_moves), 4)
    )
    listed_length = tags.get("length", "")
    if listed_length.isdigit() and int(listed_length) != len(moves):
        raise ValueError(
            f"XQDao lists {listed_length} plies but supplies {len(moves)}"
        )

    info = _info(document)
    result_text = tags.get("result") or info.get("result", "")
    if result_text not in RESULTS:
        raise ValueError(f"unsupported XQDao result: {result_text or '(missing)'}")
    red, red_affiliation = _player(info.get("red", ""))
    black, black_affiliation = _player(info.get("black", ""))
    if not red or not black:
        raise ValueError("XQDao page is missing player names")
    event = tags.get("event") or info.get("event") or listing.event_name
    opening = info.get("opening") or tags.get("open", "")
    source_url = f"https://www.xqdao.com/qipu/show/{listing.game_id}/"
    metadata: dict[str, object] = {
        **tags,
        **asdict(listing),
        "source": "XQDao",
        "refer": listing.event_url,
        "red": info.get("red", red),
        "black": info.get("black", black),
        "redteam": red_affiliation,
        "blackteam": black_affiliation,
        "redcountry": red_affiliation if red_affiliation in COUNTRIES else "",
        "blackcountry": black_affiliation if black_affiliation in COUNTRIES else "",
        "opening": opening,
        "source_url": source_url,
    }
    return ImportedGame(
        owner=COLLECTION,
        external_id=listing.game_id,
        red_name=red,
        black_name=black,
        result=RESULTS[result_text],
        played_at=_date(tags.get("date", "")),
        event=event,
        round=tags.get("round") or info.get("round", ""),
        opening=opening,
        moves=moves,
        source_url=source_url,
        source_metadata=metadata,  # type: ignore[arg-type]
    )


class XqdaoImporter:
    """Immediate-commit importer with cross-source canonical deduplication."""

    def __init__(self, database: Path, *, message: Callable[[str], None] | None = None) -> None:
        self.database = database
        self.message = message
        self.lock_retry = SqliteLockRetry(message=message)
        self.connection: sqlite3.Connection | None = None
        self.validator = PikafishGameValidator()
        self.existing_records: set[str] = set()
        self.existing_hashes: dict[bytes, str] = {}
        self.counts = {"seen": 0, "imported": 0, "duplicate": 0, "invalid": 0}

    def __enter__(self) -> "XqdaoImporter":
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
            self.lock_retry.run(self.connection.commit, context="committing imported games")
            self.connection.close()
            self.connection = None
        self.validator.close()

    def has_record(self, external_id: str) -> bool:
        return external_id in self.existing_records

    def _execute(self, sql: str, parameters=()):
        if self.connection is None:
            raise RuntimeError("XQDao importer is not open")
        return self.lock_retry.run(
            lambda: self.connection.execute(sql, parameters),
            context="updating the catalog",
        )

    def _executemany(self, sql: str, parameters):
        if self.connection is None:
            raise RuntimeError("XQDao importer is not open")
        rows = tuple(parameters)
        return self.lock_retry.run(
            lambda: self.connection.executemany(sql, rows),
            context="indexing game positions",
        )

    def _record_source(self, game: ImportedGame, game_id: str) -> None:
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
                json.dumps(
                    game.source_metadata,
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ),
            ),
        )
        self.existing_records.add(game.external_id)

    def import_page(self, path: Path, listing: XqdaoListing) -> str:
        if self.connection is None:
            raise RuntimeError("XQDao importer is not open")
        self.counts["seen"] += 1
        if listing.game_id in self.existing_records:
            self.counts["duplicate"] += 1
            return "existing"
        try:
            game = parse_game_page(path, listing)
            positions = validate_and_index(game, self.validator)
            row = _game_row(
                game,
                name_forms(game.red_name),
                name_forms(game.black_name),
                game_source=SOURCE,
                storage_external_id=game.external_id,
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
                    (SOURCE, game.external_id),
                ).fetchone()[0]
                self.counts["duplicate"] += 1
                status = "duplicate"
            self._record_source(game, game_id)
            self.lock_retry.run(self.connection.commit, context="committing imported games")
            return status
        except (OSError, UnicodeError, ValueError, sqlite3.DatabaseError) as exc:
            self.lock_retry.run(
                self.connection.rollback, context="rolling back a rejected game"
            )
            self.counts["invalid"] += 1
            message = f"Rejected XQDao game {listing.game_id}: {exc}"
            if self.message:
                self.message(message)
            else:
                print(message, file=sys.stderr)
            return "invalid"
