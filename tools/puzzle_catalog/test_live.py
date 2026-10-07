import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from tools.puzzle_catalog.catalog import PuzzleCatalog, _json
from tools.puzzle_catalog.live import (
    Publisher,
    publication_stage,
    admit_ready,
    PublicationApiError,
    content_provenance,
    atomic_json,
    pending_changes,
    sync,
    sync_destinations,
    canonical,
    publish,
    reconcile,
    wire_digest,
)
from tools.puzzle_catalog.test_catalog import puzzle
from tools.environment_data.preview_account import TOKEN as PREVIEW_TOKEN


class LivePublicationTests(unittest.TestCase):
    def test_inventory_waits_for_publication_lock_release(self):
        client = Publisher("http://localhost:9663", "test")
        busy = PublicationApiError(
            409,
            json.dumps(
                {"error": "Publication in progress; retry inventory after completion"}
            ),
        )
        with patch.object(
            client,
            "request",
            side_effect=[
                busy,
                {"version": "published", "puzzles": [{"id": "Live1"}], "next": None},
            ],
        ) as request, patch("tools.puzzle_catalog.live.time.sleep") as sleep:
            self.assertEqual(list(client.inventory(["Live1"])), [{"id": "Live1"}])
        self.assertEqual(request.call_args_list[0], request.call_args_list[1])
        sleep.assert_called_once_with(2)

    def test_inventory_restarts_entire_snapshot_on_concurrent_publication(self):
        for interruption in (
            {"version": "new", "puzzles": [{"id": "mixed"}], "next": None},
            PublicationApiError(
                409,
                json.dumps(
                    {"error": "Publication changed during inventory read; retry"}
                ),
            ),
        ):
            with self.subTest(interruption=interruption):
                client = Publisher("http://localhost:9663", "test")
                with patch.object(
                    client,
                    "request",
                    side_effect=[
                        {
                            "version": "old",
                            "puzzles": [{"id": "stale"}],
                            "next": "Live1",
                        },
                        interruption,
                        {"version": "new", "puzzles": [{"id": "fresh"}], "next": None},
                    ],
                ) as request, patch("tools.puzzle_catalog.live.time.sleep"):
                    self.assertEqual(list(client.inventory()), [{"id": "fresh"}])
                self.assertEqual(
                    [call.args[0] for call in request.call_args_list],
                    [
                        "/inventory?after=",
                        "/inventory?after=Live1",
                        "/inventory?after=",
                    ],
                )

    def test_inventory_busy_timeout_exposes_no_partial_snapshot(self):
        client = Publisher("http://localhost:9663", "test")
        with patch.object(
            client,
            "request",
            side_effect=[
                {"version": "old", "puzzles": [{"id": "stale"}], "next": "Live1"},
                PublicationApiError(
                    409,
                    json.dumps(
                        {
                            "error": "Publication in progress; retry inventory after completion"
                        }
                    ),
                ),
            ],
        ), patch("tools.puzzle_catalog.live.time.sleep") as sleep:
            with self.assertRaisesRegex(ValueError, "resume the saved operation"):
                next(client.inventory(retry_timeout=0))
        sleep.assert_not_called()

    def test_inventory_does_not_retry_permanent_errors(self):
        for error in (
            PublicationApiError(401, "Invalid token"),
            PublicationApiError(409, json.dumps({"error": "Invalid inventory IDs"})),
            PublicationApiError(500, "Internal server error"),
        ):
            with self.subTest(error=error):
                client = Publisher("http://localhost:9663", "test")
                with patch.object(
                    client, "request", side_effect=error
                ) as request, patch("tools.puzzle_catalog.live.time.sleep") as sleep:
                    with self.assertRaises(PublicationApiError) as raised:
                        list(client.inventory())
                self.assertIs(raised.exception, error)
                request.assert_called_once()
                sleep.assert_not_called()

    def test_blocking_stage_reports_wait_and_stops_on_failure(self):
        heartbeat = threading.Event()
        messages = []
        workers = []

        def report(message, **kwargs):
            messages.append(message)
            if message.startswith("Still waiting:"):
                workers.append(threading.current_thread())
                heartbeat.set()

        with self.assertRaisesRegex(ValueError, "failed"):
            with publication_stage(report, "Reading inventory", interval=0.01):
                self.assertTrue(heartbeat.wait(2))
                raise ValueError("failed")
        self.assertTrue(messages[0].startswith("Reading inventory"))
        self.assertIn("elapsed", messages[-1])
        # The reporting worker has joined before the context propagates failure.
        self.assertTrue(workers)
        self.assertTrue(all(not worker.is_alive() for worker in workers))

    def test_preparation_reports_admission_without_claiming_upload(self):
        from unittest.mock import Mock

        repo = Mock()
        repo.admit_ready.side_effect = lambda source, progress: progress(25, 100)
        messages = []
        admit_ready(
            repo,
            SimpleNamespace(source_catalog="sources.sqlite3"),
            lambda message, **kwargs: messages.append(message),
        )
        self.assertIn(
            "Preparing puzzles: 25 / 100 admitted locally (not uploaded yet)", messages
        )
        self.assertEqual(messages[-1], "Local preparation complete.")

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.catalog = PuzzleCatalog(self.root / "catalog.sqlite3")
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.catalog.close)
        self.puzzle = {**puzzle(), "retirementReason": None}
        reconcile(self.catalog, [])

    def test_sync_batches_and_resumes_durable_outbox_before_new_changes(self):
        settings = SimpleNamespace(
            catalog_db=str(self.root / "catalog.sqlite3"),
            mining_db=str(self.root / "mining.sqlite3"),
            source_catalog="unused",
            publication_origin="https://example.org",
            include_uncategorized=False,
        )
        changes = []
        for index in range(101):
            p = {
                **self.puzzle,
                "_id": f"A{index:04}",
                "themes": ["centroidPawnMate", "mateIn1"],
            }
            changes.append(
                {
                    "puzzle": p,
                    "expectedDigest": None,
                    "expectedRevision": None,
                    "provenance": {"status": "verified", "assessmentId": 1},
                }
            )
        sent = []
        events = []

        def report(message, **kwargs):
            if message.startswith("PUBLICATION_PROGRESS "):
                events.append(json.loads(message.removeprefix("PUBLICATION_PROGRESS ")))

        failed = False

        def upload(settings, path, report, *, progress=None):
            nonlocal failed
            request = json.loads(path.read_text(encoding="utf-8"))
            sent.append(request)
            if not failed:
                failed = True
                raise ConnectionError("lost response")

        with patch(
            "tools.puzzle_catalog.desktop.repository.ContentRepository.admit_ready"
        ), patch(
            "tools.puzzle_catalog.live.pending_changes",
            side_effect=[changes, changes[100:]],
        ), patch(
            "tools.puzzle_catalog.live.publish", side_effect=upload
        ), patch(
            "tools.puzzle_catalog.live.Publisher"
        ) as publisher:
            publisher.return_value.inventory.return_value = []
            publisher.return_value.request.return_value = {"status": "visible"}
            with self.assertRaises(ConnectionError):
                sync(settings, self.root, report=report)
            self.assertTrue((self.root / "publication-outbox.json").exists())
            sync(settings, self.root, report=report)
        self.assertIn(
            {"completed": 100, "total": 101, "destination": "Live Site"}, events
        )
        self.assertEqual(events[-1]["completed"], 1)
        self.assertEqual(events[-1]["total"], 1)
        self.assertEqual(sent[0], sent[1])
        self.assertEqual([len(r["changes"]) for r in sent], [100, 100, 1])
        self.assertFalse((self.root / "publication-outbox.json").exists())

    def test_large_verification_evidence_is_retained_but_upload_is_bounded(self):
        evidence = {
            "status": "verified",
            "assessmentId": 42,
            "branches": ["long proof" * 10000],
        }
        summary = content_provenance(evidence)
        self.assertEqual(summary["evidenceDigest"], wire_digest(evidence))
        self.assertEqual(summary["assessmentId"], 42)
        self.assertNotIn("branches", summary)
        self.assertLess(len(canonical(summary)), 8192)
        self.assertEqual(len(evidence["branches"][0]), 100000)

    def test_batch_limit_counts_utf8_bytes_and_rejects_oversized_change(self):
        settings = SimpleNamespace(
            catalog_db=str(self.root / "catalog.sqlite3"),
            mining_db=str(self.root / "missing.sqlite3"),
            source_catalog="unused",
            publication_origin="https://example.org",
        )
        changes = [
            {
                "puzzle": {
                    **self.puzzle,
                    "_id": f"A{i:04}",
                    "sourceSnapshot": {"name": "汉" * 750000},
                },
                "expectedDigest": "old",
                "expectedRevision": "old",
                "provenance": {"status": "verified", "assessmentId": 1},
            }
            for i in range(2)
        ]
        with patch("tools.puzzle_catalog.live.Publisher"), patch(
            "tools.puzzle_catalog.live.pending_changes", return_value=changes
        ), patch("tools.puzzle_catalog.live.publish") as upload:
            sync(settings, self.root, report=lambda *a, **kw: None, admit=False)
            self.assertEqual(upload.call_count, 2)
            for call in upload.call_args_list:
                request = json.loads(call.args[1].read_text(encoding="utf-8"))
                self.assertLessEqual(
                    len(_json(request).encode("utf-8")), 4 * 1024 * 1024
                )
                self.assertEqual(
                    request["digest"], wire_digest({"changes": request["changes"]})
                )
            changes[0]["puzzle"]["sourceSnapshot"]["name"] *= 2
            upload.reset_mock()
            with self.assertRaisesRegex(ValueError, "exceeds publication request size"):
                sync(settings, self.root, report=lambda *a, **kw: None, admit=False)
            upload.assert_not_called()

    def test_unchanged_content_does_not_decode_or_hash_retained_evidence(self):
        reconcile(
            self.catalog,
            [
                {
                    "puzzle": self.puzzle,
                    "digest": wire_digest(self.puzzle),
                    "revision": "one",
                }
            ],
        )
        with patch("tools.puzzle_catalog.live.content_provenance") as provenance:
            progress = []
            self.assertEqual(
                pending_changes(
                    self.catalog, progress=lambda n, t: progress.append((n, t))
                ),
                [],
            )
            provenance.assert_not_called()
        self.assertEqual(progress, [(0, 1), (1, 1)])

    def test_unsent_outbox_is_archived_and_rebuilt_with_fresh_preconditions(self):
        settings = SimpleNamespace(
            catalog_db=str(self.root / "catalog.sqlite3"),
            mining_db=str(self.root / "missing.sqlite3"),
            source_catalog="unused",
            publication_origin="https://example.org",
        )
        reconcile(
            self.catalog,
            [
                {
                    "puzzle": self.puzzle,
                    "digest": wire_digest(self.puzzle),
                    "revision": "old",
                }
            ],
        )
        self.catalog.retire(self.puzzle["_id"], "local withdrawal")
        changes = pending_changes(self.catalog)
        request = {
            "operationId": "not-accepted",
            "digest": wire_digest({"changes": changes}),
            "changes": changes,
        }
        outbox = {
            "schemaVersion": 2,
            "origin": settings.publication_origin,
            "requests": [request, request],
            "completed": 0,
            "total": 2,
        }
        atomic_json(self.root / "publication-outbox.json", outbox)
        latest = {**self.puzzle, "themes": ["mateIn2", "whiteFacedGeneral"]}
        with patch("tools.puzzle_catalog.live.Publisher") as factory, patch(
            "tools.puzzle_catalog.live.publish"
        ) as upload:
            factory.return_value.request.side_effect = PublicationApiError(
                404, "missing"
            )
            factory.return_value.inventory.return_value = [
                {"puzzle": latest, "digest": wire_digest(latest), "revision": "new"}
            ]
            sync(settings, self.root, report=lambda *a, **kw: None, admit=False)
        upload.assert_called_once()
        submitted = json.loads(upload.call_args.args[1].read_text(encoding="utf-8"))
        self.assertEqual(submitted["changes"][0]["expectedRevision"], "new")
        self.assertTrue(submitted["changes"][0]["puzzle"]["retired"])
        [archive] = (self.root / "receipts").glob("superseded-outbox-*.json")
        self.assertEqual(json.loads(archive.read_text(encoding="utf-8")), outbox)

    def test_uncertain_receipt_keeps_outbox_and_never_uploads(self):
        settings = SimpleNamespace(publication_origin="https://example.org")
        outbox = {
            "schemaVersion": 2,
            "origin": settings.publication_origin,
            "requests": [{"operationId": "uncertain"}],
            "completed": 0,
            "total": 100,
        }
        path = self.root / "publication-outbox.json"
        atomic_json(path, outbox)
        with patch("tools.puzzle_catalog.live.Publisher") as factory, patch(
            "tools.puzzle_catalog.live.publish"
        ) as upload:
            factory.return_value.request.side_effect = OSError("connection lost")
            with self.assertRaisesRegex(OSError, "connection lost"):
                sync(settings, self.root, report=lambda *a, **kw: None)
        upload.assert_not_called()
        self.assertEqual(json.loads(path.read_text()), outbox)

    def test_mate_depth_only_is_skipped_or_retired(self):
        p = {**self.puzzle, "themes": ["mateIn4"]}
        self.catalog.admit(p, {"status": "verified", "assessmentId": 1})
        self.assertEqual(pending_changes(self.catalog), [])
        reconcile(
            self.catalog, [{"puzzle": p, "digest": wire_digest(p), "revision": "old"}]
        )
        changes = pending_changes(self.catalog)
        self.assertEqual(len(changes), 1)
        self.assertTrue(changes[0]["puzzle"]["retired"])
        self.assertEqual(changes[0]["puzzle"]["line"], p["line"])
        self.assertEqual(changes[0]["expectedRevision"], "old")

    def test_piece_type_tags_replace_supersets_on_the_existing_live_id(self):
        from tools.xiangqi_data.puzzle_mining.patterns import (
            PIECE_TYPE_MATING_METHOD_THEMES,
        )

        old = {
            **self.puzzle,
            "themes": [
                theme for theme in PIECE_TYPE_MATING_METHOD_THEMES if "chariot" in theme
            ]
            + ["doubleChariotsMate", "mate", "mateIn8"],
        }
        reconcile(
            self.catalog,
            [{"puzzle": old, "digest": wire_digest(old), "revision": "before-fix"}],
        )
        final = {
            **old,
            "themes": ["chariotMatingMethods", "doubleChariotsMate", "mate", "mateIn8"],
        }
        self.catalog.admit(final, {"status": "verified", "assessmentId": 1})
        [change] = pending_changes(self.catalog)
        self.assertEqual(change["expectedRevision"], "before-fix")
        self.assertEqual(change["expectedDigest"], wire_digest(old))
        self.assertEqual(change["puzzle"], final)
        self.assertEqual(len(self.catalog.puzzles()), 1)
        reconcile(
            self.catalog,
            [{"puzzle": final, "digest": wire_digest(final), "revision": "after-fix"}],
        )
        self.assertEqual(pending_changes(self.catalog), [])

    def test_missing_verification_blocks_entire_sync_before_upload(self):
        settings = SimpleNamespace(
            catalog_db=str(self.root / "catalog.sqlite3"),
            mining_db=str(self.root / "mining.sqlite3"),
            source_catalog="unused",
            publication_origin="https://example.org",
        )
        changes = [
            {
                "puzzle": self.puzzle,
                "expectedDigest": None,
                "expectedRevision": None,
                "provenance": {"status": "verified"},
            }
        ]
        with patch(
            "tools.puzzle_catalog.live.pending_changes", return_value=changes
        ), patch("tools.puzzle_catalog.live.publish") as upload, patch(
            "tools.puzzle_catalog.live.Publisher"
        ):
            with self.assertRaisesRegex(
                ValueError, "lacks current verification provenance"
            ):
                sync(settings, self.root, report=lambda *a, **kw: None, admit=False)
        upload.assert_not_called()
        self.assertFalse((self.root / "publication-outbox.json").exists())

    def test_old_outbox_checks_server_before_replacing_unaccepted_requests(self):
        settings = SimpleNamespace(
            catalog_db=str(self.root / "catalog.sqlite3"),
            mining_db=str(self.root / "mining.sqlite3"),
            source_catalog="unused",
            publication_origin="https://example.org",
        )
        requests = [
            {"operationId": "accepted", "digest": "original", "changes": []},
            {"operationId": "rejected", "digest": "original2", "changes": []},
        ]
        atomic_json(
            self.root / "publication-outbox.json",
            {"origin": settings.publication_origin, "requests": requests},
        )
        with patch("tools.puzzle_catalog.live.Publisher") as factory, patch(
            "tools.puzzle_catalog.live.publish"
        ) as upload:
            factory.return_value.request.side_effect = [
                {"status": "visible"},
                PublicationApiError(404, "missing"),
            ]
            sync(settings, self.root, report=lambda *a, **kw: None, admit=False)
        upload.assert_called_once()
        saved = json.loads(upload.call_args.args[1].read_text())
        self.assertEqual(saved, requests[0])
        self.assertFalse((self.root / "publication-outbox.json").exists())
        self.assertEqual(
            len(list((self.root / "receipts").glob("superseded-outbox-*.json"))), 1
        )

    def test_library_actions_preserve_identity_and_use_live_pools(self):
        from tools.puzzle_catalog.desktop.repository import ContentRepository

        reconcile(
            self.catalog,
            [
                {
                    "puzzle": self.puzzle,
                    "digest": wire_digest(self.puzzle),
                    "revision": "one",
                }
            ],
        )
        repo = ContentRepository(
            self.root / "catalog.sqlite3", self.root / "missing.sqlite3", self.root
        )
        pid = self.puzzle["_id"]
        self.assertTrue(repo.moderate([pid], "retire")[0]["ok"])
        row = repo.page(library=True)["rows"][0]
        self.assertEqual((row["status"], row["changes"]), ("published", "Withdraw"))
        retired = self.catalog.puzzles()[0]
        reconcile(
            self.catalog,
            [{"puzzle": retired, "digest": wire_digest(retired), "revision": "two"}],
        )
        self.assertTrue(repo.moderate([pid], "restore")[0]["ok"])
        row = repo.page(library=True)["rows"][0]
        self.assertEqual((row["status"], row["changes"]), ("retired", "Restore"))
        self.assertTrue(
            repo.moderate([pid], "tags", '["centroidPawnMate", "mateIn2"]')[0]["ok"]
        )
        restored = self.catalog.puzzles()[0]
        for field in ("_id", "fen", "line", "gameId", "gameSource", "sourceSnapshot"):
            self.assertEqual(restored[field], self.puzzle[field])
        self.assertEqual(restored["themes"], ["centroidPawnMate", "mateIn2"])
        self.assertFalse(repo.moderate([pid], "reject")[0]["ok"])

    def test_sync_conflict_refreshes_baseline_and_stops_for_operator(self):
        settings = SimpleNamespace(
            catalog_db=str(self.root / "catalog.sqlite3"),
            mining_db=str(self.root / "mining.sqlite3"),
            source_catalog="unused",
            publication_origin="https://example.org",
        )
        reconcile(
            self.catalog,
            [
                {
                    "puzzle": self.puzzle,
                    "digest": wire_digest(self.puzzle),
                    "revision": "one",
                }
            ],
        )
        self.catalog.retire(self.puzzle["_id"], "local withdrawal")
        latest = {**self.puzzle, "themes": ["mateIn2"]}

        def conflict(settings, path, report, *, progress=None):
            atomic_json(path.with_suffix(".receipt.json"), {"status": "conflict"})
            raise ValueError("conflict")

        with patch(
            "tools.puzzle_catalog.desktop.repository.ContentRepository.admit_ready"
        ), patch(
            "tools.puzzle_catalog.live.publish", side_effect=conflict
        ) as upload, patch(
            "tools.puzzle_catalog.live.Publisher"
        ) as publisher:
            publisher.return_value.inventory.return_value = [
                {"puzzle": latest, "digest": wire_digest(latest), "revision": "two"}
            ]
            with self.assertRaisesRegex(ValueError, "Inspect the library"):
                sync(settings, self.root, report=lambda *a, **kw: None)
            upload.assert_called_once()
        self.assertEqual(self.catalog._meta("baseline"), [latest])
        self.assertTrue(self.catalog.puzzles()[0]["retired"])
        self.assertEqual(pending_changes(self.catalog)[0]["expectedRevision"], "two")
        self.assertFalse((self.root / "publication-outbox.json").exists())
        self.assertEqual(
            len(list((self.root / "receipts").glob("superseded-outbox-*.json"))), 1
        )

    def test_loopback_http_api_receives_authenticated_request(self):
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        from threading import Thread

        received = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                received.append((self.path, self.headers.get("Authorization")))
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"version":"local","puzzles":[],"next":null}')

            def log_message(self, *args):
                pass

        import socket

        class LocalServer(ThreadingHTTPServer):
            address_family = socket.AF_INET6

        server = LocalServer(("::1", 0), Handler)
        thread = Thread(target=server.serve_forever)
        thread.start()
        try:
            client = Publisher(f"http://[::1]:{server.server_port}", "local-test-token")
            self.assertEqual(list(client.inventory()), [])
            self.assertEqual(
                received,
                [
                    (
                        "/api/puzzle/publication/inventory?after=",
                        "Bearer local-test-token",
                    )
                ],
            )
        finally:
            server.shutdown()
            thread.join()
            server.server_close()

    def test_automatic_preview_token_is_never_used_for_live(self):
        import os

        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(Publisher("http://localhost:9663").token, PREVIEW_TOKEN)
            with self.assertRaisesRegex(ValueError, "LIXIANGQI_PUZZLE_TOKEN"):
                Publisher("https://lixiangqi.com")

    def test_preview_token_and_loopback_http_are_separate_from_live(self):
        import os

        with patch.dict(
            os.environ,
            {
                "LIXIANGQI_PREVIEW_PUZZLE_TOKEN": "preview-secret",
                "LIXIANGQI_PUZZLE_TOKEN": "live-secret",
            },
        ):
            self.assertEqual(
                Publisher("http://lixiangqi.localhost:9663").token, PREVIEW_TOKEN
            )
            self.assertEqual(Publisher("http://127.0.0.1:9663").token, PREVIEW_TOKEN)
            self.assertEqual(Publisher("https://lixiangqi.com").token, "live-secret")
            for url in [
                "http://example.org",
                "http://localhost.example.org",
                "http://192.168.1.1",
                "http://localhost:9663/path",
            ]:
                with self.assertRaises(ValueError):
                    Publisher(url)

    def test_preview_uses_separate_catalog_without_changing_live_baseline(self):
        from tools.puzzle_catalog.desktop.settings import Settings

        settings = Settings(
            catalog_db=str(self.root / "catalog.sqlite3"),
            mining_db=str(self.root / "mining.sqlite3"),
        )
        reconcile(
            self.catalog,
            [
                {
                    "puzzle": self.puzzle,
                    "digest": wire_digest(self.puzzle),
                    "revision": "live-one",
                }
            ],
        )
        self.catalog.retire(self.puzzle["_id"], "test withdrawal")
        before = self.catalog._meta("baseline")
        with patch(
            "tools.puzzle_catalog.desktop.repository.ContentRepository.admit_ready"
        ), patch("tools.puzzle_catalog.live.Publisher") as publisher, patch(
            "tools.puzzle_catalog.live.sync"
        ) as send:
            publisher.return_value.inventory.return_value = [
                {
                    "puzzle": self.puzzle,
                    "digest": wire_digest(self.puzzle),
                    "revision": "preview-one",
                }
            ]
            sync_destinations(
                settings, self.root, ["preview", "live"], report=lambda *a, **kw: None
            )
            preview_settings, preview_dir = send.call_args_list[0].args[:2]
            self.assertNotEqual(preview_settings.catalog_db, settings.catalog_db)
            self.assertEqual(
                preview_settings.publication_origin, settings.preview_publication_origin
            )
            self.assertEqual(send.call_args_list[1].args[:2], (settings, self.root))
            with PuzzleCatalog(preview_settings.catalog_db) as preview:
                changes = pending_changes(preview)
                self.assertEqual(changes[0]["expectedRevision"], "preview-one")
                self.assertTrue(changes[0]["puzzle"]["retired"])
        self.assertEqual(self.catalog._meta("baseline"), before)

    def test_preview_failure_does_not_skip_selected_live_destination(self):
        from tools.puzzle_catalog.desktop.settings import Settings

        settings = Settings(catalog_db=str(self.root / "catalog.sqlite3"))
        with patch(
            "tools.puzzle_catalog.live.Publisher",
            side_effect=OSError("preview offline"),
        ), patch("tools.puzzle_catalog.live.sync") as send:
            with self.assertRaisesRegex(ValueError, "preview offline"):
                sync_destinations(
                    settings,
                    self.root,
                    ["preview", "live"],
                    report=lambda *a, **kw: None,
                )
            send.assert_called_once()
            self.assertEqual(send.call_args.args[:2], (settings, self.root))

    def test_http_error_status_survives_connection_reset_in_error_body(self):
        from urllib.error import HTTPError
        from unittest.mock import Mock

        for status, message in [
            (403, "PuzzleCurator"),
            (401, "invalid or expired"),
            (500, "Server closed"),
        ]:
            body = Mock()
            body.read.side_effect = ConnectionResetError(10054, "reset")
            error = HTTPError("http://127.0.0.1:9663", status, "error", {}, body)
            with patch("tools.puzzle_catalog.live.build_opener") as opener:
                opener.return_value.open.side_effect = error
                with self.assertRaisesRegex(
                    ValueError, f"Publication API {status}:.*{message}"
                ):
                    Publisher("http://127.0.0.1:9663", "test").request("/inventory")
            body.close.assert_called_once()

    def test_canonical_wire_numbers(self):
        self.assertEqual(
            canonical({"z": 1.0, "a": [1e-7, -0.0]}), '{"a":[0.0000001,0],"z":1}'
        )
        self.assertEqual(
            canonical({"汉字": [True, False, None, 'a\n"\\', 10**30, -12, 1.25]}),
            '{"汉字":[true,false,null,"a\\n\\"\\\\",1000000000000000000000000000000,-12,1.25]}',
        )
        for value in (float("nan"), float("inf"), float("-inf")):
            with self.assertRaises(ValueError):
                canonical(value)

    def test_content_production_baseline_does_not_overwrite_local_draft(self):
        row = {
            "puzzle": self.puzzle,
            "digest": wire_digest(self.puzzle),
            "revision": "first",
        }
        reconcile(self.catalog, [row])
        self.catalog.retire(self.puzzle["_id"], "local review")
        reconcile(self.catalog, [row])
        self.assertTrue(self.catalog.puzzles()[0]["retired"])
        self.assertFalse(self.catalog._meta("baseline")[0]["retired"])
        changes = pending_changes(self.catalog)
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]["expectedRevision"], "first")

    def test_playback_migration_metadata_is_adopted_without_losing_local_drafts(self):
        historical = {k: v for k, v in self.puzzle.items() if k != "playback"}
        reconcile(
            self.catalog,
            [
                {
                    "puzzle": historical,
                    "digest": wire_digest(historical),
                    "revision": "old",
                }
            ],
        )
        self.catalog.retire(historical["_id"], "local review")
        reconcile(
            self.catalog,
            [
                {
                    "puzzle": self.puzzle,
                    "digest": wire_digest(self.puzzle),
                    "revision": "old",
                }
            ],
        )
        [draft] = self.catalog.puzzles()
        self.assertTrue(draft["retired"])
        self.assertEqual(draft["playback"], self.puzzle["playback"])

    def test_reconciliation_rolls_back_whole_local_transaction_on_bad_digest(self):
        with self.assertRaisesRegex(ValueError, "digest"):
            reconcile(
                self.catalog,
                [{"puzzle": self.puzzle, "digest": "wrong", "revision": "first"}],
            )
        self.assertEqual(self.catalog.puzzles(), [])

    def test_receipt_recovery_after_lost_response_uses_same_operation(self):
        change = {
            "puzzle": self.puzzle,
            "expectedDigest": None,
            "expectedRevision": None,
            "provenance": {"status": "verified", "assessmentId": 1},
        }
        checksum = wire_digest({"changes": [change]})
        request = {"operationId": checksum, "digest": checksum, "changes": [change]}
        path = self.root / "operation.json"
        atomic_json(path, request)
        with self.catalog.db:
            self.catalog.db.execute(
                "INSERT INTO catalog_puzzles VALUES(?,?,?)",
                (self.puzzle["_id"], _json(self.puzzle), "{}"),
            )
        settings = SimpleNamespace(
            publication_origin="https://example.test",
            catalog_db=str(self.root / "catalog.sqlite3"),
        )
        with patch("tools.puzzle_catalog.live.Publisher") as factory:
            factory.return_value.request.side_effect = OSError("lost response")
            with self.assertRaises(OSError):
                publish(settings, path)
            self.assertEqual(json.loads(path.read_text()), request)
            receipt = {
                "status": "visible",
                "operationId": checksum,
                "digest": checksum,
                "request": request,
                "applied": 1,
            }
            factory.return_value.request.side_effect = None
            factory.return_value.request.return_value = receipt
            latest = {
                **self.puzzle,
                "retired": True,
                "retirementReason": "newer operator update",
            }
            factory.return_value.inventory.return_value = [
                {
                    "puzzle": latest,
                    "digest": wire_digest(latest),
                    "revision": "newer-operation",
                }
            ]
            publish(settings, path, report=lambda *a, **k: None)
            self.assertEqual(factory.return_value.request.call_args.args, ("", request))
        self.assertEqual(self.catalog._meta("baseline"), [latest])
        self.assertEqual(pending_changes(self.catalog), [])
        self.assertTrue(path.with_suffix(".receipt.json").exists())

    def test_snapshot_reconciles_live_publication_without_old_release_catalog(self):
        from tools.puzzle_catalog.test_catalog import make_snapshot
        from tools.environment_data.snapshot import build_manifest

        snapshot = self.root / "snapshot"
        make_snapshot(snapshot, [self.puzzle])
        (snapshot / "puzzle-inventory.json").write_text(
            json.dumps(
                {
                    "schemaVersion": 2,
                    "puzzles": [self.puzzle],
                    "publication": {
                        "version": "op",
                        "revisions": {self.puzzle["_id"]: "op"},
                    },
                }
            ),
            encoding="utf-8",
        )
        (snapshot / "manifest.json").write_text(
            json.dumps(build_manifest(snapshot, "snap")), encoding="utf-8"
        )
        self.catalog.import_inventory(snapshot)
        self.assertEqual(self.catalog._meta("baseline"), [self.puzzle])
        self.assertEqual(
            self.catalog.db.execute("SELECT revision FROM catalog_live").fetchone()[0],
            "op",
        )

    def test_reject_insecure_or_credential_containing_origins(self):
        for origin in (
            "http://example.test",
            "https://user:secret@example.test",
            "https://example.test/path",
        ):
            with self.assertRaises(ValueError):
                Publisher(origin, "token")


if __name__ == "__main__":
    unittest.main()
