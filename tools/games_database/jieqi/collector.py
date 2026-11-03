"""Restart-safe work loop. Downloads and parsing have separate durable boundaries."""
import time

from tools.xiangqi_data.dpxq_import import decode_html
from .records import parse_record
from .sources import Page, blocked_reason, discover
from .transport import FetchError


def decode(body):
    try:
        return body.decode("utf-8-sig")
    except UnicodeDecodeError:
        return decode_html(body)


def process(store, job, validator):
    document = decode(store.body(job["raw_hash"]))
    reason = blocked_reason(document)
    if reason:
        with store.db:
            store.db.execute("UPDATE jobs SET state='blocked',error=? WHERE id=?", (reason, job["id"]))
        return
    # Always persist discovered children, even past this run's depth budget.
    # Raising --max-depth later must not require refreshing completed parents.
    links = discover(job["source"], job["url"], document)
    try:
        record = parse_record(document)
        if record:
            validator.validate(record)
    except ValueError as error:
        # Unsupported notation is retained for a future adapter, not misreported
        # as an empty page or silently discarded. Infrastructure errors propagate.
        with store.db:
            for link in links:
                store.enqueue(job["source"], link, job["depth"] + 1)
            store.db.execute("UPDATE jobs SET state='review',error=? WHERE id=?", (str(error)[:1000], job["id"]))
        return
    if record:
        classification = record.kind
    elif links:
        classification = "listing-access-limited" if "登录查看更多棋谱" in "".join(Page(document).text) else "listing"
    elif job["source"] == "xiangqiqipu":
        classification = "video-reference"
    else:
        classification = "no-supported-record"
    store.finish(job, record, links, classification)


def run(store, sources, fetch, validator, *, max_pages=1000, max_depth=5, retries=3, backoff=5.0, offline=False):
    attempted = 0
    started = time.monotonic()
    print(f"Collecting source pages (up to {max_pages:,} attempts this run; not a game total).", flush=True)
    print("Discovered links can grow the queue. Ctrl+C saves progress; repeat the command to resume.", flush=True)
    paused = {r[0] for r in store.db.execute("SELECT DISTINCT source FROM jobs WHERE state='blocked'")}
    while attempted < max_pages:
        candidates = [s for s in sources if s not in paused]
        if not candidates:
            break
        placeholders = ",".join("?" for _ in candidates)
        job = store.db.execute(
            f"SELECT * FROM jobs WHERE source IN ({placeholders}) AND depth<=? AND state='pending' "
            + ("AND raw_hash IS NOT NULL " if offline else "")
            + "ORDER BY next_attempt,id LIMIT 1", [*candidates, max_depth]).fetchone()
        if job is None:
            break
        wait = job["next_attempt"] - time.time()
        if wait > 0:
            # Long Retry-After is persisted. Do not keep an interactive run
            # asleep for minutes or hammer another URL on the same source.
            if wait > 60:
                print("Deferred retry remains queued; rerun after its Retry-After deadline", flush=True)
                break
            time.sleep(wait)
        attempted += 1
        print(f"Page attempt {attempted:,} | {job['source']} | {'Reading cached page' if job['raw_hash'] else 'Downloading page'}", flush=True)
        print(f"  {job['url']}", flush=True)
        if not job["raw_hash"]:
            # A process kill during fetch leaves this row pending. No 'in flight'
            # state or resume-high-water mark can skip a hole in the frontier.
            with store.db:
                store.db.execute("UPDATE jobs SET attempts=attempts+1 WHERE id=?", (job["id"],))
            try:
                body, status, content_type = fetch(job["source"], job["url"])
                if not any(t in content_type.lower() for t in ("text/", "json", "xml", "pgn")):
                    raise FetchError("Unsupported HTTP content type: " + content_type[:100])
                store.cache(job["id"], body, status, content_type)
            except FetchError as error:
                attempts = job["attempts"] + 1
                retry = error.retryable and attempts <= retries
                state = "blocked" if error.blocked else "pending" if retry else "failed"
                deadline = time.time() + max(error.retry_after, backoff * 2 ** min(attempts - 1, 10))
                with store.db:
                    store.db.execute("UPDATE jobs SET state=?,error=?,next_attempt=? WHERE id=?", (state, str(error), deadline, job["id"]))
                    if error.retry_after:
                        store.db.execute("UPDATE jobs SET next_attempt=max(next_attempt,?) WHERE source=? AND state='pending'", (deadline, job["source"]))
                if error.blocked or (error.retry_after > 60):
                    paused.add(job["source"])
                print(f"  {state.upper()}: {error}" + (f"; retry scheduled in {max(0, deadline-time.time()):.0f}s" if retry else ""), flush=True)
                continue
            job = store.db.execute("SELECT * FROM jobs WHERE id=?", (job["id"],)).fetchone()
        process(store, job, validator)
        state = store.db.execute("SELECT state FROM jobs WHERE id=?", (job["id"],)).fetchone()[0]
        if state == "blocked":
            paused.add(job["source"])
        outcome = store.db.execute("SELECT state,classification,error FROM jobs WHERE id=?", (job["id"],)).fetchone()
        labels = {"listing": "Discovery listing; no game imported", "listing-access-limited": "Discovery listing; more results require login", "no-supported-record": "No supported jieqi record on this page", "video-reference": "Video reference; no game imported", "game": "Validated complete jieqi record stored", "fragment": "Validated position fragment stored", "unfinished": "Validated unfinished line stored"}
        print("  " + (outcome["error"] or labels.get(outcome["classification"], outcome["state"])), flush=True)
        counts = dict(store.db.execute("SELECT kind,count(*) FROM records GROUP BY kind"))
        pending = store.db.execute("SELECT count(*) FROM jobs WHERE state='pending'").fetchone()[0]
        print(f"  Collection totals: {counts.get('game',0):,} complete games, {counts.get('fragment',0):,} fragments, {counts.get('unfinished',0):,} unfinished lines | {pending:,} pages queued (including paused sources)", flush=True)
    reason = "Per-run page cap reached; repeat the command to continue" if attempted >= max_pages else "No more eligible pages this run (check blocked sources, retry deadlines and depth limit)"
    print(f"Stopped after {attempted:,} page attempts in {time.monotonic()-started:.0f}s. {reason}.", flush=True)
    return attempted
