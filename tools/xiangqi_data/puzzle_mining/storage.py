"""SQLite persistence and atomic work claiming for puzzle mining."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from .models import CandidateRecord, EngineScore, SearchResult


SCHEMA_VERSION = 3
GENERATOR_VERSION = 2
BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


@dataclass(frozen=True)
class ClaimedJob:
    id: int
    discovery_version: str
    source_database: str
    game_id: str
    source_url: str
    claim_token: str
    attempts: int


@dataclass(frozen=True)
class ClaimedCandidate:
    id: int
    claim_token: str
    candidate_key: str
    source_database: str
    game_id: str
    source_url: str
    ply: int
    side_to_move: str
    pre_fen: str
    position_fen: str
    position_hash: str
    played_move: str
    best_move: str
    before_score: EngineScore
    after_score: EngineScore
    evaluation_loss: float
    candidate_type: str
    engine_version: str
    nnue: str
    search_settings: dict[str, Any]
    attempts: int


def now() -> str:
    return datetime.now(UTC).isoformat()


def open_database(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=30)
    connection.row_factory = sqlite3.Row
    existing_tables = {
        row["name"]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }
    if "candidates" in existing_tables:
        version = None
        if "metadata" in existing_tables:
            row = connection.execute(
                "SELECT value FROM metadata WHERE key = 'schema_version'"
            ).fetchone()
            version = row["value"] if row else None
        if version == "2":
            _migrate_schema_2_to_3(connection)
        elif version != str(SCHEMA_VERSION):
            connection.close()
            raise RuntimeError(
                f"Puzzle-mining database uses superseded schema {version or 'legacy'}; "
                f"create a new schema-{SCHEMA_VERSION} staging database."
            )
    schema = Path(__file__).with_name("puzzle_schema.sql").read_text(encoding="utf-8")
    connection.executescript(schema)
    version = connection.execute(
        "SELECT value FROM metadata WHERE key = 'schema_version'"
    ).fetchone()
    if version is not None and int(version["value"]) != SCHEMA_VERSION:
        connection.close()
        raise RuntimeError(
            f"Puzzle-mining database schema is {version['value']}; "
            f"expected {SCHEMA_VERSION}. Create a new staging database."
        )
    connection.execute(
        "INSERT OR REPLACE INTO metadata(key, value) VALUES ('schema_version', ?)",
        (str(SCHEMA_VERSION),),
    )
    connection.execute(
        "INSERT OR REPLACE INTO metadata(key, value) VALUES ('generator_version', ?)",
        (str(GENERATOR_VERSION),),
    )
    connection.commit()
    return connection


def _migrate_schema_2_to_3(connection: sqlite3.Connection) -> None:
    """Add revision-aware work tracking while preserving existing progress."""

    connection.execute("BEGIN IMMEDIATE")
    try:
        connection.execute("ALTER TABLE game_jobs RENAME TO game_jobs_v2")
        connection.execute(
            """
            CREATE TABLE game_jobs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              discovery_version TEXT NOT NULL,
              source_database TEXT NOT NULL,
              game_id TEXT NOT NULL,
              source_url TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'processing', 'complete', 'retry', 'rejected', 'failed')),
              attempts INTEGER NOT NULL DEFAULT 0,
              discovered_count INTEGER NOT NULL DEFAULT 0,
              claim_token TEXT,
              claimed_at TEXT,
              next_attempt_at TEXT,
              diagnostic TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE (discovery_version, source_database, game_id)
            )
            """
        )
        connection.execute(
            """
            INSERT INTO game_jobs(
              id, discovery_version, source_database, game_id, source_url,
              status, attempts, discovered_count, claim_token, claimed_at,
              next_attempt_at, diagnostic, created_at, updated_at
            )
            SELECT id, '1', source_database, game_id, source_url, status,
                   attempts, discovered_count, claim_token, claimed_at,
                   next_attempt_at, diagnostic, created_at, updated_at
            FROM game_jobs_v2
            """
        )
        connection.execute("DROP TABLE game_jobs_v2")
        connection.execute(
            "ALTER TABLE candidates ADD COLUMN categorization_version TEXT"
        )
        connection.execute("DROP INDEX IF EXISTS candidates_by_status")
        connection.execute(
            "UPDATE metadata SET value = ? WHERE key = 'schema_version'", (str(SCHEMA_VERSION),)
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def seed_game_job(
    connection: sqlite3.Connection,
    source_database: str,
    game_id: str,
    source_url: str,
    *,
    discovery_version: str = "1",
    commit: bool = True,
) -> bool:
    timestamp = now()
    cursor = connection.execute(
        """
        INSERT OR IGNORE INTO game_jobs(
          discovery_version, source_database, game_id, source_url, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        (discovery_version, source_database, game_id, source_url or "", timestamp, timestamp),
    )
    if commit:
        connection.commit()
    return cursor.rowcount == 1


def _requeue_stale(
    connection: sqlite3.Connection, table: str, stale_before: str
) -> None:
    connection.execute(
        f"""
        UPDATE {table}
        SET status = 'retry', claim_token = NULL, claimed_at = NULL,
            diagnostic = 'claim lease expired', updated_at = ?
        WHERE status = 'processing' AND claimed_at < ?
        """,
        (now(), stale_before),
    )


def claim_game_job(
    connection: sqlite3.Connection, *, discovery_version: str = "1", lease_seconds: int = 1800
) -> ClaimedJob | None:
    timestamp = datetime.now(UTC)
    stale_before = (timestamp - timedelta(seconds=lease_seconds)).isoformat()
    token = uuid.uuid4().hex
    connection.execute("BEGIN IMMEDIATE")
    try:
        _requeue_stale(connection, "game_jobs", stale_before)
        row = connection.execute(
            """
            SELECT * FROM game_jobs
            WHERE discovery_version = ? AND status IN ('queued', 'retry')
              AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
            ORDER BY id
            LIMIT 1
            """,
            (discovery_version, timestamp.isoformat()),
        ).fetchone()
        if row is None:
            connection.commit()
            return None
        cursor = connection.execute(
            """
            UPDATE game_jobs
            SET status = 'processing', attempts = attempts + 1,
                claim_token = ?, claimed_at = ?, updated_at = ?
            WHERE id = ? AND status IN ('queued', 'retry')
            """,
            (token, timestamp.isoformat(), timestamp.isoformat(), row["id"]),
        )
        if cursor.rowcount != 1:
            connection.rollback()
            return None
        connection.commit()
        return ClaimedJob(
            id=row["id"],
            discovery_version=row["discovery_version"],
            source_database=row["source_database"],
            game_id=row["game_id"],
            source_url=row["source_url"],
            claim_token=token,
            attempts=row["attempts"] + 1,
        )
    except Exception:
        connection.rollback()
        raise


def finish_game_job(
    connection: sqlite3.Connection, job: ClaimedJob, discovered_count: int
) -> None:
    _finish_claim(
        connection,
        "game_jobs",
        job.id,
        job.claim_token,
        "complete",
        "",
        extra=("discovered_count = ?", (discovered_count,)),
    )


def fail_game_job(
    connection: sqlite3.Connection,
    job: ClaimedJob,
    diagnostic: str,
    *,
    retryable: bool,
    max_attempts: int,
    retry_delay_seconds: int = 60,
) -> str:
    status = "retry" if retryable and job.attempts < max_attempts else "failed"
    next_attempt = (
        (datetime.now(UTC) + timedelta(seconds=retry_delay_seconds)).isoformat()
        if status == "retry"
        else None
    )
    _finish_claim(
        connection,
        "game_jobs",
        job.id,
        job.claim_token,
        status,
        diagnostic,
        next_attempt_at=next_attempt,
    )
    return status


def reject_game_job(
    connection: sqlite3.Connection, job: ClaimedJob, diagnostic: str
) -> None:
    _finish_claim(
        connection,
        "game_jobs",
        job.id,
        job.claim_token,
        "rejected",
        diagnostic,
    )


def insert_candidate(
    connection: sqlite3.Connection, candidate: CandidateRecord
) -> int | None:
    timestamp = now()
    cursor = connection.execute(
        """
        INSERT OR IGNORE INTO candidates(
          candidate_key, source_database, game_id, source_url, ply, side_to_move,
          pre_fen, position_fen, position_hash, played_move, best_move,
          before_score_json, after_score_json, evaluation_loss, candidate_type,
          engine_version, nnue, search_settings_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            candidate.candidate_key,
            candidate.source_database,
            candidate.game_id,
            candidate.source_url,
            candidate.ply,
            candidate.side_to_move,
            candidate.pre_fen,
            candidate.position_fen,
            candidate.position_hash,
            candidate.played_move,
            candidate.best_move,
            _json(candidate.before_score.to_dict()),
            _json(candidate.after_score.to_dict()),
            candidate.evaluation_loss,
            candidate.candidate_type,
            candidate.engine_version,
            candidate.nnue,
            _json(candidate.search_settings),
            timestamp,
            timestamp,
        ),
    )
    connection.commit()
    return int(cursor.lastrowid) if cursor.rowcount == 1 else None


def claim_checkmate_candidate(
    connection: sqlite3.Connection,
    *,
    categorization_version: str = "1",
    lease_seconds: int = 3600,
) -> ClaimedCandidate | None:
    timestamp = datetime.now(UTC)
    stale_before = (timestamp - timedelta(seconds=lease_seconds)).isoformat()
    token = uuid.uuid4().hex
    connection.execute("BEGIN IMMEDIATE")
    try:
        _requeue_stale(connection, "candidates", stale_before)
        row = connection.execute(
            """
            SELECT * FROM candidates
            WHERE candidate_type = 'checkmate_candidate'
              AND status != 'processing'
              AND (
                categorization_version IS NULL
                OR categorization_version != ?
                OR status IN ('pending', 'retry')
              )
              AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
            ORDER BY id
            LIMIT 1
            """,
            (categorization_version, timestamp.isoformat()),
        ).fetchone()
        if row is None:
            connection.commit()
            return None
        cursor = connection.execute(
            """
            UPDATE candidates
            SET status = 'processing',
                attempts = CASE
                  WHEN categorization_version IS NULL OR categorization_version != ? THEN 1
                  ELSE attempts + 1
                END,
                categorization_version = ?,
                claim_token = ?, claimed_at = ?, updated_at = ?
            WHERE id = ? AND status != 'processing'
              AND (
                categorization_version IS NULL
                OR categorization_version != ?
                OR status IN ('pending', 'retry')
              )
            """,
            (
                categorization_version,
                categorization_version,
                token,
                timestamp.isoformat(),
                timestamp.isoformat(),
                row["id"],
                categorization_version,
            ),
        )
        if cursor.rowcount != 1:
            connection.rollback()
            return None
        connection.commit()
        attempts = (
            1
            if row["categorization_version"] != categorization_version
            else row["attempts"] + 1
        )
        return _claimed_candidate(row, token, attempts=attempts)
    except Exception:
        connection.rollback()
        raise


def finish_candidate(
    connection: sqlite3.Connection,
    candidate: ClaimedCandidate,
    *,
    status: str,
    diagnostic: str = "",
    solution: list[str] | None = None,
    branches: list[dict[str, Any]] | None = None,
    themes: list[str] | None = None,
    verified_engine: str | None = None,
    verified_nnue: str | None = None,
    categorization_settings: dict[str, Any] | None = None,
    categorization_version: str = "1",
) -> None:
    if status not in {"published", "untagged", "review", "rejected", "failed"}:
        raise ValueError(f"invalid terminal candidate status: {status}")
    connection.execute("BEGIN IMMEDIATE")
    try:
        cursor = connection.execute(
            """
            UPDATE candidates
            SET status = ?, diagnostic = ?, solution_json = ?,
                solution_plies = ?, branches_json = ?, themes_json = ?,
                verified_engine_version = ?, verified_nnue = ?,
                categorization_settings_json = ?,
                categorization_version = ?,
                claim_token = NULL, claimed_at = NULL, next_attempt_at = NULL,
                updated_at = ?
            WHERE id = ? AND status = 'processing' AND claim_token = ?
            """,
            (
                status,
                diagnostic,
                _json(solution) if solution is not None else None,
                len(solution) if solution is not None else None,
                _json(branches) if branches is not None else None,
                _json(themes) if themes is not None else None,
                verified_engine,
                verified_nnue,
                _json(categorization_settings)
                if categorization_settings is not None
                else None,
                categorization_version,
                now(),
                candidate.id,
                candidate.claim_token,
            ),
        )
        if cursor.rowcount != 1:
            raise RuntimeError("candidate claim was lost")
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def retry_candidate(
    connection: sqlite3.Connection,
    candidate: ClaimedCandidate,
    diagnostic: str,
    *,
    max_attempts: int,
    retry_delay_seconds: int = 60,
) -> str:
    status = "retry" if candidate.attempts < max_attempts else "failed"
    next_attempt = (
        (datetime.now(UTC) + timedelta(seconds=retry_delay_seconds)).isoformat()
        if status == "retry"
        else None
    )
    _finish_claim(
        connection,
        "candidates",
        candidate.id,
        candidate.claim_token,
        status,
        diagnostic,
        next_attempt_at=next_attempt,
    )
    return status


def cache_key(
    initial_fen: str, moves: tuple[str, ...], nodes: int, multi_pv: int
) -> tuple[str, str]:
    context_hash = hashlib.sha256(
        _json({"fen": initial_fen, "moves": moves}).encode("utf-8")
    ).hexdigest()
    settings_hash = hashlib.sha256(
        _json({"nodes": nodes, "multi_pv": multi_pv}).encode("utf-8")
    ).hexdigest()
    return context_hash, settings_hash


def cached_analysis(
    connection: sqlite3.Connection,
    *,
    context_hash: str,
    engine_version: str,
    nnue: str,
    settings_hash: str,
) -> SearchResult | None:
    row = connection.execute(
        """
        SELECT result_json FROM analysis_cache
        WHERE context_hash = ? AND engine_version = ? AND nnue = ? AND settings_hash = ?
        """,
        (context_hash, engine_version, nnue, settings_hash),
    ).fetchone()
    return SearchResult.from_dict(json.loads(row["result_json"])) if row else None


def save_analysis(
    connection: sqlite3.Connection,
    *,
    context_hash: str,
    engine_version: str,
    nnue: str,
    settings_hash: str,
    result: SearchResult,
) -> None:
    connection.execute(
        """
        INSERT OR REPLACE INTO analysis_cache(
          context_hash, engine_version, nnue, settings_hash, result_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            context_hash,
            engine_version,
            nnue,
            settings_hash,
            _json(result.to_dict()),
            now(),
        ),
    )
    connection.commit()


def promote_puzzle(
    connection: sqlite3.Connection,
    candidate: ClaimedCandidate,
    *,
    solution: list[str],
    themes: list[str],
    engine: str,
    nnue: str,
    engine_nodes: int,
    engine_depth: int,
) -> str:
    puzzle_id = puzzle_id_for(connection, candidate.candidate_key)
    mate_in = (len(solution) + 1) // 2
    line = [candidate.played_move, *solution]
    connection.execute(
        """
        INSERT INTO puzzles(
          id, candidate_id, game_id, source_url, fen, display_fen, initial_ply,
          line, solution, solution_plies, mate_in, themes, engine, nnue,
          engine_nodes, engine_depth, generator_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(candidate_id) DO UPDATE SET
          line = excluded.line,
          solution = excluded.solution,
          solution_plies = excluded.solution_plies,
          mate_in = excluded.mate_in,
          themes = excluded.themes,
          engine = excluded.engine,
          nnue = excluded.nnue,
          engine_nodes = excluded.engine_nodes,
          engine_depth = excluded.engine_depth,
          generator_version = excluded.generator_version
        """,
        (
            puzzle_id,
            candidate.id,
            candidate.game_id,
            candidate.source_url,
            candidate.pre_fen,
            candidate.position_fen,
            candidate.ply - 1,
            _json(line),
            _json(solution),
            len(solution),
            mate_in,
            _json(themes),
            engine,
            nnue,
            engine_nodes,
            engine_depth,
            GENERATOR_VERSION,
            now(),
        ),
    )
    connection.commit()
    return puzzle_id


def puzzle_id_for(connection: sqlite3.Connection, candidate_key: str) -> str:
    for salt in range(10_000):
        digest = hashlib.sha256(f"{candidate_key}:{salt}".encode()).digest()
        value = int.from_bytes(digest[:8], "big") % (62**5)
        chars: list[str] = []
        for _ in range(5):
            value, remainder = divmod(value, 62)
            chars.append(BASE62[remainder])
        puzzle_id = "".join(chars)
        row = connection.execute(
            "SELECT c.candidate_key FROM puzzles p "
            "JOIN candidates c ON c.id = p.candidate_id WHERE p.id = ?",
            (puzzle_id,),
        ).fetchone()
        if row is None or row["candidate_key"] == candidate_key:
            return puzzle_id
    raise RuntimeError("could not allocate a stable puzzle ID")


def _finish_claim(
    connection: sqlite3.Connection,
    table: str,
    row_id: int,
    claim_token: str,
    status: str,
    diagnostic: str,
    *,
    next_attempt_at: str | None = None,
    extra: tuple[str, tuple[Any, ...]] | None = None,
) -> None:
    assignment = ""
    values: tuple[Any, ...] = ()
    if extra is not None:
        assignment = f", {extra[0]}"
        values = extra[1]
    cursor = connection.execute(
        f"""
        UPDATE {table}
        SET status = ?, diagnostic = ?, claim_token = NULL, claimed_at = NULL,
            next_attempt_at = ?, updated_at = ?{assignment}
        WHERE id = ? AND status = 'processing' AND claim_token = ?
        """,
        (status, diagnostic, next_attempt_at, now(), *values, row_id, claim_token),
    )
    if cursor.rowcount != 1:
        connection.rollback()
        raise RuntimeError(f"{table} claim was lost")
    connection.commit()


def _claimed_candidate(
    row: sqlite3.Row, token: str, *, attempts: int | None = None
) -> ClaimedCandidate:
    return ClaimedCandidate(
        id=row["id"],
        claim_token=token,
        candidate_key=row["candidate_key"],
        source_database=row["source_database"],
        game_id=row["game_id"],
        source_url=row["source_url"],
        ply=row["ply"],
        side_to_move=row["side_to_move"],
        pre_fen=row["pre_fen"],
        position_fen=row["position_fen"],
        position_hash=row["position_hash"],
        played_move=row["played_move"],
        best_move=row["best_move"],
        before_score=EngineScore.from_dict(json.loads(row["before_score_json"])),
        after_score=EngineScore.from_dict(json.loads(row["after_score_json"])),
        evaluation_loss=row["evaluation_loss"],
        candidate_type=row["candidate_type"],
        engine_version=row["engine_version"],
        nnue=row["nnue"],
        search_settings=json.loads(row["search_settings_json"]),
        attempts=row["attempts"] + 1 if attempts is None else attempts,
    )


def _json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))
