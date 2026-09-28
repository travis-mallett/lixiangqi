"""Remove obsolete phase labels from the mutable local puzzle stores.

This deliberately does not rewrite releases or snapshot metadata.  Those are
historical evidence and must remain immutable; a new release can simply be
built from the cleaned current catalog.
"""

from __future__ import annotations

import argparse
from datetime import datetime, UTC
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import uuid

OBSOLETE_TAGS = frozenset({"opening", "middlegame", "middle_game", "middle-game"})


def _clean(value):
    if not isinstance(value, list) or not all(isinstance(tag, str) for tag in value):
        raise ValueError("themes must be a list of strings")
    cleaned = [tag for tag in value if tag.strip().lower() not in OBSOLETE_TAGS]
    return cleaned, len(value) - len(cleaned)


def _backup(path: Path, backup_dir: Path) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    target = (
        backup_dir
        / f"{path.stem}-before-phase-tag-cleanup-{datetime.now(UTC):%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:8]}.sqlite3"
    )
    source = sqlite3.connect(path)
    destination = sqlite3.connect(target)
    try:
        source.backup(destination)
        result = destination.execute("PRAGMA quick_check").fetchone()
        if not result or result[0] != "ok":
            raise sqlite3.DatabaseError(f"backup integrity check failed for {path}")
    finally:
        destination.close()
        source.close()
    return target


def _rewrite_json_column(db, table, key_column, value_column, counters):
    rows = db.execute(f"SELECT {key_column},{value_column} FROM {table}").fetchall()
    for key, raw in rows:
        try:
            value = json.loads(raw)
        except (TypeError, json.JSONDecodeError) as exc:
            raise ValueError(f"invalid JSON in {table} {key_column}={key}") from exc
        if not isinstance(value, dict) or "themes" not in value:
            raise ValueError(f"missing themes in {table} {key_column}={key}")
        cleaned, removed = _clean(value["themes"])
        if removed:
            value["themes"] = cleaned
            db.execute(
                f"UPDATE {table} SET {value_column}=? WHERE {key_column}=?",
                (
                    json.dumps(
                        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
                    ),
                    key,
                ),
            )
            counters[f"{table}.documents"] += 1
            counters[f"{table}.tags"] += removed


def _rewrite_theme_column(db, table, key_column, counters):
    rows = db.execute(f"SELECT {key_column},themes FROM {table}").fetchall()
    for key, raw in rows:
        themes, removed = _clean(json.loads(raw or "[]"))
        if removed:
            db.execute(
                f"UPDATE {table} SET themes=? WHERE {key_column}=?",
                (json.dumps(themes, separators=(",", ":")), key),
            )
            counters[f"{table}.documents"] += 1
            counters[f"{table}.tags"] += removed


def clean_phase_tags(catalog_path: Path, mining_path: Path, backup_dir: Path) -> dict:
    """Clean mutable stores and return counts.  Both stores are backed up first."""
    catalog_path, mining_path, backup_dir = map(
        Path, (catalog_path, mining_path, backup_dir)
    )
    if not catalog_path.is_file():
        raise FileNotFoundError(catalog_path)
    if not mining_path.is_file():
        raise FileNotFoundError(mining_path)
    backups = [_backup(path, backup_dir) for path in (catalog_path, mining_path)]
    counters = {
        "catalog_puzzles.documents": 0,
        "catalog_puzzles.tags": 0,
        "puzzles.documents": 0,
        "puzzles.tags": 0,
        "candidates.documents": 0,
        "candidates.tags": 0,
        "taxonomy_assessments.rows": 0,
    }
    with closing(sqlite3.connect(catalog_path)) as db:
        with db:
            db.execute("BEGIN IMMEDIATE")
            _rewrite_json_column(db, "catalog_puzzles", "id", "document", counters)
    with closing(sqlite3.connect(mining_path)) as db:
        with db:
            db.execute("BEGIN IMMEDIATE")
            _rewrite_theme_column(db, "puzzles", "id", counters)
            rows = db.execute("SELECT id,themes_json FROM candidates").fetchall()
            for key, raw in rows:
                themes = json.loads(raw or "[]")
                cleaned, removed = _clean(themes)
                if removed:
                    db.execute(
                        "UPDATE candidates SET themes_json=? WHERE id=?",
                        (json.dumps(cleaned, separators=(",", ":")), key),
                    )
                    counters["candidates.documents"] += 1
                    counters["candidates.tags"] += removed
    return {"backups": [str(path) for path in backups], **counters}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--mining", type=Path, required=True)
    parser.add_argument("--backup-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    print(
        json.dumps(
            clean_phase_tags(args.catalog, args.mining, args.backup_dir), indent=2
        )
    )


if __name__ == "__main__":
    main()
