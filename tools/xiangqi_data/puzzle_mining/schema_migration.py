"""Controlled SQLite schema migrations for the puzzle mining staging store.

Each step is transactionally independent and records the exact schema it
created. A failed step rolls back and can be retried from the last committed
version. Routine initialization does not copy this local derived-data store.
"""

from __future__ import annotations

import sqlite3
import uuid


def migrate_schema_6_to_7(connection: sqlite3.Connection) -> None:
    """Add durable per-theme scan outcomes without altering user evidence."""
    connection.execute("BEGIN IMMEDIATE")
    try:
        connection.execute("""CREATE TABLE IF NOT EXISTS candidate_theme_scans (
          candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
          discovery_revision TEXT NOT NULL, verifier_version TEXT NOT NULL,
          theme TEXT NOT NULL, theme_version TEXT NOT NULL, outcome TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY(candidate_id, discovery_revision, verifier_version, theme, theme_version)
        )""")
        connection.execute(
            "CREATE INDEX IF NOT EXISTS candidate_theme_scans_by_candidate ON candidate_theme_scans(candidate_id, discovery_revision, theme, theme_version)"
        )
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(candidates)")
        }
        if "attempt_theme_versions_json" not in columns:
            connection.execute(
                "ALTER TABLE candidates ADD COLUMN attempt_theme_versions_json TEXT NOT NULL DEFAULT '{}'"
            )
        connection.execute(
            "UPDATE metadata SET value = '7' WHERE key = 'schema_version'"
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def migrate_schema_7_to_8(connection: sqlite3.Connection) -> None:
    """Store motif-removal proofs without changing immutable canonical traces."""
    connection.execute("BEGIN IMMEDIATE")
    try:
        for statement in (
            """CREATE TABLE IF NOT EXISTS motif_removal_evidence (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
              canonical_assessment_id INTEGER NOT NULL REFERENCES candidate_assessments(id) ON DELETE CASCADE,
              theme TEXT NOT NULL,
              theme_version TEXT NOT NULL,
              branch_index INTEGER NOT NULL,
              evidence_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              UNIQUE(candidate_id, canonical_assessment_id, theme, theme_version, branch_index)
            )""",
            """CREATE INDEX IF NOT EXISTS motif_removal_evidence_by_candidate
              ON motif_removal_evidence(candidate_id, canonical_assessment_id, theme, theme_version, branch_index);
            """,
        ):
            connection.execute(statement)
        connection.execute(
            "UPDATE metadata SET value = '8' WHERE key = 'schema_version'"
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def migrate_schema_8_to_9(connection: sqlite3.Connection) -> None:
    """Record production snapshot provenance; legacy native rows remain quarantined."""
    connection.execute("BEGIN IMMEDIATE")
    try:
        columns = {
            row[1] for row in connection.execute("PRAGMA table_info(native_games)")
        }
        if "snapshot_id" not in columns:
            connection.execute("ALTER TABLE native_games ADD COLUMN snapshot_id TEXT")
        connection.execute("""CREATE TABLE IF NOT EXISTS source_snapshots (
          snapshot_id TEXT PRIMARY KEY, origin TEXT NOT NULL,
          manifest_digest TEXT NOT NULL, created_at TEXT NOT NULL
        ) WITHOUT ROWID""")
        puzzle_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(puzzles)")
        }
        for field in ("rating", "rating_deviation", "plays", "vote"):
            if field in puzzle_columns:
                connection.execute(f"ALTER TABLE puzzles DROP COLUMN {field}")
        connection.execute("DROP TABLE IF EXISTS native_checkpoints")
        connection.execute(
            "DELETE FROM metadata WHERE key LIKE 'sync_manifest_%' OR key IN ('native_origin', 'corpus_id')"
        )
        connection.execute(
            "UPDATE metadata SET value = '9' WHERE key = 'schema_version'"
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def migrate_schema_9_to_10(connection: sqlite3.Connection) -> None:
    """Mining records verification eligibility; publication belongs to the catalog."""
    connection.execute("BEGIN IMMEDIATE")
    try:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(puzzles)")}
        connection.execute("DROP INDEX IF EXISTS puzzles_by_publication")
        if "publication_status" in columns:
            if "verification_status" in columns:
                raise RuntimeError(
                    "Mixed publication and verification schema; inspect the local schema before retrying"
                )
            connection.execute(
                "ALTER TABLE puzzles RENAME COLUMN publication_status TO verification_status"
            )
        connection.execute("UPDATE metadata SET value='10' WHERE key='schema_version'")
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def migrate_schema_2_to_3(connection: sqlite3.Connection) -> None:
    """Add revision-aware work tracking while preserving existing progress."""

    connection.execute("BEGIN IMMEDIATE")
    try:
        connection.execute("ALTER TABLE game_jobs RENAME TO game_jobs_v2")
        connection.execute("""
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
            """)
        connection.execute("""
            INSERT INTO game_jobs(
              id, discovery_version, source_database, game_id, source_url,
              status, attempts, discovered_count, claim_token, claimed_at,
              next_attempt_at, diagnostic, created_at, updated_at
            )
            SELECT id, '1', source_database, game_id, source_url, status,
                   attempts, discovered_count, claim_token, claimed_at,
                   next_attempt_at, diagnostic, created_at, updated_at
            FROM game_jobs_v2
            """)
        connection.execute("DROP TABLE game_jobs_v2")
        connection.execute(
            "ALTER TABLE candidates ADD COLUMN categorization_version TEXT"
        )
        connection.execute("DROP INDEX IF EXISTS candidates_by_status")
        connection.execute(
            "UPDATE metadata SET value = '3' WHERE key = 'schema_version'"
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def migrate_schema_3_to_4(connection: sqlite3.Connection) -> None:
    """Add the evidence ledger and explicit publication lifecycle."""

    connection.execute("BEGIN IMMEDIATE")
    try:
        candidate_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(candidates)")
        }
        if "discovery_revision" not in candidate_columns:
            connection.execute(
                "ALTER TABLE candidates ADD COLUMN discovery_revision TEXT NOT NULL DEFAULT 'legacy'"
            )
        if "categorized_revision" not in candidate_columns:
            connection.execute(
                "ALTER TABLE candidates ADD COLUMN categorized_revision TEXT"
            )
        puzzle_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(puzzles)")
        }
        if puzzle_columns:
            if "publication_status" not in puzzle_columns:
                connection.execute(
                    "ALTER TABLE puzzles ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'active'"
                )
            for name, definition in (
                ("retired_at", "TEXT"),
                ("retirement_reason", "TEXT"),
                ("canonical_assessment_id", "INTEGER"),
                ("verification_signature", "TEXT"),
                ("verification_rank_json", "TEXT"),
            ):
                if name not in puzzle_columns:
                    connection.execute(
                        f"ALTER TABLE puzzles ADD COLUMN {name} {definition}"
                    )
            if "mate_in" in puzzle_columns and "mate_in_tmp" not in puzzle_columns:
                connection.execute("ALTER TABLE puzzles ADD COLUMN mate_in_tmp INTEGER")
                connection.execute("UPDATE puzzles SET mate_in_tmp = mate_in")
                connection.execute("ALTER TABLE puzzles DROP COLUMN mate_in")
                connection.execute(
                    "ALTER TABLE puzzles RENAME COLUMN mate_in_tmp TO mate_in"
                )
        for statement in (
            """CREATE TABLE IF NOT EXISTS candidate_revisions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
              revision_key TEXT NOT NULL,
              candidate_type TEXT NOT NULL,
              before_score_json TEXT NOT NULL,
              after_score_json TEXT NOT NULL,
              evaluation_loss REAL NOT NULL,
              engine_version TEXT NOT NULL,
              nnue TEXT NOT NULL,
              search_settings_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              UNIQUE (candidate_id, revision_key)
            )""",
            """CREATE TABLE IF NOT EXISTS candidate_assessments (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
              revision_key TEXT NOT NULL,
              status TEXT NOT NULL,
              diagnostic TEXT NOT NULL DEFAULT '',
              solution_json TEXT,
              solution_plies INTEGER,
              branches_json TEXT,
              themes_json TEXT,
              verified_engine_version TEXT,
              verified_nnue TEXT,
              categorization_settings_json TEXT,
              engine_nodes INTEGER,
              engine_depth INTEGER,
              verification_rank_json TEXT,
              accepted INTEGER NOT NULL DEFAULT 0 CHECK (accepted IN (0, 1)),
              created_at TEXT NOT NULL
            )""",
            """CREATE INDEX IF NOT EXISTS candidates_by_revision
              ON candidates(candidate_type, discovery_revision, categorized_revision, status, id)""",
            """CREATE INDEX IF NOT EXISTS candidate_revisions_by_candidate
              ON candidate_revisions(candidate_id, created_at, id)""",
            """CREATE INDEX IF NOT EXISTS candidate_assessments_by_candidate
              ON candidate_assessments(candidate_id, created_at, id)""",
        ):
            connection.execute(statement)
        if puzzle_columns:
            connection.execute(
                "CREATE INDEX IF NOT EXISTS puzzles_by_publication "
                "ON puzzles(publication_status, created_at, id)"
            )
        connection.execute(
            "INSERT OR IGNORE INTO metadata(key, value) VALUES ('sync_manifest_status', 'incomplete')"
        )
        connection.execute(
            "INSERT OR IGNORE INTO metadata(key, value) VALUES ('corpus_id', ?)",
            (uuid.uuid4().hex,),
        )
        connection.execute(
            "UPDATE metadata SET value = '4' WHERE key = 'schema_version'"
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def migrate_schema_4_to_5(connection: sqlite3.Connection) -> None:
    """Separate taxonomy assessments from canonical verification evidence."""

    connection.execute("BEGIN IMMEDIATE")
    try:
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(puzzles)")
        }
        if columns and "taxonomy_assessment_id" not in columns:
            connection.execute(
                "ALTER TABLE puzzles ADD COLUMN taxonomy_assessment_id INTEGER"
            )
        for statement in (
            """CREATE TABLE IF NOT EXISTS taxonomy_assessments (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
              verification_assessment_id INTEGER NOT NULL REFERENCES candidate_assessments(id) ON DELETE CASCADE,
              taxonomy_version TEXT NOT NULL,
              status TEXT NOT NULL,
              diagnostic TEXT NOT NULL DEFAULT '',
              themes_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              UNIQUE(candidate_id, verification_assessment_id, taxonomy_version)
            )""",
            """CREATE INDEX IF NOT EXISTS taxonomy_assessments_by_candidate
              ON taxonomy_assessments(candidate_id, created_at, id)""",
        ):
            connection.execute(statement)
        connection.execute(
            "UPDATE metadata SET value = '5' WHERE key = 'schema_version'"
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def migrate_schema_5_to_6(connection: sqlite3.Connection) -> None:
    """Add immutable native games and downloader checkpoints."""
    connection.execute("BEGIN IMMEDIATE")
    try:
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS native_games (
              source_database TEXT NOT NULL, origin TEXT NOT NULL, game_id TEXT NOT NULL,
              initial_fen TEXT NOT NULL DEFAULT '', moves_json TEXT NOT NULL,
              players_json TEXT NOT NULL DEFAULT '{}', source_url TEXT NOT NULL DEFAULT '',
              payload_json TEXT NOT NULL, payload_checksum TEXT NOT NULL, created_at TEXT NOT NULL,
              PRIMARY KEY (source_database, game_id), UNIQUE (payload_checksum)
            ) WITHOUT ROWID;
            CREATE TABLE IF NOT EXISTS native_checkpoints (
              origin TEXT NOT NULL, scope TEXT NOT NULL, cursor TEXT NOT NULL DEFAULT '',
              last_success_at TEXT, metadata_json TEXT NOT NULL DEFAULT '{}',
              PRIMARY KEY (origin, scope)
            ) WITHOUT ROWID;
            UPDATE metadata SET value = '6' WHERE key = 'schema_version';
            """)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
