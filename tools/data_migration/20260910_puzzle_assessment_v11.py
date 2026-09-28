"""Migrate staging evidence authority and preserve retired publication identities.

open_database invokes this migration as an atomic local schema step.
The deployment's catalog preparation uses open_database before authoring releases;
production receives ordinary immutable additions/retirements, not staging tables.
"""

from pathlib import Path
import json


def migrate(connection):
    from tools.xiangqi_data.puzzle_mining.publication import apply_assessment
    from tools.xiangqi_data.puzzle_mining.classification_job import (
        encode_taxonomy_revision,
    )

    connection.execute("PRAGMA foreign_keys=OFF")
    connection.execute("BEGIN IMMEDIATE")
    try:
        # Later migrations use verifier-owned naming; normalize old schemas before
        # applying publication projection with the current implementation.
        for table in ("candidates", "candidate_assessments"):
            columns = {r[1] for r in connection.execute(f"PRAGMA table_info({table})")}
            if "categorization_settings_json" in columns:
                connection.execute(
                    f"ALTER TABLE {table} RENAME COLUMN categorization_settings_json TO verification_settings_json"
                )
        schema = (
            Path(__file__).parents[1] / "xiangqi_data/puzzle_mining/puzzle_schema.sql"
        ).read_text()
        start = schema.index("CREATE TABLE IF NOT EXISTS puzzles (")
        end = schema.index(";", start) + 1
        tables = {
            r[0]
            for r in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        if "puzzles" not in tables:
            connection.execute(schema[start:end])
        connection.execute(schema[start:end].replace("puzzles (", "puzzles_v11 ("))
        columns = [
            row[1] for row in connection.execute("PRAGMA table_info(puzzles_v11)")
        ]
        names = ",".join(columns)
        connection.execute(
            f"INSERT INTO puzzles_v11({names}) SELECT {names} FROM puzzles"
        )
        before = connection.execute("SELECT count(*) FROM puzzles").fetchone()[0]
        if (
            connection.execute("SELECT count(*) FROM puzzles_v11").fetchone()[0]
            != before
        ):
            raise RuntimeError("publication copy count mismatch")
        connection.execute("DROP TABLE puzzles")
        connection.execute("ALTER TABLE puzzles_v11 RENAME TO puzzles")
        if "verification_rank_json" in {
            r[1] for r in connection.execute("PRAGMA table_info(candidate_assessments)")
        }:
            connection.execute(
                "ALTER TABLE candidate_assessments DROP COLUMN verification_rank_json"
            )
        columns = {r[1] for r in connection.execute("PRAGMA table_info(candidates)")}
        if "current_verification_id" not in columns:
            connection.execute(
                "ALTER TABLE candidates ADD COLUMN current_verification_id INTEGER REFERENCES candidate_assessments(id)"
            )
        if "current_classification_id" not in columns:
            connection.execute(
                "ALTER TABLE candidates ADD COLUMN current_classification_id INTEGER REFERENCES taxonomy_assessments(id)"
            )
        if "branches_json" in {
            r[1] for r in connection.execute("PRAGMA table_info(candidates)")
        }:
            connection.execute("ALTER TABLE candidates DROP COLUMN branches_json")
        rows = connection.execute(
            """SELECT a.* FROM candidate_assessments a WHERE a.id=(
            SELECT max(b.id) FROM candidate_assessments b WHERE b.candidate_id=a.candidate_id
            AND b.status IN ('published','rejected','untagged')) ORDER BY a.id"""
        ).fetchall()
        for row in rows:
            taxonomy = connection.execute(
                "SELECT id FROM taxonomy_assessments WHERE verification_assessment_id=? AND status='classified' ORDER BY id DESC LIMIT 1",
                (row["id"],),
            ).fetchone()
            taxonomy_id = (
                taxonomy[0]
                if taxonomy
                else connection.execute(
                    "INSERT INTO taxonomy_assessments(candidate_id,verification_assessment_id,taxonomy_version,status,diagnostic,themes_json,created_at) VALUES(?,?,?,'classified','migrated latest completed assessment',?,?)",
                    (
                        row["candidate_id"],
                        row["id"],
                        encode_taxonomy_revision({}),
                        row["themes_json"] or "[]",
                        row["created_at"],
                    ),
                ).lastrowid
            )
            apply_assessment(
                connection,
                row["candidate_id"],
                row["id"],
                taxonomy_id,
                eligible=row["status"] == "published" and bool(row["solution_json"]),
            )
        connection.execute(
            "CREATE UNIQUE INDEX puzzles_one_active_per_candidate ON puzzles(candidate_id) WHERE verification_status='active'"
        )
        if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise RuntimeError("assessment migration foreign-key check failed")
        connection.execute(
            "INSERT OR REPLACE INTO metadata(key,value) VALUES('assessment_migration_v11',?)",
            (
                json.dumps(
                    {
                        "completed_assessments_applied": len(rows),
                        "publications_before": before,
                        "publications_after": connection.execute(
                            "SELECT count(*) FROM puzzles"
                        ).fetchone()[0],
                        "foreign_key_check": "ok",
                    },
                    sort_keys=True,
                ),
            ),
        )
        connection.execute("UPDATE metadata SET value='11' WHERE key='schema_version'")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.execute("PRAGMA foreign_keys=ON")
