"""Incremental DPXQ master-game updater and full-scrape compatibility CLI."""

from __future__ import annotations

import argparse
import re
import sqlite3
import urllib.request
from pathlib import Path

from tools.xiangqi_data import dpxq_scrape as legacy
from tools.xiangqi_data.dpxq_import import decode_html

from .storage import database_path

LIST_URL = "http://www.dpxq.com/hldcg/search/list.asp?owner=m&page=1"
LIST_ID_PATTERN = re.compile(r"view\(['\"]owner=m&id=(\d+)", re.IGNORECASE)


def _run_legacy(arguments: list[str]) -> int:
    try:
        legacy.main(arguments)
    except SystemExit as error:
        return int(error.code) if isinstance(error.code, int) else 1
    return 0


def latest_master_id(
    *, timeout: float = 30.0, user_agent: str = legacy.DEFAULT_USER_AGENT
) -> int:
    request = urllib.request.Request(LIST_URL, headers={"User-Agent": user_agent})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        document = decode_html(response.read())
    identifiers = [int(value) for value in LIST_ID_PATTERN.findall(document)]
    if not identifiers:
        raise RuntimeError("DPXQ master listing did not contain any game IDs")
    return max(identifiers)


def newest_stored_id(database: Path) -> int:
    if not database.is_file():
        return 0
    with sqlite3.connect(database) as connection:
        row = connection.execute(
            """
            SELECT max(CAST(external_id AS INTEGER))
            FROM game_sources
            WHERE source = 'dpxq' AND collection = 'm'
              AND external_id GLOB '[0-9]*'
            """
        ).fetchone()
    return int(row[0] or 0)


def update_new(
    *,
    database: Path,
    output: Path,
    delay: float,
    timeout: float,
    retries: int,
    retry_backoff: float,
) -> int:
    latest = latest_master_id(timeout=timeout)
    stored = newest_stored_id(database)
    print(f"DPXQ master frontier: local {stored:,}, remote {latest:,}", flush=True)
    if latest <= stored:
        print("DPXQ master games are current.", flush=True)
        return 0
    return _run_legacy(
        [
            "--start",
            str(stored + 1),
            "--end",
            str(latest),
            "--database",
            str(database),
            "--output",
            str(output),
            "--delay",
            str(delay),
            "--timeout",
            str(timeout),
            "--retries",
            str(retries),
            "--retry-backoff",
            str(retry_backoff),
        ]
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command", nargs="?", choices=("update-new", "full"), default="update-new"
    )
    parser.add_argument("--database", type=Path, default=database_path())
    parser.add_argument("--output", type=Path, default=legacy.DEFAULT_OUTPUT)
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--retry-backoff", type=float, default=2.0)
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument("--end", type=int)
    args = parser.parse_args(argv)
    if args.command == "full":
        if args.end is None:
            parser.error("full requires --end")
        return _run_legacy(
            [
                "--start",
                str(args.start),
                "--end",
                str(args.end),
                "--database",
                str(args.database),
                "--output",
                str(args.output),
                "--delay",
                str(args.delay),
                "--timeout",
                str(args.timeout),
                "--retries",
                str(args.retries),
                "--retry-backoff",
                str(args.retry_backoff),
            ]
        )
    return update_new(
        database=args.database,
        output=args.output,
        delay=args.delay,
        timeout=args.timeout,
        retries=args.retries,
        retry_backoff=args.retry_backoff,
    )


if __name__ == "__main__":
    raise SystemExit(main())
