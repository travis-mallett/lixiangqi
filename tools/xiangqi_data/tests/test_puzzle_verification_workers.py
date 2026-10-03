"""Verification leases must survive searches that do not finish a move."""

from contextlib import ExitStack
from argparse import Namespace
from pathlib import Path
import queue
import threading
import unittest
from unittest.mock import Mock, patch

from tools.xiangqi_data.puzzle_mining import verification as verifier
from tools.xiangqi_data.puzzle_mining import workers
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
from tools.xiangqi_data.puzzle_mining.workers import WorkerClaimLost


class VerificationWorkerTest(unittest.TestCase):
    def run_worker(self, action):
        self.stop = threading.Event()
        self.reports = queue.Queue()
        self.engine = Mock()
        self.claim = Mock()
        self.claim.candidate.source_database = "test"
        self.clock = 0.0
        with ExitStack() as stack:
            for name, value in {
                "open_database": Mock(),
                "OfflinePikafish": Mock(return_value=self.engine),
                "verification_signature": Mock(return_value="signature"),
                "claim_verification": Mock(side_effect=[self.claim, None]),
                "wait_for_due_jobs": Mock(return_value=False),
                "begin_write": Mock(),
            }.items():
                stack.enter_context(patch.object(verifier, name, value))
            stack.enter_context(
                patch(
                    "tools.xiangqi_data.puzzle_mining.queue_priority.prepare_priority"
                )
            )
            stack.enter_context(
                patch.object(verifier.time, "monotonic", side_effect=lambda: self.clock)
            )
            stack.enter_context(
                patch.object(verifier, "verify_candidate", side_effect=action)
            )
            self.renew = stack.enter_context(patch.object(verifier, "renew_claim"))
            self.fail = stack.enter_context(patch.object(verifier, "fail_verification"))
            verifier._worker_main(
                0,
                "unused",
                "unused",
                {"test": "unused"},
                verifier.TacticVerifierConfig(),
                1,
                128,
                3,
                self.stop,
                self.reports,
            )

    def test_lease_renews_during_engine_wait_without_move_progress(self):
        def search(*args, **kwargs):
            self.engine.cancel_event = self.stop
            self.engine.construction_deadline = None
            self.engine.process = None
            self.engine.output = Mock()

            def output(**kwargs):
                self.clock += 31
                if self.clock < 3720:
                    raise queue.Empty
                return "bestmove a0a1"

            self.engine.output.get.side_effect = output
            self.assertEqual(
                OfflinePikafish._read_until(self.engine, float("inf")), "bestmove a0a1"
            )
            self.assertGreater(self.renew.call_count, 100)
            return "invalid", None

        self.run_worker(search)
        self.assertIsNone(self.engine.heartbeat)
        self.fail.assert_not_called()
        self.assertFalse(self.stop.is_set())

    def test_lost_claim_does_not_fail_job_or_stop_other_workers(self):
        self.run_worker(Mock(side_effect=WorkerClaimLost("reclaimed")))
        self.fail.assert_not_called()
        self.assertFalse(self.stop.is_set())
        self.assertIn("warning", [event[0] for event in self.reports.queue])

    def test_fatal_worker_error_is_reported_before_completion(self):
        def fail(*args, **kwargs):
            self.fail.side_effect = RuntimeError("database write failed")
            raise ValueError("search failed")

        with self.assertRaisesRegex(RuntimeError, "database write failed"):
            self.run_worker(fail)
        kinds = [event[0] for event in self.reports.queue]
        self.assertLess(kinds.index("worker_error"), kinds.index("worker_done"))

    def test_supervisor_never_reports_failed_workers_as_complete(self):
        for event in [("worker_error", 0, "write failed"), ("worker_done", 0)]:
            with self.subTest(event=event), ExitStack() as stack:
                args = Namespace(
                    poll_interval=5,
                    workers=1,
                    engine_threads=1,
                    candidate_type="tactic_candidate",
                    version=None,
                    depth=20,
                    max_uncertainty_retries=1,
                    max_solution_plies=31,
                    hash_mb=128,
                    advantage=0.55,
                    uniqueness_gap=0.5,
                    max_positions=4096,
                    database=Path("unused"),
                    engine=Path(__file__),
                    reconstruct_old_puzzles=False,
                    force_reverify=False,
                    continuous=False,
                    source_db=[Path(__file__)],
                    max_attempts=3,
                    catalog_db=None,
                )
                db = Mock()
                db.execute.return_value.fetchone.return_value = (1,)
                db.execute.return_value.__iter__ = Mock(return_value=iter(()))
                context = Mock()
                context.Queue.return_value.get.return_value = event
                context.Process.return_value.exitcode = 1
                dashboard = Mock()
                for name, value in {
                    "parse_args": Mock(return_value=args),
                    "open_database_when_ready": Mock(return_value=db),
                    "OfflinePikafish": Mock(),
                    "verification_signature": Mock(return_value="signature"),
                    "seed_verification": Mock(),
                    "VerificationDashboard": Mock(return_value=dashboard),
                    "catalog_source_paths": Mock(return_value={}),
                    "start_workers": Mock(),
                    "stop_workers": Mock(),
                }.items():
                    stack.enter_context(patch.object(verifier, name, value))
                stack.enter_context(
                    patch.object(verifier.mp, "get_context", return_value=context)
                )
                with self.assertRaisesRegex(RuntimeError, "failed"):
                    verifier.main("tactic_candidate")
                dashboard.finish.assert_called_once_with(
                    "Verification stopped by an error"
                )


class SupervisorWatchdogTest(unittest.TestCase):
    class _Supervisor:
        def __init__(self, alive):
            self.alive = alive

        def is_alive(self):
            return self.alive

    def test_worker_stops_when_its_supervisor_disappears(self):
        stop = threading.Event()
        with patch.object(workers.mp, "parent_process", return_value=self._Supervisor(False)):
            workers.watch_supervisor(stop, interval=0.01)
            self.assertTrue(stop.wait(5))

    def test_running_supervisor_leaves_its_workers_alone(self):
        stop = threading.Event()
        try:
            with patch.object(
                workers.mp, "parent_process", return_value=self._Supervisor(True)
            ):
                workers.watch_supervisor(stop, interval=0.01)
                self.assertFalse(stop.wait(0.2))
        finally:
            stop.set()


if __name__ == "__main__":
    unittest.main()
