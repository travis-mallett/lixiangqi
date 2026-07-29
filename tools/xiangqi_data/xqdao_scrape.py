"""Discover, cache, validate, and immediately import public XQDao games."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, replace
from pathlib import Path

from external.xiangqi_explorer.catalog_databases import source_database_path
from .dpxq_import import decode_html, require_import_environment
from .dpxq_scrape import DEFAULT_USER_AGENT, ProgressBar, positive_int
from .gdchess_scrape import RateLimiter
from .xqdao_import import STANDARD_BINIT, XqdaoImporter, XqdaoListing


BASE_URL = "https://www.xqdao.com"
INDEX_URL = BASE_URL + "/dashi/?page={page}"
GAME_URL = BASE_URL + "/qipu/show/{game_id}/"
DEFAULT_DATABASE = source_database_path("xqdao")
DEFAULT_OUTPUT = DEFAULT_DATABASE.parent / "xqdao-html"
EVENT_PATTERN = re.compile(
    r'<a\s+href=["\'](?P<url>/zhuanti/[^"\']+/)["\'][^>]*title=["\']'
    r'(?P<title>[^"\']+)["\'][^>]*target=["\']_blank["\']',
    re.IGNORECASE,
)
GAME_PATTERN = re.compile(
    r'<a\s+href=["\']/qipu/show/(?P<id>\d+)/["\'][^>]*>(?P<title>.*?)</a>',
    re.IGNORECASE | re.DOTALL,
)
PAGE_PATTERN = re.compile(r'href=["\']\?page=(?P<page>\d+)["\']', re.IGNORECASE)
LEFT_PATTERN = re.compile(
    r'<div\s+id=["\']left-div["\'][^>]*>(?P<body>.*?)<div\s+id=["\']sidebar["\']',
    re.IGNORECASE | re.DOTALL,
)


def _text(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value)
    return " ".join(html.unescape(value).replace("\u3000", " ").split())


def _left(document: str) -> str:
    match = LEFT_PATTERN.search(document)
    return match.group("body") if match else document


def parse_index(document: str, page: int) -> list[tuple[str, str, int]]:
    events: list[tuple[str, str, int]] = []
    seen: set[str] = set()
    for match in EVENT_PATTERN.finditer(_left(document)):
        url = urllib.parse.urljoin(BASE_URL, html.unescape(match.group("url")))
        if url in seen:
            continue
        seen.add(url)
        events.append((url, _text(match.group("title")), page))
    return events


def parse_event(
    document: str,
    *,
    event_name: str,
    event_url: str,
    index_page: int,
    listing_page: int,
) -> tuple[list[XqdaoListing], int]:
    section = _left(document)
    pages = [int(match.group("page")) for match in PAGE_PATTERN.finditer(section)]
    last_page = max(pages, default=1)
    listings: list[XqdaoListing] = []
    seen: set[str] = set()
    for match in GAME_PATTERN.finditer(section):
        game_id = match.group("id")
        if game_id in seen:
            continue
        seen.add(game_id)
        listings.append(
            XqdaoListing(
                game_id=game_id,
                listing_title=_text(match.group("title")),
                event_name=event_name,
                event_url=event_url,
                index_page=index_page,
                listing_page=listing_page,
                collections=({"name": event_name, "url": event_url},),
            )
        )
    return listings, last_page


def index_validator(document: str) -> bool:
    return "大师对局" in document and 'id="left-div"' in document


def event_validator(document: str) -> bool:
    return 'class="xq_list"' in document and 'id="left-div"' in document


def game_validator(document: str) -> bool:
    return (
        "[DhtmlXQ_movelist]" in document
        and f"[DhtmlXQ_binit]{STANDARD_BINIT}[/DhtmlXQ_binit]" in re.sub(r"\s+", "", document)
        and "qipu_info" in document
    )


def _valid_document(path: Path, validator) -> bool:
    try:
        return validator(decode_html(path.read_bytes()))
    except (OSError, UnicodeError):
        return False


def fetch_cached(
    url: str,
    path: Path,
    *,
    validator,
    limiter: RateLimiter,
    timeout: float,
    retries: int,
    retry_backoff: float,
    user_agent: str,
    refresh: bool = False,
) -> tuple[Path, bool]:
    if not refresh and path.is_file() and _valid_document(path, validator):
        return path, True
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".partial")
    partial.unlink(missing_ok=True)
    headers = {
        "User-Agent": user_agent,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Encoding": "identity",
    }
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        if attempt:
            time.sleep(retry_backoff * (2 ** (attempt - 1)))
        limiter.wait()
        try:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read(6_000_001)
                if len(raw) > 6_000_000:
                    raise ValueError("response exceeds 6 MB")
            partial.write_bytes(raw)
            if not _valid_document(partial, validator):
                raise ValueError("response is not the expected XQDao page")
            partial.replace(path)
            return path, False
        except (TimeoutError, urllib.error.HTTPError, urllib.error.URLError, OSError, ValueError) as exc:
            last_error = exc
            partial.unlink(missing_ok=True)
    raise RuntimeError(f"failed after {retries + 1} attempts: {last_error}")


def _event_key(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:20]


def _merge_listing(
    games: dict[str, XqdaoListing], listing: XqdaoListing
) -> None:
    current = games.get(listing.game_id)
    if current is None:
        games[listing.game_id] = listing
        return
    known = {item["url"] for item in current.collections}
    additions = tuple(item for item in listing.collections if item["url"] not in known)
    if additions:
        games[listing.game_id] = replace(
            current, collections=current.collections + additions
        )


def discover(
    output: Path,
    *,
    limiter: RateLimiter,
    timeout: float,
    retries: int,
    retry_backoff: float,
    user_agent: str,
    refresh: bool,
    complete: bool,
    enough: int | None,
) -> tuple[list[XqdaoListing], dict[str, int], bool]:
    games: dict[str, XqdaoListing] = {}
    seen_events: set[str] = set()
    stats = {"index_pages": 0, "events": 0, "listing_pages": 0, "failed": 0}
    reached_end = False
    index_page = 1
    while True:
        try:
            path, _ = fetch_cached(
                INDEX_URL.format(page=index_page),
                output / "index" / f"page_{index_page:04d}.html",
                validator=index_validator,
                limiter=limiter,
                timeout=timeout,
                retries=retries,
                retry_backoff=retry_backoff,
                user_agent=user_agent,
                refresh=refresh,
            )
            events = parse_index(decode_html(path.read_bytes()), index_page)
        except (RuntimeError, OSError, UnicodeError, ValueError) as exc:
            print(f"Failed XQDao index page {index_page}: {exc}", file=sys.stderr, flush=True)
            stats["failed"] += 1
            break
        stats["index_pages"] += 1
        if not events:
            reached_end = True
            print(
                f"Discovery reached the end at index page {index_page}; "
                f"{len(games):,} unique games found.",
                flush=True,
            )
            break
        print(
            f"Index {index_page}: {len(events)} event collections | "
            f"{stats['events']:,} events scanned | {len(games):,} unique games",
            flush=True,
        )
        for event_url, event_name, source_index_page in events:
            if event_url in seen_events:
                continue
            seen_events.add(event_url)
            stats["events"] += 1
            key = _event_key(event_url)
            page_number = 1
            last_page = 1
            while page_number <= last_page:
                url = event_url if page_number == 1 else f"{event_url}?page={page_number}"
                try:
                    path, _ = fetch_cached(
                        url,
                        output / "events" / key / f"page_{page_number:04d}.html",
                        validator=event_validator,
                        limiter=limiter,
                        timeout=timeout,
                        retries=retries,
                        retry_backoff=retry_backoff,
                        user_agent=user_agent,
                        refresh=refresh,
                    )
                    listings, discovered_last = parse_event(
                        decode_html(path.read_bytes()),
                        event_name=event_name,
                        event_url=event_url,
                        index_page=source_index_page,
                        listing_page=page_number,
                    )
                    last_page = max(last_page, discovered_last)
                    stats["listing_pages"] += 1
                    for listing in listings:
                        _merge_listing(games, listing)
                except (RuntimeError, OSError, UnicodeError, ValueError) as exc:
                    print(
                        f"Failed XQDao event {event_name!r} page {page_number}: {exc}",
                        file=sys.stderr,
                        flush=True,
                    )
                    stats["failed"] += 1
                    break
                page_number += 1
            if stats["events"] % 10 == 0:
                print(
                    f"Discovery: {stats['events']:,} events, "
                    f"{stats['listing_pages']:,} listing pages, {len(games):,} unique games",
                    flush=True,
                )
            if not complete and enough is not None and len(games) >= enough:
                return list(games.values()), stats, False
        index_page += 1
    return list(games.values()), stats, reached_end


def _write_manifest(
    output: Path,
    games: list[XqdaoListing],
    stats: dict[str, int],
    complete: bool,
) -> None:
    destination = output / "manifest.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(".json.partial")
    partial.write_text(
        json.dumps(
            {
                "source": "XQDao",
                "complete": complete,
                "unique_games": len(games),
                **stats,
                "games": [asdict(game) for game in games],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    partial.replace(destination)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Download complete public XQDao games into the Lixiangqi catalog"
    )
    parser.add_argument("--count", type=positive_int, default=5, help="unique games to process")
    parser.add_argument("--full", action="store_true", help="discover and process the entire archive")
    parser.add_argument(
        "--discover-only",
        action="store_true",
        help="enumerate the entire archive and write its manifest without downloading games",
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--download-only", action="store_true")
    parser.add_argument("--refresh-listings", action="store_true")
    parser.add_argument("--overwrite-games", action="store_true")
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--timeout", type=float, default=45.0)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--retry-backoff", type=float, default=2.0)
    parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT.replace("DPXQ", "XQDao"))
    args = parser.parse_args()

    if args.full and args.count != 5:
        parser.error("use --full without --count")
    if args.delay < 0.5:
        parser.error("--delay must be at least 0.5 seconds")
    if args.timeout <= 0 or args.retries < 0 or args.retry_backoff < 0:
        parser.error("timeout must be positive and retry values cannot be negative")
    if not args.download_only and not args.discover_only:
        try:
            require_import_environment()
        except RuntimeError as exc:
            parser.error(str(exc))

    complete_discovery = args.full or args.discover_only
    limit = None if args.full or args.discover_only else args.count
    limiter = RateLimiter(args.delay)
    games, stats, reached_end = discover(
        args.output,
        limiter=limiter,
        timeout=args.timeout,
        retries=args.retries,
        retry_backoff=args.retry_backoff,
        user_agent=args.user_agent,
        refresh=args.refresh_listings,
        complete=complete_discovery,
        enough=limit,
    )
    manifest_complete = complete_discovery and reached_end and stats["failed"] == 0
    _write_manifest(args.output, games, stats, manifest_complete)
    if args.discover_only:
        print(
            f"XQDao manifest: {len(games):,} unique public full-game links across "
            f"{stats['events']:,} event collections and {stats['listing_pages']:,} listing pages.",
            flush=True,
        )
        return 0 if manifest_complete else 1
    if not games:
        print("No XQDao games were discovered", file=sys.stderr)
        return 1

    selected = games if limit is None else games[:limit]
    counts = {"downloaded": 0, "cached": 0, "failed": 0, "imported": 0, "duplicate": 0, "invalid": 0}
    progress = ProgressBar("XQDao", len(selected), print_every=1)
    importer = None if args.download_only else XqdaoImporter(args.database, message=progress.message)
    if importer:
        importer.__enter__()
    try:
        for number, listing in enumerate(selected, 1):
            if importer and importer.has_record(listing.game_id) and not args.overwrite_games:
                counts["duplicate"] += 1
                progress.update(
                    number,
                    f"ID {listing.game_id} D {counts['downloaded']} C {counts['cached']} "
                    f"F {counts['failed']} DB {counts['imported']}/{counts['duplicate']}/{counts['invalid']}",
                )
                continue
            path = args.output / "games" / f"{int(listing.game_id):08d}.html"
            try:
                path, cached = fetch_cached(
                    GAME_URL.format(game_id=listing.game_id),
                    path,
                    validator=game_validator,
                    limiter=limiter,
                    timeout=args.timeout,
                    retries=args.retries,
                    retry_backoff=args.retry_backoff,
                    user_agent=args.user_agent,
                    refresh=args.overwrite_games,
                )
                counts["cached" if cached else "downloaded"] += 1
                sidecar = path.with_suffix(".json")
                partial = sidecar.with_suffix(".json.partial")
                partial.write_text(
                    json.dumps(asdict(listing), ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
                partial.replace(sidecar)
                if importer:
                    status = importer.import_page(path, listing)
                    if status == "imported":
                        counts["imported"] += 1
                    elif status in {"duplicate", "existing"}:
                        counts["duplicate"] += 1
                    else:
                        counts["invalid"] += 1
            except (RuntimeError, OSError, UnicodeError, ValueError) as exc:
                counts["failed"] += 1
                progress.message(f"Failed XQDao game {listing.game_id}: {exc}")
            progress.update(
                number,
                f"ID {listing.game_id} D {counts['downloaded']} C {counts['cached']} "
                f"F {counts['failed']} DB {counts['imported']}/{counts['duplicate']}/{counts['invalid']}",
            )
    finally:
        if importer:
            importer.__exit__(None, None, None)
    progress.finish(
        len(selected),
        f"D {counts['downloaded']} C {counts['cached']} F {counts['failed']} "
        f"DB {counts['imported']}/{counts['duplicate']}/{counts['invalid']}",
    )
    if counts["failed"] or counts["invalid"] or stats["failed"]:
        print(
            "Completed with gaps. Rerun the same command; valid cache files and committed "
            "source records are skipped while missing or rejected records are retried.",
            file=sys.stderr,
        )
        return 1
    print(
        f"Complete: {len(selected):,} games processed; {counts['imported']:,} new, "
        f"{counts['duplicate']:,} existing/deduplicated.",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
