"""Publish completed discovery analysis independently of puzzle eligibility.

The server is the receipt: reconcile depths on every run, including after preview
resets and lost responses. No permanent local 'uploaded' flag can hide missing data.
Only metadata is scanned; decompress a game's retained evidence when it needs upload.
"""

import json
import sqlite3
import zlib
from contextlib import closing
from pathlib import Path

from tools.games_database.identity import resolve_catalog_game
from tools.xiangqi_data.puzzle_mining.game_analysis_depth import completed_depth
from tools.xiangqi_data.puzzle_mining.sources import is_native_source, native_origin
from tools.xiangqi_data.puzzle_mining.storage import open_database


def publication_body(analysis, game):
    if analysis.get("format_version") != 1:
        raise ValueError("Unsupported saved game analysis format")
    depth = completed_depth(analysis)
    if depth is None or not analysis["moves"]:
        raise ValueError("No complete searched game to publish")
    positions = []
    for position in analysis["positions"]:
        lines = position["analysis"]["lines"]
        if not lines:
            positions.append(None)
            continue
        line = lines[0]
        score = line["score"]
        if score["kind"] not in {"cp", "mate"} or score.get("bound"):
            raise ValueError("Full-game publication requires exact engine scores")
        positions.append(
            {
                "depth": line["depth"],
                score["kind"]: score["value"],
                "pv": line["moves"][:12],
            }
        )
    return {
        "game": game,
        "initialFen": analysis["initial_fen"],
        "moves": analysis["moves"],
        "positions": positions,
    }


def publication_game(source, source_id, source_origin, catalog=None):
    if is_native_source(source):
        origin = native_origin(source)
        if origin != source_origin.rstrip("/"):
            return None
        return source_id, {"type": "native", "id": source_id, "origin": origin}
    resolved = resolve_catalog_game(catalog, source_id, source)
    if resolved is None:
        raise ValueError(f"Completed analysis source is missing: {source}:{source_id}")
    return "catalog:" + resolved["id"], {"type": "catalog", "id": resolved["id"]}


def retains_analysis(depths, key, depth):
    return key in depths and (depths[key] is None or depths[key] >= depth)


def acknowledge_analysis(db, job_id, origin, depth):
    # A newer completion may have arrived while the request was in flight.
    with db:
        db.execute(
            """DELETE FROM game_analysis_publications WHERE job_id=? AND origin=?
               AND job_id IN (SELECT job_id FROM game_analyses WHERE depth<=?)""",
            (job_id, origin.rstrip("/"), depth),
        )


def upload_saved_analysis(db, publisher, job_id, key, game, catalog=None):
    payload = db.execute(
        "SELECT payload_zlib,depth FROM game_analyses WHERE job_id=?", (job_id,)
    ).fetchone()
    analysis = json.loads(zlib.decompress(payload[0]))
    depth = payload[1]
    if completed_depth(analysis) != depth:
        raise ValueError(f"Saved analysis depth mismatch: {key}")
    body = publication_body(analysis, game)
    if game["type"] == "catalog":
        resolved = resolve_catalog_game(catalog, game["id"])
        from tools.xiangqi_data.pikafish_rules import START_FEN

        if resolved is None or (
            json.loads(resolved["moves"]) != body["moves"]
            or (resolved["initial_fen"] or START_FEN) != body["initialFen"]
        ):
            raise ValueError(f"Saved analysis differs from catalog game: {key}")
    receipt = publisher.request("/analysis", body)
    if (
        receipt.get("id") != key
        or "depth" not in receipt
        or (receipt["depth"] is not None and receipt["depth"] < depth)
    ):
        raise ValueError(f"Game analysis publication was not confirmed: {key}")
    return depth


def sync_game_analyses(settings, publisher, report=print, *, source_origin=None):
    from urllib.parse import urlsplit

    from .live import LOCAL_HOSTS, publication_stage

    path = Path(settings.mining_db)
    if not path.exists():
        return
    catalog = None
    source_origin = (source_origin or settings.publication_origin).rstrip("/")
    try:
        with publication_stage(report, "Checking completed game analyses"), closing(
            open_database(path)
        ) as db:
            selected = {}
            for row in db.execute(
                """SELECT a.job_id,a.depth,j.source_database,j.game_id
                   FROM game_analyses a JOIN game_jobs j ON j.id=a.job_id
                   WHERE j.status='complete' AND a.depth > 0 ORDER BY a.depth DESC,a.job_id"""
            ):
                source, source_id = row["source_database"], row["game_id"]
                if not is_native_source(source) and catalog is None:
                    catalog = sqlite3.connect(
                        f"{Path(settings.source_catalog).resolve().as_uri()}?mode=ro",
                        uri=True,
                    )
                    catalog.row_factory = sqlite3.Row
                identity = publication_game(source, source_id, source_origin, catalog)
                if identity is None:
                    continue
                key, game = identity
                selected.setdefault(key, (row["job_id"], row["depth"], game))

            items = list(selected.items())
            uploaded = retained = 0

            def progress():
                report(
                    "PUBLICATION_PROGRESS "
                    + json.dumps(
                        {
                            "completed": uploaded + retained,
                            "total": len(items),
                            "phase": "analysis",
                            "destination": (
                                "Local Preview"
                                if urlsplit(settings.publication_origin).hostname
                                in LOCAL_HOSTS
                                else "Live Site"
                            ),
                        }
                    ),
                    flush=True,
                )

            if items:
                progress()
            for offset in range(0, len(items), 100):
                batch = items[offset : offset + 100]
                with publication_stage(
                    report, "Checking published game analysis depths"
                ):
                    depths = publisher.request(
                        "/analysis/inventory", [item[1][2] for item in batch]
                    )["depths"]
                for key, (job_id, depth, game) in batch:
                    if retains_analysis(depths, key, depth):
                        acknowledge_analysis(
                            db, job_id, settings.publication_origin, depth
                        )
                        retained += 1
                        continue
                    with publication_stage(
                        report, f"Publishing game analysis {key} at depth {depth}"
                    ):
                        depth = upload_saved_analysis(
                            db, publisher, job_id, key, game, catalog
                        )
                    acknowledge_analysis(db, job_id, settings.publication_origin, depth)
                    uploaded += 1
                    progress()
                progress()
                report(
                    f"Game analyses: {min(offset + 100, len(items)):,} / {len(items):,} checked; "
                    f"{uploaded:,} uploaded, {retained:,} existing analyses retained.",
                    flush=True,
                )
            report(
                f"Game analysis publication complete: {uploaded:,} uploaded, {retained:,} retained.",
                flush=True,
            )
    finally:
        if catalog is not None:
            catalog.close()
