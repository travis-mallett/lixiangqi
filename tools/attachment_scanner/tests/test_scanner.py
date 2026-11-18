import base64
import hashlib
import io
import os
import unittest
import uuid
from datetime import timedelta
from unittest.mock import patch

from PIL import Image, PngImagePlugin
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError

import screen
import worker


def png():
    out = io.BytesIO()
    info = PngImagePlugin.PngInfo()
    info.add_text("private", "private camera metadata")
    Image.new("RGB", (12, 8), "#257883").save(out, format="PNG", pnginfo=info)
    return out.getvalue()


def draft(data, name):
    return {"bytes": data, "sourceDigest": hashlib.sha256(data).hexdigest(), "name": name}


def general(flag=False):
    flags = {k: False for k in ("sexual", "violence", "violence/graphic", "self-harm")}
    flags["violence"] = flag
    return {"model": "omni-moderation-2024-09-26", "results": [
        {"flagged": flag, "categories": flags, "category_scores": {k: float(v) for k, v in flags.items()}}]}


class ScannerTest(unittest.TestCase):
    env = {"UGC_CLAMD_SOCKET": "/test", "UGC_CHILD_URL": "https://restricted.invalid/check",
           "UGC_CHILD_TOKEN": "fixture", "UGC_OPENAI_KEY": "fixture"}

    def test_checked_bytes_and_detector_order(self):
        calls = []
        def detector(url, token, body):
            calls.append(body)
            if url == self.env["UGC_CHILD_URL"]:
                return {"decision": "clear", "sha256": body["sha256"], "sourceSha256": body["sourceSha256"], "hashListVersion": "1", "classifierVersion": "2"}
            return general()
        with patch.object(screen, "malware"), patch.object(screen, "post_json", side_effect=detector):
            result = screen.screen(draft(png(), "board.png"), self.env)
        self.assertEqual(result.mime, "image/webp")
        self.assertNotIn(b"private camera", result.data)
        self.assertEqual(calls[0]["sourceSha256"], hashlib.sha256(png()).hexdigest())
        self.assertEqual(calls[0]["sha256"], hashlib.sha256(result.data).hexdigest())
        self.assertEqual(base64.b64decode(calls[0]["image"]), result.data)
        self.assertEqual(base64.b64decode(calls[1]["input"][0]["image_url"]["url"].split(",")[1]), result.data)
        self.assertEqual(set(calls[1]), {"model", "input"})
        self.assertEqual(result.detectors["model"], general()["model"])

    def test_incomplete_or_restricted_child_decision_never_calls_general(self):
        for decision, exc in [("suspected", screen.Restricted), ("clear", screen.Unavailable), ("error", screen.Unavailable)]:
            with self.subTest(decision=decision), patch.object(screen, "malware"), patch.object(
                screen, "post_json", side_effect=lambda url, key, body: {"sha256": body["sha256"], "sourceSha256": body["sourceSha256"], "decision": decision}
            ) as request, self.assertRaises(exc):
                try:
                    screen.screen(draft(png(), "a.png"), self.env)
                finally:
                    self.assertEqual(request.call_count, 1)

    def test_child_clearance_for_other_source_bytes_never_reaches_general(self):
        def wrong_source(url, token, body):
            return {"decision": "clear", "sha256": body["sha256"], "sourceSha256": "0" * 64,
                    "hashListVersion": "1", "classifierVersion": "1"}
        with patch.object(screen, "malware"), patch.object(screen, "post_json", side_effect=wrong_source) as call:
            with self.assertRaises(screen.Unavailable):
                screen.screen(draft(png(), "test.png"), self.env)
            self.assertEqual(call.call_count, 1)

    def test_invalid_general_response_and_changed_bytes(self):
        for response in [{}, {"model":"x","results":[]}, {"model":screen.MODEL, "results":[{"flagged": False}]}]:
            with self.assertRaises(screen.Unavailable):
                screen.general_verdict(response)
        with self.assertRaises(screen.Unavailable):
            screen.screen({**draft(png(), "img.png"), "bytes": b"different"}, {})
        self.assertEqual(screen.general_verdict(general(True))[1], ["violence"])

    def test_type_size_and_text(self):
        for name, data in [(".jpg", png()), (".png", b"plain"), (".txt", b"\x00bad"),
                           (".pgn", b"no tags"), (".pdf", b"%PDF-1"), (".txt", b"x" * (screen.LIMIT + 1))]:
            with self.subTest(name=name), self.assertRaises(screen.Rejected):
                screen.normalize(data, name)
        with patch.object(screen, "malware") as av, patch.object(screen, "post_json") as provider:
            for text in ["Good game", "好棋", "Ván cờ hay"]:
                data = text.encode()
                self.assertEqual(screen.screen(draft(data, "notes.txt"), self.env).data, data)
            self.assertEqual(av.call_count, 3)
            provider.assert_not_called()


@unittest.skipUnless(os.getenv("LIXIANGQI_MSG_TEST_URI"), "requires isolated Mongo")
class LifecycleTest(unittest.TestCase):
    def setUp(self):
        self.client = MongoClient(os.environ["LIXIANGQI_MSG_TEST_URI"], serverSelectionTimeoutMS=3000, tz_aware=True)
        self.db = self.client["ugc_test_" + uuid.uuid4().hex]
        self.coll = self.db.ugc_attachment
        self.addCleanup(self.client.close)
        self.addCleanup(self.client.drop_database, self.db.name)

    def test_restricted_fixture_vaults_once_and_never_becomes_readable(self):
        at = worker.now()
        data = png()
        self.coll.insert_one({**draft(data, "sample.png"), "_id": "sample", "owner": "author",
            "audience": "msg/bob", "policy": screen.POLICY, "state": "checking", "nextCheck": at,
            "expiresAt": at})
        with patch.object(worker, "screen", side_effect=screen.Restricted):
            self.assertEqual(worker.finish(self.coll, worker.claim(self.coll)), "restricted")
        worker.cleanup(self.db)
        vault = self.db.test_restricted_vault
        vault.insert_one({"_id": "sample", "sourceDigest": "different"})
        with self.assertRaises(DuplicateKeyError):
            worker.vault_restricted(self.db, vault)
        self.assertEqual(bytes(self.coll.find_one({"_id": "sample"})["bytes"]), data)
        vault.delete_one({"_id": "sample"})
        worker.vault_restricted(self.db, vault)
        worker.vault_restricted(self.db, vault)
        self.assertEqual(vault.count_documents({}), 1)
        self.assertEqual(bytes(vault.find_one()["original"]), data)
        ordinary = self.coll.find_one({"_id": "sample"})
        self.assertTrue(ordinary["hold"] and ordinary["vaulted"])
        self.assertNotIn("bytes", ordinary)
        self.assertNotIn("parent", ordinary)
        self.assertIsNone(worker.claim(self.coll))

    def test_outage_reclaim_stale_verdict_cleanup_and_no_publication(self):
        at = worker.now()
        self.coll.insert_one({**draft(b"hello", "notes.txt"), "_id":"draft", "policy":screen.POLICY,
            "state":"checking", "audience":"msg/other", "nextCheck":at, "expiresAt":at})
        first = worker.claim(self.coll)
        self.assertIsNone(worker.claim(self.coll))
        self.coll.update_one({"_id":"draft"}, {"$set":{"nextCheck":at}})
        second = worker.claim(self.coll)
        with patch.object(worker, "screen", side_effect=TimeoutError):
            self.assertFalse(worker.finish(self.coll, first))
            self.assertEqual(worker.finish(self.coll, second), "retry")
        self.assertEqual(self.db.msg_msg.count_documents({}), 0)
        self.coll.update_one({"_id":"draft"}, {"$set":{"state":"checking", "nextCheck":at}})
        with patch.object(worker, "screen", return_value=screen.Checked(b"hello","text/plain",{})):
            self.assertEqual(worker.finish(self.coll, worker.claim(self.coll)), "ready")
        self.assertEqual(self.db.msg_thread.count_documents({}), 0)
        self.coll.update_one({"_id":"draft"}, {"$set":{"parent":"message"}})
        self.db.msg_msg.insert_one({"_id":"message", "attachments":["draft"]})
        worker.cleanup(self.db)
        self.assertIsNotNone(self.coll.find_one({"_id":"draft"}))
        self.coll.update_one({"_id":"draft"}, {"$set":{"expiresAt":at, "evidenceUntil":at + timedelta(days=1)}})
        self.db.msg_msg.update_one({"_id":"message"}, {"$set":{"deletedAt":at}})
        worker.cleanup(self.db)
        self.assertIsNotNone(self.coll.find_one({"_id":"draft"}))
        self.coll.update_one({"_id":"draft"}, {"$set":{"evidenceUntil":at}})
        worker.cleanup(self.db)
        self.assertIsNone(self.coll.find_one({"_id":"draft"}))
