"""Freeze reconciled live membership for an offline worker connection."""

import json
import sqlite3
from contextlib import closing
from pathlib import Path


def live_inventory(catalog_path):
    with closing(
        sqlite3.connect(Path(catalog_path).resolve().as_uri() + "?mode=ro", uri=True)
    ) as catalog:
        meta = dict(catalog.execute("SELECT key,value FROM catalog_metadata"))
        release = json.loads(meta.get("deployedReleaseId", "null"))
        if release:
            row = catalog.execute(
                "SELECT document FROM catalog_releases WHERE id=?", (release,)
            ).fetchone()
            if row is None:
                raise ValueError("Confirmed production release is missing")
            puzzles = json.loads(row[0])["puzzles"]
        else:
            puzzles = json.loads(meta.get("baseline", "[]"))
        return [p for p in puzzles if not p.get("retired")]


def prepare_priority(connection, catalog_path=None):
    connection.execute(
        "CREATE TEMP TABLE IF NOT EXISTS live_candidates(id INTEGER PRIMARY KEY)"
    )
    if catalog_path is None:
        return
    live = {p["_id"] for p in live_inventory(catalog_path)}
    keys = set()
    with closing(
        sqlite3.connect(Path(catalog_path).resolve().as_uri() + "?mode=ro", uri=True)
    ) as catalog:
        for pid, raw in catalog.execute("SELECT id,evidence FROM catalog_puzzles"):
            evidence = json.loads(raw)
            if pid in live or evidence.get("originatingPuzzleId") in live:
                if evidence.get("candidateKey"):
                    keys.add(evidence["candidateKey"])
    connection.executemany(
        "INSERT OR IGNORE INTO live_candidates SELECT candidate_id FROM puzzles WHERE id=?",
        [(pid,) for pid in live],
    )
    connection.executemany(
        "INSERT OR IGNORE INTO live_candidates SELECT id FROM candidates WHERE candidate_key=?",
        [(key,) for key in keys],
    )
    connection.commit()
