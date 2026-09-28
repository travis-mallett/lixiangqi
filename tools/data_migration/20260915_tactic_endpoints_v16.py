"""Give category projections an explicit solution length; preserve raw proofs.

The staging database opener runs this migration without copying the local store.
Existing category projections use their original, untrimmed solution lengths.
"""


def migrate(connection):
    connection.execute("BEGIN IMMEDIATE")
    try:
        columns = {
            row[1]
            for row in connection.execute("PRAGMA table_info(taxonomy_assessments)")
        }
        if "solution_plies" not in columns:
            connection.execute(
                "ALTER TABLE taxonomy_assessments ADD COLUMN solution_plies INTEGER CHECK(solution_plies>0)"
            )
        cursor = connection.execute("""UPDATE taxonomy_assessments SET solution_plies=(
            SELECT a.solution_plies FROM candidate_assessments a
            WHERE a.id=taxonomy_assessments.verification_assessment_id AND a.solution_plies>0)
            WHERE solution_plies IS NULL""")
        connection.execute("UPDATE metadata SET value='16' WHERE key='schema_version'")
        connection.commit()
        print(
            f"Initialized category endpoints for {cursor.rowcount} historical assessments; raw verification retained"
        )
    except BaseException:
        connection.rollback()
        raise
