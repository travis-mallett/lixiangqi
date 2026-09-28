"""Cache branch counts for eligibility checks without rewriting solution evidence.

The staging database opener runs this migration transactionally.
Live publication data is not changed.
"""


def migrate(connection):
    connection.execute("BEGIN IMMEDIATE")
    try:
        columns = {
            row[1]
            for row in connection.execute("PRAGMA table_info(candidate_assessments)")
        }
        if "branch_count" not in columns:
            connection.execute(
                "ALTER TABLE candidate_assessments ADD COLUMN branch_count INTEGER NOT NULL DEFAULT 0"
            )
        cursor = connection.execute("""UPDATE candidate_assessments SET branch_count =
            CASE WHEN json_valid(branches_json) THEN
              CASE WHEN json_type(branches_json)='array' THEN json_array_length(branches_json) ELSE 0 END
            ELSE 0 END""")
        connection.execute("UPDATE metadata SET value='14' WHERE key='schema_version'")
        connection.commit()
        print(f"Cached branch counts for {cursor.rowcount} verification assessments")
    except Exception:
        connection.rollback()
        raise
