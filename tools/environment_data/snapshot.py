"""Verified production exports and destructive-but-recoverable disposable previews."""

from __future__ import annotations
import argparse
from datetime import UTC, datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tempfile
import uuid

PREVIEW_DATABASE = "lixiangqi_preview"
PREVIEW_URI = "mongodb://127.0.0.1:27017"
REQUIRED = {"mongo.archive.gz", "native-games.jsonl", "puzzle-inventory.json"}


def _sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def build_manifest(
    root, snapshot_id, origin="production", production_origin="https://lixiangqi.com"
):
    if origin != "production":
        raise ValueError("only production exports are snapshot sources")
    return {
        "schemaVersion": 1,
        "snapshotId": snapshot_id,
        "origin": origin,
        "productionOrigin": production_origin,
        "createdAt": datetime.now(UTC).isoformat(),
        "files": {
            p.name: _sha256(p)
            for p in sorted(Path(root).iterdir())
            if p.name in REQUIRED
        },
    }


def verify_snapshot(root):
    root = Path(root)
    if root.is_symlink():
        raise ValueError("snapshot root may not be a symlink")
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    if (
        manifest.get("schemaVersion") != 1
        or manifest.get("origin") != "production"
        or not isinstance(manifest.get("snapshotId"), str)
        or not manifest["snapshotId"]
        or not str(manifest.get("productionOrigin", "")).startswith("https://")
    ):
        raise ValueError("invalid production snapshot manifest")
    files = manifest.get("files")
    if not isinstance(files, dict) or set(files) != REQUIRED:
        raise ValueError("snapshot requires exactly the canonical export files")
    for name, checksum in files.items():
        if (
            PurePosixPath(name).is_absolute()
            or ".." in PurePosixPath(name).parts
            or "\\" in name
        ):
            raise ValueError("unsafe snapshot path")
        p = root / name
        if p.is_symlink() or not p.is_file() or _sha256(p) != checksum:
            raise ValueError(f"snapshot verification failed: {name}")
    if (root / "mongo.archive.gz").stat().st_size == 0:
        raise ValueError("empty Mongo archive")
    return manifest


def capture(source, destination):
    """Accept an already verified remote export; never mint provenance here."""
    source = Path(source)
    destination = Path(destination)
    manifest = verify_snapshot(source)
    if destination.exists():
        raise FileExistsError(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="capture-", dir=destination.parent) as temp:
        staged = Path(temp) / "snapshot"
        shutil.copytree(source, staged)
        verify_snapshot(staged)
        os.replace(staged, destination)
    return manifest


def refresh_preview(
    snapshot, preview_root, mongorestore, mongodump, *, client=None, run=subprocess.run
):
    """Writers must be stopped. No configurable host or production namespace."""
    snapshot = Path(snapshot)
    preview_root = Path(preview_root)
    manifest = verify_snapshot(snapshot)
    if (
        preview_root.resolve() == snapshot.resolve()
        or snapshot.resolve() in preview_root.resolve().parents
        or preview_root.resolve() in snapshot.resolve().parents
    ):
        raise ValueError("snapshot and preview storage must be disjoint")
    if preview_root.is_symlink():
        raise ValueError("preview root may not be a symlink")
    for executable in (mongorestore, mongodump):
        if not Path(executable).is_file():
            raise ValueError("Mongo dump/restore tools are required")
    preview_root.parent.mkdir(parents=True, exist_ok=True)
    backup_dir = preview_root.parent / "preview-backups" / uuid.uuid4().hex
    backup_dir.mkdir(parents=True)
    archive = backup_dir / "mongo.archive.gz"
    if client is None:
        from pymongo import MongoClient

        mongo = MongoClient(PREVIEW_URI, serverSelectionTimeoutMS=5000)
    else:
        mongo = client
    restore_started = False
    try:
        run(
            [
                str(mongodump),
                "--uri=" + PREVIEW_URI,
                "--db=" + PREVIEW_DATABASE,
                "--gzip",
                "--archive=" + str(archive),
            ],
            check=True,
        )
        if not archive.is_file() or archive.stat().st_size == 0:
            raise RuntimeError("preview backup did not produce an archive")
        (backup_dir / "manifest.json").write_text(
            json.dumps({"database": PREVIEW_DATABASE, "sha256": _sha256(archive)}),
            encoding="utf-8",
        )
        restore_started = True
        # --drop alone leaves collections that were absent from the source.
        mongo.drop_database(PREVIEW_DATABASE)
        run(
            [
                str(mongorestore),
                "--uri=" + PREVIEW_URI,
                "--stopOnError",
                "--gzip",
                "--archive=" + str(snapshot / "mongo.archive.gz"),
                "--nsInclude=lichess.*",
                "--nsFrom=lichess.*",
                "--nsTo=" + PREVIEW_DATABASE + ".*",
            ],
            check=True,
        )
        # Re-check transferred bytes before recording which snapshot is installed.
        verify_snapshot(snapshot)
        preview_root.mkdir(parents=True, exist_ok=True)
        temporary = preview_root / "state.json.partial"
        temporary.write_text(
            json.dumps(
                {
                    "snapshotId": manifest["snapshotId"],
                    "source": str(snapshot.resolve()),
                    "backup": str(backup_dir.resolve()),
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, preview_root / "state.json")
    except BaseException:
        if restore_started:
            expected = json.loads(
                (backup_dir / "manifest.json").read_text(encoding="utf-8")
            )["sha256"]
            if _sha256(archive) != expected:
                raise RuntimeError("preview backup changed; recovery refused")
            mongo.drop_database(PREVIEW_DATABASE)
            run(
                [
                    str(mongorestore),
                    "--uri=" + PREVIEW_URI,
                    "--stopOnError",
                    "--gzip",
                    "--archive=" + str(archive),
                    "--nsInclude=" + PREVIEW_DATABASE + ".*",
                ],
                check=True,
            )
        raise
    finally:
        if client is None:
            mongo.close()
    return manifest


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="action", required=True)
    c = sub.add_parser("capture")
    c.add_argument("source", type=Path)
    c.add_argument("destination", type=Path)
    r = sub.add_parser("refresh")
    r.add_argument("snapshot", type=Path)
    r.add_argument("preview", type=Path)
    r.add_argument("--mongorestore", required=True)
    r.add_argument("--mongodump", required=True)
    a = p.parse_args()
    result = (
        capture(a.source, a.destination)
        if a.action == "capture"
        else refresh_preview(a.snapshot, a.preview, a.mongorestore, a.mongodump)
    )
    print(json.dumps({"snapshotId": result["snapshotId"], "origin": result["origin"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
