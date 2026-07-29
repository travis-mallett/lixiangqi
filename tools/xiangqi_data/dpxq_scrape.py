"""Resumably retrieve public DPXQ master-game records and import them.

The scraper preserves each source DhtmlXQ HTML page, throttles requests, retries
transient failures, and resumes from already validated files. Downloaded pages
are passed to ``dpxq_import`` for legal-move validation, deduplication, and
position indexing.
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import re
import shutil
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import urllib.parse
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

from .dpxq_import import (
    DEFAULT_DATABASE,
    DpxqImporter,
    parse_game,
    require_import_environment,
    viewurl_game_id,
)
PROJECT_ROOT = Path(__file__).resolve().parents[2]


DEFAULT_BASE_URL = "http://www.dpxq.com/hldcg/search/view_m_{id}.html"
DEFAULT_OUTPUT = DEFAULT_DATABASE.parent / "dpxq-master-html"
DEFAULT_USER_AGENT = "Lixiangqi-DPXQ-Importer/1.0 (+https://lixiangqi.org)"
MAX_RECORD_BYTES = 2_000_000


@dataclass
class ScrapeCounts:
    requested: int = 0
    downloaded: int = 0
    cached: int = 0
    failed: int = 0


class ProgressBar:
    """Dependency-free progress display that also stays readable when redirected."""

    def __init__(self, label: str, total: int, *, print_every: int = 100) -> None:
        self.label = label
        self.total = max(0, total)
        self.started_at = time.monotonic()
        self.last_completed = -1
        self.last_line_width = 0
        self.interactive = sys.stdout.isatty()
        self.print_every = print_every

    def update(self, completed: int, detail: str, *, force: bool = False) -> None:
        completed = max(0, min(completed, self.total))
        if not force and not self.interactive:
            if self.print_every == 0 and completed not in {0, self.total}:
                return
            if (
                completed not in {0, self.total}
                and completed - self.last_completed < self.print_every
            ):
                return
        elapsed = max(0, time.monotonic() - self.started_at)
        rate = completed / elapsed if completed and elapsed else 0.0
        remaining = self.total - completed
        eta = remaining / rate if rate else None
        percent = completed / self.total if self.total else 1.0
        terminal_width = shutil.get_terminal_size((100, 20)).columns
        narrow = terminal_width < 105
        bar_width = (
            max(8, min(16, terminal_width - 65))
            if narrow
            else max(16, min(32, terminal_width - 96))
        )
        filled = min(bar_width, int(percent * bar_width))
        bar = "#" * filled + "-" * (bar_width - filled)
        eta_text = _duration(eta) if eta is not None else "--"
        if narrow:
            line = (
                f"{self.label:<8} [{bar}] {percent:5.1%} "
                f"{completed:,}/{self.total:,} ETA {eta_text} | {detail}"
            )
        else:
            line = (
                f"{self.label:<8} [{bar}] {percent:6.2%} "
                f"{completed:,}/{self.total:,} | {rate:5.1f}/s | ETA {eta_text} | {detail}"
            )
        line = line[: max(20, terminal_width - 1)]
        if self.interactive:
            padding = " " * max(0, self.last_line_width - len(line))
            print(f"\r{line}{padding}", end="", flush=True)
            self.last_line_width = len(line)
        else:
            print(line, flush=True)
        self.last_completed = completed

    def message(self, value: str) -> None:
        if self.interactive and self.last_line_width:
            print("\r" + " " * self.last_line_width + "\r", end="", flush=True)
        print(value, flush=True)
        self.last_line_width = 0

    def finish(self, completed: int, detail: str) -> None:
        if self.last_completed != completed:
            self.update(completed, detail, force=True)
        if self.interactive:
            print(flush=True)


def _duration(seconds: float | None) -> str:
    if seconds is None:
        return "--"
    seconds = max(0, int(seconds))
    hours, remainder = divmod(seconds, 3600)
    minutes, remaining_seconds = divmod(remainder, 60)
    if hours:
        return f"{hours}h {minutes:02d}m"
    if minutes:
        return f"{minutes}m {remaining_seconds:02d}s"
    return f"{remaining_seconds}s"


class DownloadFailure(RuntimeError):
    def __init__(self, message: str, *, retryable: bool = True, retry_after: float = 0) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.retry_after = retry_after


class PersistentRecordFetcher:
    """Fetch DPXQ records over one reusable HTTP connection.

    ``urllib.request.urlopen`` intentionally closes HTTP connections after each
    response. DPXQ's connection setup is substantially slower than serving a
    record, so a sequential scraper otherwise spends most of its time opening
    new TCP connections. This fetcher keeps the one-at-a-time request policy;
    it only reuses an idle connection for the same origin.
    """

    def __init__(self, *, cookie: str = "") -> None:
        self.cookie = cookie
        self.connection: http.client.HTTPConnection | http.client.HTTPSConnection | None = None
        self.origin: tuple[str, str, int] | None = None

    def __enter__(self) -> "PersistentRecordFetcher":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def close(self) -> None:
        if self.connection is not None:
            self.connection.close()
        self.connection = None
        self.origin = None

    def __call__(
        self,
        url: str,
        *,
        timeout: float,
        user_agent: str,
    ) -> bytes:
        parts = urllib.parse.urlsplit(url)
        if parts.scheme not in {"http", "https"} or not parts.hostname:
            raise DownloadFailure(f"unsupported DPXQ URL: {url}", retryable=False)
        port = parts.port or (443 if parts.scheme == "https" else 80)
        origin = (parts.scheme, parts.hostname, port)
        if self.origin != origin:
            self.close()
            connection_type = (
                http.client.HTTPSConnection if parts.scheme == "https" else http.client.HTTPConnection
            )
            self.connection = connection_type(parts.hostname, port, timeout=timeout)
            self.origin = origin
        assert self.connection is not None
        self.connection.timeout = timeout
        target = urllib.parse.urlunsplit(("", "", parts.path or "/", parts.query, ""))
        headers = {
            "User-Agent": user_agent,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Encoding": "identity",
        }
        if self.cookie:
            headers["Cookie"] = self.cookie
        try:
            self.connection.request("GET", target, headers=headers)
            response = self.connection.getresponse()
            content_type = response.headers.get_content_type()
            payload = response.read(MAX_RECORD_BYTES + 1)
        except (http.client.HTTPException, TimeoutError, OSError) as exc:
            self.close()
            raise DownloadFailure(str(exc)) from exc
        if response.will_close:
            self.close()
        if response.status >= 400:
            retryable = response.status == 429 or 500 <= response.status < 600
            try:
                retry_after = float(response.getheader("Retry-After", "0"))
            except (TypeError, ValueError):
                retry_after = 0.0
            raise DownloadFailure(
                f"HTTP {response.status}", retryable=retryable, retry_after=retry_after
            )
        if content_type not in {"text/html", "application/xhtml+xml"}:
            raise DownloadFailure(f"unexpected content type {content_type}", retryable=False)
        if len(payload) > MAX_RECORD_BYTES:
            raise DownloadFailure("record exceeds the 2 MB safety limit", retryable=False)
        return payload


def record_path(output: Path, game_id: int, owner: str = "m") -> Path:
    return output / f"view_{owner}_{game_id}.html"


def validated_record(path: Path, game_id: int, owner: str = "m") -> bool:
    try:
        game = parse_game(path, external_id=str(game_id), owner=owner)
        view_id = viewurl_game_id(game.source_metadata)
        return not view_id or view_id == str(game_id)
    except (OSError, UnicodeError, ValueError):
        return False


def fetch_record(
    url: str,
    *,
    timeout: float,
    user_agent: str,
    cookie: str = "",
) -> bytes:
    headers = {
        "User-Agent": user_agent,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Encoding": "identity",
    }
    if cookie:
        headers["Cookie"] = cookie
    request = urllib.request.Request(
        url,
        headers=headers,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            content_type = response.headers.get_content_type()
            if content_type not in {"text/html", "application/xhtml+xml"}:
                raise DownloadFailure(f"unexpected content type {content_type}", retryable=False)
            payload = response.read(MAX_RECORD_BYTES + 1)
    except urllib.error.HTTPError as exc:
        retryable = exc.code == 429 or 500 <= exc.code < 600
        retry_after = 0.0
        try:
            retry_after = float(exc.headers.get("Retry-After", "0"))
        except (TypeError, ValueError):
            pass
        raise DownloadFailure(
            f"HTTP {exc.code}", retryable=retryable, retry_after=retry_after
        ) from exc
    except (TimeoutError, urllib.error.URLError, OSError) as exc:
        raise DownloadFailure(str(exc)) from exc
    if len(payload) > MAX_RECORD_BYTES:
        raise DownloadFailure("record exceeds the 2 MB safety limit", retryable=False)
    return payload


def save_validated_record(
    payload: bytes,
    destination: Path,
    game_id: int,
    owner: str = "m",
) -> None:
    partial_dir = destination.parent / ".partial"
    partial_dir.mkdir(parents=True, exist_ok=True)
    partial = partial_dir / f"{destination.name}.part"
    try:
        partial.write_bytes(payload)
        try:
            game = parse_game(partial, external_id=str(game_id), owner=owner)
        except (OSError, UnicodeError, ValueError) as exc:
            raise DownloadFailure(
                f"invalid DhtmlXQ record: {exc}", retryable=False
            ) from exc
        view_id = viewurl_game_id(game.source_metadata)
        if view_id and view_id != str(game_id):
            raise DownloadFailure(
                f"DhtmlXQ view URL identifies game {view_id}, not requested game {game_id}",
                retryable=False,
            )
        os.replace(partial, destination)
    finally:
        partial.unlink(missing_ok=True)


def scrape_records(
    game_ids: range,
    output: Path,
    *,
    base_url: str = DEFAULT_BASE_URL,
    delay: float = 1.0,
    timeout: float = 30.0,
    retries: int = 4,
    retry_backoff: float = 2.0,
    overwrite: bool = False,
    user_agent: str = DEFAULT_USER_AGENT,
    progress_every: int = 100,
    owner: str = "m",
    fetch: Callable[..., bytes] = fetch_record,
    sleep: Callable[[float], None] = time.sleep,
    progress: Callable[[ScrapeCounts, int], None] | None = None,
    message: Callable[[str], None] | None = None,
    record_ready: Callable[[Path, int, bool], None] | None = None,
) -> tuple[ScrapeCounts, list[Path]]:
    output.mkdir(parents=True, exist_ok=True)
    counts = ScrapeCounts()
    selected: list[Path] = []
    last_request_started_at = 0.0
    for game_id in game_ids:
        counts.requested += 1
        destination = record_path(output, game_id, owner)
        if not overwrite and destination.is_file() and validated_record(
            destination, game_id, owner
        ):
            counts.cached += 1
            selected.append(destination)
            if record_ready:
                record_ready(destination, game_id, True)
            if progress:
                progress(counts, game_id)
            elif progress_every and counts.requested % progress_every == 0:
                print(json.dumps(asdict(counts), separators=(",", ":")), flush=True)
            continue

        failure: DownloadFailure | None = None
        for attempt in range(retries + 1):
            elapsed = time.monotonic() - last_request_started_at
            if elapsed < delay:
                sleep(delay - elapsed)
            # Rate-limit request starts. A slow DPXQ response already consumes
            # the configured interval, so do not add the full delay again
            # after it completes.
            last_request_started_at = time.monotonic()
            try:
                payload = fetch(
                    base_url.format(id=game_id, owner=owner),
                    timeout=timeout,
                    user_agent=user_agent,
                )
                save_validated_record(payload, destination, game_id, owner)
                counts.downloaded += 1
                selected.append(destination)
                if record_ready:
                    record_ready(destination, game_id, False)
                failure = None
                break
            except DownloadFailure as exc:
                failure = exc
                if not exc.retryable or attempt == retries:
                    break
                wait_for = max(exc.retry_after, retry_backoff * (2**attempt))
                retry_message = (
                    f"Retrying DPXQ game {game_id} after {exc} "
                    f"(attempt {attempt + 2}/{retries + 1}, wait {_duration(wait_for)})"
                )
                if message:
                    message(retry_message)
                else:
                    print(retry_message, flush=True)
                sleep(wait_for)
        if failure:
            counts.failed += 1
            failure_message = f"Failed DPXQ {owner} game {game_id}: {failure}"
            if message:
                message(failure_message)
            else:
                print(failure_message, flush=True)
        if progress:
            progress(counts, game_id)
        elif progress_every and counts.requested % progress_every == 0:
            print(json.dumps(asdict(counts), separators=(",", ":")), flush=True)
    return counts, selected


def infer_resume_start(
    start: int,
    end: int,
    output: Path,
    *,
    database: Path | None,
    owner: str = "m",
) -> int:
    """Return the ID after the highest committed or atomically saved record."""

    highest: int | None = None
    if database is not None and database.is_file():
        connection: sqlite3.Connection | None = None
        try:
            connection = sqlite3.connect(database, timeout=1)
            row = connection.execute(
                """
                SELECT max(CAST(external_id AS INTEGER))
                FROM game_sources
                WHERE source = 'dpxq' AND collection = ?
                  AND external_id NOT GLOB '*[^0-9]*'
                """,
                (owner,),
            ).fetchone()
            highest = int(row[0]) if row and row[0] is not None else None
        except sqlite3.DatabaseError:
            highest = None
        finally:
            if connection is not None:
                connection.close()
    elif database is None and output.is_dir():
        pattern = re.compile(rf"view_{re.escape(owner)}_(\d+)\.html\Z")
        for path in output.iterdir():
            match = pattern.fullmatch(path.name)
            if match:
                game_id = int(match.group(1))
                if start <= game_id <= end and (highest is None or game_id > highest):
                    highest = game_id

    if highest is None or highest < start:
        return start
    return min(end + 1, highest + 1)


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return parsed


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Retrieve public DPXQ master games and build the Lixiangqi explorer index"
    )
    parser.add_argument("--start", type=positive_int, default=1, help="first game id")
    limit = parser.add_mutually_exclusive_group(required=True)
    limit.add_argument("--end", type=positive_int, help="last game id, inclusive")
    limit.add_argument("--count", type=positive_int, help="number of sequential games")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--download-only", action="store_true")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="redownload validated cached records instead of resuming",
    )
    parser.add_argument(
        "--reconcile",
        action="store_true",
        help="scan the full requested range to validate cached files and repair old gaps",
    )
    parser.add_argument("--delay", type=float, default=1.0, help="minimum seconds between requests")
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--retry-backoff", type=float, default=2.0)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    parser.add_argument(
        "--progress-every",
        type=int,
        default=100,
        help="records between progress lines when output is redirected (interactive bars update live)",
    )
    args = parser.parse_args()
    if args.delay < 0.25:
        parser.error("--delay must be at least 0.25 seconds")
    if args.timeout <= 0 or args.retries < 0 or args.retry_backoff < 0:
        parser.error("timeout must be positive and retry values cannot be negative")
    if args.progress_every < 0:
        parser.error("--progress-every cannot be negative")
    if not args.download_only:
        try:
            require_import_environment()
        except RuntimeError as exc:
            parser.error(str(exc))
    end = args.end if args.end is not None else args.start + args.count - 1
    if end < args.start:
        parser.error("--end cannot be less than --start")

    resume_start = args.start
    if not args.overwrite and not args.reconcile:
        resume_start = infer_resume_start(
            args.start,
            end,
            args.output,
            database=None if args.download_only else args.database,
        )
        if resume_start > args.start:
            print(
                f"Fast resume: skipped IDs {args.start:,}-{resume_start - 1:,}; "
                + (
                    f"continuing at ID {resume_start:,}."
                    if resume_start <= end
                    else "the requested range is already complete."
                ),
                flush=True,
            )

    game_ids = range(resume_start, end + 1)
    download_bar = ProgressBar("Download", len(game_ids), print_every=args.progress_every)
    importer: DpxqImporter | None = None
    if not args.download_only and len(game_ids):
        importer = DpxqImporter(
            args.database,
            commit_each=True,
            message=download_bar.message,
        )
        importer.__enter__()

    def download_detail(counts: ScrapeCounts, game_id: int) -> str:
        detail = (
            f"ID {game_id:,} D {counts.downloaded:,} "
            f"C {counts.cached:,} F {counts.failed:,}"
        )
        if importer:
            imported = importer.counts
            detail += (
                f" DB {imported['imported']:,}/"
                f"{imported['duplicate']:,}/{imported['invalid']:,}"
            )
        return detail

    download_bar.update(0, f"starting at ID {resume_start:,}", force=True)
    try:
        with PersistentRecordFetcher() as fetcher:
            scrape, selected = scrape_records(
                game_ids,
                args.output,
                base_url=args.base_url,
                delay=args.delay,
                timeout=args.timeout,
                retries=args.retries,
                retry_backoff=args.retry_backoff,
                overwrite=args.overwrite,
                user_agent=args.user_agent,
                progress_every=args.progress_every,
                fetch=fetcher,
                progress=lambda counts, game_id: download_bar.update(
                    counts.requested, download_detail(counts, game_id)
                ),
                message=download_bar.message,
                record_ready=(
                    (
                        lambda path, game_id, cached: importer.import_if_missing(
                            path, str(game_id)
                        )
                        if cached
                        else importer.import_path(path)
                    )
                    if importer
                    else None
                ),
            )
    except KeyboardInterrupt:
        if importer:
            importer.close()
        download_bar.message(
            "Interrupted. Downloaded files and imported database rows are saved; "
            "run the same command again to resume safely."
        )
        raise SystemExit(130)
    except BaseException:
        if importer:
            importer.close()
        raise
    download_bar.finish(scrape.requested, download_detail(scrape, end))

    result: dict[str, object] = {"scrape": asdict(scrape)}
    if importer:
        importer.close()
        result["import"] = importer.counts
    if not args.download_only:
        result["database"] = str(args.database.resolve())
    print(
        f"Finished DPXQ range {args.start:,}-{end:,}. "
        f"HTML: {args.output.resolve()}",
        flush=True,
    )
    if not args.download_only:
        print(f"Explorer database: {args.database.resolve()}", flush=True)
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    if scrape.failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
