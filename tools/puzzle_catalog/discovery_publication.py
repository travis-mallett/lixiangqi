"""Concurrent discovery workers deliver their durable, completed analysis jobs."""

import getpass
import os
import sqlite3
import sys
from contextlib import ExitStack, closing
from http.client import HTTPException
from pathlib import Path
from urllib.parse import urlsplit

from tools.xiangqi_data.puzzle_mining.sources import is_native_source
from tools.xiangqi_data.puzzle_mining.workers import WorkerCancelled

from .game_analysis import (
    acknowledge_analysis,
    publication_game,
    retains_analysis,
    upload_saved_analysis,
)
from .live import LOCAL_HOSTS, PublicationApiError, Publisher


def connect_discovery(origin):
    """Check credentials before engine work; children inherit the session environment."""
    if (
        urlsplit(origin).hostname not in LOCAL_HOSTS
        and not os.environ.get("LIXIANGQI_PUZZLE_TOKEN", "").strip()
        and sys.stdin.isatty()
    ):
        os.environ["LIXIANGQI_PUZZLE_TOKEN"] = getpass.getpass(
            f"Publish API token for {origin} (puzzle:publish): "
        ).strip()
    publisher = Publisher(origin)
    # Catalog inventory is read-only. Check the actual analysis endpoint so an
    # older server is detected before spending time on engine searches.
    publisher.request(
        "/analysis/inventory", [{"type": "catalog", "id": "discovery-connection-check"}]
    )
    return publisher


def pending_analysis_jobs(db, origin):
    return [
        row[0]
        for row in db.execute(
            "SELECT job_id FROM game_analysis_publications WHERE origin=? ORDER BY job_id",
            (origin,),
        )
    ]


def publish_pending_analysis(db, publisher, job_id, source_paths, stop_event, report):
    """No SQLite transaction or shared upload lock is held during network requests.

    Each discovery worker calls this independently, immediately after committing
    its game. Interrupted deliveries remain queued for the next discovery run.
    """
    for attempt in range(3):
        if stop_event.is_set():
            raise WorkerCancelled("analysis publication cancelled")
        try:
            return _publish(db, publisher, job_id, source_paths, report)
        except (OSError, HTTPException, PublicationApiError) as error:
            retryable = not isinstance(error, PublicationApiError) or (
                error.status == 429 or error.status >= 500
            )
            if not retryable or attempt == 2:
                raise RuntimeError(
                    f"Analysis job {job_id} is saved locally but upload failed: {error}. "
                    "Restart Discovery or use Publish to retry the saved analysis."
                ) from error
            report(f"Upload retry {attempt + 1}/2: {error}")
            if stop_event.wait(2**attempt):
                raise WorkerCancelled("analysis publication cancelled")


def _publish(db, publisher, job_id, source_paths, report):
    row = db.execute(
        """SELECT a.depth,j.source_database,j.game_id FROM game_analysis_publications p
           JOIN game_analyses a ON a.job_id=p.job_id JOIN game_jobs j ON j.id=p.job_id
           WHERE p.origin=? AND p.job_id=? AND j.status='complete'""",
        (publisher.origin, job_id),
    ).fetchone()
    if row is None:
        return
    with ExitStack() as stack:
        catalog = None
        if not is_native_source(row["source_database"]):
            path = source_paths.get(row["source_database"])
            if path is None:
                raise ValueError(
                    f"Source database {row['source_database']} is not installed"
                )
            catalog = stack.enter_context(
                closing(
                    sqlite3.connect(
                        f"{Path(path).resolve().as_uri()}?mode=ro", uri=True
                    )
                )
            )
            catalog.row_factory = sqlite3.Row
        identity = publication_game(
            row["source_database"], row["game_id"], publisher.origin, catalog
        )
        if identity is None:
            raise ValueError("Queued native analysis belongs to another site")
        key, game = identity
        report(f"Uploading {key} at depth {row['depth']}")
        depths = publisher.request("/analysis/inventory", [game])["depths"]
        depth = row["depth"]
        retained = retains_analysis(depths, key, depth)
        if not retained:
            depth = upload_saved_analysis(db, publisher, job_id, key, game, catalog)
        acknowledge_analysis(db, job_id, publisher.origin, depth)
        result = "existing analysis retained" if retained else "analysis uploaded"
        report(f"{key}: {result}")
        return "retained" if retained else "uploaded"
