"""Verify live catalog projections; back up before an actual schema upgrade."""

import argparse
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import time

from tools.games_database.catalog_index import ensure, index_is_current
from tools.games_database.storage import SCHEMA_VERSION


def content_digest(connection):
    digest = hashlib.sha256()
    for table in ("games", "game_sources"):
        digest.update(table.encode())
        for row in connection.execute(f"SELECT * FROM {table} ORDER BY id"):
            digest.update(
                json.dumps(
                    row,
                    ensure_ascii=False,
                    separators=(",", ":"),
                    default=lambda value: {"blob": value.hex()},
                ).encode()
            )
            digest.update(b"\n")
    return digest.hexdigest()


def checkpoint_catalog(path):
    """Finish SQLite's WAL handoff while deployment owns the stopped-writer gate.

    Never unlink a WAL: it can contain committed games. SQLite must checkpoint it
    successfully before the next container opens the catalog as immutable.
    """
    path = Path(path)
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=rw", uri=True)) as db:
        busy, _, _ = db.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
        if busy:
            raise ValueError(
                "catalog checkpoint is busy; a reader or writer is still active"
            )
    wal = Path(str(path) + "-wal")
    if wal.exists() and wal.stat().st_size:
        raise ValueError(
            "catalog checkpoint left WAL frames; refusing immutable readers"
        )


def prepare(path, backups):
    _prepare(path, backups)
    checkpoint_catalog(path)


def _prepare(path, backups):
    path, backups = Path(path), Path(backups)
    with closing(
        sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    ) as source:
        try:
            version = source.execute(
                "SELECT value FROM metadata WHERE key='schema_version'"
            ).fetchone()
            if (
                version
                and version[0] == str(SCHEMA_VERSION)
                and index_is_current(source)
            ):
                print(
                    "Live catalog schema and projections are current; no schema changes"
                )
                return
        except sqlite3.OperationalError:
            pass
        backups.mkdir(parents=True, exist_ok=True)
        archive = backups / f"catalog-before-projection-{time.time_ns()}.sqlite3"
        with closing(sqlite3.connect(archive)) as destination:
            source.backup(destination)
            if destination.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                raise ValueError("catalog backup integrity check failed")
            original = content_digest(destination)
        with archive.open("rb") as stream:
            checksum = hashlib.file_digest(stream, "sha256").hexdigest()
        archive.with_suffix(".sha256").write_text(checksum + "\n")
    ensure(path, progress=True)
    with closing(
        sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    ) as current:
        if not index_is_current(current) or content_digest(current) != original:
            raise ValueError(
                f"catalog preservation verification failed; recover from {archive}"
            )
    print(f"Catalog projections upgraded; original retained at {archive}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True)
    parser.add_argument("--backups", required=True)
    args = parser.parse_args()
    prepare(args.database, args.backups)
