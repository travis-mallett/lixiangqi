"""SQLite persistence and atomic work claiming for puzzle mining."""

from __future__ import annotations
import hashlib
import json
import sqlite3
import uuid
import zlib
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from .discovery_settings import DEFAULT_DEPTH
from .models import CandidateRecord, EngineScore, SearchResult
from .position import position_hash
from .schema_migration import (
    migrate_schema_2_to_3,
    migrate_schema_3_to_4,
    migrate_schema_4_to_5,
    migrate_schema_5_to_6,
    migrate_schema_6_to_7,
    migrate_schema_7_to_8,
    migrate_schema_8_to_9,
    migrate_schema_9_to_10,
)
from .sources import NATIVE_PREFIX, is_native_source, native_origin

SCHEMA_VERSION = 20
GENERATOR_VERSION = 2


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
    revision_key: str
    attempts: int
    theme_versions: dict[str, str] = field(default_factory=dict)
    verifier_version: str = "1"


def now() -> str:
    return datetime.now(UTC).isoformat()


def open_database(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=30, uri=True)
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
        try:
            migrations = {
                2: migrate_schema_2_to_3,
                3: migrate_schema_3_to_4,
                4: migrate_schema_4_to_5,
                5: migrate_schema_5_to_6,
                6: migrate_schema_6_to_7,
                7: migrate_schema_7_to_8,
                8: migrate_schema_8_to_9,
                9: migrate_schema_9_to_10,
            }
            from importlib import import_module

            migrations[10] = import_module(
                "tools.data_migration.20260910_puzzle_assessment_v11"
            ).migrate
            migrations[11] = import_module(
                "tools.data_migration.20260911_puzzle_stages_v12"
            ).migrate
            migrations[12] = import_module(
                "tools.data_migration.20260913_puzzle_categories_v13"
            ).migrate
            migrations[13] = import_module(
                "tools.data_migration.20260915_puzzle_branch_counts_v14"
            ).migrate
            migrations[14] = import_module(
                "tools.data_migration.20260915_preserve_completed_solutions_v15"
            ).migrate
            migrations[15] = import_module(
                "tools.data_migration.20260915_tactic_endpoints_v16"
            ).migrate
            migrations[16] = import_module(
                "tools.data_migration.20260923_canonical_puzzle_solutions_v17"
            ).migrate
            migrations[17] = import_module(
                "tools.data_migration.20260924_unique_puzzle_positions_v18"
            ).migrate
            supported_kinds = import_module(
                "tools.data_migration.20260925_supported_puzzle_kinds_v20"
            )
            migrations[18] = supported_kinds.advance_18
            migrations[19] = supported_kinds.migrate
            if (
                version is None
                or not str(version).isdigit()
                or not 2 <= int(version) <= SCHEMA_VERSION
            ):
                raise RuntimeError(f"Unsupported puzzle-mining schema {version}")
            if int(version) < SCHEMA_VERSION:
                # The operator's local mining store is derived work, not the
                # live puzzle authority. Migrations commit one atomic step at a
                # time; ordinary tool initialization must not copy the database.
                for current_version in range(int(version), SCHEMA_VERSION):
                    migrations[current_version](connection)
        except Exception:
            connection.close()
            raise
    try:
        schema = (
            Path(__file__).with_name("puzzle_schema.sql").read_text(encoding="utf-8")
        )
        connection.executescript(schema)
        from .category_status import CATEGORY_SCHEMA

        connection.execute(CATEGORY_SCHEMA)
        version = connection.execute(
            "SELECT value FROM metadata WHERE key = 'schema_version'"
        ).fetchone()
        if version is not None and int(version["value"]) != SCHEMA_VERSION:
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
        from .inventory import install

        install(connection)
        from .game_analysis_depth import install_depth_coverage

        install_depth_coverage(connection)
        return connection
    except Exception:
        connection.close()
        raise


def seed_game_job(
    connection: sqlite3.Connection,
    source_database: str,
    game_id: str,
    source_url: str,
    *,
    discovery_version: str = "1",
    rescan: bool = False,
    depth: int = DEFAULT_DEPTH,
    commit: bool = True,
) -> bool:
    timestamp = now()
    active_row = connection.execute(
        "SELECT value FROM metadata WHERE key = 'active_discovery_version'"
    ).fetchone()
    version_changed = active_row is None or active_row["value"] != discovery_version
    if version_changed:
        connection.execute(
            """
            UPDATE game_jobs
            SET status = 'rejected', diagnostic = 'superseded by newer discovery revision',
                claim_token = NULL, claimed_at = NULL, next_attempt_at = NULL,
                updated_at = ?
            WHERE discovery_version != ? AND status IN ('queued', 'retry', 'processing')
            """,
            (timestamp, discovery_version),
        )
        connection.execute(
            "INSERT INTO metadata(key, value) VALUES ('active_discovery_version', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (discovery_version,),
        )
    cursor = connection.execute(
        """INSERT OR IGNORE INTO game_jobs(
          discovery_version, source_database, game_id, source_url, created_at, updated_at
        ) SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (
          SELECT 1 FROM game_analysis_depths
          WHERE source_database=? AND game_id=? AND depth>=?
        ) ON CONFLICT(discovery_version,source_database,game_id) DO UPDATE SET
          status='queued', attempts=0, diagnostic='', claim_token=NULL,
          claimed_at=NULL, next_attempt_at=NULL, updated_at=excluded.updated_at
        WHERE game_jobs.status='complete' OR
          (game_jobs.status='rejected' AND game_jobs.diagnostic='superseded by newer discovery revision')""",
        (
            discovery_version,
            source_database,
            game_id,
            source_url or "",
            timestamp,
            timestamp,
            source_database,
            game_id,
            depth,
        ),
    )
    if commit:
        connection.commit()
    return cursor.rowcount == 1


def activate_discovery_version(
    connection: sqlite3.Connection, discovery_version: str
) -> None:
    """Make one discovery revision canonical before seeding or claiming work."""

    timestamp = now()
    active_row = connection.execute(
        "SELECT value FROM metadata WHERE key = 'active_discovery_version'"
    ).fetchone()
    if active_row is not None and active_row["value"] == discovery_version:
        return
    connection.execute(
        """
        UPDATE game_jobs
        SET status = 'rejected', diagnostic = 'superseded by newer discovery revision',
            claim_token = NULL, claimed_at = NULL, next_attempt_at = NULL,
            updated_at = ?
        WHERE discovery_version != ? AND status IN ('queued', 'retry', 'processing')
        """,
        (timestamp, discovery_version),
    )
    connection.execute(
        "INSERT INTO metadata(key, value) VALUES ('active_discovery_version', ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (discovery_version,),
    )
    connection.commit()


def recover_stale_game_jobs(
    connection: sqlite3.Connection, *, lease_seconds: int = 1800
) -> int:
    """Return expired discovery claims to the retry queue before reporting status."""

    timestamp = datetime.now(UTC)
    stale_before = (timestamp - timedelta(seconds=lease_seconds)).isoformat()
    before = connection.total_changes
    _requeue_stale(connection, "game_jobs", stale_before)
    recovered = connection.total_changes - before
    connection.commit()
    return recovered


def _requeue_stale(
    connection: sqlite3.Connection, table: str, stale_before: str
) -> None:
    active_guard = (
        " AND NOT EXISTS (SELECT 1 FROM puzzles p WHERE p.candidate_id = candidates.id "
        "AND p.verification_status = 'active')"
        if table == "candidates"
        else ""
    )
    connection.execute(
        f"""
        UPDATE {table}
        SET status = 'retry', claim_token = NULL, claimed_at = NULL,
            diagnostic = 'claim lease expired', updated_at = ?
        WHERE status = 'processing' AND claimed_at < ?{active_guard}
        """,
        (now(), stale_before),
    )


def _next_game_job(connection, discovery_version, timestamp):
    # Resolve the native-game barrier before looking at the large catalog queue.
    native = connection.execute(
        """SELECT 1 FROM game_jobs WHERE discovery_version=?
        AND source_database LIKE ? AND status IN ('queued','retry','processing') LIMIT 1""",
        (discovery_version, f"{NATIVE_PREFIX}%"),
    ).fetchone()
    source_guard = "AND source_database LIKE ?" if native else ""
    index = "game_jobs_by_native_priority" if native else "game_jobs_ready_order"
    return connection.execute(
        f"""SELECT * FROM game_jobs INDEXED BY {index} WHERE discovery_version=?
        AND status IN ('queued','retry')
        AND (next_attempt_at IS NULL OR next_attempt_at<=?) {source_guard}
        ORDER BY id LIMIT 1""",
        (discovery_version, timestamp, *((f"{NATIVE_PREFIX}%",) if native else ())),
    ).fetchone()


def claim_game_job(
    connection: sqlite3.Connection,
    *,
    discovery_version: str = "1",
    lease_seconds: int = 1800,
) -> ClaimedJob | None:
    timestamp = datetime.now(UTC)
    stale_before = (timestamp - timedelta(seconds=lease_seconds)).isoformat()
    # Idle workers must not repeatedly acquire SQLite's single writer lock.
    # Recheck under the lock before claiming; this read is only a fast preflight.
    if _next_game_job(connection, discovery_version, timestamp.isoformat()) is None:
        stale = connection.execute(
            "SELECT 1 FROM game_jobs WHERE status='processing' AND claimed_at<? LIMIT 1",
            (stale_before,),
        ).fetchone()
        if stale is None:
            return None
    token = uuid.uuid4().hex
    try:
        connection.execute("BEGIN IMMEDIATE")
    except sqlite3.OperationalError as exc:
        if getattr(exc, "sqlite_errorcode", 0) & 0xFF == sqlite3.SQLITE_BUSY:
            # No claim was acquired. Let the worker's cancellable idle wait retry.
            return None
        raise
    try:
        active = connection.execute(
            "SELECT value FROM metadata WHERE key = 'active_discovery_version'"
        ).fetchone()
        if active is not None and active["value"] != discovery_version:
            connection.commit()
            return None
        _requeue_stale(connection, "game_jobs", stale_before)
        row = _next_game_job(connection, discovery_version, timestamp.isoformat())
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
    connection: sqlite3.Connection, candidate: CandidateRecord, *, commit: bool = True
) -> int | None:
    timestamp = now()
    revision_key = _candidate_revision_key(candidate)
    existing_revision = connection.execute(
        "SELECT 1 FROM candidates c JOIN candidate_revisions r ON r.candidate_id = c.id "
        "WHERE c.candidate_key = ? AND r.revision_key = ?",
        (candidate.candidate_key, revision_key),
    ).fetchone()
    connection.execute(
        """
        INSERT INTO candidates(
          candidate_key, source_database, game_id, source_url, ply, side_to_move,
          pre_fen, position_fen, position_hash, played_move, best_move,
          before_score_json, after_score_json, evaluation_loss, candidate_type,
          engine_version, nnue, search_settings_json, discovery_revision,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(candidate_key) DO UPDATE SET
          -- Candidate identity can be rediscovered from another witness, but
          -- verification provenance is frozen to the first accepted witness.
          -- This keeps puzzles.game_id and source users coherent.
          ply = excluded.ply,
          side_to_move = excluded.side_to_move,
          pre_fen = excluded.pre_fen,
          position_fen = excluded.position_fen,
          position_hash = excluded.position_hash,
          played_move = excluded.played_move,
          best_move = excluded.best_move,
          before_score_json = excluded.before_score_json,
          after_score_json = excluded.after_score_json,
          evaluation_loss = excluded.evaluation_loss,
          candidate_type = excluded.candidate_type,
          engine_version = excluded.engine_version,
          nnue = excluded.nnue,
          search_settings_json = excluded.search_settings_json,
          discovery_revision = excluded.discovery_revision,
          updated_at = excluded.updated_at
        ON CONFLICT(position_hash) DO NOTHING
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
            position_hash(candidate.position_fen),
            candidate.played_move,
            candidate.best_move,
            _json(candidate.before_score.to_dict()),
            _json(candidate.after_score.to_dict()),
            candidate.evaluation_loss,
            candidate.candidate_type,
            candidate.engine_version,
            candidate.nnue,
            _json(candidate.search_settings),
            revision_key,
            timestamp,
            timestamp,
        ),
    )
    row = connection.execute(
        "SELECT id FROM candidates WHERE candidate_key = ?", (candidate.candidate_key,)
    ).fetchone()
    if row is None:
        if commit:
            connection.commit()
        return None
    if existing_revision is None and candidate.candidate_type != "checkmate_candidate":
        # A changed discovery revision is a new unit of verification work,
        # including when the prior assessment was terminal or withdrew the
        # canonical verification.  Keep the historical assessments intact.
        connection.execute(
            """
            UPDATE candidates
            SET status = 'pending', attempts = 0, claim_token = NULL,
                claimed_at = NULL, next_attempt_at = NULL,
                categorized_revision = NULL, verifier_version = NULL
            WHERE id = ?
            """,
            (row["id"],),
        )
    connection.execute(
        """
        INSERT OR IGNORE INTO candidate_revisions(
          candidate_id, revision_key, candidate_type, before_score_json,
          after_score_json, evaluation_loss, engine_version, nnue,
          search_settings_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            row["id"],
            revision_key,
            candidate.candidate_type,
            _json(candidate.before_score.to_dict()),
            _json(candidate.after_score.to_dict()),
            candidate.evaluation_loss,
            candidate.engine_version,
            candidate.nnue,
            _json(candidate.search_settings),
            timestamp,
        ),
    )
    if commit:
        connection.commit()
    return int(row["id"]) if existing_revision is None else None


def apply_discovery_result(
    connection: sqlite3.Connection,
    job: ClaimedJob,
    candidates: list[CandidateRecord],
    *,
    game_analysis: dict[str, Any] | None = None,
    publication_origin: str | None = None,
) -> bool:
    """Atomically persist one complete game discovery result and finish its claim."""
    connection.execute("BEGIN IMMEDIATE")
    try:
        row = connection.execute(
            "SELECT status, claim_token, discovery_version FROM game_jobs WHERE id = ?",
            (job.id,),
        ).fetchone()
        if (
            row is None
            or row["status"] != "processing"
            or row["claim_token"] != job.claim_token
        ):
            raise RuntimeError("game_jobs claim was lost")
        active = connection.execute(
            "SELECT value FROM metadata WHERE key = 'active_discovery_version'"
        ).fetchone()
        if active is not None and active["value"] != row["discovery_version"]:
            connection.execute(
                """
                UPDATE game_jobs
                SET status = 'rejected', diagnostic = 'superseded by newer discovery revision',
                    claim_token = NULL, claimed_at = NULL, next_attempt_at = NULL,
                    updated_at = ?
                WHERE id = ? AND status = 'processing' AND claim_token = ?
                """,
                (now(), job.id, job.claim_token),
            )
            connection.commit()
            return False
        if game_analysis is not None:
            from .game_analysis_depth import record_depth_coverage

            depth = record_depth_coverage(
                connection, job.source_database, job.game_id, game_analysis
            )
            connection.execute(
                "INSERT OR REPLACE INTO game_analyses(job_id, payload_zlib, created_at, depth) VALUES (?, ?, ?, ?)",
                (
                    job.id,
                    zlib.compress(_json(game_analysis).encode("utf-8")),
                    now(),
                    depth,
                ),
            )
            if (
                publication_origin
                and depth is not None
                and game_analysis["moves"]
                and (
                    not is_native_source(job.source_database)
                    or native_origin(job.source_database)
                    == publication_origin.rstrip("/")
                )
            ):
                connection.execute(
                    "INSERT OR IGNORE INTO game_analysis_publications(origin,job_id) VALUES (?,?)",
                    (publication_origin.rstrip("/"), job.id),
                )
        for candidate in candidates:
            insert_candidate(connection, candidate, commit=False)
        cursor = connection.execute(
            """
            UPDATE game_jobs
            SET status = 'complete', discovered_count = ?, claim_token = NULL,
                claimed_at = NULL, next_attempt_at = NULL, updated_at = ?
            WHERE id = ? AND status = 'processing' AND claim_token = ?
            """,
            (len(candidates), now(), job.id, job.claim_token),
        )
        if cursor.rowcount != 1:
            raise RuntimeError("game_jobs claim was lost")
        connection.commit()
        return True
    except Exception:
        connection.rollback()
        raise


def cache_key(
    initial_fen: str,
    moves: tuple[str, ...],
    nodes: int | None,
    multi_pv: int,
    *,
    depth: int | None = None,
) -> tuple[str, str]:
    context_hash = hashlib.sha256(
        _json({"fen": initial_fen, "moves": moves}).encode("utf-8")
    ).hexdigest()
    settings_hash = hashlib.sha256(
        _json(
            {
                "nodes": nodes,
                "multi_pv": multi_pv,
                **({"depth": depth} if depth is not None else {}),
            }
        ).encode("utf-8")
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
        revision_key=row["discovery_revision"],
        attempts=row["attempts"] + 1 if attempts is None else attempts,
        theme_versions=json.loads(row["attempt_theme_versions_json"] or "{}"),
        verifier_version=row["verifier_version"] or "1",
    )


def _json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _candidate_revision_key(candidate: CandidateRecord) -> str:
    payload = {
        "candidate_type": candidate.candidate_type,
        "source_database": candidate.source_database,
        "game_id": candidate.game_id,
        "ply": candidate.ply,
        "pre_fen": candidate.pre_fen,
        "position_fen": candidate.position_fen,
        "played_move": candidate.played_move,
        "best_move": candidate.best_move,
        "before": candidate.before_score.to_dict(),
        "after": candidate.after_score.to_dict(),
        "loss": candidate.evaluation_loss,
        "engine": candidate.engine_version,
        "nnue": candidate.nnue,
        "settings": candidate.search_settings,
    }
    return hashlib.sha256(_json(payload).encode("utf-8")).hexdigest()


def load_game_analysis(
    connection: sqlite3.Connection, job_id: int
) -> dict[str, Any] | None:
    """Load the durable, self-contained full-game analysis saved by discovery."""
    row = connection.execute(
        "SELECT payload_zlib FROM game_analyses WHERE job_id = ?", (job_id,)
    ).fetchone()
    return json.loads(zlib.decompress(row["payload_zlib"])) if row else None
