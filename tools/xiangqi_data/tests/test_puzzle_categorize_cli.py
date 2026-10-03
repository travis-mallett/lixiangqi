"""Separate operator entry points and engine-free classification reuse."""

import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from tools.xiangqi_data.puzzle_mining import checkmate, verification
from tools.xiangqi_data.puzzle_mining.storage import open_database


class CheckmateCliTest(unittest.TestCase):
    def test_first_pass_has_engine_and_signals_publishable_results(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "puzzles.sqlite3"
            # The supervisor owns initialization; workers open the prepared store.
            open_database(database).close()
            args = SimpleNamespace(
                database=database,
                engine=Path(directory) / "pikafish.exe",
                hash_mb=16,
                nodes=100,
                workers=1,
                force_reclassify_same_version=False,
                catalog_db=None,
                continuous=False,
            )
            changed = threading.Event()

            def classify(db, **kwargs):
                # Evidence must be available before scanning any candidates.
                self.assertIs(kwargs["engine"], engine.return_value)
                kwargs["engine"].checking_pieces("test position")
                args.catalog_db = Path(directory) / "catalog.sqlite3"
                return {"classified": 1}

            with (
                patch.object(checkmate, "OfflinePikafish") as engine,
                patch.object(checkmate, "classify_solutions", side_effect=classify) as run,
            ):
                checkmate._worker_main(0, args, threading.Event(), changed)
            run.assert_called_once()
            engine.return_value.checking_pieces.assert_called_once()
            engine.return_value.close.assert_called_once()
            self.assertTrue(changed.is_set())

    def test_worker_passes_stop_event_and_closes_after_database_cancellation(self):
        from tools.xiangqi_data.puzzle_mining.workers import WorkerCancelled

        with tempfile.TemporaryDirectory() as directory:
            connection = open_database(Path(directory) / "puzzles.sqlite3")
            stop = threading.Event()
            args = SimpleNamespace(
                database=Path(directory) / "puzzles.sqlite3",
                nodes=100,
                force_reclassify_same_version=False,
                workers=20,
                engine=Path(directory) / "pikafish.exe",
                hash_mb=16,
            )

            def cancel(db, **kwargs):
                self.assertIs(db, connection)
                self.assertIs(kwargs["stop_event"], stop)
                stop.set()
                raise WorkerCancelled("stopped while waiting for database")

            with (
                patch.object(checkmate, "open_database", return_value=connection),
                patch.object(checkmate, "classify_solutions", side_effect=cancel),
                patch.object(checkmate, "OfflinePikafish") as engine,
            ):
                checkmate._worker_main(4, args, stop, threading.Event())
            engine.return_value.close.assert_called_once()
            engine.return_value.start.assert_not_called()
            import sqlite3

            with self.assertRaises(sqlite3.ProgrammingError):
                connection.execute("SELECT 1")

    def test_verifier_exposes_explicit_reconstruction(self):
        with patch(
            "sys.argv", ["verify", "--reconstruct-old-puzzles", "--force-reverify"]
        ):
            args = verification.parse_args()
        self.assertTrue(args.reconstruct_old_puzzles)
        self.assertTrue(args.force_reverify)
        self.assertFalse(hasattr(args, "max_branches"))
        self.assertFalse(hasattr(args, "max_multipv"))

    def test_categorizer_does_not_accept_solution_search_options(self):
        with patch("sys.argv", ["categorize", "--max-branches", "10"]):
            with self.assertRaises(SystemExit):
                checkmate.parse_args()

    def test_empty_classification_does_not_require_an_engine(self):
        with tempfile.TemporaryDirectory() as directory:
            connection = open_database(Path(directory) / "puzzles.sqlite3")
            try:
                self.assertEqual(checkmate.classify_solutions(connection), {})
            finally:
                connection.close()

    def test_category_config_is_independent_of_verification(self):
        self.assertFalse(hasattr(checkmate.CategorizerConfig(), "max_branches"))
        self.assertFalse(hasattr(checkmate.CategorizerConfig(), "version"))
        self.assertEqual(
            verification.VerifierConfig().version,
            verification.CHECKMATE_VERIFIER_VERSION,
        )
