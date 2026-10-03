"""Discovery writes wait for contention without discarding engine results."""

from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import tempfile
import threading
import unittest

from tools.xiangqi_data.puzzle_mining import storage
from tools.xiangqi_data.puzzle_mining.workers import WorkerCancelled
from tools.xiangqi_data.tests.test_puzzle_mining import result, score


class DiscoveryWriteContentionTest(unittest.TestCase):
    def test_writes_wait_and_remain_cancellable(self):
        for operation in ("cache", "complete", "fail", "reject"):
            for cancel in (False, True):
                with self.subTest(operation=operation, cancel=cancel):
                    self.check_write(operation, cancel)

    def check_write(self, operation, cancel):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "mining.sqlite3"
            with closing(storage.open_database(path)) as owner:
                storage.seed_game_job(owner, "test", "game", "https://example.com/game")
                job = storage.claim_game_job(owner)
                stop = threading.Event()
                waiting = threading.Event()

                def write():
                    with closing(storage.open_database(path, initialize=False)) as db:
                        db.execute("PRAGMA busy_timeout=1")
                        attempts = 0

                        def trace(sql):
                            nonlocal attempts
                            if sql == "BEGIN IMMEDIATE":
                                attempts += 1
                                if attempts == 2:
                                    waiting.set()

                        db.set_trace_callback(trace)
                        try:
                            if operation == "cache":
                                storage.save_analysis(
                                    db,
                                    context_hash="context",
                                    engine_version="engine",
                                    nnue="nnue",
                                    settings_hash="settings",
                                    result=result(score("cp", 10), "a0a1"),
                                    stop_event=stop,
                                )
                            elif operation == "complete":
                                storage.apply_discovery_result(
                                    db, job, [], stop_event=stop
                                )
                            elif operation == "fail":
                                storage.fail_game_job(
                                    db,
                                    job,
                                    "engine failure",
                                    retryable=True,
                                    max_attempts=3,
                                    stop_event=stop,
                                )
                            else:
                                storage.reject_game_job(
                                    db, job, "invalid game", stop_event=stop
                                )
                        finally:
                            self.assertFalse(db.in_transaction)
                            self.assertEqual(
                                db.execute("PRAGMA busy_timeout").fetchone()[0], 1
                            )

                owner.execute("BEGIN IMMEDIATE")
                with ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(write)
                    try:
                        self.assertTrue(waiting.wait(5))
                        self.assertFalse(future.done())
                        if cancel:
                            stop.set()
                            with self.assertRaises(WorkerCancelled):
                                future.result(timeout=5)
                        else:
                            owner.rollback()
                            future.result(timeout=5)
                    finally:
                        stop.set()
                        owner.rollback()
                status = owner.execute("SELECT status FROM game_jobs").fetchone()[0]
                self.assertEqual(
                    status,
                    (
                        "processing"
                        if cancel or operation == "cache"
                        else {
                            "complete": "complete",
                            "fail": "retry",
                            "reject": "rejected",
                        }[operation]
                    ),
                )
                self.assertEqual(
                    owner.execute("SELECT count(*) FROM analysis_cache").fetchone()[0],
                    int(operation == "cache" and not cancel),
                )
