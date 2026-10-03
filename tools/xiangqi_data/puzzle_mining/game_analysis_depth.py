"""Indexed depth coverage derived from durable, completed full-game analysis."""

import json
import zlib


def completed_depth(analysis):
    positions = analysis["positions"]
    if len(positions) != len(analysis["moves"]) + 1:
        raise ValueError("incomplete game analysis cannot establish depth coverage")
    depths = []
    for ply, position in enumerate(positions):
        lines = position["analysis"]["lines"]
        if not lines:
            if ply != len(positions) - 1:
                raise ValueError("missing nonterminal game analysis")
        else:
            values = [line["depth"] for line in lines]
            if any(type(depth) is not int or depth < 1 for depth in values):
                raise ValueError("invalid completed analysis depth")
            depths.append(min(values))
    return min(depths) if depths else None


def record_depth_coverage(connection, source_database, game_id, analysis):
    depth = completed_depth(analysis)
    if depth is None:
        return
    connection.execute(
        """INSERT INTO game_analysis_depths(source_database,game_id,depth)
           VALUES (?,?,?) ON CONFLICT(source_database,game_id)
           DO UPDATE SET depth=max(depth,excluded.depth)""",
        (source_database, game_id, depth),
    )
    return depth


def install_depth_coverage(connection):
    """Add/backfill a small derived index once; preserve every existing analysis."""
    connection.execute("""CREATE TABLE IF NOT EXISTS game_analysis_depths (
            source_database TEXT NOT NULL,
            game_id TEXT NOT NULL,
            depth INTEGER NOT NULL CHECK(depth > 0),
            PRIMARY KEY(source_database,game_id)
        ) WITHOUT ROWID""")
    if "depth" not in {
        row[1] for row in connection.execute("PRAGMA table_info(game_analyses)")
    }:
        connection.execute("ALTER TABLE game_analyses ADD COLUMN depth INTEGER")
    connection.execute(
        "CREATE INDEX IF NOT EXISTS game_analyses_by_depth ON game_analyses(depth DESC,job_id)"
    )
    backfilled = (
        connection.execute(
            "SELECT 1 FROM metadata WHERE key='game_analysis_depths_backfilled'"
        ).fetchone()
        is not None
    )
    if backfilled and not connection.execute(
        "SELECT 1 FROM game_analyses WHERE depth IS NULL LIMIT 1"
    ).fetchone():
        # Already installed and complete: reopening the database must not need
        # the writer lock while other stages are writing.
        return
    with connection:
        for row in connection.execute(
            """SELECT j.source_database,j.game_id,a.payload_zlib,a.job_id FROM game_analyses a
               JOIN game_jobs j ON j.id=a.job_id WHERE j.status='complete'"""
            + (" AND a.depth IS NULL" if backfilled else "")
        ):
            depth = record_depth_coverage(
                connection, row[0], row[1], json.loads(zlib.decompress(row[2]))
            )
            connection.execute(
                "UPDATE game_analyses SET depth=? WHERE job_id=?", (depth, row[3])
            )
        connection.execute(
            "INSERT OR REPLACE INTO metadata VALUES ('game_analysis_depths_backfilled','1')"
        )
