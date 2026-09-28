"""Desktop workflows composed exclusively from the existing offline tools."""

from __future__ import annotations

import argparse
import json
import subprocess
import time
from pathlib import Path

from .settings import ROOT, Settings, atomic_json, current_snapshot


def command(
    settings: Settings, action: str, settings_path: Path, *extra: str
) -> list[str]:
    return [
        settings.python,
        "-u",
        "-m",
        "tools.puzzle_catalog.desktop.operations",
        "--settings",
        str(settings_path),
        action,
        *extra,
    ]


def run(argv):
    print("Running " + subprocess.list2cmdline([str(x) for x in argv]), flush=True)
    result = subprocess.run([str(x) for x in argv], cwd=ROOT, check=False)
    if result.returncode:
        raise RuntimeError(f"Operation exited with code {result.returncode}")


def prepare(settings: Settings, refresh: bool):
    from tools.xiangqi_data.puzzle_mining.storage import open_database

    from ..catalog import PuzzleCatalog
    from ..live import Publisher, reconcile

    print("Reconciling live published inventory…", flush=True)
    rows = list(Publisher(settings.publication_origin).inventory())
    with PuzzleCatalog(settings.catalog_db) as catalog:
        reconcile(catalog, rows)
    db = open_database(Path(settings.mining_db))
    try:
        from ..mining_inventory import import_live_positions

        # Reserve published roots when importing the live inventory, before
        # discovery can enqueue another occurrence of the same position.
        import_live_positions(db, settings.catalog_db)
        if (Path(settings.snapshot_dir) / "current.json").is_file():
            from tools.xiangqi_data.puzzle_mining.discovery import DISCOVERY_VERSION
            from tools.xiangqi_data.puzzle_mining.snapshot_import import import_snapshot

            import_snapshot(db, current_snapshot(settings), DISCOVERY_VERSION)
    finally:
        db.close()
    print(
        "Ready: published inventory reconciled. Discovery uses local sources.",
        flush=True,
    )


def discovery_command(s: Settings, rescan: bool = False):
    return [
        s.python,
        "-u",
        str(ROOT / "scripts/discover-puzzle-candidates.py"),
        "--output",
        s.mining_db,
        "--source-db",
        s.source_catalog,
        "--engine",
        s.engine,
        "--workers",
        s.discovery_workers,
        "--publication-origin",
        s.publication_origin,
        *(["--rescan"] if rescan else []),
    ]


def verifier_command(s: Settings, reconstruct=False, force=False, *, tactic=False):
    return [
        s.python,
        "-u",
        "-m",
        (
            "tools.xiangqi_data.puzzle_mining.tactic_verification"
            if tactic
            else "tools.xiangqi_data.puzzle_mining.verification"
        ),
        "--database",
        s.mining_db,
        "--catalog-db",
        s.catalog_db,
        "--source-db",
        s.source_catalog,
        "--engine",
        s.engine,
        "--workers",
        s.verifier_workers,
        *(["--reconstruct-old-puzzles"] if reconstruct else []),
        *(["--force-reverify"] if force else []),
        *([] if reconstruct or force else ["--continuous"]),
        "--poll-interval",
        s.poll_seconds,
    ]


def categorizer_command(s: Settings, reclassify=False, *, tactic=False):
    return [
        s.python,
        "-u",
        "-m",
        (
            "tools.xiangqi_data.puzzle_mining.tactic"
            if tactic
            else "tools.xiangqi_data.puzzle_mining.checkmate"
        ),
        "--database",
        s.mining_db,
        "--catalog-db",
        s.catalog_db,
        "--engine",
        s.engine,
        "--workers",
        s.categorizer_workers,
        *(["--force-reclassify-same-version"] if reclassify else ["--continuous"]),
        "--poll-interval",
        s.poll_seconds,
    ]


def reclassify(s: Settings, themes: list[str], release_id: str, request_path=None):
    from tools.puzzle_catalog.catalog import PuzzleCatalog
    from tools.xiangqi_data.puzzle_mining.checkmate import CategorizerConfig
    from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish

    if release_id == "snapshot":
        # Freeze published membership from the reconciled API inventory.
        from tools.puzzle_catalog.catalog import _digest, _json

        with PuzzleCatalog(s.catalog_db) as target:
            body = {"puzzles": target._meta("baseline") or []}
            document = {**body, "releaseId": _digest(body)}
            with target.db:
                target.db.execute(
                    "INSERT OR IGNORE INTO catalog_releases VALUES (?,?)",
                    (document["releaseId"], _json(document)),
                )
        release_id = document["releaseId"]
    if request_path:
        atomic_json(request_path, dict(release=release_id, themes=themes))
    config = CategorizerConfig()
    with PuzzleCatalog(s.catalog_db) as catalog:
        plans = [catalog.audit_plan(release_id, theme) for theme in themes]
        for index, plan in enumerate(plans):
            print(
                f"Theme {index + 1}/{len(themes)} · {plan['theme']}@{plan['version']} · "
                f"{plan['total']} published · {plan['completed']} already evaluated · "
                f"{plan['remaining']} remaining",
                flush=True,
            )
        if not any(plan["remaining"] for plan in plans):
            print(
                "Audit is already complete for the selected logic versions.", flush=True
            )
            return
        print("Starting analysis engine for the remaining positions…", flush=True)
        engine = OfflinePikafish(
            Path(s.engine), threads=config.engine_threads, hash_mb=config.hash_mb
        )
        try:
            for index, (theme, plan) in enumerate(zip(themes, plans)):
                if not plan["remaining"]:
                    continue

                def report(progress, audit_index=index):
                    plans[audit_index] = progress
                    progress = {
                        **progress,
                        "themeIndex": audit_index + 1,
                        "themeCount": len(themes),
                        "overallTotal": sum(item["total"] for item in plans),
                        "overallCompleted": sum(item["completed"] for item in plans),
                        "overallRemaining": sum(item["remaining"] for item in plans),
                    }
                    print("AUDIT_PROGRESS " + json.dumps(progress), flush=True)

                result = catalog.reclassify(
                    release_id,
                    theme,
                    engine,
                    config,
                    progress=report,
                )
                print(
                    f"Completed {theme}@{result['version']}: "
                    f"{result['outcomes']['qualifies']} qualify · "
                    f"{result['outcomes']['does_not_qualify']} do not qualify · "
                    f"{result['outcomes']['unresolved']} inconclusive",
                    flush=True,
                )
        finally:
            engine.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--settings", type=Path, required=True)
    parser.add_argument(
        "action",
        choices=[
            "prepare",
            "reconcile",
            "initialize",
            "discovery",
            "verifier",
            "categorizer",
            "tactic_verifier",
            "tactic_categorizer",
            "publish",
            "reclassify",
            "moderate",
        ],
    )
    parser.add_argument(
        "--destinations", nargs="+", choices=["preview", "live"], default=["preview"]
    )
    parser.add_argument("--output", type=Path)
    parser.add_argument("--release")
    parser.add_argument("--themes", nargs="+")
    parser.add_argument("--rescan", action="store_true")
    parser.add_argument("--reconstruct-old-puzzles", action="store_true")
    parser.add_argument("--force-reclassify-same-version", action="store_true")
    parser.add_argument("--force-reverify", action="store_true")
    parser.add_argument("--request", type=Path)
    args = parser.parse_args()
    s = Settings.load(args.settings)
    if args.action in {"verifier", "categorizer"}:
        from tools.puzzle_catalog.mining_inventory import import_live_positions
        from tools.xiangqi_data.puzzle_mining.storage import open_database

        db = open_database(Path(s.mining_db))
        try:
            imported = import_live_positions(db, s.catalog_db)
            from tools.xiangqi_data.puzzle_mining.queue_priority import prepare_priority

            prepare_priority(db, s.catalog_db)
            awaiting = db.execute(
                """SELECT count(*) FROM live_candidates live JOIN candidates c ON c.id=live.id
                WHERE NOT EXISTS(SELECT 1 FROM candidate_assessments a WHERE a.id=c.current_verification_id AND a.coverage='complete')"""
            ).fetchone()[0]
            print(
                f"Linked {imported} inherited published positions; {awaiting} published positions need explicit reconstruction before classification. Normal verification Start skips previously published puzzles.",
                flush=True,
            )
        finally:
            db.close()
    if args.action == "initialize":
        from tools.xiangqi_data.puzzle_mining.storage import open_database

        db = open_database(Path(s.mining_db))
        db.close()
        from tools.puzzle_catalog.catalog import PuzzleCatalog

        with PuzzleCatalog(s.catalog_db):
            pass
        print("Local databases ready", flush=True)
    elif args.action in {"prepare", "reconcile"}:
        prepare(s, args.action == "prepare")
    elif args.action == "discovery":
        rescan = args.rescan
        while True:
            run(discovery_command(s, rescan))
            rescan = False
            print(
                f"Discovery caught up. Waiting {s.discovery_interval}s before checking local sources again.",
                flush=True,
            )
            time.sleep(s.discovery_interval)
    elif args.action in {"verifier", "tactic_verifier"}:
        run(
            verifier_command(
                s,
                args.reconstruct_old_puzzles,
                args.force_reverify,
                tactic=args.action == "tactic_verifier",
            )
        )
    elif args.action in {"categorizer", "tactic_categorizer"}:
        run(
            categorizer_command(
                s,
                reclassify=args.force_reclassify_same_version,
                tactic=args.action == "tactic_categorizer",
            )
        )
    elif args.action == "publish":
        from ..live import sync_destinations

        sync_destinations(s, args.settings.parent, args.destinations)
    elif args.action == "reclassify":
        if args.request:
            pending = json.loads(args.request.read_text(encoding="utf-8"))
            reclassify(
                s,
                pending["themes"],
                pending["release"],
                args.request,
            )
            args.request.unlink()
        else:
            if not args.release or not args.themes:
                raise ValueError("A frozen release and themes are required")
            reclassify(s, args.themes, args.release)
    else:
        from .repository import ContentRepository

        if not args.request:
            raise ValueError("Moderation request is required")
        request = json.loads(args.request.read_text(encoding="utf-8"))
        repo = ContentRepository(
            Path(s.catalog_db), Path(s.mining_db), args.settings.parent
        )
        keys = request["keys"]
        result = []
        for offset in range(0, len(keys), 25):
            batch = repo.moderate(
                keys[offset : offset + 25],
                request["action"],
                request["reason"],
                Path(s.source_catalog),
            )
            result.extend(batch)
            print(
                f"Moderation: {min(offset + 25, len(keys)):,} / {len(keys):,} processed",
                flush=True,
            )
            for item in batch:
                if not item["ok"]:
                    print(json.dumps(item), flush=True)
        if any(not item["ok"] for item in result):
            raise RuntimeError(
                "Some moderation actions failed; successful items were retained. See per-item results above."
            )
        print(f"Completed {len(result):,} moderation actions.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as exc:
        print(f"Unable to complete operation: {exc}", flush=True)
        raise SystemExit(1) from None
