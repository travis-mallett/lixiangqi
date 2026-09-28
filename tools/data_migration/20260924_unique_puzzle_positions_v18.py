"""Enforce unique player-facing roots after explicit, backed-up deduplication.

This schema migration never deduplicates data. Existing duplicate pools must be
cleaned once with 20260924_deduplicate_puzzle_positions.py, while workers are
stopped. Normal startup only installs the unique index, once per database.
"""

import sqlite3


def migrate(connection):
    connection.execute("BEGIN IMMEDIATE")
    try:
        connection.execute("DROP INDEX IF EXISTS candidates_by_position")
        connection.execute(
            "CREATE UNIQUE INDEX candidates_by_position ON candidates(position_hash)"
        )
        connection.execute("UPDATE metadata SET value='18' WHERE key='schema_version'")
        connection.commit()
    except sqlite3.IntegrityError as exc:
        connection.rollback()
        raise RuntimeError(
            "Duplicate starting positions require the explicit one-time cleanup: "
            "python -m tools.data_migration.20260924_deduplicate_puzzle_positions "
            "--help. Stop Studio workers and back up the databases first."
        ) from exc
    except BaseException:
        connection.rollback()
        raise
