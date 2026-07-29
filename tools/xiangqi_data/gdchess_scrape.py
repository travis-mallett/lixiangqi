"""Resumably discover, download, validate, and import GDChess/01xq games."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict
from pathlib import Path

from external.xiangqi_explorer.catalog_databases import source_database_path
from .dpxq_import import decode_html, require_import_environment
from .dpxq_scrape import DEFAULT_USER_AGENT, positive_int
from .gdchess_import import GAME_ID_PATTERN, MOVE_PATTERN, GdchessImporter, GdchessListing


DEFAULT_DATABASE = source_database_path("gdchess")
DEFAULT_OUTPUT = DEFAULT_DATABASE.parent / "gdchess-01xq-html"
MAX_DOCUMENT_BYTES = 6_000_000
CATALOG_URL = "http://www.gdchess.com/xqdata/?page={page}"
LISTING_URL = "http://www.01xq.com/XQData/GameList.asp?eid={event_id}"
GAME_URL = "http://www.gdchess.com/xqgame/gview.asp?id={game_id}"
EVENT_PATTERN = re.compile(r"GameList\.asp\?eid=(\d+)", re.IGNORECASE)
CATALOG_EVENT_PATTERN = re.compile(r"EventInfo\.asp\?eid=\d+", re.IGNORECASE)
LAST_PAGE_PATTERN = re.compile(r"共\s*(\d+)\s*页")
ROW_PATTERN = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
CELL_PATTERN = re.compile(r"<td\b[^>]*>(.*?)</td>", re.IGNORECASE | re.DOTALL)
HEADER_PATTERN = re.compile(r"<th\b[^>]*>(.*?)</th>", re.IGNORECASE | re.DOTALL)
LISTED_GAME_PATTERN = re.compile(
    r"javascript:g\(['\"](?P<id>[0-9A-F-]+)['\"]\)", re.IGNORECASE
)
TITLE_PATTERN = re.compile(r"<title>(.*?)</title>", re.IGNORECASE | re.DOTALL)


def _text(value: str) -> str:
    value = re.sub(r"<br\s*/?>", " ", value, flags=re.IGNORECASE)
    value = re.sub(r"<[^>]+>", "", value)
    return " ".join(html.unescape(value).replace("\u3000", " ").split())


def _date(value: str) -> str:
    digits = re.sub(r"\D", "", value)
    if len(digits) >= 8:
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"
    return "0000-00-00"


def _result(value: str) -> int:
    compact = re.sub(r"\s+", "", value)
    if compact.startswith("2"):
        return 1
    if compact.startswith("0"):
        return -1
    if "=" in compact or compact.startswith("1"):
        return 0
    raise ValueError(f"unsupported 01xq result: {value or '(missing)'}")


def parse_catalog(document: str) -> tuple[list[str], int]:
    event_ids = list(dict.fromkeys(EVENT_PATTERN.findall(document)))
    last_match = LAST_PAGE_PATTERN.search(document)
    last_page = int(last_match.group(1)) if last_match else 1
    return event_ids, last_page


def parse_listing(document: str, event_id: str, listing_url: str) -> list[GdchessListing]:
    title_match = TITLE_PATTERN.search(document)
    page_title = _text(title_match.group(1)) if title_match else ""
    event_english = re.sub(
        r"\s*-\s*Game list\s*-?\s*XiangQi Database\s*$", "", page_title, flags=re.IGNORECASE
    ).strip()
    columns: dict[str, int] = {}
    for row in ROW_PATTERN.findall(document):
        headers = [_text(header).casefold() for header in HEADER_PATTERN.findall(row)]
        if {"match date", "round", "red", "result", "black", "game", "moves"}.issubset(headers):
            columns = {name: index for index, name in enumerate(headers)}
            break
    listings: list[GdchessListing] = []
    for row in ROW_PATTERN.findall(document):
        game_match = LISTED_GAME_PATTERN.search(row)
        if not game_match:
            continue
        game_id = game_match.group("id").upper()
        if not GAME_ID_PATTERN.fullmatch(game_id):
            continue
        cells = [_text(cell) for cell in CELL_PATTERN.findall(row)]
        if columns:
            if len(cells) < len(columns):
                raise ValueError(
                    f"01xq listing row for {game_id} has {len(cells)} cells, "
                    f"but its header defines {len(columns)}"
                )

            def cell(name: str, default: str = "") -> str:
                index = columns.get(name)
                return cells[index] if index is not None else default

            date = cell("match date")
            round_name = cell("round")
            table = cell("table")
            red = cell("red")
            result = cell("result")
            black = cell("black")
            moves = cell("moves")
            opening = cell("opening")
            views = cell("views")
            updated = cell("last update")
        elif len(cells) == 11:
            date, round_name, table, red, result, black = cells[:6]
            moves, opening, views, updated = cells[7:11]
        elif len(cells) == 10:
            date, round_name, red, result, black = cells[:5]
            table = ""
            moves, opening, views, updated = cells[6:10]
        else:
            raise ValueError(f"unsupported 01xq listing row for {game_id}")
        listings.append(
            GdchessListing(
                game_id=game_id,
                event_id=event_id,
                event_native="",
                event_english=event_english,
                played_at=_date(date),
                round=round_name,
                table=table,
                red_english=red,
                black_english=black,
                result=_result(result),
                listed_plies=int(moves) if moves.isdigit() else 0,
                opening_english=opening,
                views=int(views) if views.isdigit() else None,
                updated_at=updated.replace(" ", "T", 1),
                listing_url=listing_url,
            )
        )
    return listings


class RateLimiter:
    def __init__(self, delay: float) -> None:
        self.delay = delay
        self.last_request = 0.0

    def wait(self) -> None:
        remaining = self.delay - (time.monotonic() - self.last_request)
        if remaining > 0:
            time.sleep(remaining)
        self.last_request = time.monotonic()


def _valid_document(path: Path, validator) -> bool:
    try:
        return validator(decode_html(path.read_bytes()))
    except (OSError, UnicodeError):
        return False


def _document_description(raw: bytes) -> str:
    digest = hashlib.sha256(raw).hexdigest()[:12]
    try:
        document = decode_html(raw)
        title_match = TITLE_PATTERN.search(document)
        title = _text(title_match.group(1)) if title_match else "(missing)"
    except (UnicodeError, ValueError):
        title = "(undecodable)"
    return f"{len(raw):,} bytes, sha256={digest}, title={title!r}"


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
    rejected = path.with_suffix(".rejected" + path.suffix)
    partial.unlink(missing_ok=True)
    headers = {
        "User-Agent": user_agent,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Encoding": "identity",
    }
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        limiter.wait()
        try:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                status = response.getcode()
                final_url = response.geturl()
                content_type = response.headers.get_content_type()
                raw = response.read(MAX_DOCUMENT_BYTES + 1)
                if len(raw) > MAX_DOCUMENT_BYTES:
                    raise ValueError(f"response exceeds {MAX_DOCUMENT_BYTES // 1_000_000} MB")
            partial.write_bytes(raw)
            if content_type not in {"text/html", "application/xhtml+xml"}:
                partial.replace(rejected)
                raise ValueError(
                    f"unexpected content type {content_type!r}; rejected response saved to {rejected}"
                )
            if not _valid_document(partial, validator):
                description = _document_description(raw)
                partial.replace(rejected)
                raise ValueError(
                    "response is not the expected GDChess/01xq page "
                    f"(HTTP {status}, final URL {final_url!r}, {description}); "
                    f"rejected response saved to {rejected}"
                )
            partial.replace(path)
            rejected.unlink(missing_ok=True)
            return path, False
        except (TimeoutError, urllib.error.HTTPError, urllib.error.URLError, OSError, ValueError) as exc:
            last_error = exc
            partial.unlink(missing_ok=True)
            if attempt < retries:
                wait_for = retry_backoff * (2**attempt)
                print(
                    f"Retrying {url} after {exc} "
                    f"(attempt {attempt + 2}/{retries + 1}, wait {wait_for:g}s)",
                    file=sys.stderr,
                    flush=True,
                )
                if wait_for:
                    time.sleep(wait_for)
    raise RuntimeError(f"failed after {retries + 1} attempts: {last_error}")


def catalog_validator(document: str) -> bool:
    has_event = bool(EVENT_PATTERN.search(document) or CATALOG_EVENT_PATTERN.search(document))
    return has_event and bool(LAST_PAGE_PATTERN.search(document))


def listing_validator(document: str) -> bool:
    return bool(LISTED_GAME_PATTERN.search(document)) or "game list(0)" in document.lower()


def game_validator(document: str) -> bool:
    return bool(MOVE_PATTERN.search(document)) and bool(TITLE_PATTERN.search(document))


def _completed_game(
    output: Path,
    game_id: str,
    imported_game_ids: set[str] | None,
) -> bool:
    if imported_game_ids is not None:
        return game_id in imported_game_ids
    game_path = output / "games" / f"{game_id}.html"
    return game_path.is_file() and game_path.with_suffix(".json").is_file()


def infer_resume_cursor(
    event_ids: list[str],
    output: Path,
    imported_game_ids: set[str] | None = None,
) -> tuple[int, int]:
    """Find the first game after the furthest completed GDChess record.

    Event listings are fetched immediately before their games, so the last
    listing in the contiguous cached prefix identifies the event that was
    active when a sequential run stopped. Only that one small listing is
    parsed. Scattered listings from targeted/manual runs are deliberately
    ignored. In import mode committed source rows are authoritative;
    download-only mode requires both the HTML page and its JSON listing sidecar.
    """

    if not event_ids:
        return 0, 0
    if imported_game_ids is not None and not imported_game_ids:
        return 0, 0

    cached_event_ids = {path.stem for path in (output / "events").glob("*.html")}
    first_uncached_index = next(
        (
            index
            for index, event_id in enumerate(event_ids)
            if event_id not in cached_event_ids
        ),
        len(event_ids),
    )
    if first_uncached_index == 0:
        return 0, 0

    active_event_index = first_uncached_index - 1
    event_id = event_ids[active_event_index]
    listing_path = output / "events" / f"{event_id}.html"
    try:
        listings = parse_listing(
            decode_html(listing_path.read_bytes()),
            event_id,
            LISTING_URL.format(event_id=event_id),
        )
    except (OSError, UnicodeError, ValueError):
        return active_event_index, 0

    last_completed = -1
    for index, listing in enumerate(listings):
        if _completed_game(output, listing.game_id, imported_game_ids):
            last_completed = index
    next_game_index = last_completed + 1
    if next_game_index >= len(listings):
        return active_event_index + 1, 0
    return active_event_index, next_game_index


def _progress(processed: int, limit: int | None, game_id: str, counts: dict[str, int]) -> None:
    total = str(limit) if limit else "all"
    print(
        f"Games {processed:,}/{total} | {game_id} | "
        f"downloaded {counts['downloaded']:,}, cached {counts['cached']:,}, "
        f"failed {counts['failed']:,}, DB {counts['imported']:,}/"
        f"{counts['duplicate']:,}/{counts['invalid']:,}",
        flush=True,
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Download complete GDChess/01xq games into the Lixiangqi catalog"
    )
    parser.add_argument("--count", type=positive_int, default=5, help="unique games to process")
    parser.add_argument("--full", action="store_true", help="process every discoverable game")
    parser.add_argument("--event-id", help="process one GDChess event instead of catalog traversal")
    parser.add_argument("--start-page", type=positive_int, default=1, help="first event catalog page")
    parser.add_argument("--end-page", type=positive_int, help="last event catalog page")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--download-only", action="store_true")
    parser.add_argument("--refresh-listings", action="store_true")
    parser.add_argument("--overwrite-games", action="store_true")
    parser.add_argument(
        "--reconcile",
        action="store_true",
        help="scan all earlier games to validate cached files and repair old gaps",
    )
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--timeout", type=float, default=45.0)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--retry-backoff", type=float, default=2.0)
    parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT.replace("DPXQ", "GDChess-01xq"))
    args = parser.parse_args()

    if args.full and args.count != 5:
        parser.error("use --full without --count")
    if args.delay < 0.5:
        parser.error("--delay must be at least 0.5 seconds")
    if args.timeout <= 0 or args.retries < 0 or args.retry_backoff < 0:
        parser.error("timeout must be positive and retry values cannot be negative")
    if args.end_page is not None and args.end_page < args.start_page:
        parser.error("--end-page cannot be less than --start-page")
    if args.event_id and not args.event_id.isdigit():
        parser.error("--event-id must be numeric")
    if not args.download_only:
        try:
            require_import_environment()
        except RuntimeError as exc:
            parser.error(str(exc))

    limit = None if args.full else args.count
    limiter = RateLimiter(args.delay)
    counts = {
        "downloaded": 0,
        "cached": 0,
        "failed": 0,
        "catalog_failed": 0,
        "event_failed": 0,
        "game_failed": 0,
        "imported": 0,
        "duplicate": 0,
        "invalid": 0,
    }
    seen_events: set[str] = set()
    seen_games: set[str] = set()
    processed = 0
    importer = None

    try:
        if args.event_id:
            event_pages = [(args.event_id, "")]
        else:
            first_path, _ = fetch_cached(
                CATALOG_URL.format(page=args.start_page),
                args.output / "catalog" / f"page_{args.start_page:04d}.html",
                validator=catalog_validator,
                limiter=limiter,
                timeout=args.timeout,
                retries=args.retries,
                retry_backoff=args.retry_backoff,
                user_agent=args.user_agent,
                refresh=args.refresh_listings,
            )
            first_document = decode_html(first_path.read_bytes())
            _, discovered_last = parse_catalog(first_document)
            end_page = args.end_page or discovered_last
            event_pages = []
            for page in range(args.start_page, end_page + 1):
                if page == args.start_page:
                    document = first_document
                else:
                    try:
                        path, _ = fetch_cached(
                            CATALOG_URL.format(page=page),
                            args.output / "catalog" / f"page_{page:04d}.html",
                            validator=catalog_validator,
                            limiter=limiter,
                            timeout=args.timeout,
                            retries=args.retries,
                            retry_backoff=args.retry_backoff,
                            user_agent=args.user_agent,
                            refresh=args.refresh_listings,
                        )
                        document = decode_html(path.read_bytes())
                    except (RuntimeError, OSError, UnicodeError, ValueError) as exc:
                        counts["failed"] += 1
                        counts["catalog_failed"] += 1
                        print(f"Failed catalog page {page}: {exc}", file=sys.stderr, flush=True)
                        continue
                event_pages.extend((event_id, "") for event_id in parse_catalog(document)[0])
                if limit and event_pages:
                    break

        if not args.download_only:
            importer = GdchessImporter(args.database)
            importer.__enter__()

        event_pages = list(dict.fromkeys(event_pages))
        resume_event_index = 0
        resume_game_index = 0
        fast_resume = (
            args.full
            and not args.event_id
            and not args.reconcile
            and not args.refresh_listings
            and not args.overwrite_games
        )
        if fast_resume:
            resume_event_index, resume_game_index = infer_resume_cursor(
                [event_id for event_id, _event_name in event_pages],
                args.output,
                importer.existing_records if importer else None,
            )
            if resume_event_index < len(event_pages):
                resume_event_id = event_pages[resume_event_index][0]
                print(
                    f"Fast resume: skipped {resume_event_index:,} completed events; "
                    f"continuing at event {resume_event_id}, game {resume_game_index + 1:,}.",
                    flush=True,
                )
            else:
                print(
                    f"Fast resume: all {len(event_pages):,} discovered events are complete.",
                    flush=True,
                )

        for zero_based_event_index in range(resume_event_index, len(event_pages)):
            event_id, _event_name = event_pages[zero_based_event_index]
            event_index = zero_based_event_index + 1
            if event_id in seen_events:
                continue
            seen_events.add(event_id)
            listing_url = LISTING_URL.format(event_id=event_id)
            print(f"Event {event_index:,}: {event_id}", flush=True)
            try:
                listing_path, _ = fetch_cached(
                    listing_url,
                    args.output / "events" / f"{event_id}.html",
                    validator=listing_validator,
                    limiter=limiter,
                    timeout=args.timeout,
                    retries=args.retries,
                    retry_backoff=args.retry_backoff,
                    user_agent=args.user_agent,
                    refresh=args.refresh_listings,
                )
                listings = parse_listing(decode_html(listing_path.read_bytes()), event_id, listing_url)
            except (RuntimeError, OSError, UnicodeError, ValueError) as exc:
                print(f"Failed event {event_id}: {exc}", file=sys.stderr, flush=True)
                counts["failed"] += 1
                counts["event_failed"] += 1
                continue
            listing_offset = (
                resume_game_index if zero_based_event_index == resume_event_index else 0
            )
            for listing in listings[listing_offset:]:
                if listing.game_id in seen_games:
                    continue
                seen_games.add(listing.game_id)
                if fast_resume and _completed_game(
                    args.output,
                    listing.game_id,
                    importer.existing_records if importer else None,
                ):
                    continue
                if limit and processed >= limit:
                    break
                processed += 1
                page_path = args.output / "games" / f"{listing.game_id}.html"
                try:
                    page_path, cached = fetch_cached(
                        GAME_URL.format(game_id=listing.game_id),
                        page_path,
                        validator=game_validator,
                        limiter=limiter,
                        timeout=args.timeout,
                        retries=args.retries,
                        retry_backoff=args.retry_backoff,
                        user_agent=args.user_agent,
                        refresh=args.overwrite_games,
                    )
                    counts["cached" if cached else "downloaded"] += 1
                    metadata_path = page_path.with_suffix(".json")
                    partial = metadata_path.with_suffix(".json.partial")
                    partial.write_text(
                        json.dumps(asdict(listing), ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8",
                    )
                    partial.replace(metadata_path)
                    if importer:
                        status = importer.import_page(page_path, listing)
                        if status == "imported":
                            counts["imported"] += 1
                        elif status in {"duplicate", "existing"}:
                            counts["duplicate"] += 1
                        else:
                            counts["invalid"] += 1
                except (RuntimeError, OSError, UnicodeError, ValueError) as exc:
                    counts["failed"] += 1
                    counts["game_failed"] += 1
                    print(f"Failed GDChess/01xq game {listing.game_id}: {exc}", file=sys.stderr, flush=True)
                _progress(processed, limit, listing.game_id, counts)
            if limit and processed >= limit:
                break
    finally:
        if importer:
            importer.__exit__(None, None, None)

    if processed == 0 and fast_resume and not counts["failed"] and not counts["invalid"]:
        print("GDChess/01xq collection has no unfinished games.", flush=True)
        return 0
    if processed == 0:
        print("No GDChess/01xq games were discovered", file=sys.stderr)
        return 1
    if counts["failed"] or counts["invalid"]:
        print(
            f"Completed with gaps: failed={counts['failed']} "
            f"(catalog={counts['catalog_failed']}, events={counts['event_failed']}, "
            f"games={counts['game_failed']}), invalid={counts['invalid']}. "
            "Run again with --reconcile to retry historical gaps.",
            file=sys.stderr,
        )
        return 1
    print(
        f"Complete: {processed:,} games processed; {counts['imported']:,} new, "
        f"{counts['duplicate']:,} existing/deduplicated.",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
