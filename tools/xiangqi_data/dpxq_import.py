"""Import DPXQ master-game DhtmlXQ records into Lixiangqi.

Input is a directory (or individual files) containing the public DhtmlXQ HTML
record format. The companion ``dpxq_scrape.py`` tool retrieves public records.
This importer validates every move with the official Pikafish executable,
rejects illegal records, and deduplicates games before indexing transposed
positions.
"""

from __future__ import annotations

import argparse
import html
import importlib.util
import json
import re
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Sequence

from external.xiangqi_explorer.catalog_databases import source_database_path
from tools.games_database.provenance import (
    clear_ingest_failure,
    record_ingest_failure,
    upsert_source_record,
)
from tools.games_database.storage import (
    canonical_hash as make_canonical_hash,
    first_position_occurrences,
    initialize as initialize_database,
    line_hash,
    source_file_provenance,
    stable_game_id,
)
from .pikafish_rules import PikafishGameValidator, default_executable, index_validated_line
from .sqlite_lock_retry import SqliteLockRetry

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE = source_database_path("dpxq")
TAG_PATTERN = re.compile(
    r"\[DhtmlXQ_(?P<name>[a-zA-Z0-9]+)\](?P<value>.*?)\[/DhtmlXQ_(?P=name)\]",
    re.IGNORECASE | re.DOTALL,
)
SCRIPT_MOVES_PATTERN = re.compile(
    r"DhtmlXQ_movelist\s*=\s*['\"]\[DhtmlXQ_movelist\](?P<moves>.*?)"
    r"\[/DhtmlXQ_movelist\]['\"]",
    re.IGNORECASE | re.DOTALL,
)
LEGACY_SCRIPT_MOVES_PATTERN = re.compile(
    r"DhtmlXQ_movelist\s*=\s*['\"](?P<tree>\[0_1_0\].*?)['\"]\s*;",
    re.IGNORECASE | re.DOTALL,
)
LEGACY_MAINLINE_PATTERN = re.compile(
    r"\[0_1_0\](?P<moves>\d+)\[/0_1_0\]", re.IGNORECASE | re.DOTALL
)
RECORD_ID_PATTERN = re.compile(r"view_([a-z])_(\d+)\.html$", re.IGNORECASE)
VIEWURL_ID_PATTERN = re.compile(r"(?:^|[?&])id=(\d+)(?:[&#]|$)", re.IGNORECASE)
VIEWURL_OWNER_PATTERN = re.compile(r"(?:^|[?&])owner=([a-z])(?:[&#]|$)", re.IGNORECASE)
ROMANIZATION_DEPENDENCIES = ("pypinyin", "pykakasi", "hangulpy")
DPXQ_COLLECTIONS = {
    "m": "大师对局",
    "n": "网络赛事",
    "t": "顶尖对局",
    "k": "顶尖快棋",
    "o": "其他对局",
    "b": "低于24步",
    "u": "棋友上传",
    "w": "无主棋谱",
}
RESULTS = {"红胜": 1, "黑胜": -1, "和棋": 0, "和": 0, "平": 0}


@dataclass(frozen=True)
class ImportedGame:
    owner: str
    external_id: str
    red_name: str
    black_name: str
    result: int
    played_at: str
    event: str
    round: str
    opening: str
    moves: tuple[str, ...]
    source_url: str
    source_metadata: dict[str, str]

    @property
    def canonical_hash(self) -> bytes:
        return make_canonical_hash(
            self.moves,
            red_name=self.red_name,
            black_name=self.black_name,
            result=self.result,
        )


def decode_html(raw: bytes) -> str:
    header = raw[:2048].lower().replace(b"'", b"").replace(b'"', b"")
    encodings = (
        ("utf-8-sig", "utf-8", "gb18030")
        if raw.startswith(b"\xef\xbb\xbf") or b"charset=utf-8" in header
        else ("gb18030", "utf-8-sig", "utf-8")
    )
    for encoding in encodings:
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            pass
    return raw.decode("gb18030", errors="replace")


def read_html(path: Path) -> str:
    return decode_html(path.read_bytes())


def parse_tags(document: str) -> dict[str, str]:
    tags: dict[str, str] = {}
    for match in TAG_PATTERN.finditer(document):
        value = re.sub(r"<br\s*/?>", "\n", match.group("value"), flags=re.IGNORECASE)
        value = re.sub(r"<[^>]+>", "", value)
        tags[match.group("name").lower()] = html.unescape(value).strip()
    scripted = SCRIPT_MOVES_PATTERN.search(document)
    if scripted:
        tags["movelist"] = html.unescape(scripted.group("moves")).strip()
    else:
        legacy_script = LEGACY_SCRIPT_MOVES_PATTERN.search(document)
        legacy_mainline = (
            LEGACY_MAINLINE_PATTERN.search(legacy_script.group("tree"))
            if legacy_script
            else None
        )
        if legacy_mainline:
            tags["movelist"] = legacy_mainline.group("moves").strip()
    return tags


def dhtml_move_to_uci(move: str) -> str:
    if not re.fullmatch(r"\d{4}", move):
        raise ValueError(f"invalid DhtmlXQ move: {move}")
    from_file, from_row, to_file, to_row = map(int, move)
    if from_file > 8 or to_file > 8 or from_row > 9 or to_row > 9:
        raise ValueError(f"DhtmlXQ coordinate is outside the Xiangqi board: {move}")
    return (
        f"{chr(ord('a') + from_file)}{10 - from_row}"
        f"{chr(ord('a') + to_file)}{10 - to_row}"
    )


def viewurl_game_id(tags: dict[str, str]) -> str:
    match = VIEWURL_ID_PATTERN.search(tags.get("viewurl", ""))
    return match.group(1) if match else ""


def viewurl_owner(tags: dict[str, str]) -> str:
    match = VIEWURL_OWNER_PATTERN.search(tags.get("viewurl", ""))
    return match.group(1).lower() if match else ""


def parse_game(
    path: Path,
    *,
    external_id: str | None = None,
    owner: str | None = None,
) -> ImportedGame:
    tags = parse_tags(read_html(path))
    identifier = RECORD_ID_PATTERN.search(path.name)
    view_id = viewurl_game_id(tags)
    file_owner = identifier.group(1).lower() if identifier else ""
    resolved_owner = (owner or viewurl_owner(tags) or file_owner or "m").lower()
    if resolved_owner not in DPXQ_COLLECTIONS:
        raise ValueError(f"unsupported DPXQ collection owner: {resolved_owner}")
    sort_id = tags.get("sortid", "")
    sort_external_id = sort_id[:-1] if sort_id.endswith("0") else sort_id
    # DPXQ has many valid master pages whose sortid was copied from another
    # record (or left as 999999999). The requested/view URL identifies the
    # source record; sortid remains preserved in source_metadata only.
    resolved_external_id = (
        external_id
        if external_id is not None
        else view_id
        if view_id
        else identifier.group(2)
        if identifier
        else sort_external_id
    )
    if not resolved_external_id:
        raise ValueError("missing DPXQ game id")
    if tags.get("binit"):
        raise ValueError("non-standard DhtmlXQ initial positions are not game imports")
    encoded_moves = re.sub(r"\s+", "", tags.get("movelist", ""))
    if not encoded_moves or len(encoded_moves) % 4:
        raise ValueError("missing or malformed DhtmlXQ move list")
    result_text = tags.get("result", "")
    if result_text not in RESULTS:
        raise ValueError(f"unsupported result: {result_text or '(missing)'}")
    red_name = tags.get("redname") or tags.get("red", "")
    black_name = tags.get("blackname") or tags.get("black", "")
    if not red_name or not black_name:
        raise ValueError("missing player names")
    moves = tuple(dhtml_move_to_uci(encoded_moves[i : i + 4]) for i in range(0, len(encoded_moves), 4))
    return ImportedGame(
        owner=resolved_owner,
        external_id=resolved_external_id,
        red_name=red_name,
        black_name=black_name,
        result=RESULTS[result_text],
        played_at=tags.get("date", "0000-00-00").replace(" ", "T", 1),
        event=tags.get("event", ""),
        round=tags.get("round", ""),
        opening=tags.get("open", ""),
        moves=moves,
        source_url=(
            "https://www.dpxq.com/hldcg/search/"
            f"view_{resolved_owner}_{resolved_external_id}.html"
        ),
        source_metadata=tags,
    )


def validate_and_index(
    game: ImportedGame, validator: PikafishGameValidator | None = None
) -> list[tuple[int, str, str, str]]:
    if validator is None:
        with PikafishGameValidator() as one_shot_validator:
            one_shot_validator.validate(game.moves)
    else:
        validator.validate(game.moves)
    return index_validated_line(game.moves)


def initialize(connection: sqlite3.Connection) -> None:
    initialize_database(connection)


def source_files(inputs: Iterable[Path]) -> Iterable[Path]:
    for source in inputs:
        if source.is_dir():
            yield from sorted(source.rglob("*.html"))
        elif source.is_file():
            yield source
        else:
            raise FileNotFoundError(source)


def require_import_environment() -> None:
    missing = [
        package for package in ROMANIZATION_DEPENDENCIES if importlib.util.find_spec(package) is None
    ]
    if missing:
        raise RuntimeError(
            f"missing import packages: {', '.join(missing)}. "
            "From the project root, run this command with "
            ".venv\\Scripts\\python.exe"
        )
    executable = default_executable()
    if not executable.is_file():
        raise RuntimeError(
            f"Pikafish is not installed at {executable}. "
            "Run scripts\\windows\\Install-Pikafish.ps1 from the project root."
        )


def _tag(tags: dict[str, str], *names: str) -> str:
    return next((tags[name] for name in names if tags.get(name)), "")


def _rating(value: str) -> int | None:
    match = re.search(r"(?<!\d)(\d{3,5})(?!\d)", value)
    return int(match.group(1)) if match else None


GAME_COLUMNS = (
    "id",
    "external_id",
    "canonical_hash",
    "line_hash",
    "red_name",
    "red_name_romanized",
    "red_name_romanization",
    "red_name_key",
    "red_entry",
    "red_team",
    "red_country",
    "red_level",
    "red_name_english",
    "red_time",
    "black_name",
    "black_name_romanized",
    "black_name_romanization",
    "black_name_key",
    "black_entry",
    "black_team",
    "black_country",
    "black_level",
    "black_name_english",
    "black_time",
    "red_rating",
    "black_rating",
    "result",
    "played_at",
    "year",
    "month",
    "event",
    "round",
    "opening",
    "title",
    "game_type",
    "game_class",
    "group_name",
    "place",
    "time_rule",
    "table_name",
    "end_type",
    "judge",
    "game_record",
    "remark",
    "author",
    "reference",
    "other",
    "added_at",
    "edited_at",
    "metadata_json",
    "moves",
    "notations",
    "source_url",
)
BACKFILL_COLUMNS = tuple(
    column
    for column in GAME_COLUMNS
    if column
    not in {"id", "external_id", "canonical_hash", "line_hash", "moves", "notations"}
)


def _game_row(
    game: ImportedGame,
    red_name,
    black_name,
    *,
    game_source: str = "dpxq",
    storage_external_id: str | None = None,
    notations: Sequence[str] = (),
) -> dict[str, object]:
    tags = game.source_metadata
    year_text = game.played_at[:4]
    stored_id = storage_external_id or game.external_id
    return {
        "id": stable_game_id(game.canonical_hash),
        "external_id": stored_id,
        "canonical_hash": game.canonical_hash,
        "line_hash": line_hash(game.moves),
        "red_name": red_name.native,
        "red_name_romanized": red_name.romanized,
        "red_name_romanization": red_name.system,
        "red_name_key": red_name.search_key,
        "red_entry": _tag(tags, "red"),
        "red_team": _tag(tags, "redteam"),
        "red_country": _tag(tags, "redcountry", "rednation", "rednationality"),
        "red_level": _tag(tags, "redlevel"),
        "red_name_english": _tag(tags, "redeng"),
        "red_time": _tag(tags, "redtime"),
        "black_name": black_name.native,
        "black_name_romanized": black_name.romanized,
        "black_name_romanization": black_name.system,
        "black_name_key": black_name.search_key,
        "black_entry": _tag(tags, "black"),
        "black_team": _tag(tags, "blackteam"),
        "black_country": _tag(tags, "blackcountry", "blacknation", "blacknationality"),
        "black_level": _tag(tags, "blacklevel"),
        "black_name_english": _tag(tags, "blackeng"),
        "black_time": _tag(tags, "blacktime"),
        "red_rating": _rating(_tag(tags, "redrating")),
        "black_rating": _rating(_tag(tags, "blackrating")),
        "result": game.result,
        "played_at": game.played_at,
        "year": int(year_text) if year_text.isdigit() and year_text != "0000" else None,
        "month": (
            game.played_at[:7]
            if re.fullmatch(r"\d{4}-\d{2}", game.played_at[:7])
            else None
        ),
        "event": game.event,
        "round": game.round,
        "opening": game.opening,
        "title": _tag(tags, "title"),
        "game_type": _tag(tags, "gametype"),
        "game_class": _tag(tags, "class"),
        "group_name": _tag(tags, "group"),
        "place": _tag(tags, "place"),
        "time_rule": _tag(tags, "timerule"),
        "table_name": _tag(tags, "table"),
        "end_type": _tag(tags, "endtype"),
        "judge": _tag(tags, "judge"),
        "game_record": _tag(tags, "record"),
        "remark": _tag(tags, "remark"),
        "author": _tag(tags, "author"),
        "reference": _tag(tags, "refer"),
        "other": _tag(tags, "other"),
        "added_at": _tag(tags, "adddate").replace(" ", "T", 1),
        "edited_at": _tag(tags, "editdate").replace(" ", "T", 1),
        # Source-owned metadata and annotations live on game_sources. Keeping
        # the canonical projection empty avoids duplicating large AI arrays or
        # commentary from whichever witness happened to arrive first.
        "metadata_json": "{}",
        "moves": json.dumps(game.moves, separators=(",", ":")),
        "notations": json.dumps(notations, ensure_ascii=False, separators=(",", ":")),
        "source_url": game.source_url,
    }


class DpxqImporter:
    """Persistent importer used by both directory imports and live scraping."""

    def __init__(
        self,
        database: Path = DEFAULT_DATABASE,
        *,
        game_source: str = "dpxq",
        default_collection: str = "m",
        commit_each: bool = False,
        progress: Callable[[dict[str, int], Path], None] | None = None,
        message: Callable[[str], None] | None = None,
    ) -> None:
        if default_collection not in DPXQ_COLLECTIONS:
            raise ValueError(f"unsupported DPXQ collection: {default_collection}")
        self.database = database
        self.game_source = game_source
        self.default_collection = default_collection
        self.commit_each = commit_each
        self.progress = progress
        self.message = message
        self.lock_retry = SqliteLockRetry(message=message)
        self.validator = PikafishGameValidator()
        self.connection: sqlite3.Connection | None = None
        self.counts = {"seen": 0, "imported": 0, "duplicate": 0, "invalid": 0}
        self.name_forms = None
        self.existing_records: set[tuple[str, str]] = set()
        self.rejected_records: set[tuple[str, str]] = set()
        self.existing_hashes: dict[bytes, str] = {}

    def __enter__(self) -> "DpxqImporter":
        require_import_environment()
        from external.xiangqi_explorer.name_romanization import name_forms

        self.name_forms = name_forms
        self.validator.start()
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.database, timeout=0)

        def open_database() -> tuple[
            set[tuple[str, str]], set[tuple[str, str]], dict[bytes, str]
        ]:
            assert self.connection is not None
            initialize(self.connection)
            self.connection.commit()
            records = {
                (row[0], row[1])
                for row in self.connection.execute(
                    "SELECT collection, external_id FROM game_sources WHERE source = 'dpxq'"
                )
            }
            hashes = {
                bytes(row[0]): row[1]
                for row in self.connection.execute(
                    """
                    SELECT canonical_hash, id FROM games
                    """
                )
            }
            rejected = {
                (row[0], row[1])
                for row in self.connection.execute(
                    """
                    SELECT collection, external_id FROM ingest_failures
                    WHERE source = 'dpxq'
                    """
                )
            }
            return records, rejected, hashes

        (
            self.existing_records,
            self.rejected_records,
            self.existing_hashes,
        ) = self.lock_retry.run(open_database, context="opening the catalog")
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def _storage_external_id(self, owner: str, external_id: str) -> str:
        if self.game_source == "dpxq" and owner == "m":
            return external_id
        return f"{owner}:{external_id}"

    def _execute(self, sql: str, parameters=()):
        if self.connection is None:
            raise RuntimeError("DPXQ importer session is not open")
        return self.lock_retry.run(
            lambda: self.connection.execute(sql, parameters),
            context="updating the catalog",
        )

    def _executemany(self, sql: str, parameters):
        if self.connection is None:
            raise RuntimeError("DPXQ importer session is not open")
        rows = tuple(parameters)
        return self.lock_retry.run(
            lambda: self.connection.executemany(sql, rows),
            context="indexing game positions",
        )

    def _commit(self) -> None:
        if self.connection is not None:
            self.lock_retry.run(self.connection.commit, context="committing imported games")

    def _record_source(self, game: ImportedGame, game_id: str, path: Path) -> None:
        if self.connection is None:
            raise RuntimeError("DPXQ importer session is not open")
        raw_checksum, acquired_at = source_file_provenance(path)
        self.lock_retry.run(
            lambda: upsert_source_record(
                self.connection,
                source="dpxq",
                collection=game.owner,
                collection_name=DPXQ_COLLECTIONS[game.owner],
                external_id=game.external_id,
                game_id=game_id,
                source_url=game.source_url,
                metadata=game.source_metadata,
                moves=game.moves,
                parser_version="dpxq-dhtmlxq-v2",
                raw_checksum=raw_checksum,
                acquired_at=acquired_at,
            ),
            context="recording source provenance",
        )
        self.existing_records.add((game.owner, game.external_id))
        clear_ingest_failure(
            self.connection,
            source="dpxq",
            collection=game.owner,
            external_id=game.external_id,
        )

    def import_path(
        self,
        path: Path,
        external_id: str | None = None,
        owner: str | None = None,
    ) -> None:
        if self.connection is None or self.name_forms is None:
            raise RuntimeError("DPXQ importer session is not open")
        self.counts["seen"] += 1
        savepoint = "dpxq_game_import"
        savepoint_open = False
        imported_new = False
        try:
            self._execute(f"SAVEPOINT {savepoint}")
            savepoint_open = True
            game = parse_game(
                path,
                external_id=external_id,
                owner=owner or self.default_collection,
            )
            positions = validate_and_index(game, self.validator)
            red_name = self.name_forms(game.red_name)
            black_name = self.name_forms(game.black_name)
            storage_external_id = self._storage_external_id(game.owner, game.external_id)
            row = _game_row(
                game,
                red_name,
                black_name,
                game_source=self.game_source,
                storage_external_id=storage_external_id,
                notations=[position[3] for position in positions],
            )
            insert_columns = ", ".join(GAME_COLUMNS)
            insert_values = ", ".join(f":{column}" for column in GAME_COLUMNS)
            existing_game_id = self.existing_hashes.get(game.canonical_hash)
            if existing_game_id is None:
                cursor = self._execute(
                    f"INSERT OR IGNORE INTO games(source, {insert_columns}) "
                    f"VALUES (:game_source, {insert_values})",
                    {**row, "game_source": self.game_source},
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
                    (
                        (game_id, *position)
                        for position in first_position_occurrences(positions)
                    ),
                )
                imported_new = True
            else:
                game_id = existing_game_id or self._execute(
                    "SELECT id FROM games WHERE source = ? AND external_id = ?",
                    (self.game_source, storage_external_id),
                ).fetchone()[0]
                if game_id == row["id"]:
                    assignments = ", ".join(
                        f"{column} = :{column}" for column in BACKFILL_COLUMNS
                    )
                    self._execute(
                        f"UPDATE games SET {assignments} WHERE id = :id",
                        row,
                    )
            self._record_source(game, game_id, path)
            self._execute(f"RELEASE SAVEPOINT {savepoint}")
            savepoint_open = False
            if imported_new:
                self.counts["imported"] += 1
                self.existing_hashes[game.canonical_hash] = game_id
            else:
                self.counts["duplicate"] += 1
        except (OSError, UnicodeError, ValueError, sqlite3.DatabaseError) as exc:
            if savepoint_open:
                self._execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
                self._execute(f"RELEASE SAVEPOINT {savepoint}")
            identifier = RECORD_ID_PATTERN.search(path.name)
            failure_owner = owner or (identifier.group(1) if identifier else self.default_collection)
            failure_external_id = external_id or (identifier.group(2) if identifier else path.stem)
            self.existing_records.discard((failure_owner, failure_external_id))
            try:
                raw_checksum, _acquired_at = source_file_provenance(path)
            except OSError:
                raw_checksum = ""
            record_ingest_failure(
                self.connection,
                source="dpxq",
                collection=failure_owner,
                external_id=failure_external_id,
                stage="game_import",
                error=exc,
                parser_version="dpxq-dhtmlxq-v2",
                raw_checksum=raw_checksum,
            )
            self.rejected_records.add((failure_owner, failure_external_id))
            self.counts["invalid"] += 1
            rejection = f"Rejected {path}: {exc}"
            if self.message:
                self.message(rejection)
            else:
                print(rejection, file=sys.stderr)
        if self.commit_each or self.counts["seen"] % 250 == 0:
            self._commit_visible()
        if self.progress:
            self.progress(self.counts, path)

    def import_if_missing(
        self,
        path: Path,
        external_id: str,
        owner: str | None = None,
    ) -> None:
        """Skip expensive re-import only when a committed row already exists."""

        resolved_owner = owner or self.default_collection
        source_key = (resolved_owner, external_id)
        if (
            source_key in self.existing_records
            or source_key in self.rejected_records
        ):
            self.counts["seen"] += 1
            self.counts["duplicate"] += 1
            if self.progress:
                self.progress(self.counts, path)
            return

        # A source ID may be absent because its game was already stored under a
        # different DPXQ ID by content de-duplication. Parsing the cached HTML is
        # cheap; avoid replaying the whole duplicate through Pikafish on every
        # restart.
        try:
            game = parse_game(path, external_id=external_id, owner=resolved_owner)
            game_id = self.existing_hashes.get(game.canonical_hash)
            if game_id is not None:
                self.counts["seen"] += 1
                self.counts["duplicate"] += 1
                self._record_source(game, game_id, path)
                if self.commit_each:
                    self._commit_visible()
                if self.progress:
                    self.progress(self.counts, path)
                return
        except (OSError, UnicodeError, ValueError):
            pass
        self.import_path(path, external_id=external_id, owner=resolved_owner)

    def _commit_visible(self, *, update_counts: bool = False) -> None:
        if self.connection is None:
            return
        if not update_counts:
            self._commit()
            return
        # A legacy master scraper may still be running while this migration is
        # deployed. Reconcile any rows it committed after ``initialize`` so a
        # concurrent/continued download cannot leave category membership gaps.
        self._execute(
            """
            INSERT OR IGNORE INTO game_sources(
              source, collection, collection_name, external_id, game_id,
              source_url, metadata_json
            )
            SELECT 'dpxq', 'm', '大师对局', external_id, id, source_url, metadata_json
            FROM games
            WHERE source = 'dpxq'
            """
        )
        master_count = self._execute(
            """
            SELECT count(DISTINCT game_id) FROM game_sources
            WHERE source = 'dpxq' AND collection = 'm'
            """
        ).fetchone()[0]
        online_game_count, online_record_count = self._execute(
            """
            SELECT count(DISTINCT game_id), count(*) FROM game_sources
            WHERE source = 'dpxq' AND collection <> 'm'
            """
        ).fetchone()
        self._execute(
            "INSERT OR REPLACE INTO metadata(key, value) VALUES ('dpxq_game_count', ?)",
            (str(master_count),),
        )
        self._execute(
            "INSERT OR REPLACE INTO metadata(key, value) "
            "VALUES ('dpxq_online_game_count', ?)",
            (str(online_game_count),),
        )
        self._execute(
            "INSERT OR REPLACE INTO metadata(key, value) "
            "VALUES ('dpxq_online_record_count', ?)",
            (str(online_record_count),),
        )
        self._commit()

    def close(self) -> None:
        connection, self.connection = self.connection, None
        try:
            if connection is not None:
                self.connection = connection
                try:
                    self._commit_visible(update_counts=True)
                finally:
                    self.connection = None
                    connection.close()
        finally:
            self.validator.close()


def import_files(
    inputs: Iterable[Path],
    database: Path = DEFAULT_DATABASE,
    *,
    progress: Callable[[dict[str, int], Path], None] | None = None,
    message: Callable[[str], None] | None = None,
) -> dict[str, int]:
    with DpxqImporter(database, progress=progress, message=message) as importer:
        for path in source_files(inputs):
            importer.import_path(path)
        return importer.counts


def main() -> None:
    parser = argparse.ArgumentParser(description="Import DPXQ DhtmlXQ master-game records")
    parser.add_argument("inputs", nargs="+", type=Path, help="HTML files or directories")
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    args = parser.parse_args()
    counts = import_files(args.inputs, args.database)
    print(json.dumps(counts, ensure_ascii=False))


if __name__ == "__main__":
    main()
