"""Use a disposable MongoDB: LIXIANGQI_MIGRATION_TEST_URI=mongodb://127.0.0.1:PORT."""

import copy
from importlib import import_module
import os
from pathlib import Path
import tempfile
import unittest
import uuid
from unittest.mock import patch

from pymongo import MongoClient
from pymongo.errors import WriteError

migration = import_module("tools.data_migration.20260929_native_study_v1")


@unittest.skipUnless(os.environ.get("LIXIANGQI_MIGRATION_TEST_URI"), "isolated MongoDB URI required")
class NativeStudyResetTests(unittest.TestCase):
    def setUp(self):
        self.client = MongoClient(os.environ["LIXIANGQI_MIGRATION_TEST_URI"])
        self.db = self.client["native_study_test_" + uuid.uuid4().hex]
        self.temp = tempfile.TemporaryDirectory()
        self.backup = Path(self.temp.name) / "original"
        self.db.study.insert_many([{"_id": "study001", "name": "Precious", "unknown": b"\x01"}, {"_id": "round001"}])
        self.db.study.create_index([("ownerId", 1), ("createdAt", -1)])
        self.db.study_chapter_flat.insert_one({"_id": "chapter1", "studyId": "study001", "root": {"_": {"f": "legacy"}}})
        self.db.relay.insert_one({"_id": "round001", "tourId": "tour0001"})
        self.db.relay_tour.insert_one({"_id": "tour0001", "name": "Broadcast"})
        self.db.relay_group.insert_one({"_id": "group001", "tours": ["tour0001"]})
        self.db.relay_stats.insert_one({"_id": "round001", "data": [1, 2, 3]})
        self.db.relay_delay.insert_one({"_id": "https://source.test/round 123", "pgn": "legacy"})
        self.db.study_topic.insert_one({"_id": "Fork"})
        self.db.study_user_topic.insert_one({"_id": "alice", "topics": ["My preference"]})
        self.db.eval_cache2.insert_one({"_id": b"old-position-key", "evals": []})
        self.db.flag.insert_many([{"_id": "studyFeatured", "setting": "study001\nelsewhere"},
                                  {"_id": "unrelated", "setting": ["study001"]}])
        self.db.analysis2.insert_many([
            {"_id": "analysis-study", "studyId": "study001", "data": "old study analysis"},
            {"_id": "chapter1", "data": "unrelated game with colliding chapter ID"},
            {"_id": "orphan", "studyId": "oldstudy", "data": "orphan analysis"},
            {"_id": "catalog:example", "data": "catalog analysis"},
        ])
        self.db.fishnet_analysis.insert_many([
            {"_id": "work1", "game": {"id": "chapter1", "studyId": "study001"}},
            {"_id": "work2", "game": {"id": "chapter1"}},
        ])
        self.db.chat.insert_many([{"_id": "study001", "lines": ["hello"]}, {"_id": "game0001", "lines": ["untouched"]}])
        self.db.chat_timeout.insert_many([{"_id": "timeout1", "chat": "study001"}, {"_id": "timeout2", "chat": "game0001"}])
        self.db.activity2.insert_one({"_id": "alice:1", "t": ["study001", "elsewhere"], "g": {"count": 7}})
        self.db.timeline_entry.insert_many([
            {"_id": "entry1", "typ": "study-like", "data": {"studyId": "study001"}},
            {"_id": "entry2", "typ": "game-end", "data": {"studyId": "study001"}},
        ])
        self.db.notify.insert_many([
            {"_id": "notification1", "content": {"type": "invitedStudy", "studyId": "study001"}},
            {"_id": "notification2", "content": {"type": "broadcastRound", "url": "/broadcast/name/round001"}},
            {"_id": "notification3", "content": {"type": "privateMessage", "studyId": "study001"}},
        ])
        self.db.coach.insert_one({"_id": "alice", "profile": {
            "publicStudies": "https://lixiangqi.org/study/study001\nhttps://example.test/study/other001",
            "description": "https://lixiangqi.org/study/study001 is user-written history",
        }})
        self.original = {name: list(self.db[name].find({})) for name in self.db.list_collection_names()}

    def tearDown(self):
        self.client.drop_database(self.db.name)
        self.client.close()
        self.temp.cleanup()

    def run_reset(self, **kwargs):
        return migration.migrate(self.db, self.backup, writers_stopped=True, **kwargs)

    def test_scoped_reset_and_repeat_preserve_new_studies_and_unrelated_data(self):
        result = self.run_reset()
        self.assertFalse(result["alreadyApplied"])
        for name in migration.OWNED:
            self.assertEqual(self.db[name].count_documents({}), 0, name)
        self.assertEqual(self.db.analysis2.count_documents({}), 2)
        self.assertEqual(self.db.fishnet_analysis.find_one({})["_id"], "work2")
        self.assertEqual(self.db.chat.find_one({})["_id"], "game0001")
        self.assertEqual(self.db.chat_timeout.find_one({})["_id"], "timeout2")
        self.assertEqual(self.db.activity2.find_one({}), {"_id": "alice:1", "t": ["elsewhere"], "g": {"count": 7}})
        self.assertEqual(self.db.timeline_entry.find_one({})["_id"], "entry2")
        self.assertEqual(self.db.notify.find_one({})["_id"], "notification3")
        self.assertEqual(list(self.db.study_user_topic.find({})), self.original["study_user_topic"])
        self.assertEqual(self.db.flag.find_one({"_id": "studyFeatured"})["setting"], "elsewhere")
        self.assertEqual(self.db.flag.find_one({"_id": "unrelated"})["setting"], ["study001"])
        self.assertEqual(self.db.coach.find_one({})["profile"]["description"], self.original["coach"][0]["profile"]["description"])
        self.db.study.insert_one({"_id": "newstudy", "name": "Never delete"})
        self.assertTrue(self.run_reset()["alreadyApplied"])
        self.assertIsNotNone(self.db.study.find_one({"_id": "newstudy"}))
        self.assertEqual(list(migration.documents(self.backup / "study.bson")), self.original["study"])

    def test_interrupted_delete_reuses_original_manifest_and_archive(self):
        def stop(stage):
            if stage == "reset:study_chapter_flat":
                raise RuntimeError("injected failure")

        with self.assertRaisesRegex(RuntimeError, "injected"):
            self.run_reset(interrupt=stop)
        manifest = (self.backup / "manifest.json").read_bytes()
        archive = (self.backup / "study.bson").read_bytes()
        self.assertEqual(self.db.study.count_documents({}), 0)
        self.run_reset()
        self.assertEqual((self.backup / "manifest.json").read_bytes(), manifest)
        self.assertEqual((self.backup / "study.bson").read_bytes(), archive)

    def test_directory_retirement_and_editor_role_preserve_recoverable_user_data(self):
        old_player = {"_id": 123, "name": "Foreign player", "photo": {"id": "user-photo"}}
        old_follow = {"_id": "123/alice", "u": "alice", "p": 123}
        editor = {"_id": "editor", "roles": ["ROLE_FIDE_PLAYER", "ROLE_STUDY_ADMIN"], "settings": {"safe": True}}
        other = {"_id": "other", "roles": ["ROLE_USER"], "settings": {"safe": True}}
        self.db.fide_player.insert_one(old_player)
        self.db.fide_player_follower.insert_one(old_follow)
        self.db.user4.insert_many([editor, other])
        self.db.title_request.insert_one({"_id": "request", "data": {"fideId": 123, "comment": "Keep original request"}})
        self.run_reset()
        self.assertNotIn("fide_player", self.db.list_collection_names())
        self.assertNotIn("fide_player_follower", self.db.list_collection_names())
        self.assertEqual(list(migration.documents(self.backup / "fide_player.bson")), [old_player])
        self.assertEqual(list(migration.documents(self.backup / "fide_player_follower.bson")), [old_follow])
        self.assertEqual(list(migration.documents(self.backup / "user4.bson")), [editor])
        self.assertEqual(self.db.user4.find_one({"_id": "editor"}), {**editor, "roles": ["ROLE_DIRECTORY_PLAYER", "ROLE_STUDY_ADMIN"]})
        self.assertEqual(self.db.user4.find_one({"_id": "other"}), other)
        self.assertEqual(self.db.title_request.find_one({})["data"]["fideId"], 123)
        self.assertIn("native_player_search", self.db.directory_player.index_information())
        self.db.directory_player.insert_one({"_id": "wxf:IGM0012", "name": "New native player"})
        self.run_reset()
        self.assertIsNotNone(self.db.directory_player.find_one({"_id": "wxf:IGM0012"}))

    def test_legacy_external_engine_is_never_deleted_or_relabelled(self):
        engine = {"_id": "old-provider", "variants": ["standard"], "officialStockfish": True, "userId": "alice"}
        self.db.external_engine.insert_one(engine)
        with self.assertRaisesRegex(ValueError, "explicit provider migration"):
            self.run_reset()
        self.assertEqual(self.db.external_engine.find_one({}), engine)
        self.assertEqual(list(self.db.study.find({})), self.original["study"])
        self.assertIsNone(self.db.schema_migration.find_one({"_id": migration.MIGRATION}))

    def test_native_external_engine_is_backed_up_preserved_and_schema_guarded(self):
        engine = {"_id": "native-provider", "name": "My engine", "maxThreads": 2, "maxHash": 64,
                  "protocol": "xiangqi-v1", "officialPikafish": False,
                  "providerSelector": "hashed-provider", "clientSecret": "secret-fixture", "userId": "alice"}
        self.db.external_engine.insert_one(engine)
        self.run_reset()
        self.assertEqual(self.db.external_engine.find_one({}), engine)
        self.assertEqual(list(migration.documents(self.backup / "external_engine.bson")), [engine])
        with self.assertRaises(WriteError):
            self.db.external_engine.update_one({"_id": engine["_id"]}, {"$set": {"variants": ["standard"]}})

    def test_backup_verification_failure_does_not_mutate_data(self):
        with patch.object(migration, "verify_backup", side_effect=RuntimeError("restore failed")):
            with self.assertRaisesRegex(RuntimeError, "restore failed"):
                self.run_reset()
        for name, docs in self.original.items():
            self.assertEqual(list(self.db[name].find({})), docs)
        self.run_reset()

    def test_tampered_backup_is_rejected_after_interruption(self):
        def stop(stage):
            if stage == "backup-verified":
                raise RuntimeError("stop")

        with self.assertRaises(RuntimeError):
            self.run_reset(interrupt=stop)
        with (self.backup / "study.bson").open("ab") as stream:
            stream.write(b"corrupt")
        with self.assertRaisesRegex(ValueError, "checksum"):
            self.run_reset()
        self.assertEqual(list(self.db.study.find({})), self.original["study"])

    def test_schema_failure_leaves_reset_incomplete_and_retryable(self):
        with patch.object(migration, "install_schema", side_effect=RuntimeError("index failure")):
            with self.assertRaisesRegex(RuntimeError, "index failure"):
                self.run_reset()
        self.assertEqual(self.db.schema_migration.find_one({"_id": migration.MIGRATION})["state"], "resetting")
        self.run_reset()

    def test_unbacked_new_records_are_never_deleted(self):
        def stop(stage):
            if stage == "backup-verified":
                raise RuntimeError("stop")
        with self.assertRaises(RuntimeError):
            self.run_reset(interrupt=stop)
        self.db.study.insert_one({"_id": "concurrent", "name": "Must survive"})
        with self.assertRaisesRegex(ValueError, "Unbacked records"):
            self.run_reset()
        self.assertEqual(self.db.study.count_documents({}), 3)

    def test_native_schema_accepts_rank_ten_and_rejects_old_encoding(self):
        self.run_reset()
        chapter = {"_id": "newchap1", "studyId": "newstudy", "setup": {"orientation": "red"},
                   "root": {"_": {"ruleset": "tiantian-v1", "p": 0, "f": "native-root", "o": []},
                            "i10i9/a1a2": {"u": "a1a2", "p": 2, "f": "native-position", "notation": "R9+1", "chineseNotation": "车九进一", "o": []}}}
        self.db.study_chapter_flat.insert_one(chapter)
        bad = copy.deepcopy(chapter)
        bad["_id"] = "oldchap1"
        bad["root"]["i:i9"] = {"u": "i:i9"}
        with self.assertRaises(WriteError):
            self.db.study_chapter_flat.insert_one(bad)
        bad = copy.deepcopy(chapter)
        bad["_id"] = "oldchap2"
        bad["setup"]["variant"] = 1
        with self.assertRaises(WriteError):
            self.db.study_chapter_flat.insert_one(bad)

    def test_writer_gate_is_required(self):
        with self.assertRaisesRegex(ValueError, "writers"):
            migration.migrate(self.db, self.backup, writers_stopped=False)
        self.assertFalse(self.backup.exists())

    def test_ambiguous_shared_chat_identity_aborts_without_deletion(self):
        self.db.game5.insert_one({"_id": "study001", "source": "unrelated game"})
        with self.assertRaisesRegex(ValueError, "Ambiguous"):
            self.run_reset()
        self.assertEqual(list(self.db.chat.find({})), self.original["chat"])
        self.assertEqual(list(self.db.study.find({})), self.original["study"])

    def test_native_search_index_matches_all_terms_and_obeys_live_permissions(self):
        self.run_reset()
        self.db.study.insert_many([
            {"_id": "public01", "name": "Central cannon endgame", "visibility": "public", "ownerId": "alice", "uids": ["alice"], "topics": ["中炮"]},
            {"_id": "partial1", "name": "Central cannon opening", "visibility": "public", "ownerId": "bob", "uids": ["bob"]},
            {"_id": "private1", "name": "Central cannon endgame", "visibility": "private", "ownerId": "alice", "uids": ["alice", "carol"]},
            {"_id": "chapter1", "name": "Lesson", "searchChapters": ["Central cannon endgame Red player"], "visibility": "public", "ownerId": "bob", "uids": ["bob"]},
        ])
        words = {"$text": {"$search": '"central cannon" "endgame"', "$language": "none"}}
        def find(access):
            return {doc["_id"] for doc in self.db.study.find({**words, **access}, max_time_ms=3000)}
        self.assertEqual(find({"visibility": "public"}), {"public01", "chapter1"})
        self.assertEqual(find({"$or": [{"visibility": "public"}, {"uids": "carol"}]}), {"public01", "private1", "chapter1"})
        self.assertEqual(find({"visibility": "public", "ownerId": "alice"}), {"public01"})
        self.db.study.update_one({"_id": "public01"}, {"$set": {"visibility": "private"}})
        self.assertEqual(find({"visibility": "public"}), {"chapter1"})
        self.assertEqual(self.db.study.count_documents({"$text": {"$search": '"中炮"'}}), 1)


if __name__ == "__main__":
    unittest.main()
