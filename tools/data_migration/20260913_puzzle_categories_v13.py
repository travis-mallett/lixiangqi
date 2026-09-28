"""Replace discovery-keyed scan stamps with solution/category-version results.

open_database invokes this atomic migration without copying the local store. This is
local authoring data only; the live publication schema is unchanged.
"""

import json


def migrate(connection):
    from tools.xiangqi_data.puzzle_mining.category_status import CATEGORY_SCHEMA
    from tools.xiangqi_data.puzzle_mining.position import PUZZLE_HISTORY_POLICY

    connection.execute("BEGIN IMMEDIATE")
    try:
        connection.execute(CATEGORY_SCHEMA)
        seeded = 0
        for row in connection.execute(
            """SELECT t.*,a.coverage,a.accepted,a.verification_settings_json
            FROM taxonomy_assessments t JOIN candidate_assessments a ON a.id=t.verification_assessment_id
            WHERE a.candidate_id=t.candidate_id ORDER BY t.id"""
        ):
            try:
                versions = json.loads(row["taxonomy_version"])["versions"]
                settings = json.loads(row["verification_settings_json"] or "{}")
                themes = set(json.loads(row["themes_json"]))
            except (KeyError, ValueError, TypeError):
                continue
            if (
                not isinstance(versions, dict)
                or not isinstance(settings, dict)
                or row["coverage"] != "complete"
                or not row["accepted"]
                or settings.get("history_policy") != PUZZLE_HISTORY_POLICY
                or row["status"] not in {"classified", "uncategorized"}
                or "__consensus__" not in versions
            ):
                continue
            # Completed snapshots establish matches AND non-matches. A negative
            # all-branch verdict needs only one counterexample, not every branch.
            for category, version in versions.items():
                if category.startswith("__"):
                    continue
                connection.execute(
                    "INSERT INTO category_assessments VALUES(?,?,?,?,?,?,?) "
                    "ON CONFLICT(candidate_id,verification_assessment_id,category,category_version,consensus_version) "
                    "DO UPDATE SET outcome=excluded.outcome,attempted_at=excluded.attempted_at",
                    (
                        row["candidate_id"],
                        row["verification_assessment_id"],
                        category,
                        version,
                        versions["__consensus__"],
                        "match" if category in themes else "no_match",
                        row["created_at"],
                    ),
                )
                seeded += 1
        connection.execute("DROP TABLE IF EXISTS candidate_theme_scans")
        connection.execute("""UPDATE candidates SET status=coalesce((
            SELECT CASE t.status WHEN 'classified' THEN 'published' WHEN 'uncategorized' THEN 'untagged'
                WHEN 'category_conflict' THEN 'rejected' ELSE 'pending' END
            FROM taxonomy_assessments t WHERE t.id=candidates.current_classification_id),'pending'),
            claim_token=NULL,claimed_at=NULL,next_attempt_at=NULL
            WHERE candidate_type='checkmate_candidate' AND status='processing'""")
        cleared = connection.execute("SELECT changes()").fetchone()[0]
        connection.execute("UPDATE metadata SET value='13' WHERE key='schema_version'")
        if connection.execute("PRAGMA foreign_key_check").fetchone():
            raise RuntimeError("Category migration foreign key check failed")
        connection.commit()
        print(
            f"Category results: retained {seeded} completed category verdicts; cleared {cleared} obsolete candidate claims.",
            flush=True,
        )
    except BaseException:
        connection.rollback()
        raise
