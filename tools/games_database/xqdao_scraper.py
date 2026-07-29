"""Incremental XQDao updater with a bounded newest-event scan."""

from __future__ import annotations

import argparse
from pathlib import Path

from tools.xiangqi_data import xqdao_scrape as legacy

from .storage import database_path

BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/128.0.0.0 Safari/537.36"
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command", nargs="?", choices=("update-new-events", "full"), default="update-new-events"
    )
    parser.add_argument("--database", type=Path, default=database_path())
    parser.add_argument("--output", type=Path, default=legacy.DEFAULT_OUTPUT)
    parser.add_argument("--lookback-pages", type=int, default=2)
    parser.add_argument(
        "--lookback-events",
        type=int,
        default=10,
        help="newest event collections to refresh",
    )
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--timeout", type=float, default=45.0)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--retry-backoff", type=float, default=2.0)
    args = parser.parse_args(argv)
    if args.lookback_pages < 1:
        parser.error("--lookback-pages must be positive")
    if args.lookback_events < 1:
        parser.error("--lookback-events must be positive")
    scraper_args = [
        "--full",
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
        "--refresh-listings",
        "--user-agent",
        BROWSER_USER_AGENT,
    ]
    if args.command == "update-new-events":
        scraper_args.extend(
            [
                "--max-index-pages",
                str(args.lookback_pages),
                "--max-events",
                str(args.lookback_events),
            ]
        )
    return legacy.main(scraper_args)


if __name__ == "__main__":
    raise SystemExit(main())
