"""Split the legacy shared explorer database into source-owned databases."""

from __future__ import annotations

import argparse
import os
import sqlite3
from pathlib import Path

from external.xiangqi_explorer.catalog_databases import (
    DPXQ_DATABASE,
    GDCHESS_DATABASE,
    LEGACY_DATABASE,
    XQDAO_DATABASE,
)
from .dpxq_import import initialize


TARGETS = (
    ("DPXQ", "dpxq", DPXQ_DATABASE),
    ("GDChess/01xq", "gdchess_01xq", GDCHESS_DATABASE),
    ("XQDao", "xqdao", XQDAO_DATABASE),
)


def _column_names(connection: sqlite3.Connection, schema: str, table: str) -> list[str]:
    rows = connection.execute(f'PRAGMA "{schema}".table_info("{table}")').fetchall()
    if not rows:
        raise sqlite3.DatabaseError(f"source table is missing: {table}")
    return [row[1] for row in rows]


def _quoted_columns(names: list[str], prefix: str = "") -> str:
    return ", ".join(
        prefix + '"' + name.replace('"', '""') + '"' for name in names
    )


def split_database(
    source: Path,
    targets: tuple[tuple[str, str, Path], ...] = TARGETS,
    *,
    replace: bool = False,
) -> list[tuple[str, Path, int, int]]:
    source = source.resolve()
    if not source.is_file():
        raise FileNotFoundError(source)

    results: list[tuple[str, Path, int, int]] = []
    for label, source_name, destination in targets:
        destination = destination.resolve()
        if destination.exists() and not replace:
            raise FileExistsError(
                f"{destination} already exists; pass --replace to rebuild source databases"
            )
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(destination.name + ".migrating")
        if temporary.exists():
            temporary.unlink()

        connection = sqlite3.connect(temporary, timeout=30, uri=True)
        try:
            initialize(connection)
            connection.commit()
            connection.execute("PRAGMA journal_mode = DELETE")
            source_uri = f"{source.as_uri()}?mode=ro"
            connection.execute("ATTACH DATABASE ? AS legacy", (source_uri,))
            connection.execute("BEGIN")

            for table in ("metadata", "games", "game_positions", "game_sources"):
                columns = _column_names(connection, "main", table)
                source_columns = _column_names(connection, "legacy", table)
                if set(columns) != set(source_columns):
                    raise sqlite3.DatabaseError(f"schema mismatch in {table}")

            metadata_names = _column_names(connection, "main", "metadata")
            metadata_columns = _quoted_columns(metadata_names)
            connection.execute("DELETE FROM metadata")
            connection.execute(
                f"INSERT INTO metadata({metadata_columns}) "
                f"SELECT {metadata_columns} FROM legacy.metadata"
            )

            game_names = _column_names(connection, "main", "games")
            game_columns = _quoted_columns(game_names)
            source_game_columns = _quoted_columns(game_names, "g.")
            connection.execute(
                f"""
                INSERT INTO games({game_columns})
                SELECT {source_game_columns}
                FROM legacy.games g
                WHERE EXISTS (
                  SELECT 1 FROM legacy.game_sources s
                  WHERE s.game_id = g.id AND s.source = ?
                )
                """,
                (source_name,),
            )
            position_names = _column_names(connection, "main", "game_positions")
            position_columns = _quoted_columns(position_names)
            source_position_columns = _quoted_columns(position_names, "p.")
            connection.execute(
                f"""
                INSERT INTO game_positions({position_columns})
                SELECT {source_position_columns}
                FROM legacy.game_positions p
                WHERE EXISTS (SELECT 1 FROM games g WHERE g.id = p.game_id)
                """
            )
            source_names = _column_names(connection, "main", "game_sources")
            source_columns = _quoted_columns(source_names)
            connection.execute(
                f"""
                INSERT INTO game_sources({source_columns})
                SELECT {source_columns}
                FROM legacy.game_sources
                WHERE source = ?
                """,
                (source_name,),
            )
            connection.commit()
            game_count = connection.execute("SELECT count(*) FROM games").fetchone()[0]
            record_count = connection.execute(
                "SELECT count(*) FROM game_sources"
            ).fetchone()[0]
            check = connection.execute("PRAGMA quick_check").fetchone()[0]
            if check != "ok":
                raise sqlite3.DatabaseError(f"integrity check failed for {label}: {check}")
            connection.execute("PRAGMA journal_mode = WAL")
        except Exception:
            connection.close()
            if temporary.exists():
                temporary.unlink()
            raise
        else:
            connection.close()

        os.replace(temporary, destination)
        results.append((label, destination, game_count, record_count))
    return results


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Split the shared Xiangqi catalog into source writer databases"
    )
    parser.add_argument("--source", type=Path, default=LEGACY_DATABASE)
    parser.add_argument(
        "--replace", action="store_true", help="atomically replace existing split databases"
    )
    args = parser.parse_args()
    for label, path, games, records in split_database(
        args.source, replace=args.replace
    ):
        print(f"{label}: {games:,} games, {records:,} source records -> {path}")
    print(f"Original database retained at {args.source.resolve()}")


if __name__ == "__main__":
    main()
