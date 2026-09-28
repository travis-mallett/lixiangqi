"""Archive abandoned authored objectives once, without discarding recovery data."""


def migrate(connection):
    if connection.execute(
        "SELECT 1 FROM catalog_metadata WHERE key='supported_objectives_v1'"
    ).fetchone():
        return
    tables = {
        r[0]
        for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    with connection:
        removed = 0
        for table in ("catalog_puzzles", "catalog_live"):
            if table not in tables:
                continue
            predicate = "json_extract(document,'$.playback.objective') IS NOT NULL AND json_extract(document,'$.playback.objective') NOT IN ('mate','tactic')"
            connection.execute(
                f"CREATE TABLE __retired_v1_{table} AS SELECT * FROM {table} WHERE {predicate}"
            )
            removed += connection.execute(
                f"DELETE FROM {table} WHERE {predicate}"
            ).rowcount
        # Reconciliation owns the next authoritative baseline. Retain the prior
        # snapshot for recovery, but never offer it as current publication input.
        if removed:
            connection.execute(
                "CREATE TABLE __retired_v1_catalog_baseline AS SELECT * FROM catalog_metadata WHERE key IN ('baseline','baselineDigest')"
            )
            connection.execute(
                "DELETE FROM catalog_metadata WHERE key IN ('baseline','baselineDigest')"
            )
        connection.execute(
            "INSERT INTO catalog_metadata VALUES('supported_objectives_v1','true')"
        )
