"""Back up and repair native analysis history and unsupported-variant queues."""

import argparse
import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
import uuid
import zlib

from tools.xiangqi_data.puzzle_mining.sources import is_native_source
from tools.environment_data.snapshot import verify_snapshot

POLICY = "native-game-history-v1/catalog-isolated-root-v1"
UNSUPPORTED = "Unsupported native source ruleset for Xiangqi puzzle discovery"


def migrate(database: Path, recovery: Path, *, apply=False, snapshot=None):
    source_rules = {}
    if snapshot is not None:
        manifest = verify_snapshot(snapshot)
        origin = "lixiangqi:" + manifest["productionOrigin"]
        for raw in (
            (snapshot / "native-games.jsonl").read_text(encoding="utf-8").splitlines()
        ):
            if raw.strip():
                source = json.loads(raw)
                source_rules[(origin, source["id"])] = source["ruleset"]
    db = sqlite3.connect(database.resolve().as_uri() + "?mode=rw", uri=True)
    db.row_factory = sqlite3.Row
    try:
        db.execute("BEGIN IMMEDIATE" if apply else "BEGIN")
        jobs = []
        for row in db.execute("""SELECT j.*,a.payload_zlib,EXISTS (
                 SELECT 1 FROM game_analysis_publications p WHERE p.job_id=j.id) AS unpublished
               FROM game_jobs j LEFT JOIN game_analyses a ON a.job_id=j.id
               WHERE j.source_database LIKE 'lixiangqi:%'"""):
            if not is_native_source(row["source_database"]):
                continue
            ruleset = source_rules.get((row["source_database"], row["game_id"]))
            unsupported = ruleset is not None and ruleset not in {
                "unrestricted-v1",
                "tiantian-v1",
            }
            if unsupported:
                if row["status"] == "rejected" and row["diagnostic"] == UNSUPPORTED:
                    continue
                action = "reject"
            elif row["status"] == "complete" and row["unpublished"]:
                analysis = json.loads(zlib.decompress(row["payload_zlib"]))
                if analysis.get("settings", {}).get("history_policy") == POLICY:
                    continue
                action = "requeue"
            else:
                continue
            item = dict(row)
            item.pop("unpublished")
            jobs.append((item, action))
        if not apply or not jobs:
            return len(jobs), None
        originals = []
        for job, action in jobs:
            job.pop("payload_zlib")
            analysis_row = db.execute(
                "SELECT * FROM game_analyses WHERE job_id=?", (job["id"],)
            ).fetchone()
            originals.append(
                {
                    "job": job,
                    "action": action,
                    "analysis": (
                        {
                            key: (
                                base64.b64encode(value).decode("ascii")
                                if isinstance(value, bytes)
                                else value
                            )
                            for key, value in dict(analysis_row).items()
                        }
                        if analysis_row is not None
                        else None
                    ),
                    "publications": [
                        dict(row)
                        for row in db.execute(
                            "SELECT * FROM game_analysis_publications WHERE job_id=?",
                            (job["id"],),
                        )
                    ],
                    "depth": [
                        dict(row)
                        for row in db.execute(
                            "SELECT * FROM game_analysis_depths WHERE source_database=? AND game_id=?",
                            (job["source_database"], job["game_id"]),
                        )
                    ],
                }
            )
        backup = (
            recovery
            / (
                "native-discovery-history-"
                + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
                + "-"
                + uuid.uuid4().hex
            )
            / "original.json"
        )
        backup.parent.mkdir(parents=True)
        with backup.open("xb") as stream:
            stream.write(
                (
                    json.dumps(
                        {"database": str(database.resolve()), "jobs": originals},
                        indent=2,
                    )
                    + "\n"
                ).encode()
            )
            stream.flush()
            os.fsync(stream.fileno())
        # Verify recoverability before changing any queue or coverage metadata.
        saved = json.loads(backup.read_text())
        if len(saved["jobs"]) != len(jobs):
            raise ValueError("Recovery backup job count differs")
        for original in saved["jobs"]:
            if original["analysis"] is not None:
                json.loads(
                    zlib.decompress(
                        base64.b64decode(original["analysis"]["payload_zlib"])
                    )
                )
        for job, action in jobs:
            db.execute(
                "DELETE FROM game_analysis_publications WHERE job_id=?", (job["id"],)
            )
            db.execute(
                "DELETE FROM game_analysis_depths WHERE source_database=? AND game_id=?",
                (job["source_database"], job["game_id"]),
            )
            db.execute(
                """UPDATE game_jobs SET attempts=0,claim_token=NULL,
                claimed_at=NULL,next_attempt_at=NULL,diagnostic=?,status=?,updated_at=?
                WHERE id=?""",
                (
                    (
                        UNSUPPORTED
                        if action == "reject"
                        else "Reanalyse with native source history"
                    ),
                    "rejected" if action == "reject" else "queued",
                    datetime.now(timezone.utc).isoformat(),
                    job["id"],
                ),
            )
        db.commit()
        return len(jobs), backup
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--recovery", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--snapshot",
        type=Path,
        help="Verified current snapshot; also excludes unsupported native variants",
    )
    args = parser.parse_args()
    count, backup = migrate(
        args.database, args.recovery, apply=args.apply, snapshot=args.snapshot
    )
    print(
        f"{'Repaired' if args.apply else 'Would repair'} {count} native analysis job(s)."
    )
    if backup:
        print(f"Original analysis and queue metadata backed up to {backup}")


if __name__ == "__main__":
    main()
