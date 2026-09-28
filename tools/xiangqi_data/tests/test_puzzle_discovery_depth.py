"""Depth-only discovery and durable full-game evidence."""

import tempfile
import sqlite3
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from tools.xiangqi_data.puzzle_mining.discovery import (
    DiscoveryConfig,
    _process_job,
    seed_jobs,
    seed_native_jobs,
)
from tools.xiangqi_data.puzzle_mining.engine import IncompleteSearchError
from tools.xiangqi_data.puzzle_mining.models import SearchContext
from tools.xiangqi_data.puzzle_mining.storage import (
    cache_key,
    claim_game_job,
    load_game_analysis,
    open_database,
    seed_game_job,
)
from tools.xiangqi_data.tests.test_puzzle_mining_engine_discovery import (
    FakePikafish,
    _line,
)


class DepthDiscoveryTest(unittest.TestCase):
    def test_depth_coverage_controls_both_queues_and_native_priority(self):
        with tempfile.TemporaryDirectory() as directory:
            db = open_database(Path(directory) / "mining.sqlite3")
            source = Path(directory) / "xiangqi-games.sqlite3"
            catalog = sqlite3.connect(source)
            catalog.execute("CREATE TABLE games(id TEXT PRIMARY KEY, source_url TEXT)")
            ids = ["a-unknown", "b-shallow", "c-equal", "d-deeper"]
            catalog.executemany('INSERT INTO games VALUES (?, "")', [(i,) for i in ids])
            catalog.commit()
            catalog.close()
            native = "lixiangqi:test"
            db.execute(
                "INSERT INTO source_snapshots VALUES ('snap','test','digest','now')"
            )
            for game_id in ids:
                db.execute(
                    """INSERT INTO native_games(source_database,origin,game_id,moves_json,
                    payload_json,payload_checksum,snapshot_id,created_at)
                    VALUES (?,'test',?,'[]','{}',?,'snap','now')""",
                    (native, game_id, game_id),
                )
            for src in ["catalog", native]:
                for game_id, depth in zip(ids[1:], [15, 20, 30]):
                    db.execute(
                        "INSERT INTO game_analysis_depths VALUES (?,?,?)",
                        (src, game_id, depth),
                    )
            db.commit()
            self.assertEqual(seed_jobs(db, (source,), None, "6-depth20", depth=20), 2)
            self.assertEqual(seed_native_jobs(db, "6-depth20", depth=20), 2)
            from tools.xiangqi_data.puzzle_mining.storage import finish_game_job

            jobs = []
            for _ in range(4):
                job = claim_game_job(db, discovery_version="6-depth20")
                jobs.append(job)
                finish_game_job(db, job, 0)
            self.assertEqual(
                [(j.source_database, j.game_id) for j in jobs],
                [(src, i) for src in [native, "catalog"] for i in ids[:2]],
            )
            self.assertEqual(seed_jobs(db, (source,), None, "6-depth30", depth=30), 3)
            self.assertEqual(seed_native_jobs(db, "6-depth30", depth=30), 3)
            # Switching back restores unfinished superseded work; no duplicate analyses.
            self.assertEqual(seed_jobs(db, (source,), None, "6-depth20", depth=20), 2)
            self.assertEqual(seed_native_jobs(db, "6-depth20", depth=20), 2)
            self.assertEqual(
                seed_jobs(db, (source,), None, "6-depth20", rescan=True, depth=20), 0
            )
            db.close()

    def test_coverage_is_minimum_of_all_positions_and_never_decreases(self):
        from tools.xiangqi_data.puzzle_mining.game_analysis_depth import (
            record_depth_coverage,
        )

        with tempfile.TemporaryDirectory() as directory:
            db = open_database(Path(directory) / "db")

            def analysis(depths):
                return {
                    "moves": ["move"] * (len(depths) - 1),
                    "positions": [
                        {"analysis": {"lines": [{"depth": d}]}} for d in depths
                    ],
                }

            record_depth_coverage(db, "catalog", "game", analysis([30, 15, 25]))
            self.assertEqual(
                db.execute("SELECT depth FROM game_analysis_depths").fetchone()[0], 15
            )
            record_depth_coverage(db, "catalog", "game", analysis([30, 30, 30]))
            record_depth_coverage(db, "catalog", "game", analysis([20, 20, 20]))
            self.assertEqual(
                db.execute("SELECT depth FROM game_analysis_depths").fetchone()[0], 30
            )
            db.close()

    def test_depth_command_has_no_other_budget_and_roundtrips(self):
        engine = FakePikafish(["readyok", _line(1, 20, "a4a5"), "bestmove a4a5"])
        commands = []
        engine._send = commands.append
        result = engine.analyse(SearchContext("fen", ()), depth=20, multi_pv=1)
        self.assertEqual([c for c in commands if c.startswith("go ")], ["go depth 20"])
        self.assertIsNone(result.search_nodes)
        self.assertEqual(type(result).from_dict(result.to_dict()).search_depth, 20)
        self.assertNotEqual(
            cache_key("fen", (), 600000, 1), cache_key("fen", (), None, 1, depth=20)
        )

    def test_early_bestmove_does_not_count_as_completed_depth(self):
        engine = FakePikafish(["readyok", _line(1, 19, "a4a5"), "bestmove a4a5"])
        with self.assertRaises(IncompleteSearchError):
            engine.analyse(SearchContext("fen", ()), depth=20, multi_pv=1)

    def test_zero_candidate_game_retains_every_position_even_after_cache_deleted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "mining.sqlite3"
            db = open_database(path)
            seed_game_job(db, "test", "game", "", discovery_version="5")
            job = claim_game_job(db, discovery_version="5")
            engine = FakePikafish(
                [
                    "readyok",  # game-boundary reset
                    "readyok",
                    _line(1, 20, "a4a5"),
                    "bestmove a4a5",
                    "readyok",
                    _line(1, 20, "a6a5"),
                    "bestmove a6a5",
                ]
            )
            commands = []
            engine._send = commands.append
            source = SimpleNamespace(moves=("a4a5",), initial_fen=None)
            with patch(
                "tools.xiangqi_data.puzzle_mining.discovery.load_game",
                return_value=source,
            ):
                status, stats = _process_job(
                    db,
                    engine,
                    job,
                    {},
                    DiscoveryConfig(depth=20),
                    3,
                    "5",
                    publication_origin="https://lixiangqi.com",
                )
            self.assertEqual(status, "complete")
            self.assertEqual(commands.count("ucinewgame"), 1)
            self.assertEqual(commands.count("go depth 20"), 2)
            self.assertEqual(stats["stored"], 0)
            db.execute("DELETE FROM analysis_cache")
            db.commit()
            db.close()
            db = open_database(path)
            saved = load_game_analysis(db, job.id)
            self.assertEqual(
                tuple(
                    db.execute(
                        "SELECT origin,job_id FROM game_analysis_publications"
                    ).fetchone()
                ),
                ("https://lixiangqi.com", job.id),
            )
            # Rebuild the derived index from saved analysis, without engine searches.
            db.execute("DELETE FROM game_analysis_depths")
            db.execute(
                "DELETE FROM metadata WHERE key='game_analysis_depths_backfilled'"
            )
            db.commit()
            db.close()
            db = open_database(path)
            self.assertEqual(
                db.execute("SELECT depth FROM game_analysis_depths").fetchone()[0], 20
            )
            self.assertEqual(saved["moves"], ["a4a5"])
            self.assertEqual(saved["settings"]["depth"], 20)
            self.assertNotIn("nodes", saved["settings"])
            self.assertEqual(len(saved["positions"]), 2)
            self.assertTrue(
                all(
                    p["analysis"]["lines"][0]["depth"] == 20 for p in saved["positions"]
                )
            )
            db.close()

    def test_failed_game_has_no_completed_analysis(self):
        with tempfile.TemporaryDirectory() as directory:
            db = open_database(Path(directory) / "mining.sqlite3")
            seed_game_job(db, "test", "game", "", discovery_version="5")
            job = claim_game_job(db, discovery_version="5")
            engine = FakePikafish(["readyok", _line(1, 20, "a4a5"), "bestmove a4a5"])
            with patch(
                "tools.xiangqi_data.puzzle_mining.discovery.load_game",
                return_value=SimpleNamespace(moves=("a4a5",), initial_fen=None),
            ):
                status, _ = _process_job(
                    db,
                    engine,
                    job,
                    {},
                    DiscoveryConfig(depth=20),
                    3,
                    "5",
                    publication_origin="https://lixiangqi.com",
                )
            self.assertEqual(status, "retry")
            self.assertIsNone(load_game_analysis(db, job.id))
            self.assertEqual(
                db.execute(
                    "SELECT count(*) FROM game_analysis_publications"
                ).fetchone()[0],
                0,
            )
            db.close()
