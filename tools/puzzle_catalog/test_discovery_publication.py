"""Automatic upload and concurrent worker contracts; never contact production."""

import json
import os
import queue
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from unittest.mock import Mock, patch

from tools.puzzle_catalog.discovery_publication import (
    connect_discovery,
    pending_analysis_jobs,
    publish_pending_analysis,
)
from tools.puzzle_catalog.live import PublicationApiError, Publisher
from tools.puzzle_catalog.test_game_analysis import Destination, evidence
from tools.xiangqi_data.puzzle_mining.discovery import DiscoveryConfig, _worker_main
from tools.xiangqi_data.puzzle_mining.storage import (
    apply_discovery_result,
    claim_game_job,
    open_database,
    seed_game_job,
)
from tools.xiangqi_data.puzzle_mining.workers import WorkerCancelled


class DiscoveryPublicationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "mining.sqlite3"
        self.origin = "https://lixiangqi.com"
        self.db = open_database(self.path)
        self.addCleanup(self.db.close)
        self.server = Destination()
        self.server.origin = self.origin
        self.stop = Mock(wraps=threading.Event())
        self.stop.wait = Mock(return_value=False)

    def complete(self, game="native01", depth=20, origin=None):
        seed_game_job(
            self.db,
            "lixiangqi:" + (origin or self.origin),
            game,
            "",
            discovery_version="test",
        )
        job = claim_game_job(self.db, discovery_version="test")
        apply_discovery_result(
            self.db,
            job,
            [],
            game_analysis=evidence(depth),
            publication_origin=self.origin,
        )
        return job.id

    def deliver(self, job_id):
        return publish_pending_analysis(
            self.db, self.server, job_id, {}, self.stop, lambda _: None
        )

    def test_completed_game_and_upload_are_durable_and_lost_response_is_reconciled(
        self,
    ):
        job_id = self.complete()
        with closing(open_database(self.path)) as reopened:
            self.assertEqual(pending_analysis_jobs(reopened, self.origin), [job_id])
        self.server.lose_response = True
        self.deliver(job_id)
        self.assertEqual(self.server.depths, {"native01": 20})
        self.assertEqual(len(self.server.uploads), 1)
        self.stop.wait.assert_called_once_with(1)
        self.assertEqual(pending_analysis_jobs(self.db, self.origin), [])

    def test_depth_rule_and_other_origins(self):
        for depth in (20, 30, None):
            job_id = self.complete(game=f"native{len(self.server.depths):02}")
            game_id = self.db.execute(
                "SELECT game_id FROM game_jobs WHERE id=?", (job_id,)
            ).fetchone()[0]
            self.server.depths[game_id] = depth
            self.deliver(job_id)
        self.assertEqual(self.server.uploads, [])
        self.complete(game="native99", origin="https://another.example")
        self.assertEqual(pending_analysis_jobs(self.db, self.origin), [])

    def test_failure_keeps_completed_game_and_pending_upload_for_restart(self):
        job_id = self.complete()
        self.server.request = Mock(side_effect=OSError("offline"))
        with self.assertRaisesRegex(RuntimeError, "saved locally"):
            self.deliver(job_id)
        self.assertEqual(self.server.request.call_count, 3)
        self.assertEqual(pending_analysis_jobs(self.db, self.origin), [job_id])
        self.assertEqual(
            self.db.execute("SELECT status FROM game_jobs").fetchone()[0], "complete"
        )
        self.server = Destination()
        self.server.origin = self.origin
        # Restarted workers deliver their assigned pending jobs before claiming new games.
        with patch(
            "tools.puzzle_catalog.live.Publisher", return_value=self.server
        ), patch(
            "tools.xiangqi_data.puzzle_mining.discovery.OfflinePikafish"
        ) as engine, patch(
            "tools.xiangqi_data.puzzle_mining.discovery._process_job"
        ) as analyse:
            _worker_main(
                0,
                str(self.path),
                "unused",
                {},
                DiscoveryConfig(),
                1,
                64,
                3,
                "test",
                threading.Event(),
                queue.Queue(),
                self.origin,
                [job_id],
            )
            analyse.assert_not_called()
            engine.return_value.start.assert_not_called()
            engine.return_value.close.assert_called_once()
        self.assertEqual(pending_analysis_jobs(self.db, self.origin), [])

    def test_authentication_errors_and_cancellation_keep_the_upload_pending(self):
        job_id = self.complete()
        self.server.request = Mock(side_effect=PublicationApiError(403, "wrong scope"))
        with self.assertRaisesRegex(RuntimeError, "wrong scope"):
            self.deliver(job_id)
        self.server.request.assert_called_once()
        self.stop.wait.assert_not_called()
        self.stop.set()
        with self.assertRaises(WorkerCancelled):
            self.deliver(job_id)
        self.assertEqual(pending_analysis_jobs(self.db, self.origin), [job_id])

    def test_lost_claim_does_not_queue_or_save_analysis(self):
        seed_game_job(self.db, "catalog", "game", "", discovery_version="test")
        job = claim_game_job(self.db, discovery_version="test")
        self.db.execute("UPDATE game_jobs SET claim_token='someone-else'")
        self.db.commit()
        with self.assertRaisesRegex(RuntimeError, "claim was lost"):
            apply_discovery_result(
                self.db,
                job,
                [],
                game_analysis=evidence(20),
                publication_origin=self.origin,
            )
        self.assertEqual(pending_analysis_jobs(self.db, self.origin), [])
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM game_analyses").fetchone()[0], 0
        )

    def test_save_failure_rolls_back_analysis_and_its_upload_together(self):
        seed_game_job(self.db, "catalog", "game", "", discovery_version="test")
        job = claim_game_job(self.db, discovery_version="test")
        with patch(
            "tools.xiangqi_data.puzzle_mining.storage.insert_candidate",
            side_effect=RuntimeError("candidate write failed"),
        ), self.assertRaisesRegex(RuntimeError, "candidate write failed"):
            apply_discovery_result(
                self.db,
                job,
                [Mock()],
                game_analysis=evidence(20),
                publication_origin=self.origin,
            )
        self.assertEqual(pending_analysis_jobs(self.db, self.origin), [])
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM game_analyses").fetchone()[0], 0
        )
        self.assertEqual(
            self.db.execute("SELECT status FROM game_jobs").fetchone()[0], "processing"
        )

    def test_catalog_upload_resolves_retained_alias_to_canonical_game(self):
        catalog = self.path.with_name("catalog.sqlite3")
        analysis = evidence(20)
        with closing(sqlite3.connect(catalog)) as source:
            source.execute(
                "CREATE TABLE games(id TEXT PRIMARY KEY,moves TEXT,initial_fen TEXT)"
            )
            source.execute(
                "INSERT INTO games VALUES ('canonical',?,?)",
                (json.dumps(analysis["moves"]), analysis["initial_fen"]),
            )
            source.execute(
                "CREATE TABLE game_sources(game_id TEXT,source TEXT,external_id TEXT,collection TEXT)"
            )
            source.execute(
                "INSERT INTO game_sources VALUES ('canonical','dpxq','old','m')"
            )
            source.commit()
        seed_game_job(self.db, "dpxq", "old", "", discovery_version="test")
        job = claim_game_job(self.db, discovery_version="test")
        apply_discovery_result(
            self.db, job, [], game_analysis=analysis, publication_origin=self.origin
        )
        publish_pending_analysis(
            self.db, self.server, job.id, {"dpxq": catalog}, self.stop, lambda _: None
        )
        self.assertEqual(self.server.depths, {"catalog:canonical": 20})
        self.assertEqual(pending_analysis_jobs(self.db, self.origin), [])

    def test_workers_upload_simultaneously_after_committing_each_game(self):
        barrier = threading.Barrier(2)
        received = queue.Queue()
        db_path = self.path

        def request(_publisher, path, body):
            if path.endswith("/inventory"):
                return {"depths": {}}
            # Neither request can finish before both workers reach the upload.
            # A separate writer also proves network waits hold no transaction.
            with closing(sqlite3.connect(db_path, timeout=1)) as check:
                check.execute("BEGIN IMMEDIATE")
                row = check.execute(
                    """SELECT j.status FROM game_jobs j JOIN game_analysis_publications p
                       ON p.job_id=j.id WHERE j.game_id=?""",
                    (body["game"]["id"],),
                ).fetchone()
                check.rollback()
            received.put((body["game"]["id"], row[0] if row else None))
            barrier.wait(timeout=10)
            return {"id": body["game"]["id"], "depth": 20}

        origin = "http://localhost:9663"
        for game in ("native01", "native02"):
            seed_game_job(
                self.db, "lixiangqi:" + origin, game, "", discovery_version="test"
            )

        def finish(db, _engine, job, *_args):
            apply_discovery_result(
                db, job, [], game_analysis=evidence(20), publication_origin=origin
            )
            return "complete", {"stored": 0}

        with patch("tools.xiangqi_data.puzzle_mining.discovery.OfflinePikafish"), patch(
            "tools.xiangqi_data.puzzle_mining.discovery._process_job",
            side_effect=finish,
        ), patch.object(Publisher, "request", request), ThreadPoolExecutor(
            max_workers=2
        ) as pool:
            futures = [
                pool.submit(
                    _worker_main,
                    worker,
                    str(self.path),
                    "unused",
                    {},
                    DiscoveryConfig(),
                    1,
                    64,
                    3,
                    "test",
                    threading.Event(),
                    queue.Queue(),
                    origin,
                    [],
                )
                for worker in range(2)
            ]
            for future in futures:
                future.result(timeout=20)
        self.assertEqual(
            {received.get_nowait(), received.get_nowait()},
            {("native01", "complete"), ("native02", "complete")},
        )
        self.assertEqual(pending_analysis_jobs(self.db, origin), [])

    def test_cli_credentials_are_hidden_and_inherited_not_passed_as_arguments(self):
        with patch.dict(os.environ, {}, clear=True), patch(
            "tools.puzzle_catalog.discovery_publication.sys.stdin.isatty",
            return_value=True,
        ), patch(
            "tools.puzzle_catalog.discovery_publication.getpass.getpass",
            return_value="test-secret",
        ) as prompt, patch.object(
            Publisher, "request", return_value={}
        ) as request:
            publisher = connect_discovery(self.origin)
            self.assertEqual(publisher.token, "test-secret")
            self.assertEqual(os.environ["LIXIANGQI_PUZZLE_TOKEN"], "test-secret")
            prompt.assert_called_once()
            request.assert_called_once_with(
                "/analysis/inventory",
                [{"type": "catalog", "id": "discovery-connection-check"}],
            )

    def test_cli_missing_credentials_fail_before_network_in_noninteractive_runs(self):
        with patch.dict(os.environ, {}, clear=True), patch(
            "tools.puzzle_catalog.discovery_publication.sys.stdin.isatty",
            return_value=False,
        ), patch.object(Publisher, "request") as request:
            with self.assertRaisesRegex(ValueError, "LIXIANGQI_PUZZLE_TOKEN"):
                connect_discovery(self.origin)
            request.assert_not_called()
