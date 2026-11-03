"""Collect public jieqi evidence and validated records into a separate local SQLite database."""
import argparse
import json
from pathlib import Path
import signal
import sys

from .collector import process, run
from .sources import SOURCES, canonical_url
from .store import DEFAULT_DIRECTORY, Store, exclusive
from .transport import Fetcher, MAX_BYTES
from .validation import Validator


def interrupted(*_):
    raise KeyboardInterrupt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=DEFAULT_DIRECTORY)
    sub = parser.add_subparsers(dest="command", required=True)
    collect = sub.add_parser("run", help="Seed and resume discovery/collection")
    collect.add_argument("--sources", nargs="+", choices=list(SOURCES), help="Explicit experimental sources; none has a verified full-game downloader")
    collect.add_argument("--max-pages", type=int, default=1000, help="Page-attempt cap for this run, including retries (not a game count); repeat run to resume")
    collect.add_argument("--max-depth", type=int, default=5)
    collect.add_argument("--delay", type=float, default=2)
    collect.add_argument("--timeout", type=float, default=30)
    collect.add_argument("--retries", type=int, default=3)
    collect.add_argument("--backoff", type=float, default=5)
    collect.add_argument("--offline", action="store_true")
    collect.add_argument("--refresh", action="store_true", help="Refetch previously completed/review pages; keep all evidence")
    collect.add_argument("--retry-failed", action="store_true", help="Requeue failed/blocked requests after resolving access")
    collect.add_argument("--reparse", action="store_true", help="Reparse cached successful/review pages without downloading")
    seed = sub.add_parser("seed", help="Add explicit source URLs")
    seed.add_argument("source", choices=list(SOURCES))
    seed.add_argument("urls", nargs="+")
    ingest = sub.add_parser("import-file", help="Import one saved HTML, coordinate PGN, or normalized JSON record")
    ingest.add_argument("source", choices=list(SOURCES))
    ingest.add_argument("url", help="Original source URL, for provenance")
    ingest.add_argument("file", type=Path)
    export = sub.add_parser("export", help="Atomically export validated records with provenance to JSONL")
    export.add_argument("file", type=Path)
    sub.add_parser("status")
    sub.add_parser("sources")
    args = parser.parse_args(argv)
    if args.command == "sources":
        for name, source in SOURCES.items():
            print(f"{name}: {source.capability}")
        return 0
    if args.command == "run":
        if not args.sources:
            parser.error("No verified full-game sources are available. This is an experimental discovery tool, not a working bulk game scraper. Use --sources explicitly only to investigate a source.")
        if args.max_pages < 1 or args.max_depth < 0 or args.delay < 0 or args.timeout <= 0 or args.retries < 0 or args.backoff < 0:
            parser.error("Invalid limits: pages/timeout must be positive; other limits nonnegative")
        if sum((args.refresh, args.retry_failed, args.reparse)) > 1:
            parser.error("Choose at most one of --refresh, --retry-failed, --reparse")
        if args.offline and (args.refresh or args.retry_failed):
            parser.error("Offline mode cannot refresh or retry network failures")
    signal.signal(signal.SIGTERM, interrupted)
    try:
        with exclusive(args.directory):
            store = Store(args.directory)
            validator = None
            try:
                if args.command in {"run", "import-file"}:
                    validator = Validator()
                if args.command == "seed":
                    with store.db:
                        for url in args.urls:
                            store.enqueue(args.source, canonical_url(args.source, url))
                elif args.command == "import-file":
                    if args.file.stat().st_size > MAX_BYTES:
                        parser.error("Record exceeds 4 MB; split the input into individual records")
                    url = canonical_url(args.source, args.url)
                    with store.db:
                        store.enqueue(args.source, url)
                    job = store.db.execute("SELECT * FROM jobs WHERE source=? AND url=?", (args.source, url)).fetchone()
                    store.cache(job["id"], args.file.read_bytes(), content_type="local-file")
                    with store.db:
                        store.db.execute("UPDATE jobs SET state='pending',error='' WHERE id=?", (job["id"],))
                    job = store.db.execute("SELECT * FROM jobs WHERE id=?", (job["id"],)).fetchone()
                    process(store, job, validator)
                elif args.command == "run":
                    with store.db:
                        for source in args.sources:
                            for url in SOURCES[source].seeds:
                                store.enqueue(source, canonical_url(source, url))
                        placeholders = ",".join("?" for _ in args.sources)
                        if args.refresh or args.retry_failed or args.reparse:
                            states = "('failed','blocked')" if args.retry_failed else "('done','review')"
                            clear = "" if args.reparse else ",raw_hash=NULL"
                            store.db.execute(f"UPDATE jobs SET state='pending',attempts=0,next_attempt=0,error=''{clear} WHERE source IN ({placeholders}) AND state IN {states}", args.sources)
                    run(store, args.sources, Fetcher(args.delay, args.timeout), validator,
                        max_pages=args.max_pages, max_depth=args.max_depth, retries=args.retries,
                        backoff=args.backoff, offline=args.offline)
                elif args.command == "export":
                    store.export(args.file)
                summary = store.summary()
                print(json.dumps(summary, ensure_ascii=True, indent=2))
                if args.command in {"run", "import-file"}:
                    selected = set(args.sources if args.command == "run" else [args.source])
                    games = store.db.execute(
                        "SELECT count(DISTINCT r.identity) FROM records r "
                        "JOIN witnesses w ON w.identity=r.identity JOIN jobs j ON j.id=w.job_id "
                        "WHERE r.kind='game' AND j.source IN (" + ",".join("?" for _ in selected) + ")",
                        sorted(selected)).fetchone()[0]
                    if not games:
                        print("NO COMPLETE GAMES COLLECTED for the selected sources. Downloaded pages and fragments do not establish a working game source.", file=sys.stderr)
                        return 3
                    return 2 if any(p["source"] in selected for p in summary["problems"]) else 0
                return 0
            finally:
                if validator is not None:
                    validator.close()
                store.close()
    except KeyboardInterrupt:
        print("Cancelled. Committed records and cached responses retained; repeat the command to resume.", file=sys.stderr)
        return 130
    except (OSError, RuntimeError, ValueError) as error:
        print(f"Collector stopped: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
