"""Remove category-owned endpoints from the local mining schema.

Verification evidence and historical publication lines retain the original data.
Invalidate shortened projections so categorization republishes the full canonical
solve through the usual immutable publication identities, without reconstructing it.
"""


def migrate(connection):
    connection.execute("BEGIN IMMEDIATE")
    try:
        changed = connection.execute(
            """UPDATE candidates SET current_classification_id=NULL
            WHERE EXISTS (
              SELECT 1 FROM puzzles p JOIN candidate_assessments a
                ON a.id=candidates.current_verification_id
              WHERE p.candidate_id=candidates.id AND p.verification_status='active'
                AND json(p.solution) != json(a.solution_json))"""
        ).rowcount
        connection.execute(
            "ALTER TABLE taxonomy_assessments DROP COLUMN solution_plies"
        )
        connection.execute("UPDATE metadata SET value='17' WHERE key='schema_version'")
        connection.commit()
        print(
            f"Removed category endpoints; {changed} publications need canonical reprojection"
        )
    except BaseException:
        connection.rollback()
        raise
