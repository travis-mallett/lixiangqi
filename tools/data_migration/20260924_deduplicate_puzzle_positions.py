"""Explicit one-time cleanup of the local Studio candidate pool and catalog.

Stop Studio workers first. Full SQLite backups and a decision report precede
edits. Published IDs take precedence, then active puzzles, verified candidates,
and finally the oldest candidate. Redundant source occurrences and their derived
evidence are removed from mining; catalog IDs are retired, never deleted. Live
retirements go through the normal explicit Studio publication workflow.

This tool is not called by Studio startup, discovery, or publication.
"""

import argparse
import json
import sqlite3
from collections import defaultdict
from contextlib import closing
from pathlib import Path

from tools.xiangqi_data.puzzle_mining.position import position_hash, replay_fens


def plan(db):
    candidates = {
        r["id"]: dict(r)
        for r in db.execute(
            "SELECT c.id,c.candidate_key,c.position_hash,c.position_fen,"
            "coalesce(a.accepted=1 AND a.coverage='complete',0) AS verified "
            "FROM candidates c LEFT JOIN candidate_assessments a "
            "ON a.id=c.current_verification_id"
        )
    }
    groups = defaultdict(list)
    for c in candidates.values():
        if c["position_hash"] != position_hash(c["position_fen"]):
            raise ValueError(f"Candidate {c['id']} has an inconsistent position hash")
        groups[c["position_hash"]].append(c["id"])
    puzzles = {
        r["id"]: dict(r)
        for r in db.execute(
            "SELECT id,candidate_id,verification_status,created_at FROM puzzles"
        )
    }
    authored = {
        r[0]: json.loads(r[1])
        for r in db.execute("SELECT id,document FROM authored.catalog_puzzles")
    }
    if db.execute(
        "SELECT 1 FROM authored.sqlite_master WHERE name='catalog_live'"
    ).fetchone():
        live = {
            r[0]
            for r in db.execute("SELECT id,document FROM authored.catalog_live")
            if not json.loads(r[1]).get("retired")
        }
    else:
        row = db.execute(
            "SELECT value FROM authored.catalog_metadata WHERE key='baseline'"
        ).fetchone()
        live = (
            {p["_id"] for p in json.loads(row[0]) if not p.get("retired")}
            if row
            else set()
        )
    active = defaultdict(list)
    for pid, p in authored.items():
        if not p.get("retired"):
            root = replay_fens([p["line"].split()[0]], p["fen"])[-1]
            h = position_hash(root)
            if h not in groups or pid not in puzzles:
                raise ValueError(
                    f"Import catalog puzzle {pid} into mining before cleanup"
                )
            if candidates[puzzles[pid]["candidate_id"]]["position_hash"] != h:
                raise ValueError(f"Catalog and mining disagree on position for {pid}")
            active[h].append(pid)
    per_candidate = defaultdict(list)
    for p in puzzles.values():
        per_candidate[p["candidate_id"]].append(p)

    decisions = []
    retire = {}
    for h, ids in groups.items():

        def rank(cid, h=h):
            records = per_candidate[cid]
            return (
                not any(p["id"] in live and p["id"] in active[h] for p in records),
                not any(p["id"] in active[h] for p in records),
                not any(p["verification_status"] == "active" for p in records),
                not candidates[cid]["verified"],
                cid,
            )

        keep = min(ids, key=rank)
        remove = sorted(set(ids) - {keep})
        eligible = [pid for pid in active[h] if puzzles[pid]["candidate_id"] == keep]
        if eligible:
            keeper_puzzle = min(
                eligible,
                key=lambda pid: (
                    puzzles[pid]["verification_status"] != "active",
                    pid not in live,
                    puzzles[pid]["created_at"],
                    pid,
                ),
            )
            for pid in active[h]:
                if pid != keeper_puzzle:
                    retire[pid] = keeper_puzzle
        if remove:
            decisions.append(
                {
                    "position_hash": h,
                    "keep": keep,
                    "remove": remove,
                    "keep_puzzles": [p["id"] for p in per_candidate[keep]],
                    "remove_puzzles": [
                        p["id"] for cid in remove for p in per_candidate[cid]
                    ],
                    "remove_active_puzzles": [
                        p["id"]
                        for cid in remove
                        for p in per_candidate[cid]
                        if p["verification_status"] == "active"
                    ],
                }
            )
    return {"groups": decisions, "retire_catalog": retire}


def apply(db, decisions):
    """Apply a reviewed plan inside the caller's transaction, with backups saved."""
    # These reverse references are rarely queried during normal mining, but
    # SQLite checks them for every cascading delete. Temporary migration indexes
    # avoid repeatedly scanning large proof tables during this one-time cleanup.
    references = {
        "candidates": ("current_verification_id", "current_classification_id"),
        "puzzles": (
            "candidate_id",
            "canonical_assessment_id",
            "taxonomy_assessment_id",
        ),
        "taxonomy_assessments": ("verification_assessment_id",),
        "motif_removal_evidence": ("canonical_assessment_id",),
        "category_assessments": ("verification_assessment_id",),
    }
    indexes = []
    for table, columns in references.items():
        for column in columns:
            name = f"dedup_{table}_{column}"
            db.execute(f"CREATE INDEX {name} ON {table}({column})")
            indexes.append(name)
    db.execute("CREATE TEMP TABLE duplicate_candidates(id INTEGER PRIMARY KEY)")
    db.executemany(
        "INSERT INTO duplicate_candidates VALUES (?)",
        [(cid,) for g in decisions["groups"] for cid in g["remove"]],
    )
    for pid, keep in decisions["retire_catalog"].items():
        db.execute(
            "UPDATE authored.catalog_puzzles SET document=json_set(document,"
            "'$.retired',json('true'),'$.retirementReason',?) WHERE id=?",
            (f"Duplicate starting position; retained {keep}", pid),
        )
    db.execute(
        "DELETE FROM verification_jobs WHERE candidate_id IN (SELECT id FROM duplicate_candidates)"
    )
    db.execute(
        "UPDATE candidates SET current_verification_id=NULL,current_classification_id=NULL "
        "WHERE id IN (SELECT id FROM duplicate_candidates)"
    )
    db.execute(
        "DELETE FROM candidates WHERE id IN (SELECT id FROM duplicate_candidates)"
    )
    db.execute("DROP TABLE duplicate_candidates")
    if db.execute("PRAGMA foreign_key_check").fetchone():
        raise ValueError("Mining foreign-key check failed")
    if db.execute("PRAGMA authored.foreign_key_check").fetchone():
        raise ValueError("Catalog foreign-key check failed")
    if db.execute(
        "SELECT 1 FROM candidates GROUP BY position_hash HAVING count(*)>1 LIMIT 1"
    ).fetchone():
        raise ValueError("Duplicate candidates remain")
    db.execute("DROP INDEX IF EXISTS candidates_by_position")
    db.execute(
        "CREATE UNIQUE INDEX candidates_by_position ON candidates(position_hash)"
    )
    db.execute("UPDATE metadata SET value='18' WHERE key='schema_version'")
    for name in indexes:
        db.execute(f"DROP INDEX {name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mining", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--backup-dir", type=Path, required=True)
    args = parser.parse_args()
    args.backup_dir.mkdir(parents=True, exist_ok=False)
    for source, name in [
        (args.mining, "mining.sqlite3"),
        (args.catalog, "catalog.sqlite3"),
    ]:
        with (
            closing(
                sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)
            ) as src,
            closing(sqlite3.connect(args.backup_dir / name)) as dst,
        ):
            print(f"Backing up {source}", flush=True)
            src.backup(dst)
    with closing(sqlite3.connect(args.mining, timeout=30)) as db:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("ATTACH DATABASE ? AS authored", (str(args.catalog.resolve()),))
        with db:
            db.execute("BEGIN IMMEDIATE")
            decisions = plan(db)
            report = args.backup_dir / "decisions.json"
            report.write_text(json.dumps(decisions, indent=2), encoding="utf-8")
            print(f"Saved cleanup plan: {report}", flush=True)
            apply(db, decisions)
    print(
        f"Removed {sum(len(g['remove']) for g in decisions['groups'])} duplicate candidates; "
        f"retired {len(decisions['retire_catalog'])} catalog IDs. Publish retirements normally."
    )


if __name__ == "__main__":
    main()
