"""Native discovery must obey source-game chase restrictions, with recoverable retries."""

import base64
import importlib
import json
from pathlib import Path
import tempfile
import unittest
import zlib

from tools.xiangqi_data.native_rules import NativeRules
from tools.xiangqi_data.pikafish import _default_executable
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
from tools.xiangqi_data.puzzle_mining.models import SearchContext
from tools.xiangqi_data.puzzle_mining.storage import (
    apply_discovery_result,
    claim_game_job,
    open_database,
    seed_game_job,
)
from tools.puzzle_catalog.test_game_analysis import evidence

migration = importlib.import_module(
    "tools.data_migration.20261103_native_discovery_history"
)


class NativeDiscoveryHistoryTest(unittest.TestCase):
    def test_unsupported_variant_queue_is_rejected_with_original_source_and_job_retained(
        self,
    ):
        from tools.puzzle_catalog.test_catalog import make_snapshot
        from tools.environment_data.snapshot import build_manifest

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            snapshot = root / "snapshot"
            make_snapshot(snapshot, [])
            (snapshot / "native-games.jsonl").write_text(
                json.dumps({"id": "game0000", "ruleset": "minixiangqi-v1"}) + "\n"
            )
            (snapshot / "manifest.json").write_text(
                json.dumps(build_manifest(snapshot, "snapshot"))
            )
            path = root / "mining.sqlite3"
            db = open_database(path)
            seed_game_job(
                db,
                "lixiangqi:https://lixiangqi.com",
                "game0000",
                "",
                discovery_version="6-depth20",
            )
            db.close()
            count, backup = migration.migrate(
                path, root / "recovery", apply=True, snapshot=snapshot
            )
            self.assertEqual(count, 1)
            original = json.loads(backup.read_text())["jobs"][0]
            self.assertEqual(original["job"]["status"], "queued")
            self.assertIsNone(original["analysis"])
            db = open_database(path)
            try:
                row = db.execute("SELECT status,diagnostic FROM game_jobs").fetchone()
                self.assertEqual(tuple(row), ("rejected", migration.UNSUPPORTED))
            finally:
                db.close()
            self.assertEqual(
                migration.migrate(
                    path, root / "recovery", apply=True, snapshot=snapshot
                ),
                (0, None),
            )

    def test_source_chase_restriction_is_enforced_at_depth_twenty(self):
        fixture = json.loads(
            Path(__file__)
            .with_name("fixtures")
            .joinpath("native_discovery_chase.json")
            .read_text()
        )
        rules = NativeRules()
        engine = OfflinePikafish(_default_executable())
        try:
            source = rules.position(fixture["initial_fen"], tuple(fixture["moves"]))
            isolated = rules.position(source["fen"], (), inspection=True)
            self.assertIn(fixture["banned"], isolated["legalMoves"])
            self.assertNotIn(fixture["banned"], source["legalMoves"])
            engine.new_game()
            result = engine.analyse(
                SearchContext(
                    fixture["initial_fen"], tuple(fixture["moves"]), "tiantian-v1"
                ),
                depth=20,
                multi_pv=1,
            )
            self.assertIn(result.best_move, source["legalMoves"])
            self.assertGreaterEqual(result.primary.depth, 20)
        finally:
            engine.close()
            rules.close()

    def test_requeue_backs_up_original_evidence_and_preserves_other_completed_work(
        self,
    ):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "mining.sqlite3"
            db = open_database(path)
            jobs = []
            for source, policy in [
                ("lixiangqi:https://example.org", "isolated-root-v1"),
                ("lixiangqi:https://example.org", migration.POLICY),
                ("catalog", "isolated-root-v1"),
            ]:
                game = f"game{len(jobs):04}"
                seed_game_job(db, source, game, "", discovery_version="6-depth20")
                job = claim_game_job(db, discovery_version="6-depth20")
                analysis = {**evidence(20), "settings": {"history_policy": policy}}
                apply_discovery_result(
                    db,
                    job,
                    [],
                    game_analysis=analysis,
                    publication_origin="https://example.org",
                )
                jobs.append(job)
            original = bytes(
                db.execute(
                    "SELECT payload_zlib FROM game_analyses WHERE job_id=?",
                    (jobs[0].id,),
                ).fetchone()[0]
            )
            db.close()
            self.assertEqual(migration.migrate(path, root / "recovery"), (1, None))
            count, backup = migration.migrate(path, root / "recovery", apply=True)
            self.assertEqual(count, 1)
            saved = json.loads(backup.read_text())["jobs"][0]
            self.assertEqual(
                base64.b64decode(saved["analysis"]["payload_zlib"]), original
            )
            self.assertEqual(
                json.loads(zlib.decompress(original))["settings"]["history_policy"],
                "isolated-root-v1",
            )
            db = open_database(path)
            try:
                self.assertEqual(
                    [
                        r[0]
                        for r in db.execute("SELECT status FROM game_jobs ORDER BY id")
                    ],
                    ["queued", "complete", "complete"],
                )
                self.assertEqual(
                    db.execute(
                        "SELECT count(*) FROM game_analysis_publications"
                    ).fetchone()[0],
                    2,
                )
                self.assertEqual(
                    db.execute("SELECT count(*) FROM game_analysis_depths").fetchone()[
                        0
                    ],
                    2,
                )
                self.assertEqual(
                    bytes(
                        db.execute(
                            "SELECT payload_zlib FROM game_analyses WHERE job_id=?",
                            (jobs[0].id,),
                        ).fetchone()[0]
                    ),
                    original,
                )
            finally:
                db.close()
            self.assertEqual(
                migration.migrate(path, root / "recovery", apply=True), (0, None)
            )
