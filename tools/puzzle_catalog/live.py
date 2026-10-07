"""Bounded HTTPS publication and durable local receipts. No MongoDB credentials."""

from __future__ import annotations

import hashlib
from contextlib import contextmanager
from decimal import Decimal
import json
from json.encoder import encode_basestring
import os
import sqlite3
from pathlib import Path
import time
import threading
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler
from uuid import uuid4

from .catalog import PuzzleCatalog, _digest, _json, validate_puzzle, identity


@contextmanager
def publication_stage(report, message, *, interval=10):
    """Keep blocking preparation and network work observable without claiming progress."""
    started = time.monotonic()
    stopped = threading.Event()
    report(message + "…", flush=True)

    def heartbeat():
        while not stopped.wait(interval):
            report(
                f"Still waiting: {message} ({time.monotonic() - started:.0f}s elapsed)",
                flush=True,
            )

    worker = threading.Thread(target=heartbeat, daemon=True)
    worker.start()
    try:
        yield
    finally:
        stopped.set()
        worker.join()


def admit_ready(repo, settings, report):
    with publication_stage(report, "Preparing verified local puzzles for publication"):
        repo.admit_ready(
            Path(settings.source_catalog),
            progress=lambda completed, total: report(
                f"Preparing puzzles: {completed:,} / {total:,} admitted locally (not uploaded yet)",
                flush=True,
            ),
        )
    report("Local preparation complete.", flush=True)


def canonical(value):
    if isinstance(value, dict):
        return (
            "{"
            + ",".join(
                encode_basestring(k) + ":" + canonical(v)
                for k, v in sorted(value.items())
            )
            + "}"
        )
    if isinstance(value, list):
        return "[" + ",".join(map(canonical, value)) + "]"
    if isinstance(value, str):
        return encode_basestring(value)
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        number = Decimal(str(value))
        if not number.is_finite():
            raise ValueError("Non-finite number")
        if not number:
            return "0"
        result = format(number, "f")
        return result.rstrip("0").rstrip(".") if "." in result else result
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def wire_digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError(
            "Publication endpoint redirected; configure the canonical HTTPS origin"
        )


LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "lixiangqi.localhost"}


class PublicationApiError(ValueError):
    def __init__(self, status, detail):
        self.status = status
        self.detail = detail
        super().__init__(f"Publication API {status}: {detail}")


class Publisher:
    def __init__(self, origin, token=None):
        url = urlsplit(origin)
        if (
            (
                url.scheme != "https"
                and not (url.scheme == "http" and url.hostname in LOCAL_HOSTS)
            )
            or not url.netloc
            or url.username
            or url.password
            or url.query
            or url.fragment
            or url.path not in ("", "/")
        ):
            raise ValueError("Publication requires HTTPS or a loopback HTTP origin")
        self.origin = origin.rstrip("/")
        self.local = url.hostname in LOCAL_HOSTS
        if self.local:
            from tools.environment_data.preview_account import TOKEN

            self.token = token or TOKEN
        else:
            self.token = token or os.environ.get("LIXIANGQI_PUZZLE_TOKEN")
        if not self.token:
            raise ValueError(
                "Set LIXIANGQI_PUZZLE_TOKEN to a puzzle:publish token for a PuzzleCurator account"
            )

    def request(self, path, body=None):
        request = Request(
            self.origin + "/api/puzzle/publication" + path,
            data=_json(body).encode("utf-8") if body is not None else None,
            headers={
                "Authorization": "Bearer " + self.token,
                "Content-Type": "application/json",
            },
        )
        try:
            handlers = [NoRedirect, ProxyHandler({})] if self.local else [NoRedirect]
            with build_opener(*handlers).open(request, timeout=45) as response:
                return json.load(response)
        except HTTPError as error:
            # Preserve the HTTP status even when the server closes the error body.
            try:
                if error.code == 403:
                    detail = "Publishing requires both the puzzle:publish token scope and the PuzzleCurator role on the account at this destination."
                elif error.code == 401:
                    detail = "The token is invalid or expired at this destination. Use a token created on this site."
                else:
                    try:
                        detail = error.read(8192).decode("utf-8", errors="replace")
                    except OSError:
                        detail = "Server closed the error response before its body could be read."
            finally:
                error.close()
            raise PublicationApiError(error.code, detail) from None

    def inventory(self, ids=None, *, retry_timeout=120):
        # A visible receipt can precede lock release, and another publisher (or
        # selection refresh) can interrupt any page. Never expose a partial or
        # mixed-version snapshot to reconciliation, including on a retry.
        deadline = time.monotonic() + retry_timeout
        while True:
            try:
                rows = list(self._inventory_snapshot(ids))
            except PublicationApiError as error:
                try:
                    message = json.loads(error.detail).get("error")
                except (ValueError, AttributeError):
                    raise error
                if error.status != 409 or message not in (
                    "Publication in progress; retry inventory after completion",
                    "Publication changed during inventory read; retry",
                ):
                    raise
            else:
                yield from rows
                return
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ValueError(
                    "Server inventory remained busy or changed during reconciliation; "
                    "retry publication to resume the saved operation"
                )
            time.sleep(min(2, remaining))

    def _inventory_snapshot(self, ids):
        after = ""
        version = None
        while True:
            page = self.request(
                "/inventory?ids=" + quote(",".join(ids))
                if ids
                else "/inventory?after=" + quote(after)
            )
            if version is not None and page["version"] != version:
                raise PublicationApiError(
                    409,
                    json.dumps(
                        {"error": "Publication changed during inventory read; retry"}
                    ),
                )
            version = page["version"]
            yield from page["puzzles"]
            following = page.get("next")
            if following is None:
                break
            if following <= after:
                raise ValueError("Non-advancing inventory cursor")
            after = following


def reconcile(catalog: PuzzleCatalog, rows):
    """Production owns publication membership; never replace a newer local draft."""
    catalog.db.execute(
        "CREATE TABLE IF NOT EXISTS catalog_live(id TEXT PRIMARY KEY, document TEXT NOT NULL, digest TEXT NOT NULL, revision TEXT)"
    )
    with catalog.db:
        for row in rows:
            p = validate_puzzle(row["puzzle"])
            if (
                wire_digest({**p, "retirementReason": p.get("retirementReason")})
                != row["digest"]
            ):
                raise ValueError("Server inventory digest mismatch")
            prior = catalog.db.execute(
                "SELECT document FROM catalog_live WHERE id=?", (p["_id"],)
            ).fetchone()
            local = catalog.db.execute(
                "SELECT document FROM catalog_puzzles WHERE id=?", (p["_id"],)
            ).fetchone()
            if prior and local and json.loads(prior[0]) == json.loads(local[0]):
                catalog.db.execute(
                    "UPDATE catalog_puzzles SET document=? WHERE id=?",
                    (_json(p), p["_id"]),
                )
            elif local and "playback" in p:
                draft = json.loads(local[0])
                if "playback" not in draft and identity(draft) == identity(p):
                    # Adopt additive server schema metadata without overwriting
                    # local moderation, categories, or a different solve.
                    draft["playback"] = p["playback"]
                    catalog.db.execute(
                        "UPDATE catalog_puzzles SET document=? WHERE id=?",
                        (_json(draft), p["_id"]),
                    )
            catalog.db.execute(
                "INSERT INTO catalog_live VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document,digest=excluded.digest,revision=excluded.revision",
                (p["_id"], _json(p), row["digest"], row["revision"]),
            )
            catalog.db.execute(
                "INSERT OR IGNORE INTO catalog_puzzles VALUES(?,?,?)",
                (
                    p["_id"],
                    _json(p),
                    _json({"status": "inherited", "revision": row["revision"]}),
                ),
            )
        baseline = [
            json.loads(r[0])
            for r in catalog.db.execute("SELECT document FROM catalog_live ORDER BY id")
        ]
        catalog._set_meta("baseline", baseline)
        catalog._set_meta("baselineDigest", wire_digest(baseline))
        catalog._set_meta("deployedReleaseId", None)
        catalog._set_meta("snapshotId", "live-" + wire_digest(baseline))


def content_provenance(evidence):
    """Keep full verification locally; transmit its identity and content digest."""
    if not isinstance(evidence, dict) or not evidence:
        raise ValueError("Missing retained content provenance")
    summary = {
        k: evidence[k]
        for k in (
            "status",
            "assessmentId",
            "candidateKey",
            "verificationSignature",
            "discoveryRevision",
        )
        if k in evidence
    }
    summary["evidenceDigest"] = wire_digest(evidence)
    if len(canonical(summary).encode("utf-16-le")) // 2 > 8192:
        raise ValueError("Content provenance summary exceeds 8 KB")
    return summary


def publication_document(puzzle, previous):
    from .publication import officially_categorized
    from .remove_phase_tags import OBSOLETE_TAGS

    puzzle = {
        **puzzle,
        "retirementReason": puzzle.get("retirementReason"),
        "themes": [
            t for t in puzzle["themes"] if t.strip().lower() not in OBSOLETE_TAGS
        ],
    }
    if not puzzle["retired"] and not officially_categorized(puzzle):
        if previous is None or previous["retired"]:
            return None
        return {
            **previous,
            "themes": puzzle["themes"],
            "retired": True,
            "retirementReason": "No supported basic kill pattern",
        }
    return puzzle


def pending_changes(catalog: PuzzleCatalog, *, progress=None):
    baseline = {r["_id"]: r for r in catalog._meta("baseline") or []}
    rows = {
        r[0]: r
        for r in catalog.db.execute("SELECT id,digest,revision FROM catalog_live")
    }
    changes = []
    total = catalog.db.execute("SELECT count(*) FROM catalog_puzzles").fetchone()[0]
    for index, row in enumerate(
        catalog.db.execute("SELECT id,document FROM catalog_puzzles ORDER BY id"), 1
    ):
        if progress and (index - 1) % 250 == 0:
            progress(index - 1, total)
        p = json.loads(row[1])
        p = {**p, "retirementReason": p.get("retirementReason")}
        old = baseline.get(p["_id"])
        if old is not None:
            old = {**old, "retirementReason": old.get("retirementReason")}
        p = publication_document(p, old)
        if p is None:
            continue
        if p == old or (old is None and p["retired"]):
            continue
        previous = rows.get(p["_id"])
        changes.append(
            {
                "puzzle": p,
                "expectedDigest": previous[1] if previous else None,
                "expectedRevision": previous[2] if previous else None,
                "provenance": content_provenance(
                    json.loads(
                        catalog.db.execute(
                            "SELECT evidence FROM catalog_puzzles WHERE id=?", (row[0],)
                        ).fetchone()[0]
                    )
                ),
            }
        )
    if progress:
        progress(total, total)
    return changes


def atomic_json(path, document):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid4().hex + ".tmp")
    with temporary.open("x", encoding="utf-8") as stream:
        stream.write(_json(document) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def publish(settings, request_path, report=print, *, progress=None):
    publisher = Publisher(settings.publication_origin)
    request = json.loads(request_path.read_text(encoding="utf-8"))
    if wire_digest({"changes": request["changes"]}) != request["digest"]:
        raise ValueError("Local operation digest mismatch")
    # Same request file and identifier are used after lost responses or restarts.
    with publication_stage(
        report, f"Submitting batch of {len(request['changes']):,} changes"
    ):
        receipt = publisher.request("", request)
    while receipt["status"] not in ("visible", "conflict"):
        report(
            f"Server status: {receipt['status']}; {receipt.get('applied', 0):,} / "
            f"{len(request['changes']):,} changes applied; waiting for visibility.",
            flush=True,
        )
        if progress:
            progress(min(len(request["changes"]), receipt.get("applied", 0)))
        atomic_json(request_path.with_suffix(".receipt.json"), receipt)
        if receipt.get("error"):
            raise ValueError(
                "Publication needs recovery; retry this operation: " + receipt["error"]
            )
        time.sleep(2)
        with publication_stage(report, "Checking server publication status"):
            receipt = publisher.request("/" + quote(request["operationId"]))
    atomic_json(request_path.with_suffix(".receipt.json"), receipt)
    if receipt["status"] == "conflict":
        raise ValueError(
            receipt.get("error")
            or "Content conflict; reconcile and review a new operation"
        )
    if receipt["digest"] != request["digest"] or receipt["request"] != request:
        raise ValueError("Receipt does not match the submitted operation")
    with publication_stage(
        report, "Verifying published batch against server inventory"
    ):
        rows = list(
            publisher.inventory([c["puzzle"]["_id"] for c in request["changes"]])
        )
    if {r["puzzle"]["_id"] for r in rows} != {
        c["puzzle"]["_id"] for c in request["changes"]
    }:
        raise ValueError("Published membership missing from server inventory")
    with (
        publication_stage(report, "Saving verified batch to local inventory"),
        PuzzleCatalog(settings.catalog_db) as catalog,
        catalog.db,
    ):
        catalog.db.execute("BEGIN IMMEDIATE")
        # A completed request is no longer a draft. Adopt current server content
        # if the operator has not edited the submitted document since uploading.
        submitted = {c["puzzle"]["_id"]: c["puzzle"] for c in request["changes"]}
        baseline = {p["_id"]: p for p in catalog._meta("baseline") or []}
        for row in rows:
            pid = row["puzzle"]["_id"]
            local = catalog.db.execute(
                "SELECT document FROM catalog_puzzles WHERE id=?", (pid,)
            ).fetchone()
            if local and wire_digest(
                publication_document(json.loads(local[0]), baseline.get(pid))
            ) == wire_digest(submitted[pid]):
                catalog.db.execute(
                    "UPDATE catalog_puzzles SET document=? WHERE id=?",
                    (_json(row["puzzle"]), pid),
                )
        reconcile(catalog, rows)
    if progress:
        progress(len(request["changes"]))
    report(f"Batch verified: {len(request['changes']):,} changes visible.", flush=True)


def sync(settings, state_dir, report=print, *, admit=True, source_origin=None):
    """Resume the durable outbox, then publish current local changes in bounded batches."""
    from .desktop.repository import ContentRepository
    from .publication import validate_release_categories

    state_dir = Path(state_dir)
    outbox = state_dir / "publication-outbox.json"
    last_progress = None

    def emit_progress(completed, total):
        nonlocal last_progress
        if last_progress == (completed, total):
            return
        last_progress = (completed, total)
        report(
            "PUBLICATION_PROGRESS "
            + json.dumps(
                {
                    "completed": completed,
                    "total": total,
                    "destination": (
                        "Local Preview"
                        if urlsplit(settings.publication_origin).hostname in LOCAL_HOSTS
                        else "Live Site"
                    ),
                }
            ),
            flush=True,
        )

    # Old requests must be checked by durable ID before replacing their payloads.
    # A missing receipt proves the server never accepted that operation.
    if outbox.exists():
        report("Checking saved publication outbox for interrupted work…", flush=True)
        legacy = json.loads(outbox.read_text(encoding="utf-8"))
        if legacy.get("schemaVersion") != 2:
            if legacy["origin"] != settings.publication_origin:
                raise ValueError("Unfinished publication belongs to another server")
            atomic_json(
                state_dir
                / "receipts"
                / ("superseded-outbox-" + wire_digest(legacy) + ".json"),
                legacy,
            )
            publisher = Publisher(settings.publication_origin)
            while legacy["requests"]:
                request = legacy["requests"][0]
                try:
                    receipt = publisher.request("/" + quote(request["operationId"]))
                except PublicationApiError as error:
                    if error.status != 404:
                        raise
                    receipt = None
                if receipt and receipt["status"] != "conflict":
                    path = (
                        state_dir
                        / "receipts"
                        / (request["operationId"] + ".operation.json")
                    )
                    atomic_json(path, request)
                    publish(settings, path, report)
                legacy["requests"].pop(0)
                atomic_json(outbox, legacy)
            outbox.unlink()

    def archive_outbox(pending):
        # Retain the exact plan for recovery before retiring stale unsent work.
        atomic_json(
            state_dir
            / "receipts"
            / ("superseded-outbox-" + wire_digest(pending) + ".json"),
            pending,
        )
        outbox.unlink()

    def refresh_inventory():
        with publication_stage(report, "Downloading current server inventory"):
            rows = list(Publisher(settings.publication_origin).inventory())
        with (
            publication_stage(report, "Reconciling current server inventory"),
            PuzzleCatalog(settings.catalog_db) as catalog,
        ):
            reconcile(catalog, rows)
        report(
            f"Refreshed {len(rows):,} published puzzles; local edits retained.",
            flush=True,
        )

    def drain(*, resume=False):
        if not outbox.exists():
            return
        pending = json.loads(outbox.read_text(encoding="utf-8"))
        if pending["origin"] != settings.publication_origin:
            raise ValueError("Unfinished publication belongs to another server")
        completed = pending["completed"]
        total = pending["total"]
        emit_progress(completed, total)
        while pending["requests"]:
            request = pending["requests"][0]
            if resume:
                # Only the head can have reached the server: we persist its removal
                # before submitting the next batch. Never discard an uncertain write.
                with publication_stage(report, "Checking interrupted batch receipt"):
                    try:
                        Publisher(settings.publication_origin).request(
                            "/" + quote(request["operationId"])
                        )
                    except PublicationApiError as error:
                        if error.status != 404:
                            raise
                        archive_outbox(pending)
                        report(
                            "Unsent batches archived; rebuilding from current inventory.",
                            flush=True,
                        )
                        return
            path = state_dir / "receipts" / (request["operationId"] + ".operation.json")
            atomic_json(path, request)
            try:
                publish(
                    settings,
                    path,
                    report,
                    progress=lambda count: emit_progress(completed + count, total),
                )
            except ValueError:
                receipt_path = path.with_suffix(".receipt.json")
                receipt = (
                    json.loads(receipt_path.read_text(encoding="utf-8"))
                    if receipt_path.exists()
                    else {}
                )
                if receipt.get("status") == "conflict":
                    refresh_inventory()
                    archive_outbox(pending)
                    raise ValueError(
                        f"{receipt.get('error') or 'Server content changed'}. "
                        "Current inventory downloaded and stale unsent batches archived; local edits are retained. "
                        "Inspect the library before clicking Publish again to build fresh batches."
                    )
                raise
            completed += len(request["changes"])
            emit_progress(completed, total)
            pending["completed"] = completed
            pending["requests"].pop(0)
            atomic_json(outbox, pending)
            if resume:
                archive_outbox(pending)
                report(
                    "Interrupted batch recovered; rebuilding remaining changes from current inventory.",
                    flush=True,
                )
                return
        outbox.unlink()

    drain(resume=True)
    refresh_inventory()
    repo = ContentRepository(
        Path(settings.catalog_db), Path(settings.mining_db), state_dir
    )
    if admit:
        admit_ready(repo, settings, report)
    with (
        publication_stage(report, "Comparing local content with published inventory"),
        PuzzleCatalog(settings.catalog_db) as catalog,
    ):
        changes = pending_changes(
            catalog,
            progress=lambda done, total: report(
                f"Comparing puzzles: {done:,} / {total:,} checked", flush=True
            ),
        )
    report(f"Preparing upload batches for {len(changes):,} changes…", flush=True)
    validate_release_categories(
        [c["puzzle"] for c in changes if c["expectedDigest"] is None],
    )
    for change in changes:
        provenance = change["provenance"]
        if change["expectedDigest"] is None and (
            provenance.get("status") != "verified"
            or provenance.get("assessmentId") is None
        ):
            raise ValueError(
                f"Puzzle {change['puzzle']['_id']} lacks current verification provenance"
            )
        if not provenance or len(canonical(provenance).encode("utf-16-le")) // 2 > 8192:
            raise ValueError(
                f"Puzzle {change['puzzle']['_id']} has invalid publication provenance"
            )
    requests = []
    batch = []

    def request_for(items):
        checksum = wire_digest({"changes": items})
        return {"operationId": checksum, "digest": checksum, "changes": items}

    # Both identifiers are fixed-width hashes. Count encoded changes once rather
    # than serializing and hashing every growing prefix of each batch.
    envelope_size = len(_json(request_for([])).encode("utf-8"))
    batch_size = envelope_size
    for change in changes:
        change_size = len(_json(change).encode("utf-8"))
        if envelope_size + change_size > 4 * 1024 * 1024:
            raise ValueError(
                "Puzzle exceeds publication request size: " + change["puzzle"]["_id"]
            )
        if batch and (
            len(batch) == 100 or batch_size + 1 + change_size > 4 * 1024 * 1024
        ):
            requests.append(request_for(batch))
            batch = []
            batch_size = envelope_size
        batch_size += change_size + bool(batch)
        batch.append(change)
    if batch:
        requests.append(request_for(batch))
    if requests:
        atomic_json(
            outbox,
            {
                "schemaVersion": 2,
                "origin": settings.publication_origin,
                "requests": requests,
                "total": len(changes),
                "completed": 0,
            },
        )
        report(
            f"Publishing {len(changes):,} changes…",
            flush=True,
        )
        drain()
    from .game_analysis import sync_game_analyses

    sync_game_analyses(
        settings,
        Publisher(settings.publication_origin),
        report,
        source_origin=source_origin,
    )
    report(
        "All eligible local changes and completed game analyses published.", flush=True
    )


def sync_destinations(settings, state_dir, destinations, report=print):
    """Keep preview publication receipts and membership out of the live inventory."""
    from dataclasses import replace
    from .desktop.repository import ContentRepository

    if not destinations or set(destinations) - {"preview", "live"}:
        raise ValueError("Select Local Preview or Live Site")
    state_dir = Path(state_dir)
    failures = []
    for destination in dict.fromkeys(destinations):
        report(f"Publishing to {destination}…", flush=True)
        try:
            if destination == "live":
                sync(settings, state_dir, report)
            else:
                origin = settings.preview_publication_origin
                if urlsplit(origin).hostname not in LOCAL_HOSTS:
                    raise ValueError("Local Preview must use a loopback address")
                publisher = Publisher(origin)
                with publication_stage(report, "Downloading Local Preview inventory"):
                    rows = list(publisher.inventory())
                repo = ContentRepository(
                    Path(settings.catalog_db), Path(settings.mining_db), state_dir
                )
                admit_ready(repo, settings, report)
                preview_dir = (
                    state_dir / "preview-publication" / wire_digest(origin)[:16]
                )
                preview_dir.mkdir(parents=True, exist_ok=True)
                preview_db = preview_dir / "catalog.sqlite3"
                with PuzzleCatalog(settings.catalog_db) as authored:
                    documents = authored.db.execute(
                        "SELECT id,document,evidence FROM catalog_puzzles"
                    ).fetchall()
                with PuzzleCatalog(preview_db) as preview, preview.db:
                    # Preview databases may be reset from a production snapshot.
                    # Refresh only this destination's baseline, never live membership.
                    preview.db.execute(
                        "CREATE TABLE IF NOT EXISTS catalog_live(id TEXT PRIMARY KEY,document TEXT NOT NULL,digest TEXT NOT NULL,revision TEXT)"
                    )
                    preview.db.execute("DELETE FROM catalog_live")
                    preview.db.execute("DELETE FROM catalog_puzzles")
                    reconcile(preview, rows)
                    preview.db.executemany(
                        "INSERT INTO catalog_puzzles VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document,evidence=excluded.evidence",
                        documents,
                    )
                sync(
                    replace(
                        settings, catalog_db=str(preview_db), publication_origin=origin
                    ),
                    preview_dir,
                    report,
                    admit=False,
                    source_origin=settings.publication_origin,
                )
            report(f"{destination}: publication complete", flush=True)
        except (OSError, ValueError, sqlite3.Error) as exc:
            failures.append(f"{destination}: {exc}")
            report(f"{destination}: {exc}", flush=True)
    if failures:
        raise ValueError("\n".join(failures))
