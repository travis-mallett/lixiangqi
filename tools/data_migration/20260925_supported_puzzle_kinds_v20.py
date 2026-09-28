"""Remove abandoned derived puzzle work, retaining recoverable rows locally.

Archives are inert recovery data, never consulted by the mining pipeline. Native
games, source records, engine caches and all supported candidates are untouched.
"""

import re


def advance_18(connection):
    # Version 19 only added the now-abandoned candidate kind.
    with connection:
        connection.execute("UPDATE metadata SET value='19' WHERE key='schema_version'")


def migrate(connection):
    quote = lambda name: '"' + name.replace('"', '""') + '"'
    sql = connection.execute(
        "SELECT sql FROM sqlite_master WHERE name='candidates'"
    ).fetchone()[0]
    revised, count = re.subn(
        r"CHECK\s*\(candidate_type IN \([^)]*\)\)",
        "CHECK (candidate_type IN ('checkmate_candidate', 'tactic_candidate'))",
        sql,
    )
    if count != 1:
        raise RuntimeError("Unexpected candidate type constraint")
    views = list(
        connection.execute("SELECT name,sql FROM sqlite_master WHERE type='view'")
    )
    indexes = list(
        connection.execute(
            "SELECT sql FROM sqlite_master WHERE tbl_name='candidates' AND type IN ('index','trigger') AND sql IS NOT NULL"
        )
    )
    tables = [
        r[0]
        for r in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '__retired_v20_%'"
        )
    ]
    connection.execute("PRAGMA foreign_keys=OFF")
    connection.execute("BEGIN IMMEDIATE")
    try:
        connection.execute(
            "CREATE TEMP TABLE removed_candidates AS SELECT id FROM candidates WHERE candidate_type NOT IN ('checkmate_candidate','tactic_candidate')"
        )
        for name in tables:
            columns = {
                r[1] for r in connection.execute(f"PRAGMA table_info({quote(name)})")
            }
            key = "id" if name == "candidates" else "candidate_id"
            if key not in columns or (name != "candidates" and key == "id"):
                continue
            predicate = f"{key} IN (SELECT id FROM removed_candidates)"
            connection.execute(
                f'CREATE TABLE {quote("__retired_v20_" + name)} AS SELECT * FROM {quote(name)} WHERE {predicate}'
            )
            connection.execute(f"DELETE FROM {quote(name)} WHERE {predicate}")
        # The obsolete queue has no relationship to ordinary game discovery.
        if "opening_trap_jobs" in tables:
            connection.execute(
                "ALTER TABLE opening_trap_jobs RENAME TO __retired_v20_discovery_jobs"
            )
            for (name,) in list(
                connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='__retired_v20_discovery_jobs' AND sql IS NOT NULL"
                )
            ):
                connection.execute(f"DROP INDEX {quote(name)}")
        connection.execute(
            "DELETE FROM metadata WHERE key='verification_queue:opening_trap_candidate'"
        )
        for name, _ in views:
            connection.execute(f"DROP VIEW {quote(name)}")
        revised = re.sub(
            r'CREATE TABLE (?:"candidates"|candidates)',
            "CREATE TABLE candidates_v20",
            revised,
            count=1,
        )
        connection.execute(revised)
        connection.execute("INSERT INTO candidates_v20 SELECT * FROM candidates")
        connection.execute("DROP TABLE candidates")
        connection.execute("ALTER TABLE candidates_v20 RENAME TO candidates")
        for (statement,) in indexes:
            connection.execute(statement)
        for _, statement in views:
            connection.execute(statement)
        if connection.execute("PRAGMA foreign_key_check").fetchone():
            raise RuntimeError("Candidate cleanup failed foreign-key validation")
        connection.execute("DROP TABLE removed_candidates")
        connection.execute("UPDATE metadata SET value='20' WHERE key='schema_version'")
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    finally:
        connection.execute("PRAGMA foreign_keys=ON")
