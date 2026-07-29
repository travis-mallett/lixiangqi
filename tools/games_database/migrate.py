"""Build the authoritative catalog from the superseded source-owned databases."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from contextlib import closing
from pathlib import Path
from typing import Any

from external.xiangqi_explorer.catalog_databases import LEGACY_SOURCE_DATABASES

from .provenance import upsert_source_record
from .storage import (
    DEFAULT_DATABASE,
    SCHEMA_PATH,
    SCHEMA_VERSION,
    canonical_hash,
    compact_json,
    line_hash,
    stable_game_id,
)

GAME_COLUMNS = (
    "source",
    "external_id",
    "red_name",
    "red_name_romanized",
    "red_name_romanization",
    "red_name_key",
    "red_entry",
    "red_team",
    "red_country",
    "red_level",
    "red_name_english",
    "red_time",
    "black_name",
    "black_name_romanized",
    "black_name_romanization",
    "black_name_key",
    "black_entry",
    "black_team",
    "black_country",
    "black_level",
    "black_name_english",
    "black_time",
    "red_rating",
    "black_rating",
    "result",
    "played_at",
    "year",
    "month",
    "event",
    "round",
    "opening",
    "title",
    "game_type",
    "game_class",
    "group_name",
    "place",
    "time_rule",
    "table_name",
    "end_type",
    "judge",
    "game_record",
    "remark",
    "author",
    "reference",
    "other",
    "added_at",
    "edited_at",
    "metadata_json",
    "moves",
    "notations",
    "source_url",
)


def _value(row: sqlite3.Row, columns: set[str], name: str, default: Any = "") -> Any:
    return row[name] if name in columns and row[name] is not None else default


def _open_target(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA page_size = 8192")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = NORMAL")
    connection.execute("PRAGMA cache_size = -262144")
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    for index in (
        "game_positions_by_position",
        "games_by_line_hash",
        "games_by_date",
        "games_by_red",
        "games_by_black",
        "games_by_event",
        "game_sources_by_collection",
        "game_sources_by_game",
        "annotation_sets_by_source",
        "annotations_by_anchor",
        "source_tree_nodes_by_parent",
    ):
        connection.execute(f"DROP INDEX IF EXISTS {index}")
    connection.execute(
        "INSERT OR REPLACE INTO metadata(key, value) VALUES ('schema_version', ?)",
        (str(SCHEMA_VERSION),),
    )
    connection.commit()
    return connection


def _insert_game(
    target: sqlite3.Connection,
    source: sqlite3.Connection,
    row: sqlite3.Row,
    columns: set[str],
    identity: bytes,
    moves: list[str],
) -> str:
    existing = target.execute(
        "SELECT id FROM games WHERE canonical_hash = ?", (identity,)
    ).fetchone()
    if existing is not None:
        return str(existing[0])

    game_id = stable_game_id(identity)
    positions = source.execute(
        """
        SELECT ply, position_key, move, notation
        FROM game_positions WHERE game_id = ? ORDER BY ply
        """,
        (row["id"],),
    ).fetchall()
    values = {
        name: _value(row, columns, name, None if name.endswith("_rating") else "")
        for name in GAME_COLUMNS
    }
    values.update(
        {
            "id": game_id,
            "canonical_hash": identity,
            "line_hash": line_hash(moves),
            "metadata_json": "{}",
            "moves": json.dumps(moves, separators=(",", ":")),
            "notations": json.dumps(
                [position["notation"] for position in positions],
                ensure_ascii=False,
                separators=(",", ":"),
            ),
        }
    )
    names = ("id", "canonical_hash", "line_hash", *GAME_COLUMNS)
    target.execute(
        f"""
        INSERT INTO games({", ".join(names)})
        VALUES ({", ".join(":" + name for name in names)})
        """,
        values,
    )

    seen_positions: set[str] = set()
    batch: list[tuple[str, int, str, str, str]] = []
    for position in positions:
        position_key = position["position_key"]
        if position_key in seen_positions:
            continue
        seen_positions.add(position_key)
        batch.append(
            (
                game_id,
                position["ply"],
                position_key,
                position["move"],
                position["notation"],
            )
        )
    target.executemany(
        """
        INSERT INTO game_positions(game_id, ply, position_key, move, notation)
        VALUES (?, ?, ?, ?, ?)
        """,
        batch,
    )
    return game_id


def _migrate_database(
    target: sqlite3.Connection, path: Path, label: str
) -> dict[str, int]:
    counts = {"source_games": 0, "canonical_added": 0, "witnesses": 0}
    with closing(
        sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    ) as source:
        source.row_factory = sqlite3.Row
        game_columns = {
            row[1] for row in source.execute("PRAGMA table_info(games)").fetchall()
        }
        mapping: dict[str, str] = {}
        started = time.monotonic()
        before = target.execute("SELECT count(*) FROM games").fetchone()[0]
        for row in source.execute("SELECT * FROM games ORDER BY id"):
            moves = json.loads(row["moves"])
            identity = canonical_hash(
                moves,
                red_name=row["red_name"],
                black_name=row["black_name"],
                result=row["result"],
            )
            mapping[row["id"]] = _insert_game(
                target, source, row, game_columns, identity, moves
            )
            counts["source_games"] += 1
            if counts["source_games"] % 2_000 == 0:
                target.commit()
                elapsed = max(time.monotonic() - started, 0.001)
                print(
                    f"{label}: {counts['source_games']:,} source games "
                    f"({counts['source_games'] / elapsed:.0f}/s)",
                    flush=True,
                )
        counts["canonical_added"] = (
            target.execute("SELECT count(*) FROM games").fetchone()[0] - before
        )

        source_columns = {
            row[1]
            for row in source.execute("PRAGMA table_info(game_sources)").fetchall()
        }
        for witness in source.execute("SELECT * FROM game_sources ORDER BY game_id"):
            old_game_id = witness["game_id"]
            new_game_id = mapping.get(old_game_id)
            if new_game_id is None:
                continue
            game = source.execute(
                "SELECT moves FROM games WHERE id = ?", (old_game_id,)
            ).fetchone()
            metadata = json.loads(witness["metadata_json"] or "{}")
            upsert_source_record(
                target,
                source=witness["source"],
                collection=witness["collection"],
                collection_name=witness["collection_name"],
                external_id=witness["external_id"],
                game_id=new_game_id,
                source_url=witness["source_url"],
                metadata=metadata,
                moves=json.loads(game["moves"]),
                parser_version=f"legacy-{label}-v4",
                raw_checksum=_value(witness, source_columns, "raw_checksum"),
                acquired_at=_value(witness, source_columns, "acquired_at"),
            )
            counts["witnesses"] += 1
            if counts["witnesses"] % 2_000 == 0:
                target.commit()
        target.commit()
    return counts


def _finish(target: sqlite3.Connection, source_paths: list[Path]) -> dict[str, int]:
    target.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    totals = {
        "games": target.execute("SELECT count(*) FROM games").fetchone()[0],
        "positions": target.execute(
            "SELECT count(*) FROM game_positions"
        ).fetchone()[0],
        "witnesses": target.execute("SELECT count(*) FROM game_sources").fetchone()[0],
        "annotations": target.execute(
            "SELECT count(*) FROM annotations"
        ).fetchone()[0],
        "annotationSeries": target.execute(
            "SELECT count(*) FROM annotation_series"
        ).fetchone()[0],
    }
    target.execute(
        "INSERT OR REPLACE INTO metadata(key, value) VALUES ('migration_sources', ?)",
        (compact_json([str(path.resolve()) for path in source_paths]),),
    )
    target.execute(
        "INSERT OR REPLACE INTO metadata(key, value) VALUES ('catalog_counts', ?)",
        (compact_json(totals),),
    )
    violations = target.execute("PRAGMA foreign_key_check").fetchall()
    if violations:
        raise sqlite3.IntegrityError(
            f"foreign-key verification failed with {len(violations)} violations"
        )
    bad_positions = target.execute(
        """
        SELECT count(*) FROM (
          SELECT game_id, position_key, count(*) AS n
          FROM game_positions GROUP BY game_id, position_key HAVING n > 1
        )
        """
    ).fetchone()[0]
    if bad_positions:
        raise sqlite3.IntegrityError("repeated explorer positions survived migration")
    target.commit()
    target.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    target.execute("PRAGMA optimize")
    return totals


def migrate(
    target_path: Path,
    sources: list[tuple[str, Path]],
    *,
    replace: bool = False,
) -> dict[str, Any]:
    target_path = target_path.resolve()
    building = Path(f"{target_path}.building")
    if target_path.exists() and not replace:
        raise FileExistsError(f"{target_path} already exists; pass --replace to rebuild")
    if building.exists():
        building.unlink()
    for suffix in ("-wal", "-shm"):
        candidate = Path(f"{building}{suffix}")
        if candidate.exists():
            candidate.unlink()

    results: dict[str, Any] = {}
    existing_sources = [(label, path.resolve()) for label, path in sources if path.is_file()]
    if not existing_sources:
        raise FileNotFoundError("no legacy games databases were found")
    target = _open_target(building)
    try:
        for label, path in existing_sources:
            results[label] = _migrate_database(target, path, label)
        results["totals"] = _finish(target, [path for _label, path in existing_sources])
    finally:
        target.close()

    os.replace(building, target_path)
    for suffix in ("-wal", "-shm"):
        candidate = Path(f"{building}{suffix}")
        if candidate.exists():
            candidate.unlink()
    return results


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build the authoritative Xiangqi games database"
    )
    parser.add_argument("--target", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--replace", action="store_true")
    parser.add_argument(
        "--source",
        action="append",
        type=Path,
        help="legacy source database (repeatable; defaults to the three installed catalogs)",
    )
    args = parser.parse_args()
    sources = (
        [(path.stem, path) for path in args.source]
        if args.source
        else list(LEGACY_SOURCE_DATABASES.items())
    )
    try:
        result = migrate(args.target, sources, replace=args.replace)
    except (FileExistsError, FileNotFoundError, sqlite3.DatabaseError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(compact_json(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
