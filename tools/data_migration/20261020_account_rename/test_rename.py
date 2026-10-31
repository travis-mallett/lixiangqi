"""Synthetic fixtures only. Integration tests use an explicitly isolated local mongod."""

from copy import deepcopy
from datetime import datetime, timezone, timedelta
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from bson import Binary, Int64
from pymongo import MongoClient

import migrate
import repair_rebuild_keys
from rules import IDENTITY, MIGRATION, Identity, archived, chat_line, puzzle_digest, transform, unexplained


class RulesTest(unittest.TestCase):
    def test_job_keys_match_scala_instant_utc_format(self):
        with self.assertRaises(ValueError):
            migrate.instant_string(datetime(2026, 10, 1))
        self.assertEqual(
            migrate.instant_string(datetime(2026, 9, 30, 17, tzinfo=timezone(timedelta(hours=-7)))),
            "2026-10-01T00:00:00Z",
        )
    def test_account_preserves_raw_credentials_and_provider_ids(self):
        source = {
            "_id": "testing", "username": "Testing", "bpass": Binary(b"\x00secret"),
            "externalLogins": ["lishogi:testing", "lichess:testing"],
            "counter": Int64(17), "unknownFutureField": {"value": Binary(b"\x04")},
        }
        result = transform("user4", source)
        self.assertEqual(result, {**source, "_id": IDENTITY.new, "username": IDENTITY.display})
        self.assertEqual(source["_id"], "testing")
        self.assertEqual(list(unexplained("user4", result)), [])

    def test_crosstable_reorders_scores_and_winners(self):
        source = {"_id": "opponent/testing", "s1": 10, "s2": 25, "r": ["12345678", "abcdABCD-", "qwerQWER="]}
        result = transform("crosstable2", source)
        self.assertEqual(result["_id"], IDENTITY.new + "/opponent")
        self.assertEqual((result["s1"], result["s2"]), (25, 10))
        self.assertEqual(result["r"], ["12345678-", "abcdABCD", "qwerQWER="])
        self.assertEqual(transform("crosstable2", result), result)

    def test_crosstable_keeps_order_when_not_crossed(self):
        source = {"_id": "alice/testing", "s1": 10, "r": ["12345678"]}
        self.assertEqual(transform("crosstable2", source), {**source, "_id": "alice/" + IDENTITY.new})
        with self.assertRaises(ValueError):
            transform("crosstable2", {"_id": "testing/alice", "r": []})

    def test_bad_crosstable_result_fails(self):
        with self.assertRaises(ValueError):
            transform("crosstable2", {"_id": "opponent/testing", "r": ["12345678?"]})

    def test_thread_and_all_message_links_rekey(self):
        thread = {"_id": "opponent/testing", "users": ["opponent", "testing"], "del": ["testing"],
                  "maskFor": "testing", "lastMsg": {"user": "testing", "text": "testing"}}
        result = transform("msg_thread", thread)
        self.assertEqual(result["users"], [IDENTITY.new, "opponent"])
        self.assertEqual(result["lastMsg"]["text"], "testing")
        msg = {"_id": "random", "tid": thread["_id"], "user": "opponent", "text": "testing"}
        self.assertEqual(transform("msg_msg", msg)["tid"], result["_id"])

    def test_chat_keeps_flags_titles_and_message_body(self):
        for flag in " !?&:;":
            self.assertEqual(chat_line("GM~Testing" + flag + "testing stays", IDENTITY),
                             "GM~" + IDENTITY.display + flag + "testing stays")
        self.assertEqual(chat_line("someone testing", IDENTITY), "someone testing")
        self.assertEqual(chat_line("testing-other hello", IDENTITY), "testing-other hello")
        self.assertEqual(chat_line("testing ", IDENTITY), IDENTITY.display + " ")
        with self.assertRaises(ValueError):
            chat_line("testing|unknown format", IDENTITY)

    def test_puzzle_digest_tracks_authored_snapshot_not_community_themes(self):
        doc = {"_id": "puz", "gameSource": {"type": "native", "origin": "https://lixiangqi.com"},
               "sourceSnapshot": {"players": [{"userId": "testing"}]},
               "themes": ["community", "fork"], "managedThemes": ["fork"]}
        doc["contentDigest"] = puzzle_digest(doc)
        changed_community = {**doc, "themes": ["other", "fork"]}
        self.assertEqual(puzzle_digest(changed_community), doc["contentDigest"])
        result = transform("puzzle2_puzzle", doc)
        self.assertEqual(result["contentDigest"], puzzle_digest(result))
        self.assertNotEqual(result["contentDigest"], doc["contentDigest"])
        doc["contentDigest"] = "corrupt"
        with self.assertRaises(ValueError):
            transform("puzzle2_puzzle", doc)

    def test_study_member_keys_and_nested_authors(self):
        study = {"_id": "study", "ownerId": "testing", "members": {"testing": {"role": "w"}},
                 "uids": ["testing"], "likers": ["testing"], "name": "testing ideas"}
        self.assertIn(IDENTITY.new, transform("study", study)["members"])
        study["members"][IDENTITY.new] = {"role": "r"}
        with self.assertRaises(ValueError):
            transform("study", study)
        chapter = {"_id": "ch", "ownerId": "testing", "root": {
            "a1a2/b1b2": {"co": [{"by": {"kind": "user", "id": "testing", "name": "GM testing"},
                                 "text": "testing text"}]}}}
        result = transform("study_chapter_flat", chapter)
        self.assertEqual(result["root"]["a1a2/b1b2"]["co"][0]["by"]["name"], "GM " + IDENTITY.display)
        self.assertEqual(list(unexplained("study_chapter_flat", result)), [])

    def test_puzzle_source_only_local_native_identity(self):
        doc = {"_id": "puz", "gameSource": {"type": "native", "origin": "https://lixiangqi.com"},
               "sourceSnapshot": {"players": [{"userId": "testing", "name": "Testing"}]}}
        self.assertEqual(transform("puzzle2_puzzle", doc)["sourceSnapshot"]["players"][0],
                         {"userId": IDENTITY.new, "name": IDENTITY.display})
        doc["gameSource"]["type"] = "catalog"
        with self.assertRaises(ValueError):
            transform("puzzle2_puzzle", doc)

    def test_compound_ids(self):
        cases = {
            "activity2": ("testing:42", IDENTITY.new + ":42"),
            "ai_challenge_stats": ("user/testing/9", "user/" + IDENTITY.new + "/9"),
            "puzzle2_round": ("testing:abcde", IDENTITY.new + ":abcde"),
            "bookmark": ("12345678testing", "12345678" + IDENTITY.new),
            "game_note": ("12345678testing", "12345678" + IDENTITY.new),
            "relation": ("opponent/testing", "opponent/" + IDENTITY.new),
            "ublog_blog": ("user:testing", "user:" + IDENTITY.new),
            "video_view": ("video/testing", "video/" + IDENTITY.new),
        }
        for coll, (old, new) in cases.items():
            with self.subTest(coll=coll):
                self.assertEqual(transform(coll, {"_id": old})["_id"], new)

    def test_sessions_close_but_api_tokens_survive(self):
        session = {"_id": "session", "user": "testing", "up": True, "date": 1}
        self.assertEqual(transform("security", session), {**session, "user": IDENTITY.new, "up": False})
        token = {"_id": "hashed-token", "userId": "testing", "scopes": ["challenge:write"]}
        self.assertEqual(transform("oauth2_access_token", token), {**token, "userId": IDENTITY.new})

    def test_unknown_references_are_not_guessed(self):
        self.assertEqual(list(unexplained("future_collection", {"_id": "a", "futureOwner": "testing"})),
                         ["futureOwner"])
        self.assertTrue(archived("puzzle2_publication"))
        self.assertFalse(archived("some_new_backup"))

    def test_only_local_profile_urls_change(self):
        doc = {"_id": "image", "user": "testing", "context": "https://lixiangqi.com/@/testing/blog/new"}
        self.assertIn("/@/ChineseChessOutLoud/", transform("picfit_image", doc)["context"])
        doc["context"] = "https://example.org/@/testing"
        self.assertEqual(transform("picfit_image", doc)["context"], doc["context"])


@unittest.skipUnless(os.environ.get("RENAME_TEST_MONGO_URI"), "Set isolated local test URI")
class MongoTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        uri = os.environ["RENAME_TEST_MONGO_URI"]
        if not uri.startswith("mongodb://127.0.0.1:27993/"):
            raise ValueError("Tests only run against the dedicated local port 27993")
        cls.client = MongoClient(uri, tz_aware=True, w="majority", journal=True)

    @classmethod
    def tearDownClass(cls):
        cls.client.drop_database(migrate.MAIN)
        cls.client.drop_database(migrate.TRAFFIC)
        cls.client.close()

    def setUp(self):
        self.client.drop_database(migrate.MAIN)
        self.client.drop_database(migrate.TRAFFIC)
        self.temp = tempfile.TemporaryDirectory(prefix="rename-tests-")
        self.addCleanup(self.temp.cleanup)
        self.backup = Path(self.temp.name) / "backup"
        self.hashes = migrate.identities("synthetic-traffic-key-" * 3)
        self.main = self.client[migrate.MAIN]
        self.traffic = self.client[migrate.TRAFFIC]
        self.main.user4.insert_one({
            "_id": "testing", "username": "testing", "enabled": True,
            "roles": ["ROLE_PUBLISH_OFFICIAL_BLOG"], "bpass": Binary(b"password"),
            "externalLogins": ["provider:testing"], "future": Int64(77),
        })
        self.main.user4.create_index("externalLogins", unique=True, sparse=True)
        self.main[migrate.MARKERS].insert_one({"_id": "official-blogs-v1", "state": "complete"})
        self.main.user_perf.insert_one({"_id": "testing", "ranks": {"xiangqi": {"s": Int64(12345)}}})
        self.main.crosstable2.insert_one({"_id": "opponent/testing", "s1": 10, "s2": 20, "r": ["12345678-"]})
        self.main.game5.insert_one({"_id": "12345678", "us": ["testing", "opponent"], "wid": "testing"})
        self.traffic.traffic_state.insert_many([
            {"_id": "identity", "check": self.hashes["check"]},
            {"_id": "snapshot", "complete": True, "cursor": "testing"},
        ])
        date = datetime(2026, 10, 1, tzinfo=timezone.utc)
        self.traffic.traffic_event.insert_one({
            "_id": self.hashes["registrationOld"], "subject": self.hashes["old"],
            "kind": "user.registered", "registered": True, "at": date, "month": date,
            "receivedAt": date, "processed": True,
        })
        self.traffic.traffic_subject.insert_one({"_id": self.hashes["old"], "registeredAt": date})
        self.traffic.traffic_rollup.insert_one({
            "_id": "monthly", "grain": "month", "at": date, "dimension": "all",
            "key": "all", "registered": True, "global": False, "counts": {"user_registered": 1},
            "participants": "synthetic-original-sketch",
        })

    def test_audit_is_read_only_and_collision_aborts(self):
        before = list(self.main.user4.find())
        changes, report = migrate.census(self.client, self.hashes)
        self.assertFalse(report["errors"])
        self.assertGreater(len(changes), 0)
        self.assertEqual(list(self.main.user4.find()), before)
        self.assertIsNone(self.main[migrate.MARKERS].find_one({"_id": MIGRATION}))
        self.main.user_perf.insert_one({"_id": IDENTITY.new})
        _, report = migrate.census(self.client, self.hashes)
        self.assertTrue(report["errors"])

    def test_backup_restore_apply_resume_and_finish(self):
        manifest = migrate.prepare(self.client, self.hashes, self.backup)
        self.assertTrue(manifest["restoreVerified"])
        with self.assertRaises(ValueError):
            migrate.prepare(self.client, self.hashes, self.backup)
        self.assertEqual(migrate.apply(self.client, self.backup), "awaitingAnalytics")
        restored = migrate.load_backup(self.backup)
        self.assertEqual(restored["capturedAt"].utcoffset(), timedelta(0))
        for month in restored["audit"]["analyticsMonths"]:
            # The Scala worker addresses jobs with month.toString, not the key
            # read from the job document. A missing Z made every update a no-op.
            worker_key = month.strftime("%Y-%m-%dT%H:%M:%SZ")
            job = self.traffic.traffic_rebuild.find_one({"_id": worker_key})
            self.assertIsNotNone(job)
            updated = self.traffic.traffic_rebuild.update_one(
                {"_id": worker_key}, {"$set": {"phase": "replay"}}
            )
            self.assertEqual(updated.matched_count, 1)
        migrate.verify_documents(self.client, self.backup)
        migrate.verify_references(self.client, self.hashes)
        self.assertEqual(migrate.apply(self.client, self.backup), "awaitingAnalytics")
        self.assertIsNone(self.main.user4.find_one({"_id": "testing"}))
        user = self.main.user4.find_one({"_id": IDENTITY.new})
        self.assertEqual(user["externalLogins"], ["provider:testing"])
        self.assertEqual(bytes(user["bpass"]), b"password")
        with self.assertRaises(migrate.AnalyticsPending):
            migrate.finish(self.client, self.backup)
        # Simulate the existing worker completing its month (not a test of HLL itself).
        self.traffic.traffic_rebuild.delete_many({})
        self.assertEqual(migrate.finish(self.client, self.backup), "complete")
        self.assertEqual(migrate.finish(self.client, self.backup), "complete")
        self.assertTrue((self.backup / "traffic.bson").exists())

    def test_interrupt_between_unique_key_delete_and_insert(self):
        migrate.prepare(self.client, self.hashes, self.backup)
        real_apply = migrate.apply_change
        def interrupt(client, change):
            if change["collection"] == "user4":
                client[migrate.MAIN].user4.delete_one({"_id": "testing"})
                raise RuntimeError("simulated process failure")
            real_apply(client, change)
        with patch.object(migrate, "apply_change", interrupt), self.assertRaises(RuntimeError):
            migrate.apply(self.client, self.backup)
        self.assertEqual(migrate.apply(self.client, self.backup), "awaitingAnalytics")
        migrate.verify_documents(self.client, self.backup)

    def test_changed_source_and_corrupt_backup_fail_before_conversion(self):
        migrate.prepare(self.client, self.hashes, self.backup)
        self.main.user4.update_one({"_id": "testing"}, {"$set": {"newUserData": "keep"}})
        with self.assertRaises(ValueError):
            migrate.apply(self.client, self.backup)
        self.assertIsNone(self.main.user4.find_one({"_id": IDENTITY.new}))
        with (self.backup / "changes.bson").open("ab") as stream:
            stream.write(b"corrupt")
        with self.assertRaises(ValueError):
            migrate.load_backup(self.backup)

    def test_unknown_reference_and_wrong_secret_block(self):
        self.main.future.insert_one({"_id": "x", "account": "testing"})
        _, report = migrate.census(self.client, self.hashes)
        self.assertTrue(report["errors"])
        with self.assertRaises(ValueError):
            migrate.prepare(self.client, self.hashes, self.backup)
        with self.assertRaises(ValueError):
            migrate.preconditions(self.client, migrate.identities("a" * 40))

    def test_inflight_publication_blocks_rename(self):
        self.main.puzzle2_publication.insert_one({"_id": "operation", "status": "applying"})
        with self.assertRaisesRegex(ValueError, "publications must finish"):
            migrate.preconditions(self.client, self.hashes)

    def test_repair_legacy_job_keys_preserves_backup_and_resumes(self):
        migrate.prepare(self.client, self.hashes, self.backup)
        migrate.apply(self.client, self.backup)
        original_manifest_hash = migrate.file_hash(self.backup / "manifest.json")
        job = self.traffic.traffic_rebuild.find_one()
        self.traffic.traffic_rebuild.delete_one({"_id": job["_id"]})
        self.traffic.traffic_rebuild.insert_one({**job, "_id": job["_id"][:-1]})
        journal = self.backup.parent / "rebuild-key-repair.bson"
        # Exercise the old deployed decoder, which returns naive UTC datetimes.
        from bson import json_util
        old_decoder = json_util.loads((self.backup / "manifest.json").read_text())
        with patch.object(migrate, "load_backup", return_value=old_decoder):
            self.assertIn("Repaired 1", repair_rebuild_keys.repair(self.client, self.backup, journal))
        self.assertEqual(migrate.file_hash(self.backup / "manifest.json"), original_manifest_hash)
        self.assertEqual(self.traffic.traffic_rebuild.find_one(), job)
        self.assertTrue(journal.exists())
        # A repeated repair must not resurrect already completed rebuilds.
        self.traffic.traffic_rebuild.delete_many({})
        self.assertEqual(repair_rebuild_keys.repair(self.client, self.backup, journal), "already repaired")
        self.assertEqual(self.traffic.traffic_rebuild.count_documents({}), 0)

    def test_repair_collision_does_not_mutate_jobs(self):
        migrate.prepare(self.client, self.hashes, self.backup)
        migrate.apply(self.client, self.backup)
        job = self.traffic.traffic_rebuild.find_one()
        self.traffic.traffic_rebuild.insert_one({**job, "_id": job["_id"][:-1]})
        before = list(self.traffic.traffic_rebuild.find())
        with self.assertRaisesRegex(ValueError, "already exists"):
            repair_rebuild_keys.repair(self.client, self.backup, self.backup.parent / "repair.bson")
        self.assertEqual(list(self.traffic.traffic_rebuild.find()), before)

    def test_incorrect_rebuild_counts_do_not_mark_complete(self):
        migrate.prepare(self.client, self.hashes, self.backup)
        migrate.apply(self.client, self.backup)
        self.traffic.traffic_rebuild.delete_many({})
        self.traffic.traffic_rollup.update_one({"_id": "monthly"}, {"$set": {"counts.user_registered": 2}})
        with self.assertRaises(ValueError):
            migrate.finish(self.client, self.backup)
        self.assertEqual(self.main[migrate.MARKERS].find_one({"_id": MIGRATION})["state"], "awaitingAnalytics")


if __name__ == "__main__":
    unittest.main()
