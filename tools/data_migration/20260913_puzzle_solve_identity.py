"""Repair local Studio identities created by category-only replacements.

Run with Studio workers stopped. This changes no live server data. Published IDs
from the reconciled catalog win; multiple published IDs for one solve require an
explicit live-data migration instead. Complete SQLite backups precede all edits.
Assessment history is retained; redundant local publication rows are removed.
"""

from contextlib import closing
from datetime import UTC, datetime
import argparse
import json
from pathlib import Path
import sqlite3
from uuid import uuid4

from tools.puzzle_catalog.catalog import _json, solve_identity
from tools.puzzle_catalog.desktop.settings import atomic_json
from tools.xiangqi_data.puzzle_mining.sources import is_native_source, native_origin


def key(puzzle):
    return _json(solve_identity(puzzle))


def plan(db):
    groups = {}
    identities = {}
    mismatched = set()
    mined = {}
    for row in db.execute(
        "SELECT p.*,c.source_database FROM puzzles p JOIN candidates c ON c.id=p.candidate_id ORDER BY p.rowid"
    ):
        row = dict(row)
        source = row.pop("source_database")
        document = {
            "_id": row["id"],
            "gameId": row["game_id"],
            "gameSource": (
                {"type": "native", "origin": native_origin(source)}
                if is_native_source(source)
                else {"type": "catalog", "database": source}
            ),
            "fen": row["fen"],
            "line": " ".join(json.loads(row["line"])),
        }
        groups.setdefault(key(document), set()).add(row["id"])
        identities[row["id"]] = key(document)
        mined[row["id"]] = row
    authored = {}
    for row in db.execute("SELECT * FROM authored.catalog_puzzles"):
        document = json.loads(row["document"])
        if row["id"] in identities and identities[row["id"]] != key(document):
            mismatched.add(row["id"])
        groups.setdefault(key(document), set()).add(row["id"])
        authored[row["id"]] = dict(row)
    tables = {
        r[0]
        for r in db.execute(
            "SELECT name FROM authored.sqlite_master WHERE type='table'"
        )
    }
    if "catalog_live" in tables:
        published = {r[0] for r in db.execute("SELECT id FROM authored.catalog_live")}
    else:
        row = db.execute(
            "SELECT value FROM authored.catalog_metadata WHERE key='baseline'"
        ).fetchone()
        published = {p["_id"] for p in json.loads(row[0])} if row else set()
    plans = []
    for ids in groups.values():
        if len(ids) < 2:
            continue
        if ids & mismatched:
            raise ValueError(
                f"Mining and catalog disagree on duplicate solve identity: {sorted(ids & mismatched)}"
            )
        public = ids & published
        if len(public) > 1:
            raise ValueError(
                f"Multiple published IDs share a solve; refusing local merge: {sorted(public)}"
            )
        records = [row for pid, row in mined.items() if pid in ids]
        if len({row["candidate_id"] for row in records}) > 1:
            raise ValueError(f"Solve spans different candidates: {sorted(ids)}")
        active = [row for row in records if row["verification_status"] == "active"]
        if len(active) > 1:
            raise ValueError(f"Multiple active records share a solve: {sorted(ids)}")
        latest = active[0] if active else (records[-1] if records else None)
        if latest is None:
            raise ValueError(
                f"Duplicate catalog solve lacks mining evidence: {sorted(ids)}"
            )
        keep = next(iter(public)) if public else latest["id"]
        if keep not in mined:
            raise ValueError(
                f"Import published puzzle {keep} into mining before identity repair"
            )
        replacement = {**latest, "id": keep, "created_at": mined[keep]["created_at"]}
        content = authored.get(latest["id"], authored.get(keep))
        if content:
            content = dict(content)
            document = json.loads(content["document"])
            document["_id"] = keep
            # Undo only assessment-owned withdrawal. Operator moderation survives.
            if active and document.get("retirementReason") in {
                "assessment replaced publication",
                "latest assessment ineligible",
            }:
                document.update(retired=False, retirementReason=None)
            content.update(id=keep, document=_json(document))
        plans.append(
            {
                "keep": keep,
                "remove": sorted(ids - {keep}),
                "mining": replacement,
                "catalog": content,
            }
        )
    return plans


def rejected_outbox(path, removed):
    if not path.exists():
        return None
    outbox = json.loads(path.read_text(encoding="utf-8"))
    remaining = []
    for request in outbox["requests"]:
        changes = request["changes"]
        identities = [key(c["puzzle"]) for c in changes]
        if len(set(identities)) != len(identities):
            # The publication API rejects this shape before creating a journal
            # entry or writing puzzles, including retired entries in the check.
            continue
        if removed.intersection(c["puzzle"]["_id"] for c in changes):
            raise ValueError(
                "A potentially accepted outbox references replaced IDs; reconcile its server receipt first"
            )
        remaining.append(request)
    if len(remaining) == len(outbox["requests"]):
        return None
    return {
        **outbox,
        "requests": remaining,
        "total": outbox.get("completed", 0) + sum(len(r["changes"]) for r in remaining),
    }


def repair(mining_path, catalog_path, state_dir, *, apply=False):
    mining_path, catalog_path, state_dir = map(
        Path, (mining_path, catalog_path, state_dir)
    )
    for path in (mining_path, catalog_path):
        if not path.is_file():
            raise ValueError(f"Missing database: {path}")
    with closing(sqlite3.connect(mining_path, timeout=30)) as db:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("ATTACH DATABASE ? AS authored", (str(catalog_path.resolve()),))
        db.execute("BEGIN IMMEDIATE")
        try:
            changes = plan(db)
            removed = {pid for change in changes for pid in change["remove"]}
            outbox_path = state_dir / "publication-outbox.json"
            outbox = rejected_outbox(outbox_path, removed)
            result = {
                "solves": len(changes),
                "removed": len(removed),
                "identities": [
                    {"keep": c["keep"], "remove": c["remove"]} for c in changes
                ],
                "outbox_repaired": outbox is not None,
            }
            if not apply or (not changes and outbox is None):
                db.rollback()
                return result
            recovery = (
                state_dir
                / "recovery"
                / (
                    "solve-identity-"
                    + datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
                    + "-"
                    + uuid4().hex[:8]
                )
            )
            recovery.mkdir(parents=True)
            for name, path in (("mining", mining_path), ("catalog", catalog_path)):
                # A separate reader can back up WAL while this connection holds
                # the write locks. Backing up the writing connection would block.
                with closing(
                    sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
                ) as source:
                    with closing(
                        sqlite3.connect(recovery / f"{name}.sqlite3")
                    ) as target:
                        source.backup(target)
                        if (
                            target.execute("PRAGMA integrity_check").fetchone()[0]
                            != "ok"
                        ):
                            raise ValueError(f"Invalid {name} recovery backup")
            atomic_json(recovery / "plan.json", {**result, "changes": changes})
            if outbox_path.exists():
                (recovery / "publication-outbox.json").write_bytes(
                    outbox_path.read_bytes()
                )
            print(f"Saved identity recovery backups: {recovery}", flush=True)
            for change in changes:
                for pid in change["remove"]:
                    db.execute("DELETE FROM puzzles WHERE id=?", (pid,))
                    db.execute(
                        "DELETE FROM authored.catalog_puzzles WHERE id=?", (pid,)
                    )
                    db.execute(
                        "UPDATE authored.catalog_assessments SET puzzle_id=? WHERE puzzle_id=?",
                        (change["keep"], pid),
                    )
                row = change["mining"]
                columns = [name for name in row if name != "id"]
                db.execute(
                    "UPDATE puzzles SET "
                    + ",".join(f"{name}=?" for name in columns)
                    + " WHERE id=?",
                    [*(row[name] for name in columns), row["id"]],
                )
                content = change["catalog"]
                if content:
                    db.execute(
                        "INSERT INTO authored.catalog_puzzles VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document,evidence=excluded.evidence",
                        (content["id"], content["document"], content["evidence"]),
                    )
            if plan(db):
                raise ValueError("Identity repair left duplicate solves")
            if db.execute("PRAGMA foreign_key_check").fetchone():
                raise ValueError("Identity repair foreign key check failed")
            db.commit()
            if outbox is not None:
                if outbox["requests"]:
                    atomic_json(outbox_path, outbox)
                else:
                    outbox_path.unlink()
            atomic_json(recovery / "completed.json", result)
            return {**result, "backup": str(recovery)}
        except BaseException:
            db.rollback()
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(
        json.dumps(
            repair(args.database, args.catalog, args.state_dir, apply=args.apply),
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
