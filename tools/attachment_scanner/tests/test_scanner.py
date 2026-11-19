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
    env = {"UGC_CLAMD_SOCKET": "/test", "UGC_OPENAI_KEY": "fixture"}

    def test_only_normalized_image_reaches_openai(self):
        with patch.object(screen, "malware") as av, patch.object(screen, "post_json", return_value=general()) as send:
            result = screen.screen(draft(png(), "board.png"), self.env)
        av.assert_called_once()
        send.assert_called_once()
        url, token, body = send.call_args.args
        self.assertEqual(url, "https://api.openai.com/v1/moderations")
        self.assertEqual(set(body), {"model", "input"})
        self.assertEqual(body["model"], "omni-moderation-latest")
        self.assertEqual(base64.b64decode(body["input"][0]["image_url"]["url"].split(",")[1]), result.data)
        self.assertNotIn(b"private camera", result.data)
        self.assertEqual(result.detectors["pipeline"], "photo-openai-1")

    def test_held_images_never_reach_openai(self):
        with patch.object(screen, "post_json") as send, self.assertRaises(screen.Restricted):
            screen.screen({**draft(png(), "photo.png"), "hold": True}, self.env)
        send.assert_not_called()

    def test_invalid_general_response_and_changed_bytes(self):
        for response in [{}, {"model":"x","results":[]}, {"model":screen.MODEL, "results":[{"flagged": False}]}]:
            with self.assertRaises(screen.Unavailable):
                screen.general_verdict(response)
        with self.assertRaises(screen.Unavailable):
            screen.screen({**draft(png(), "img.png"), "bytes": b"different"}, {})
        self.assertEqual(screen.general_verdict(general(True))[1], ["violence"])

    def test_private_documents_and_renamed_photo(self):
        with patch.object(screen, "malware") as av, patch.object(screen, "post_json", return_value=general()) as provider:
            for name in ("contract.pdf", "backup.zip", "README"):
                original = b"document bytes"
                item = screen.screen({**draft(original, name), "audience": "msg/bob"}, self.env)
                self.assertEqual((item.mime, item.data), ("application/octet-stream", original))
            provider.assert_not_called()
            item = screen.screen({**draft(png(), "download.bin"), "audience": "msg/bob"}, self.env)
            self.assertEqual(item.mime, "image/webp")
            provider.assert_called_once()
            self.assertEqual(av.call_count, 4)

    def test_private_clip_is_reencoded_and_its_visible_frames_screened(self):
        import subprocess
        data = subprocess.check_output(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=blue:s=96x72",
                                        "-t", "1", "-c:v", "libx264", "-threads", "1", "-movflags",
                                        "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"])
        with patch.object(screen, "malware"), patch.object(screen, "post_json", return_value=general()) as provider:
            item = screen.screen({**draft(data, "movie.mov"), "audience": "msg/bob"}, self.env)
            self.assertEqual(item.mime, "video/mp4")
            self.assertNotEqual(item.data, data)
            self.assertTrue(provider.call_args.args[2]["input"])
            self.assertEqual(item.detectors["pipeline"], "video-openai-1")

    def test_private_animation_screens_every_frame(self):
        frames = [Image.new("RGB", (12, 8), color) for color in ("red", "green", "blue")]
        stream = io.BytesIO()
        frames[0].save(stream, format="GIF", save_all=True, append_images=frames[1:], duration=80)
        with patch.object(screen, "malware"), patch.object(screen, "post_json", return_value=general()) as provider:
            item = screen.screen({**draft(stream.getvalue(), "album.gif"), "audience": "msg/bob"}, self.env)
            self.assertEqual(len(provider.call_args.args[2]["input"]), 3)
            with Image.open(io.BytesIO(item.data)) as decoded:
                self.assertEqual((decoded.format, decoded.n_frames), ("WEBP", 3))

    def test_type_size_and_text(self):
        for name, data in [(".jpg", png()), (".png", b"plain"), (".txt", b"\x00bad"),
                           (".pgn", b"no tags"), (".pdf", b"%PDF-1"), (".txt", b"x" * (screen.LIMIT + 1))]:
            with self.subTest(name=name), self.assertRaises(screen.Rejected):
                screen.normalize(data, name)
        with patch.object(screen, "malware") as av, patch.object(screen, "post_json") as provider:
            for name, text in [("notes.txt", "Good game"), ("notes.txt", "好棋"), ("notes.txt", "Ván cờ hay"),
                               ("game.pgn", '[Event "Game analysis"]\n\n{Nice cannon sacrifice.}')]:
                data = text.encode()
                checked = screen.screen(draft(data, name), self.env)
                self.assertEqual(checked.data, data)
                self.assertEqual(set(checked.detectors), {"clamav"})
            self.assertEqual(av.call_count, 4)
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
