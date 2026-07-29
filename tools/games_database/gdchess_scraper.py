"""Incremental GDChess/01xq updater with a bounded newest-event scan."""

from __future__ import annotations

import argparse
from pathlib import Path

from tools.xiangqi_data import gdchess_scrape as legacy

from .storage import database_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command", nargs="?", choices=("update-new-events", "full"), default="update-new-events"
    )
    parser.add_argument("--database", type=Path, default=database_path())
    parser.add_argument("--output", type=Path, default=legacy.DEFAULT_OUTPUT)
    parser.add_argument(
        "--lookback-pages",
        type=int,
        default=2,
        help="newest catalog pages to refresh; 01xq currently has few, dense event pages",
    )
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--timeout", type=float, default=45.0)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--retry-backoff", type=float, default=2.0)
    args = parser.parse_args(argv)
    if args.lookback_pages < 1:
        parser.error("--lookback-pages must be positive")
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
    ]
    if args.command == "update-new-events":
        scraper_args.extend(["--start-page", "1", "--end-page", str(args.lookback_pages)])
    return legacy.main(scraper_args)


if __name__ == "__main__":
    raise SystemExit(main())
