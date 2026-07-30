"""Download, validate, and import Elephantchess.io's anonymized PvP dataset."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shutil
import sqlite3
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

from tools.xiangqi_data.dpxq_import import (
    GAME_COLUMNS,
    ImportedGame,
    _game_row,
    require_import_environment,
    validate_and_index,
)
from tools.xiangqi_data.pikafish_rules import PikafishGameValidator

from .provenance import (
    clear_ingest_failure,
    record_ingest_failure,
    upsert_source_record,
)
from .storage import (
    DATA_DIRECTORY,
    database_path,
    first_position_occurrences,
    initialize,
)

DATASET_PAGE_URL = "https://elephantchess.io/about/datasets"
SOURCE = "elephantchess"
COLLECTION = "games"
COLLECTION_NAME = "Elephantchess.io"
PARSER_VERSION = "elephantchess-pvp-csv-v1"
DEFAULT_OUTPUT = DATA_DIRECTORY / "elephantchess"
DEFAULT_USER_AGENT = "Lixiangqi-Elephantchess-Dataset-Importer/1.0"

ARCHIVE_NAME_PATTERN = re.compile(
    r"^pvp_game_moves_xiangqi_(?P<month>\d{4}-\d{2})\.zip$",
    re.IGNORECASE,
)
CSV_NAME_PATTERN = re.compile(
    r"^pvp_game_moves_xiangqi_\d+\.csv$",
    re.IGNORECASE,
)
ZERO_BASED_MOVE_PATTERN = re.compile(r"^([a-i])([0-9])([a-i])([0-9])$")
OUTCOMES = {"RED_WINS": 1, "DRAW": 0, "BLACK_WINS": -1}
MAX_EXTRACTED_BYTES = 4 * 1024 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class DatasetArchive:
    url: str
    month: str

    @property
    def name(self) -> str:
        return Path(urllib.parse.urlparse(self.url).path).name


@dataclass(frozen=True, slots=True)
class CsvGame:
    external_id: str
    red_identity: str
    black_identity: str
    red_rating: int | None
    black_rating: int | None
    result: int
    played_at: str
    moves: tuple[str, ...]
    metadata: dict[str, str]
    raw_checksum: str


class _LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        if tag.casefold() != "a":
            return
        href = dict(attrs).get("href")
        if href:
            self.links.append(href)


def dataset_archives(
    document: str, *, page_url: str = DATASET_PAGE_URL
) -> list[DatasetArchive]:
    parser = _LinkParser()
    parser.feed(document)
    archives: dict[str, DatasetArchive] = {}
    for href in parser.links:
        url = urllib.parse.urljoin(page_url, href)
        name = Path(urllib.parse.urlparse(url).path).name
        match = ARCHIVE_NAME_PATTERN.fullmatch(name)
        if match:
            archives[url] = DatasetArchive(url=url, month=match.group("month"))
    return sorted(archives.values(), key=lambda item: (item.month, item.url))


def _download(
    url: str,
    *,
    timeout: float,
    retries: int,
    retry_backoff: float,
    user_agent: str,
) -> tuple[bytes, str]:
    request = urllib.request.Request(url, headers={"User-Agent": user_agent})
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                content_type = response.headers.get_content_type()
                return response.read(), content_type
        except OSError:
            if attempt >= retries:
                raise
            time.sleep(retry_backoff * (2**attempt))
    raise AssertionError("unreachable")


def latest_archive(
    *,
    page_url: str = DATASET_PAGE_URL,
    timeout: float = 45.0,
    retries: int = 4,
    retry_backoff: float = 2.0,
    user_agent: str = DEFAULT_USER_AGENT,
) -> DatasetArchive:
    document, _content_type = _download(
        page_url,
        timeout=timeout,
        retries=retries,
        retry_backoff=retry_backoff,
        user_agent=user_agent,
    )
    archives = dataset_archives(document.decode("utf-8-sig"), page_url=page_url)
    if not archives:
        raise RuntimeError("Elephantchess.io datasets page contains no Xiangqi archive")
    return archives[-1]


def download_archive(
    archive: DatasetArchive,
    output: Path,
    *,
    timeout: float = 45.0,
    retries: int = 4,
    retry_backoff: float = 2.0,
    user_agent: str = DEFAULT_USER_AGENT,
) -> tuple[Path, str, str]:
    payload, content_type = _download(
        archive.url,
        timeout=timeout,
        retries=retries,
        retry_backoff=retry_backoff,
        user_agent=user_agent,
    )
    if not payload.startswith(b"PK"):
        raise RuntimeError(
            "Elephantchess.io dataset response is not a ZIP archive "
            f"(content type {content_type or 'unknown'})"
        )
    checksum = hashlib.sha256(payload).hexdigest()
    acquired_at = datetime.now(timezone.utc).isoformat()
    output.mkdir(parents=True, exist_ok=True)
    path = output / archive.name
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_bytes(payload)
    temporary.replace(path)
    return path, checksum, acquired_at


def extract_csvs(archive: Path, output: Path, checksum: str) -> list[Path]:
    destination = output / "extracted" / archive.stem
    marker = destination / ".archive-sha256"
    existing = sorted(destination.glob("*.csv")) if destination.is_dir() else []
    if existing and marker.is_file() and marker.read_text(encoding="ascii").strip() == checksum:
        return existing

    extraction_root = output / "extracted"
    extraction_root.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{archive.stem}-", dir=extraction_root))
    try:
        with zipfile.ZipFile(archive) as zipped:
            members = [
                member
                for member in zipped.infolist()
                if not member.is_dir()
                and CSV_NAME_PATTERN.fullmatch(Path(member.filename).name)
            ]
            if not members:
                raise RuntimeError("Elephantchess.io archive contains no expected CSV files")
            if sum(member.file_size for member in members) > MAX_EXTRACTED_BYTES:
                raise RuntimeError("Elephantchess.io archive is unexpectedly large")
            for member in members:
                if member.filename != Path(member.filename).name:
                    raise RuntimeError(
                        f"unsafe Elephantchess.io archive member: {member.filename}"
                    )
                target = temporary / member.filename
                with zipped.open(member) as source, target.open("wb") as sink:
                    shutil.copyfileobj(source, sink)
        (temporary / ".archive-sha256").write_text(checksum + "\n", encoding="ascii")
        if destination.exists():
            shutil.rmtree(destination)
        temporary.replace(destination)
    except BaseException as error:
        shutil.rmtree(temporary, ignore_errors=True)
        if isinstance(error, zipfile.BadZipFile):
            raise RuntimeError(
                "Elephantchess.io dataset is not a valid ZIP archive"
            ) from error
        raise
    return sorted(destination.glob("*.csv"))


def zero_based_move_to_uci(move: str) -> str:
    match = ZERO_BASED_MOVE_PATTERN.fullmatch(move.strip().casefold())
    if not match:
        raise ValueError(f"invalid Elephantchess.io move: {move}")
    return (
        f"{match.group(1)}{int(match.group(2)) + 1}"
        f"{match.group(3)}{int(match.group(4)) + 1}"
    )


def _optional_int(value: str) -> int | None:
    text = value.strip()
    if not text:
        return None
    parsed = int(text)
    if parsed < 0:
        raise ValueError(f"invalid negative rating: {value}")
    return parsed


def _normalized_timestamp(value: str) -> str:
    text = value.strip()
    if not text:
        raise ValueError("Elephantchess.io game has no timestamp")
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_csv_game(
    rows: Sequence[dict[str, str]],
    *,
    archive_name: str,
    csv_name: str,
) -> CsvGame:
    if not rows:
        raise ValueError("empty Elephantchess.io game")
    external_id = rows[0].get("game_id", "").strip()
    if not external_id or len(external_id) > 160:
        raise ValueError("invalid Elephantchess.io game id")
    ordered = sorted(rows, key=lambda row: int(row.get("move_index", "")))
    indexes = [int(row.get("move_index", "")) for row in ordered]
    if indexes != list(range(len(ordered))):
        raise ValueError(
            f"Elephantchess.io game {external_id} has non-contiguous move indexes"
        )
    if any(row.get("game_id", "").strip() != external_id for row in ordered):
        raise ValueError("mixed Elephantchess.io game IDs in one CSV group")

    first = ordered[0]
    outcome = first.get("outcome", "").strip().upper()
    if outcome not in OUTCOMES:
        raise ValueError(
            f"unsupported Elephantchess.io outcome: {outcome or '(missing)'}"
        )
    red_identity = first.get("red_player", "").strip()
    black_identity = first.get("black_player", "").strip()
    if not red_identity or not black_identity:
        raise ValueError("Elephantchess.io game is missing anonymized player IDs")

    checksum_payload = json.dumps(
        ordered, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    metadata = {
        "source": COLLECTION_NAME,
        "archive": archive_name,
        "csv": csv_name,
        "license": "GPL-3.0",
        "timerule": first.get("time_control", "").strip(),
        "time_control_category": first.get("time_control_category", "").strip(),
        "rating_mode": first.get("rating_mode", "").strip(),
        "endtype": first.get("game_status", "").strip(),
        "game_join_source": first.get("game_join_source", "").strip(),
        "gametype": "Player vs Player",
        "redrating": first.get("red_elo_before", "").strip(),
        "blackrating": first.get("black_elo_before", "").strip(),
    }
    return CsvGame(
        external_id=external_id,
        red_identity=red_identity,
        black_identity=black_identity,
        red_rating=_optional_int(first.get("red_elo_before", "")),
        black_rating=_optional_int(first.get("black_elo_before", "")),
        result=OUTCOMES[outcome],
        played_at=_normalized_timestamp(first.get("timestamp", "")),
        moves=tuple(zero_based_move_to_uci(row.get("move", "")) for row in ordered),
        metadata=metadata,
        raw_checksum=hashlib.sha256(checksum_payload).hexdigest(),
    )


def csv_game_groups(paths: Iterable[Path]) -> Iterator[tuple[Path, list[dict[str, str]]]]:
    for path in sorted(paths):
        with path.open("r", encoding="utf-8-sig", newline="") as source:
            reader = csv.DictReader(source)
            required = {
                "timestamp",
                "move_index",
                "move",
                "game_id",
                "red_player",
                "black_player",
                "outcome",
            }
            if reader.fieldnames is None or not required.issubset(reader.fieldnames):
                missing = sorted(required.difference(reader.fieldnames or ()))
                raise RuntimeError(
                    f"{path.name} is missing required columns: {', '.join(missing)}"
                )
            current_id = ""
            group: list[dict[str, str]] = []
            closed: set[str] = set()
            for row in reader:
                game_id = row.get("game_id", "").strip()
                if not game_id:
                    raise RuntimeError(f"{path.name} contains a row without a game ID")
                if current_id and game_id != current_id:
                    closed.add(current_id)
                    yield path, group
                    group = []
                if game_id in closed:
                    raise RuntimeError(
                        f"{path.name} contains non-contiguous rows for game {game_id}"
                    )
                current_id = game_id
                group.append({key: value or "" for key, value in row.items()})
            if group:
                yield path, group


class ElephantchessImporter:
    def __init__(self, database: Path) -> None:
        self.database = database
        self.connection: sqlite3.Connection | None = None
        self.validator = PikafishGameValidator()
        self.name_forms = None
        self.existing_records: set[str] = set()
        self.rejected_records: dict[str, str] = {}
        self.existing_hashes: dict[bytes, str] = {}
        self.counts = {"seen": 0, "imported": 0, "duplicate": 0, "invalid": 0}

    def __enter__(self) -> "ElephantchessImporter":
        require_import_environment()
        from external.xiangqi_explorer.name_romanization import name_forms

        self.name_forms = name_forms
        self.validator.start()
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.database, timeout=30)
        self.connection.execute("PRAGMA foreign_keys = ON")
        initialize(self.connection)
        self.connection.commit()
        self.existing_records = {
            str(row[0])
            for row in self.connection.execute(
                "SELECT external_id FROM game_sources WHERE source = ? AND collection = ?",
                (SOURCE, COLLECTION),
            )
        }
        self.rejected_records = {
            str(row[0]): str(row[1])
            for row in self.connection.execute(
                """
                SELECT external_id, raw_checksum FROM ingest_failures
                WHERE source = ? AND collection = ?
                """,
                (SOURCE, COLLECTION),
            )
        }
        self.existing_hashes = {
            bytes(row[0]): str(row[1])
            for row in self.connection.execute("SELECT canonical_hash, id FROM games")
        }
        return self

    def __exit__(self, *_exc: object) -> None:
        if self.connection is not None:
            self.connection.commit()
            self.connection.close()
            self.connection = None
        self.validator.close()

    def import_groups(
        self,
        groups: Iterable[tuple[Path, list[dict[str, str]]]],
        *,
        archive_name: str,
        acquired_at: str,
    ) -> dict[str, int]:
        if self.connection is None or self.name_forms is None:
            raise RuntimeError("Elephantchess.io importer is not open")
        anonymous = self.name_forms("Anonymous")
        for path, rows in groups:
            self.counts["seen"] += 1
            external_id = rows[0].get("game_id", "").strip() or path.stem
            raw_checksum = hashlib.sha256(
                json.dumps(
                    rows, ensure_ascii=False, sort_keys=True, separators=(",", ":")
                ).encode("utf-8")
            ).hexdigest()
            if external_id in self.existing_records:
                self.counts["duplicate"] += 1
                continue
            if self.rejected_records.get(external_id) == raw_checksum:
                self.counts["duplicate"] += 1
                continue
            savepoint = "elephantchess_game_import"
            self.connection.execute(f"SAVEPOINT {savepoint}")
            try:
                game = parse_csv_game(
                    rows, archive_name=archive_name, csv_name=path.name
                )
                imported = ImportedGame(
                    owner=COLLECTION,
                    external_id=game.external_id,
                    red_name=game.red_identity,
                    black_name=game.black_identity,
                    result=game.result,
                    played_at=game.played_at,
                    event="Elephantchess.io PvP",
                    round="",
                    opening="",
                    moves=game.moves,
                    source_url=DATASET_PAGE_URL,
                    source_metadata=game.metadata,
                )
                positions = validate_and_index(imported, self.validator)
                row = _game_row(
                    imported,
                    anonymous,
                    anonymous,
                    game_source=SOURCE,
                    storage_external_id=game.external_id,
                    notations=[position[3] for position in positions],
                )
                existing_game_id = self.existing_hashes.get(imported.canonical_hash)
                if existing_game_id is None:
                    columns = ", ".join(GAME_COLUMNS)
                    values = ", ".join(f":{column}" for column in GAME_COLUMNS)
                    cursor = self.connection.execute(
                        f"""
                        INSERT OR IGNORE INTO games(source, {columns})
                        VALUES (:source, {values})
                        """,
                        {**row, "source": SOURCE},
                    )
                else:
                    cursor = None
                if cursor is not None and cursor.rowcount:
                    game_id = str(row["id"])
                    self.connection.executemany(
                        """
                        INSERT INTO game_positions(
                          game_id, ply, position_key, move, notation
                        ) VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            (game_id, *position)
                            for position in first_position_occurrences(positions)
                        ),
                    )
                    self.existing_hashes[imported.canonical_hash] = game_id
                    self.counts["imported"] += 1
                else:
                    game_id = existing_game_id or str(
                        self.connection.execute(
                            "SELECT id FROM games WHERE canonical_hash = ?",
                            (imported.canonical_hash,),
                        ).fetchone()[0]
                    )
                    self.counts["duplicate"] += 1
                upsert_source_record(
                    self.connection,
                    source=SOURCE,
                    collection=COLLECTION,
                    collection_name=COLLECTION_NAME,
                    external_id=game.external_id,
                    game_id=game_id,
                    source_url=DATASET_PAGE_URL,
                    metadata=game.metadata,
                    moves=game.moves,
                    parser_version=PARSER_VERSION,
                    raw_checksum=game.raw_checksum,
                    acquired_at=acquired_at,
                )
                clear_ingest_failure(
                    self.connection,
                    source=SOURCE,
                    collection=COLLECTION,
                    external_id=game.external_id,
                )
                self.existing_records.add(game.external_id)
                self.rejected_records.pop(game.external_id, None)
                self.connection.execute(f"RELEASE SAVEPOINT {savepoint}")
            except (OSError, UnicodeError, ValueError, sqlite3.DatabaseError) as error:
                self.connection.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
                self.connection.execute(f"RELEASE SAVEPOINT {savepoint}")
                record_ingest_failure(
                    self.connection,
                    source=SOURCE,
                    collection=COLLECTION,
                    external_id=external_id,
                    stage="game_import",
                    error=error,
                    parser_version=PARSER_VERSION,
                    raw_checksum=raw_checksum,
                )
                self.rejected_records[external_id] = raw_checksum
                self.counts["invalid"] += 1
                print(
                    f"Rejected Elephantchess.io game {external_id}: {error}",
                    file=sys.stderr,
                    flush=True,
                )
            if self.counts["seen"] % 250 == 0:
                self.connection.commit()
                print(
                    "Elephantchess.io: "
                    + ", ".join(
                        f"{name} {count:,}" for name, count in self.counts.items()
                    ),
                    flush=True,
                )
        self.connection.commit()
        return dict(self.counts)


def _record_sync(
    database: Path,
    *,
    archive: DatasetArchive,
    checksum: str,
    counts: dict[str, int],
) -> None:
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            INSERT INTO sync_state(
              source, scope, cursor, last_success_at, metadata_json
            ) VALUES (?, 'dataset', ?, ?, ?)
            ON CONFLICT(source, scope) DO UPDATE SET
              cursor = excluded.cursor,
              last_success_at = excluded.last_success_at,
              metadata_json = excluded.metadata_json
            """,
            (
                SOURCE,
                archive.month,
                datetime.now(timezone.utc).isoformat(),
                json.dumps(
                    {
                        "archive": archive.url,
                        "sha256": checksum,
                        "counts": counts,
                    },
                    separators=(",", ":"),
                ),
            ),
        )
        connection.commit()


def update(
    *,
    database: Path,
    output: Path,
    page_url: str,
    archive_url: str | None,
    timeout: float,
    retries: int,
    retry_backoff: float,
    user_agent: str,
) -> dict[str, int]:
    if archive_url:
        archive_name = Path(urllib.parse.urlparse(archive_url).path).name
        archive_match = ARCHIVE_NAME_PATTERN.fullmatch(archive_name)
        archive = DatasetArchive(
            url=archive_url,
            month=archive_match.group("month") if archive_match else "unknown",
        )
    else:
        archive = latest_archive(
            page_url=page_url,
            timeout=timeout,
            retries=retries,
            retry_backoff=retry_backoff,
            user_agent=user_agent,
        )
    print(f"Elephantchess.io dataset: {archive.url}", flush=True)
    path, checksum, acquired_at = download_archive(
        archive,
        output,
        timeout=timeout,
        retries=retries,
        retry_backoff=retry_backoff,
        user_agent=user_agent,
    )
    csvs = extract_csvs(path, output, checksum)
    print(f"Extracted {len(csvs)} Elephantchess.io CSV files.", flush=True)
    with ElephantchessImporter(database) as importer:
        counts = importer.import_groups(
            csv_game_groups(csvs),
            archive_name=archive.name,
            acquired_at=acquired_at,
        )
    _record_sync(database, archive=archive, checksum=checksum, counts=counts)
    print(
        "Elephantchess.io complete: "
        + ", ".join(f"{name} {count:,}" for name, count in counts.items()),
        flush=True,
    )
    return counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=database_path())
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--dataset-page", default=DATASET_PAGE_URL)
    parser.add_argument("--archive-url")
    parser.add_argument("--delay", type=float, default=0.0, help=argparse.SUPPRESS)
    parser.add_argument("--timeout", type=float, default=45.0)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--retry-backoff", type=float, default=2.0)
    parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    args = parser.parse_args(argv)
    if args.retries < 0:
        parser.error("--retries cannot be negative")
    update(
        database=args.database,
        output=args.output,
        page_url=args.dataset_page,
        archive_url=args.archive_url,
        timeout=args.timeout,
        retries=args.retries,
        retry_backoff=args.retry_backoff,
        user_agent=args.user_agent,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
