import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from tools.puzzle_catalog.game_analysis import publication_body, sync_game_analyses
from tools.xiangqi_data.pikafish_rules import START_FEN
from tools.xiangqi_data.puzzle_mining.storage import (
    apply_discovery_result,
    claim_game_job,
    open_database,
    seed_game_job,
)


def evidence(depth):
    return {
        "format_version": 1,
        "initial_fen": START_FEN,
        "moves": ["a4a5"],
        "positions": [
            {
                "analysis": {
                    "lines": [
                        {
                            "depth": depth,
                            "score": {"kind": "cp", "value": cp, "bound": None},
                            "moves": [move],
                        }
                    ]
                }
            }
            for cp, move in [(23, "a4a5"), (-15, "a7a6")]
        ],
    }


class Destination:
    def __init__(self):
        self.depths = {}
        self.uploads = []
        self.lose_response = False

    def inventory(self):
        return iter(())

    def request(self, path, body):
        if path == "/analysis/inventory":
            return {"depths": self.depths.copy()}
        key = ("catalog:" if body["game"]["type"] == "catalog" else "") + body["game"][
            "id"
        ]
        depth = min(p["depth"] for p in body["positions"] if p)
        self.depths[key] = max(self.depths.get(key, 0), depth)
        self.uploads.append(body)
        if self.lose_response:
            self.lose_response = False
            raise OSError("response lost after saving")
        return {"id": key, "depth": self.depths[key]}


class GameAnalysisPublicationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.settings = SimpleNamespace(
            mining_db=str(self.root / "mining.db"),
            source_catalog=str(self.root / "catalog.db"),
            publication_origin="https://lixiangqi.com",
        )
        self.server = Destination()
        with closing(sqlite3.connect(self.settings.source_catalog)) as db:
            db.execute(
                "CREATE TABLE games(id TEXT PRIMARY KEY,moves TEXT,initial_fen TEXT)"
            )
            db.execute(
                "INSERT INTO games VALUES ('canonical',?,?)",
                (json.dumps(["a4a5"]), START_FEN),
            )
            db.execute(
                "CREATE TABLE game_sources(game_id TEXT,source TEXT,external_id TEXT,collection TEXT)"
            )
            db.execute("INSERT INTO game_sources VALUES ('canonical','dpxq','old','m')")
            db.commit()

    def save(self, depth, *, source="catalog", game="canonical", status="complete"):
        with closing(open_database(Path(self.settings.mining_db))) as db:
            # Seed at a new requested depth, then retain the actual search depth.
            version = str(db.execute("SELECT count(*) FROM game_jobs").fetchone()[0])
            seed_game_job(db, source, game, "", discovery_version=version, depth=255)
            job = claim_game_job(db, discovery_version=version)
            apply_discovery_result(db, job, [], game_analysis=evidence(depth))
            if status != "complete":
                db.execute("UPDATE game_jobs SET status=? WHERE id=?", (status, job.id))
                db.commit()

    def sync(self):
        sync_game_analyses(self.settings, self.server, lambda *args, **kwargs: None)

    def test_depth_only_upgrades_and_retains_best_historical_run_without_puzzles(self):
        self.save(20)
        self.sync()
        self.assertEqual(self.server.depths, {"catalog:canonical": 20})
        self.save(30)
        self.sync()
        self.save(15)
        with patch(
            "tools.puzzle_catalog.game_analysis.zlib.decompress",
            side_effect=AssertionError("unnecessary decompression"),
        ):
            self.sync()
        self.assertEqual(len(self.server.uploads), 2)
        self.assertEqual(self.server.depths["catalog:canonical"], 30)
        self.server.depths.clear()  # Preview restored from an earlier snapshot.
        self.sync()
        self.assertEqual(self.server.depths["catalog:canonical"], 30)

    def test_lost_response_reconciles_without_duplicate_upload(self):
        self.save(20)
        self.server.lose_response = True
        with self.assertRaises(OSError):
            self.sync()
        self.sync()
        self.assertEqual(len(self.server.uploads), 1)

    def test_publish_with_no_puzzle_changes_still_uploads_completed_game_analysis(self):
        from tools.puzzle_catalog.catalog import PuzzleCatalog
        from tools.puzzle_catalog.live import sync

        self.settings.catalog_db = str(self.root / "puzzles.db")
        with PuzzleCatalog(self.settings.catalog_db):
            pass
        self.save(20)
        with (
            patch("tools.puzzle_catalog.live.Publisher", return_value=self.server),
            patch("tools.puzzle_catalog.desktop.repository.ContentRepository"),
        ):
            sync(self.settings, self.root / "state", lambda *args, **kwargs: None)
        self.assertEqual(self.server.depths, {"catalog:canonical": 20})

    def test_canonical_catalog_identity_and_native_origin_are_separate(self):
        self.save(20, source="dpxq", game="old")
        self.save(30, source="lixiangqi:https://lixiangqi.com", game="native01")
        self.save(40, source="lixiangqi:https://other.example", game="native01")
        self.sync()
        self.assertEqual(self.server.depths, {"native01": 30, "catalog:canonical": 20})
        preview = Destination()
        self.settings.publication_origin = "http://localhost:9663"
        sync_game_analyses(
            self.settings,
            preview,
            lambda *args, **kwargs: None,
            source_origin="https://lixiangqi.com",
        )
        self.assertEqual(preview.depths["catalog:canonical"], 20)
        self.assertEqual(preview.depths["native01"], 30)

    def test_incomplete_jobs_and_equal_or_higher_server_depth_are_not_uploaded(self):
        self.save(40, status="retry")
        self.sync()
        self.assertEqual(self.server.uploads, [])
        self.save(20)
        for depth in (20, 30, None):
            self.server.depths["catalog:canonical"] = depth
            self.sync()
        self.assertEqual(self.server.uploads, [])

    def test_rejects_incomplete_and_bounded_payloads_and_preserves_terminal_position(
        self,
    ):
        data = evidence(20)
        data["positions"].pop()
        with self.assertRaisesRegex(ValueError, "incomplete"):
            publication_body(data, {})
        data = evidence(20)
        data["positions"][0]["analysis"]["lines"][0]["score"]["bound"] = "lower"
        with self.assertRaisesRegex(ValueError, "exact"):
            publication_body(data, {})
        data = evidence(20)
        data["positions"][-1]["analysis"]["lines"] = []
        self.assertIsNone(publication_body(data, {})["positions"][-1])

    def test_depth_column_backfills_existing_retained_evidence(self):
        self.save(20)
        with closing(sqlite3.connect(self.settings.mining_db)) as db:
            db.execute("DROP INDEX game_analyses_by_depth")
            db.execute("ALTER TABLE game_analyses DROP COLUMN depth")
            db.commit()
        self.sync()
        self.assertEqual(self.server.depths["catalog:canonical"], 20)

    def test_changed_catalog_history_is_not_given_stale_analysis(self):
        self.save(20)
        with closing(sqlite3.connect(self.settings.source_catalog)) as db:
            db.execute("UPDATE games SET moves='[\"c4c5\"]'")
            db.commit()
        with self.assertRaisesRegex(ValueError, "differs"):
            self.sync()
        self.assertEqual(self.server.uploads, [])
