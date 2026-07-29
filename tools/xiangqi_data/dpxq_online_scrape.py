"""Retrieve DPXQ non-master collections into the Lixiangqi game catalog.

Each downloaded page is stored under its DPXQ owner/category, validated as a
standard-start complete game by the shared DPXQ parser, checked move-by-move by
Pikafish during import, and linked to its source category in ``game_sources``.
The HTML cache and per-record database commits make repeated runs resumable.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path

from .dpxq_import import (
    DEFAULT_DATABASE,
    DPXQ_COLLECTIONS,
    DpxqImporter,
    decode_html,
    require_import_environment,
)
from .dpxq_scrape import (
    DEFAULT_USER_AGENT,
    PersistentRecordFetcher,
    ProgressBar,
    ScrapeCounts,
    positive_int,
    scrape_records,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = DEFAULT_DATABASE.parent / "dpxq-online-html"
DEFAULT_BASE_URL = "http://www.dpxq.com/hldcg/search/view_{owner}_{id}.html"
DEFAULT_LIST_URL = "http://www.dpxq.com/hldcg/search/list.asp?owner={owner}&page={page}"
ONLINE_COLLECTIONS = tuple(owner for owner in DPXQ_COLLECTIONS if owner != "m")
LISTED_RECORD_PATTERN = re.compile(
    r"view\(['\"]owner=[a-z]&id=(\d+)(?:&[^'\"]*)?['\"]\)", re.IGNORECASE
)


@dataclass
class CollectionResult:
    owner: str
    name: str
    start_id: int | None
    end_id: int | None
    scrape: ScrapeCounts


def parse_collections(value: str) -> list[str]:
    owners = [part.strip().lower() for part in value.split(",") if part.strip()]
    invalid = [owner for owner in owners if owner not in ONLINE_COLLECTIONS]
    if invalid:
        raise argparse.ArgumentTypeError(
            f"unknown collection(s): {', '.join(invalid)}; choose from "
            + ", ".join(ONLINE_COLLECTIONS)
        )
    return list(dict.fromkeys(owners))


def listed_collection_ids(
    owner: str,
    *,
    pages: int,
    limit: int,
    timeout: float,
    user_agent: str,
    cookie: str = "",
    list_url: str = DEFAULT_LIST_URL,
) -> list[int]:
    """Return IDs in DPXQ list order, preserving sparse collection membership.

    ``w`` (无主棋谱) is a filtered view over the uploaded-game ID namespace,
    so IDs 1..N cannot be assumed to belong to it. Listing enumeration is the
    source of truth for that collection.
    """

    ids: list[int] = []
    seen: set[int] = set()
    headers = {
        "User-Agent": user_agent,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Encoding": "identity",
    }
    if cookie:
        headers["Cookie"] = cookie
    for page in range(1, pages + 1):
        request = urllib.request.Request(
            list_url.format(owner=owner, page=page), headers=headers
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                document = decode_html(response.read(4_000_000))
        except (TimeoutError, urllib.error.URLError, OSError) as exc:
            raise RuntimeError(
                f"could not enumerate DPXQ {owner} list page {page}: {exc}"
            ) from exc
        page_ids = [int(match.group(1)) for match in LISTED_RECORD_PATTERN.finditer(document)]
        found_new = False
        for game_id in page_ids:
            if game_id in seen:
                continue
            found_new = True
            seen.add(game_id)
            ids.append(game_id)
            if len(ids) >= limit:
                return ids
        if not found_new:
            break
    return ids


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Retrieve category-aware DPXQ online/uploaded games and build the "
            "Lixiangqi game catalog"
        )
    )
    parser.add_argument(
        "--categories",
        type=parse_collections,
        default=list(ONLINE_COLLECTIONS),
        metavar="OWNER,...",
        help=(
            "DPXQ owner codes (default: all non-master collections): "
            + ", ".join(
                f"{owner}={DPXQ_COLLECTIONS[owner]}" for owner in ONLINE_COLLECTIONS
            )
        ),
    )
    parser.add_argument("--start", type=positive_int, default=1, help="first sequential ID")
    limit = parser.add_mutually_exclusive_group()
    limit.add_argument("--end", type=positive_int, help="last sequential ID, inclusive")
    limit.add_argument("--count", type=positive_int, help="records per category (default: 5)")
    parser.add_argument(
        "--list-pages",
        type=positive_int,
        default=1,
        help="DPXQ list pages available when sampling sparse 无主棋谱 records",
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--download-only", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--retry-backoff", type=float, default=2.0)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--list-url", default=DEFAULT_LIST_URL)
    parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    parser.add_argument(
        "--cookie",
        default=os.environ.get("DPXQ_COOKIE", ""),
        help="DPXQ session cookie; preferably set DPXQ_COOKIE instead of shell history",
    )
    parser.add_argument(
        "--progress-every",
        type=int,
        default=100,
        help="records between progress lines when output is redirected",
    )
    args = parser.parse_args()

    if args.delay < 0.25:
        parser.error("--delay must be at least 0.25 seconds")
    if args.timeout <= 0 or args.retries < 0 or args.retry_backoff < 0:
        parser.error("timeout must be positive and retry values cannot be negative")
    if args.progress_every < 0:
        parser.error("--progress-every cannot be negative")
    if args.end is not None and args.end < args.start:
        parser.error("--end cannot be less than --start")
    if not args.download_only:
        try:
            require_import_environment()
        except RuntimeError as exc:
            parser.error(str(exc))

    per_category_count = args.count or (args.end - args.start + 1 if args.end else 5)
    fetcher = PersistentRecordFetcher(cookie=args.cookie)
    importer: DpxqImporter | None = None
    results: list[CollectionResult] = []
    if not args.download_only:
        importer = DpxqImporter(
            args.database,
            game_source="dpxq_online",
            default_collection=args.categories[0],
            commit_each=True,
        )
        importer.__enter__()

    try:
        for category_index, owner in enumerate(args.categories):
            name = DPXQ_COLLECTIONS[owner]
            if owner == "w":
                game_ids = listed_collection_ids(
                    owner,
                    pages=args.list_pages,
                    limit=per_category_count,
                    timeout=args.timeout,
                    user_agent=args.user_agent,
                    cookie=args.cookie,
                    list_url=args.list_url,
                )
                if not game_ids:
                    raise RuntimeError("DPXQ 无主棋谱 listing returned no game IDs")
            else:
                end = args.end if args.end is not None else args.start + per_category_count - 1
                game_ids = list(range(args.start, end + 1))

            bar = ProgressBar(name, len(game_ids), print_every=args.progress_every)

            def detail(counts: ScrapeCounts, game_id: int) -> str:
                value = (
                    f"{owner}:{game_id:,} D {counts.downloaded:,} "
                    f"C {counts.cached:,} F {counts.failed:,}"
                )
                if importer:
                    imported = importer.counts
                    value += (
                        f" DB {imported['imported']:,}/"
                        f"{imported['duplicate']:,}/{imported['invalid']:,}"
                    )
                return value

            bar.update(0, f"{owner} IDs {game_ids[0]:,}..{game_ids[-1]:,}", force=True)
            counts, _selected = scrape_records(
                game_ids,
                args.output / owner,
                base_url=args.base_url,
                delay=args.delay,
                timeout=args.timeout,
                retries=args.retries,
                retry_backoff=args.retry_backoff,
                overwrite=args.overwrite,
                user_agent=args.user_agent,
                progress_every=args.progress_every,
                owner=owner,
                fetch=fetcher,
                progress=lambda current, game_id: bar.update(
                    current.requested, detail(current, game_id)
                ),
                message=bar.message,
                record_ready=(
                    (
                        lambda path, game_id, cached, owner=owner: (
                            importer.import_if_missing(path, str(game_id), owner)
                            if cached
                            else importer.import_path(path, str(game_id), owner)
                        )
                    )
                    if importer
                    else None
                ),
            )
            bar.finish(counts.requested, detail(counts, game_ids[-1]))
            results.append(
                CollectionResult(owner, name, game_ids[0], game_ids[-1], counts)
            )
            if category_index + 1 < len(args.categories) and args.delay:
                time.sleep(args.delay)
    except KeyboardInterrupt:
        if importer:
            importer.close()
        print(
            "Interrupted. Cached HTML and committed source records are saved; "
            "run the same command again to resume.",
            flush=True,
        )
        raise SystemExit(130)
    except BaseException:
        if importer:
            importer.close()
        raise
    finally:
        fetcher.close()

    result: dict[str, object] = {
        "collections": [
            {
                "owner": item.owner,
                "name": item.name,
                "startId": item.start_id,
                "endId": item.end_id,
                "scrape": asdict(item.scrape),
            }
            for item in results
        ]
    }
    if importer:
        importer.close()
        result["import"] = importer.counts
        result["database"] = str(args.database.resolve())
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")), flush=True)
    if any(item.scrape.failed for item in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
