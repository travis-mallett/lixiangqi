"""Discard the 626 audited legacy nonmates, with a recoverable SQLite backup.

Run from the repository root with --database and --apply. No engine or discovery
work is performed. Historical evidence is retained; only eligibility changes.
"""

import argparse
import json
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

from tools.xiangqi_data.puzzle_mining.storage import _claimed_candidate
from tools.xiangqi_data.puzzle_mining.verification_store import (
    VerificationClaim,
    candidate_pool_sql,
    finish_verification,
)

MARKER = "20260913_discard_legacy_nonmates"
REASON = "mate_not_reproduced"
SELECT = """SELECT c.*,j.id job_id,j.signature,j.diagnostic job_diagnostic
    FROM candidates c JOIN verification_jobs j ON j.candidate_id=c.id
    WHERE j.updated_at>='2026-09-13T19:51:28'
    AND j.updated_at<'2026-09-13T20:47:46'
    AND j.status='incomplete'
    AND j.diagnostic LIKE 'inconclusive: mate_not_reproduced_inconclusive; settings=%'
    ORDER BY c.id"""


def targets(db, expected):
    rows = db.execute(SELECT).fetchall()
    if len(rows) != expected or len({r["id"] for r in rows}) != expected:
        raise ValueError(
            f"Expected exactly {expected} distinct candidates, found {len(rows)}"
        )
    for r in rows:
        score = json.loads(r["after_score_json"])
        if (
            r["candidate_type"] != "checkmate_candidate"
            or r["source_database"] != "catalog"
            or r["current_verification_id"] is not None
            or r["current_classification_id"] is not None
            or json.loads(r["search_settings_json"]).get("history_policy")
            or score["kind"] != "mate"
            or score["value"] != -1
        ):
            raise ValueError(f"Unexpected candidate evidence: {r['id']}")
        if db.execute(
            "SELECT 1 FROM puzzles WHERE candidate_id=?", (r["id"],)
        ).fetchone():
            raise ValueError(f"Candidate has publication inventory: {r['id']}")
        if db.execute(
            "SELECT 1 FROM verification_jobs WHERE candidate_id=? AND status='processing'",
            (r["id"],),
        ).fetchone():
            raise ValueError(f"Candidate is being verified: {r['id']}")
    return rows


def migrate(path, *, apply=False, expected=626):
    path = Path(path).resolve()
    db = sqlite3.connect(path.as_uri() + "?mode=rw", uri=True, timeout=30)
    db.row_factory = sqlite3.Row
    try:
        marker = db.execute(
            "SELECT value FROM metadata WHERE key=?", (MARKER,)
        ).fetchone()
        if marker:
            print(f"Already applied: {marker[0]}", flush=True)
            return json.loads(marker[0])
        rows = targets(db, expected)
        print(
            f"Validated {len(rows)} legacy candidates; no engine work required.",
            flush=True,
        )
        if not apply:
            return {"candidates": len(rows)}
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        backup = path.with_name(
            f"{path.name}.before-nonmate-discard-{stamp}-{uuid.uuid4().hex[:8]}.sqlite3"
        )
        print(f"Creating recovery backup: {backup}", flush=True)
        destination = sqlite3.connect(backup)
        try:
            db.backup(destination)
            if destination.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise RuntimeError("Recovery backup failed quick_check")
        finally:
            destination.close()
        print("Recovery backup verified. Applying discards atomically.", flush=True)
        db.execute("BEGIN IMMEDIATE")
        try:
            fresh = targets(db, expected)
            if [dict(r) for r in rows] != [dict(r) for r in fresh]:
                raise RuntimeError(
                    "Candidates changed during backup; rerun from a fresh snapshot"
                )
            before = db.execute(
                f"SELECT count(*) FROM ({candidate_pool_sql()})"
            ).fetchone()[0]
            for r in fresh:
                settings = json.loads(r["job_diagnostic"].split("; settings=", 1)[1])
                config = SimpleNamespace(
                    version=settings["version"], settings=lambda s=settings: s
                )
                # Identify the saved attempt, not a newly executed engine search.
                engine = SimpleNamespace(
                    engine_version="not-run:manual-discard", nnue="not-run"
                )
                token = uuid.uuid4().hex
                db.execute(
                    "UPDATE verification_jobs SET status='processing',claim_token=? WHERE id=?",
                    (token, r["job_id"]),
                )
                claim = VerificationClaim(
                    r["job_id"], r["signature"], _claimed_candidate(r, token), None
                )
                finish_verification(
                    db, claim, config, engine, invalid=REASON, commit=False
                )
            after = db.execute(
                f"SELECT count(*) FROM ({candidate_pool_sql()})"
            ).fetchone()[0]
            if before - after != expected:
                raise RuntimeError(
                    f"Pool changed by {before-after}, expected {expected}"
                )
            if db.execute("PRAGMA foreign_key_check").fetchone():
                raise RuntimeError("Foreign key validation failed")
            report = {
                "discarded": expected,
                "pool_before": before,
                "pool_after": after,
                "backup": str(backup),
                "candidate_ids": [r["id"] for r in fresh],
            }
            db.execute(
                "INSERT INTO metadata(key,value) VALUES(?,?)",
                (MARKER, json.dumps(report)),
            )
            db.commit()
        except BaseException:
            db.rollback()
            raise
        print(
            json.dumps({k: v for k, v in report.items() if k != "candidate_ids"}),
            flush=True,
        )
        return report
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    migrate(args.database, apply=args.apply)
