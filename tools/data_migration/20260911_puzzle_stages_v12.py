"""Separate offline verification authority from classification.

open_database runs this local schema transaction without a database copy. No live
MongoDB schema changes: publication still produces the existing release format.
"""

import json


def migrate(connection):
    from tools.xiangqi_data.puzzle_mining.classification_job import _stored_traces

    connection.execute("BEGIN IMMEDIATE")
    try:
        for table in ("candidates", "candidate_assessments"):
            columns = {r[1] for r in connection.execute(f"PRAGMA table_info({table})")}
            if "categorization_settings_json" in columns:
                connection.execute(
                    f"ALTER TABLE {table} RENAME COLUMN categorization_settings_json TO verification_settings_json"
                )
        columns = {r[1] for r in connection.execute("PRAGMA table_info(candidates)")}
        if "categorization_version" in columns:
            connection.execute(
                "ALTER TABLE candidates RENAME COLUMN categorization_version TO verifier_version"
            )
        columns = {
            r[1] for r in connection.execute("PRAGMA table_info(candidate_assessments)")
        }
        for name, definition in [
            ("verification_version", "TEXT"),
            ("verification_signature", "TEXT"),
            ("coverage", "TEXT NOT NULL DEFAULT 'legacy'"),
        ]:
            if name not in columns:
                connection.execute(
                    f"ALTER TABLE candidate_assessments ADD COLUMN {name} {definition}"
                )
        audited = complete = 0
        for row in connection.execute(
            "SELECT id,accepted,branches_json,diagnostic,verification_settings_json FROM candidate_assessments"
        ):
            audited += 1
            try:
                diagnostic = json.loads(row["diagnostic"] or "{}")
                settings = json.loads(row["verification_settings_json"] or "{}")
                # Old acceptance alone is insufficient: capped enumeration could
                # be accepted. Only explicit uncapped completion is reusable.
                covered = (
                    row["accepted"] == 1
                    and isinstance(diagnostic, dict)
                    and diagnostic.get("truncated") is False
                    and not diagnostic.get("limits")
                    and not diagnostic.get("reason")
                    and _stored_traces(row["branches_json"]) is not None
                )
                version = "legacy:" + str(settings.get("version", "unknown"))
            except (ValueError, TypeError, AttributeError):
                covered, version = False, "legacy:unknown"
            connection.execute(
                "UPDATE candidate_assessments SET coverage=?,verification_version=? WHERE id=?",
                ("complete" if covered else "legacy", version, row["id"]),
            )
            complete += int(covered)
        connection.execute("UPDATE metadata SET value='12' WHERE key='schema_version'")
        if connection.execute("PRAGMA foreign_key_check").fetchone():
            raise RuntimeError("Stage migration foreign key check failed")
        connection.commit()
        print(
            f"Puzzle stages: audited {audited} assessments; {complete} have reusable coverage; {audited - complete} require explicit re-verification.",
            flush=True,
        )
    except Exception:
        connection.rollback()
        raise
