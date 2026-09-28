"""Remove obsolete eligibility metadata without changing completed solutions.

The staging database opener runs this migration transactionally.
"""


def migrate(connection):
    connection.execute("BEGIN IMMEDIATE")
    try:
        connection.execute("DROP TRIGGER IF EXISTS assessment_branch_count_insert")
        connection.execute("DROP TRIGGER IF EXISTS assessment_branch_count_update")
        connection.execute("ALTER TABLE candidate_assessments DROP COLUMN branch_count")
        connection.execute("UPDATE metadata SET value='15' WHERE key='schema_version'")
        connection.commit()
        print(
            "Removed branch-count eligibility metadata; completed solutions preserved"
        )
    except Exception:
        connection.rollback()
        raise
