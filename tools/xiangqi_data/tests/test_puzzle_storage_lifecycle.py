"""Independent verification, classification, recovery, and publication contracts."""

from contextlib import closing
import json
import sqlite3
import tempfile
import unittest
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch
from tools.xiangqi_data.puzzle_mining import storage
from tools.xiangqi_data.puzzle_mining.database_write import begin_write
from tools.xiangqi_data.puzzle_mining.storage import (
    SCHEMA_VERSION,
    insert_candidate,
    open_database,
    open_database_when_ready,
)
from tools.xiangqi_data.puzzle_mining.models import (
    CandidateRecord,
    EngineScore,
    PositionStatus,
)
from tools.xiangqi_data.puzzle_mining.position import (
    candidate_key,
    position_hash,
    replay_fens,
)
from tools.xiangqi_data.puzzle_mining.verification import VerifierConfig
from tools.xiangqi_data.puzzle_mining.verification_store import (
    seed_verification,
    claim_verification,
    finish_verification,
    fail_verification,
    verification_signature,
    candidate_pool_sql,
    verification_progress,
)
from tools.xiangqi_data.puzzle_mining.solver import SolveResult, VerifiedBranch
from tools.xiangqi_data.puzzle_mining.classification import Motif, MotifRegistry
from tools.xiangqi_data.puzzle_mining.classification_job import reclassify_canonical
from tools.xiangqi_data.tests.test_puzzle_equal_mates import TreeEngine


class PuzzleStorageLifecycleTest(unittest.TestCase):
    def test_expired_verifier_cannot_overwrite_reclaimed_job(self):
        from tools.xiangqi_data.puzzle_mining.workers import WorkerClaimLost

        original = self.claim()
        self.connection.execute(
            "UPDATE verification_jobs SET claimed_at='2000-01-01T00:00:00+00:00'"
        )
        self.connection.commit()
        replacement = self.claim()
        self.assertNotEqual(
            original.candidate.claim_token, replacement.candidate.claim_token
        )
        with self.assertRaises(WorkerClaimLost):
            finish_verification(
                self.connection,
                original,
                self.config,
                self.engine,
                invalid="ambiguous_tactic_start",
            )
        with self.assertRaises(WorkerClaimLost):
            fail_verification(self.connection, original, "stale result")
        self.assertEqual(
            self.connection.execute(
                "SELECT count(*) FROM candidate_assessments"
            ).fetchone()[0],
            0,
        )
        finish_verification(
            self.connection, replacement, self.config, self.engine, result=self.result()
        )
        self.assertIsNotNone(self.current()["current_verification_id"])

    def test_progress_counts_old_rejections_and_current_terminal_outcomes(self):
        claim = self.claim()
        finish_verification(
            self.connection,
            claim,
            self.config,
            self.engine,
            invalid="mate_not_reproduced",
        )
        self.assertEqual(verification_progress(self.connection)["finished"], 1)
        seed_verification(self.connection, "new-policy")
        pending = verification_progress(self.connection)
        self.assertEqual(
            (pending["work_total"], pending["finished"], pending["remaining"]),
            (1, 0, 1),
        )
        claim = claim_verification(self.connection, "new-policy")
        finish_verification(
            self.connection,
            claim,
            self.config,
            self.engine,
            result=replace(
                self.result(), complete=False, uncertainty=("construction_time_limit",)
            ),
        )
        complete = verification_progress(self.connection)
        self.assertEqual(
            (complete["work_total"], complete["finished"], complete["remaining"]),
            (1, 1, 0),
        )

    def test_progress_excludes_preserved_solutions_from_new_queue(self):
        self.verify()
        seed_verification(self.connection, "new-policy")
        self.assertEqual(verification_progress(self.connection)["work_total"], 0)

    def test_claim_waits_for_writer_without_worker_failure(self):
        seed_verification(self.connection, "contended")
        stop = threading.Event()

        def claim():
            with closing(sqlite3.connect(self.path, timeout=0.01)) as db:
                db.row_factory = sqlite3.Row
                return claim_verification(db, "contended", stop_event=stop)

        self.connection.execute("BEGIN IMMEDIATE")
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(claim)
            time.sleep(0.1)
            self.assertFalse(future.done())
            self.connection.rollback()
            self.assertIsNotNone(future.result(timeout=3))

    def test_failure_outcomes_wait_for_writer(self):
        for inconclusive, attempts, expected in (
            (True, 3, "incomplete"),
            (False, 3, "retry"),
            (False, 1, "failed"),
        ):
            with self.subTest(expected=expected):
                signature = f"contended-{expected}"
                seed_verification(self.connection, signature)
                claim = claim_verification(self.connection, signature)
                stop = threading.Event()
                waiting = threading.Event()

                def finish():
                    with closing(sqlite3.connect(self.path, timeout=0.01)) as db:
                        db.set_trace_callback(
                            lambda sql: waiting.set() if sql == "BEGIN IMMEDIATE" else None
                        )
                        status = fail_verification(
                            db, claim, "tactic_repetition",
                            inconclusive=inconclusive, max_attempts=attempts,
                            stop_event=stop,
                        )
                        self.assertFalse(db.in_transaction)
                        self.assertEqual(db.execute("PRAGMA busy_timeout").fetchone()[0], 10)
                        return status

                self.connection.execute("BEGIN IMMEDIATE")
                with ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(finish)
                    try:
                        self.assertTrue(waiting.wait(3))
                        time.sleep(0.05)
                        self.assertFalse(future.done())
                    finally:
                        self.connection.rollback()
                    self.assertEqual(future.result(timeout=3), expected)
                row = self.connection.execute(
                    "SELECT status,claim_token FROM verification_jobs WHERE id=?", (claim.id,)
                ).fetchone()
                self.assertEqual(tuple(row), (expected, None))

    def test_waiting_writer_can_be_cancelled(self):
        from tools.xiangqi_data.puzzle_mining.workers import WorkerCancelled

        stop = threading.Event()
        stop.set()
        with self.assertRaises(WorkerCancelled):
            begin_write(self.connection, stop)

    def test_reopening_an_initialized_database_writes_nothing(self):
        statements = []
        connect = sqlite3.connect

        def traced(*args, **kwargs):
            connection = connect(*args, **kwargs)
            connection.set_trace_callback(statements.append)
            return connection

        with patch.object(storage.sqlite3, "connect", traced):
            reopened = open_database(self.path)
        try:
            writes = [
                sql
                for sql in statements
                if sql.split(None, 1)[0].upper()
                in {"BEGIN", "INSERT", "UPDATE", "DELETE", "REPLACE"}
            ]
            self.assertEqual(writes, [])
        finally:
            reopened.close()

    def test_worker_connection_ignores_a_writer_holding_the_lock(self):
        writer = sqlite3.connect(self.path, timeout=0, isolation_level=None)
        writer.execute("PRAGMA busy_timeout=1")
        writer.execute("BEGIN IMMEDIATE")
        try:
            worker = open_database(self.path, initialize=False)
            try:
                self.assertEqual(
                    worker.execute(
                        "SELECT value FROM metadata WHERE key='schema_version'"
                    ).fetchone()[0],
                    str(SCHEMA_VERSION),
                )
            finally:
                worker.close()
        finally:
            writer.rollback()
            writer.close()

    def test_worker_connection_rejects_an_uninitialized_database(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(
                RuntimeError, "Initialize it before starting workers"
            ):
                open_database(Path(directory) / "fresh.sqlite3", initialize=False)

    def test_supervisor_constructions_retry_only_a_locked_database(self):
        with patch.object(
            storage,
            "open_database",
            side_effect=[sqlite3.OperationalError("database is locked"), self.connection],
        ) as attempt:
            self.assertIs(
                open_database_when_ready(self.path, interval=0), self.connection
            )
        self.assertEqual(attempt.call_count, 2)
        with patch.object(
            storage, "open_database", side_effect=RuntimeError("unsupported schema")
        ):
            with self.assertRaisesRegex(RuntimeError, "unsupported schema"):
                open_database_when_ready(self.path, interval=0)

    def test_new_checkmate_policy_reconsiders_rejections_without_reconstruction(self):
        claim = self.claim()
        finish_verification(
            self.connection,
            claim,
            self.config,
            self.engine,
            invalid="ambiguous_attacking_mate",
        )
        self.assertIsNone(self.claim())
        self.assertIsNotNone(
            self.claim(config=replace(self.config, version="next-policy"))
        )

    def test_timeout_is_held_for_same_signature_and_preserves_existing_solution(self):
        self.verify()
        old = self.current()["current_verification_id"]
        config = replace(self.config, version="timeout-test")
        claim = self.claim(config=config, reconstruct=True)
        result = replace(
            self.result(), complete=False, uncertainty=("construction_time_limit",)
        )
        finish_verification(self.connection, claim, config, self.engine, result=result)
        self.assertEqual(self.current()["current_verification_id"], old)
        self.assertIsNone(self.claim(config=config, reconstruct=True))

    def test_discarded_nonmate_leaves_pool_but_keeps_recoverable_evidence(self):
        claim = self.claim()
        status, _ = finish_verification(
            self.connection,
            claim,
            self.config,
            self.engine,
            invalid="mate_not_reproduced",
        )
        self.assertEqual(status, "invalid")
        self.assertEqual(self.connection.execute(candidate_pool_sql()).fetchall(), [])
        self.assertIsNone(self.claim())
        self.assertEqual(
            self.connection.execute("SELECT count(*) FROM candidates").fetchone()[0], 1
        )
        self.assertIsNotNone(self.claim(force=True))

    def test_manual_nonmate_cleanup_is_backed_up_and_idempotent(self):
        from importlib import import_module
        from tools.xiangqi_data.puzzle_mining.storage import _json

        migration = import_module(
            "tools.data_migration.20260913_discard_legacy_nonmates"
        )
        claim = self.claim()
        self.connection.execute(
            "UPDATE candidates SET source_database='catalog',after_score_json=?",
            (_json(EngineScore("mate", -1).to_dict()),),
        )
        self.connection.commit()
        fail_verification(
            self.connection,
            claim,
            "inconclusive: mate_not_reproduced_inconclusive; settings="
            + json.dumps(self.config.settings()),
            inconclusive=True,
        )
        self.connection.execute(
            "UPDATE verification_jobs SET updated_at='2026-09-13T20:00:00'"
        )
        self.connection.commit()
        report = migration.migrate(self.path, apply=True, expected=1)
        self.assertEqual(report["discarded"], 1)
        self.assertEqual(migration.migrate(self.path, apply=True, expected=1), report)
        with closing(sqlite3.connect(report["backup"])) as backup:
            self.assertEqual(
                backup.execute("SELECT status FROM verification_jobs").fetchone()[0],
                "incomplete",
            )
            self.assertIsNone(
                backup.execute(
                    "SELECT current_verification_id FROM candidates"
                ).fetchone()[0]
            )
        self.assertEqual(self.connection.execute(candidate_pool_sql()).fetchall(), [])

    def setUp(self, *, themes=()):
        self.scope_categories(themes)
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "puzzles.sqlite3"
        self.connection = open_database(self.path)
        self.config = VerifierConfig(depth=20)
        self.engine = TreeEngine({})
        self.key = self.candidate().candidate_key
        insert_candidate(self.connection, self.candidate())

    def tearDown(self):
        try:
            self.connection.close()
            self.temp.cleanup()
        finally:
            # Other suites also use this fixture directly rather than through
            # unittest's runner, so restore its taxonomy in either lifecycle.
            self.doCleanups()

    def scope_categories(self, themes):
        """Limit synthetic evidence to the categories the test actually supplies.

        Pure registered predicates remain available. None selects the complete
        production taxonomy for tests of the full publication boundary.
        """
        from tools.xiangqi_data.puzzle_mining.patterns import THEME_LOGIC_VERSIONS

        versions = (
            dict(THEME_LOGIC_VERSIONS)
            if themes is None
            else {theme: THEME_LOGIC_VERSIONS[theme] for theme in themes}
        )
        self.enterContext(
            patch(
                "tools.xiangqi_data.puzzle_mining.classification.THEME_LOGIC_VERSIONS",
                versions,
            )
        )

    def candidate(
        self, *, engine: str = "engine", value: int = 20, move: str = "a4a5"
    ) -> CandidateRecord:
        fens = replay_fens([move])
        return CandidateRecord(
            candidate_key=candidate_key(fens[1], (move,)),
            source_database="test",
            game_id="g1",
            source_url="",
            ply=1,
            side_to_move="black",
            pre_fen=fens[0],
            position_fen=fens[1],
            position_hash=position_hash(fens[1]),
            played_move=move,
            best_move="b1c3",
            before_score=EngineScore("cp", value, (700, 200, 100)),
            after_score=EngineScore("cp", -value, (100, 200, 700)),
            evaluation_loss=0.8,
            candidate_type="checkmate_candidate",
            engine_version=engine,
            nnue="test.nnue",
            search_settings={"nodes": 100},
        )

    def claim(self, *, config=None, reconstruct=False, force=False):
        signature = verification_signature(config or self.config, self.engine)
        seed_verification(
            self.connection, signature, reconstruct=reconstruct, force=force
        )
        return claim_verification(
            self.connection, signature, reconstruct=reconstruct or force
        )

    def result(self, moves=("a7a6",), *, complete=True, branches=None):
        branch = VerifiedBranch(
            moves, PositionStatus("4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1", True, ())
        )
        return SolveResult(
            tuple(branches or (branch,)),
            self.engine.engine_version,
            self.engine.nnue,
            100,
            10,
            () if complete else ("branch_limit",),
            complete,
        )

    def verify(self, *, config=None, result=None, reconstruct=False, force=False):
        claim = self.claim(config=config, reconstruct=reconstruct, force=force)
        self.assertIsNotNone(claim)
        return finish_verification(
            self.connection,
            claim,
            config or self.config,
            self.engine,
            result=result or self.result(),
        )

    def classify(self, *, theme="testKill", version="1", predicate=None, force=False):
        registry = MotifRegistry(
            (Motif(theme, predicate or (lambda trace: True), version),)
        )
        return reclassify_canonical(
            self.connection, self.key, registry=registry, force=force
        )

    def current(self):
        return self.connection.execute("SELECT * FROM candidates").fetchone()

    def test_import_live_identity_preserves_proof_and_replaces_local_duplicate(self):
        from tools.puzzle_catalog.mining_inventory import import_live_positions

        self.verify()
        self.classify()
        old_id = self.connection.execute("SELECT id FROM puzzles").fetchone()[0]
        verification_id = self.current()["current_verification_id"]
        catalog_path = Path(self.temp.name) / "inherited.sqlite3"
        puzzle = {
            "_id": "live1",
            "gameId": "g1",
            "gameSource": {"type": "catalog", "database": "test"},
            "fen": self.candidate().pre_fen,
            "line": "a4a5 a7a6",
            "themes": ["mate", "mateIn1"],
            "retired": False,
            "retirementReason": None,
            "sourceSnapshot": {
                "initialFen": self.candidate().pre_fen,
                "moves": ["a4a5"],
                "players": [],
            },
        }
        with closing(sqlite3.connect(catalog_path)) as db, db:
            db.execute("CREATE TABLE catalog_metadata(key TEXT,value TEXT)")
            db.execute(
                "INSERT INTO catalog_metadata VALUES('baseline',?)",
                (json.dumps([puzzle]),),
            )
        self.assertEqual(import_live_positions(self.connection, catalog_path), 1)
        self.assertEqual(import_live_positions(self.connection, catalog_path), 0)
        self.assertEqual(self.current()["current_verification_id"], verification_id)
        self.assertIsNone(self.current()["current_classification_id"])
        self.assertEqual(
            dict(self.connection.execute("SELECT id,verification_status FROM puzzles")),
            {old_id: "withdrawn", "live1": "active"},
        )
        backups = list(Path(self.temp.name).glob("*.before-live-import-*.sqlite3"))
        self.assertEqual(backups, [])

    def prepare_live_candidate(self):
        from tools.xiangqi_data.puzzle_mining.queue_priority import prepare_priority

        self.verify()
        insert_candidate(
            self.connection,
            replace(
                self.candidate(move="c4c5"),
                candidate_key="live-second",
                game_id="g2",
            ),
        )
        self.verify()
        catalog_path = Path(self.temp.name) / "catalog.sqlite3"
        with closing(sqlite3.connect(catalog_path)) as catalog, catalog:
            catalog.executescript("""
                CREATE TABLE catalog_metadata(key TEXT,value TEXT);
                CREATE TABLE catalog_puzzles(id TEXT,evidence TEXT);
            """)
            catalog.execute(
                "INSERT INTO catalog_metadata VALUES('baseline',?)",
                (json.dumps([{"_id": "live1", "retired": False}]),),
            )
            catalog.execute(
                "INSERT INTO catalog_puzzles VALUES('live1',?)",
                (json.dumps({"candidateKey": "live-second"}),),
            )
        prepare_priority(self.connection, catalog_path)

    def test_reconstruction_claims_live_before_older_verified_candidate(self):
        self.prepare_live_candidate()
        signature = "new-configuration"
        seed_verification(self.connection, signature, reconstruct=True)
        first = claim_verification(self.connection, signature, reconstruct=True)
        second = claim_verification(self.connection, signature, reconstruct=True)
        self.assertEqual(first.candidate.candidate_key, "live-second")
        self.assertEqual(second.candidate.candidate_key, self.key)

    def test_reclassification_visits_live_then_verified_candidates(self):
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            classify_solutions,
            TaxonomyResult,
        )

        self.prepare_live_candidate()
        with patch(
            "tools.xiangqi_data.puzzle_mining.classification_job.reclassify_canonical",
            return_value=TaxonomyResult("classified"),
        ) as classify:
            classify_solutions(self.connection, force=True)
        self.assertEqual(
            [call.args[1] for call in classify.call_args_list],
            ["live-second", self.key],
        )
        with patch(
            "tools.xiangqi_data.puzzle_mining.classification_job.reclassify_canonical",
            return_value=TaxonomyResult("classified"),
        ) as classify:
            classify_solutions(self.connection, force=True, published_only=True)
        self.assertEqual(
            [call.args[1] for call in classify.call_args_list], ["live-second"]
        )

    def test_verification_does_not_classify_or_publish(self):
        self.verify()
        self.assertIsNotNone(self.current()["current_verification_id"])
        self.assertIsNone(self.current()["current_classification_id"])
        self.assertEqual(
            self.connection.execute("SELECT count(*) FROM puzzles").fetchone()[0], 0
        )

    def test_full_taxonomy_requires_evidence_before_publication(self):
        self.scope_categories(None)
        self.verify()
        result = reclassify_canonical(self.connection, self.key)
        self.assertEqual(result.status, "awaiting_classification_evidence")
        self.assertIsNone(self.current()["current_classification_id"])
        self.assertEqual(
            self.connection.execute("SELECT count(*) FROM puzzles").fetchone()[0], 0
        )
        self.assertGreater(
            self.connection.execute(
                "SELECT count(*) FROM category_assessments WHERE outcome='inconclusive'"
            ).fetchone()[0],
            0,
        )

    def test_reclassification_preserves_evidence_and_uses_new_category_versions(self):
        self.verify()
        evidence = dict(
            self.connection.execute("SELECT * FROM candidate_assessments").fetchone()
        )
        self.assertEqual(self.classify().status, "classified")
        self.assertEqual(self.classify().status, "already_current")
        self.assertEqual(self.classify(version="2").status, "classified")
        self.assertEqual(
            dict(
                self.connection.execute(
                    "SELECT * FROM candidate_assessments"
                ).fetchone()
            ),
            evidence,
        )
        self.assertEqual(
            self.connection.execute(
                "SELECT count(*) FROM candidate_assessments"
            ).fetchone()[0],
            1,
        )

    def test_default_skips_solutions_even_when_verifier_version_changes(self):
        self.verify()
        self.assertIsNone(
            self.claim(config=replace(self.config, version="next-test-version"))
        )
        self.assertIsNotNone(
            self.claim(
                config=replace(self.config, version="next-test-version"),
                reconstruct=True,
            )
        )

    def test_normal_start_skips_old_reconstruction_queue_and_explicit_can_resume(self):
        self.verify()
        signature = "stale-reconstruction"
        seed_verification(self.connection, signature, reconstruct=True)
        self.assertEqual(seed_verification(self.connection, signature), 0)
        self.assertIsNone(claim_verification(self.connection, signature))
        self.assertEqual(
            self.connection.execute(
                "SELECT status FROM verification_jobs WHERE signature=?", (signature,)
            ).fetchone()[0],
            "skipped",
        )
        seed_verification(self.connection, signature, reconstruct=True)
        self.assertIsNotNone(
            claim_verification(self.connection, signature, reconstruct=True)
        )

    def test_claim_rechecks_completion_after_seeding_and_expired_reconstruction(self):
        self.verify()
        for state in ("queued", "retry", "processing"):
            signature = "stale-" + state
            seed_verification(self.connection, signature, reconstruct=True)
            with self.connection:
                self.connection.execute(
                    "UPDATE verification_jobs SET status=?,claimed_at='2000-01-01T00:00:00+00:00' WHERE signature=?",
                    (state, signature),
                )
            self.assertIsNone(claim_verification(self.connection, signature))
            self.assertEqual(
                self.connection.execute(
                    "SELECT status FROM verification_jobs WHERE signature=?",
                    (signature,),
                ).fetchone()[0],
                "skipped",
            )
        self.assertEqual(
            self.connection.execute(
                "SELECT count(*) FROM candidate_assessments"
            ).fetchone()[0],
            1,
        )

    def test_historical_acceptance_never_reconstructs_by_default(self):
        self.verify()
        with self.connection:
            self.connection.execute(
                "UPDATE candidate_assessments SET coverage='legacy'"
            )
            self.connection.execute(
                "UPDATE candidates SET current_verification_id=NULL"
            )
        self.assertIsNone(self.claim(config=replace(self.config, version="new-budget")))
        self.assertIsNotNone(
            self.claim(
                config=replace(self.config, version="new-budget"), reconstruct=True
            )
        )

    def test_published_solution_without_current_proof_requires_explicit_reconstruction(
        self,
    ):
        self.verify()
        self.classify()
        with self.connection:
            self.connection.execute(
                "UPDATE candidate_assessments SET coverage='legacy',accepted=0"
            )
            self.connection.execute(
                "UPDATE candidates SET current_verification_id=NULL"
            )
        self.assertIsNone(self.claim(config=replace(self.config, version="new-budget")))
        self.assertIsNotNone(
            self.claim(
                config=replace(self.config, version="new-budget"), reconstruct=True
            )
        )

    def test_short_mates_are_claimed_first_but_live_puzzles_stay_first(self):
        for key, distance, move in [
            ("long", -9, "c4c5"),
            ("short", -1, "e4e5"),
            ("live", -7, "g4g5"),
        ]:
            insert_candidate(
                self.connection,
                replace(
                    self.candidate(move=move),
                    candidate_key=key,
                    after_score=EngineScore("mate", distance),
                ),
            )
        from tools.xiangqi_data.puzzle_mining.queue_priority import prepare_priority

        prepare_priority(self.connection)
        self.connection.execute(
            "INSERT INTO live_candidates SELECT id FROM candidates WHERE candidate_key='live'"
        )
        self.connection.commit()
        self.assertEqual(self.claim().candidate.candidate_key, "live")
        self.assertEqual(self.claim().candidate.candidate_key, "short")
        self.assertEqual(self.claim().candidate.candidate_key, "long")

    def test_new_revision_recovers_exhausted_missing_source_jobs(self):
        old_config = replace(self.config, version="missing-source-bug")
        claim = self.claim(config=old_config)
        fail_verification(
            self.connection, claim, "source database is not installed", max_attempts=1
        )
        self.assertIsNone(self.claim(config=old_config))
        recovered = self.claim()
        self.assertIsNotNone(recovered)
        self.assertEqual(recovered.candidate.attempts, 1)
        self.assertEqual(
            self.connection.execute(
                "SELECT status FROM verification_jobs WHERE id=?", (claim.id,)
            ).fetchone()[0],
            "failed",
        )

    def test_reconstruct_is_resumable_force_repeats_same_signature(self):
        self.verify()
        self.assertIsNone(self.claim(reconstruct=True))
        self.assertIsNotNone(self.claim(force=True))

    def test_reduced_budget_settings_do_not_requeue_complete_proofs(self):
        self.verify(config=replace(self.config, depth=30))
        self.assertIsNone(self.claim())
        self.assertIsNotNone(self.claim(force=True))

    def test_rediscovery_keeps_one_candidate_across_engine_runs(self):
        self.verify()
        for version in ("old", "new", "new"):
            insert_candidate(self.connection, self.candidate(engine=version, value=40))
        self.assertEqual(
            self.connection.execute("SELECT count(*) FROM candidates").fetchone()[0], 1
        )
        self.assertIsNotNone(self.current()["current_verification_id"])

    def test_rediscovery_does_not_invalidate_solution(self):
        self.verify()
        self.classify()
        before = self.current()
        insert_candidate(
            self.connection, self.candidate(engine="new-discoverer", value=40)
        )
        after = self.current()
        self.assertNotEqual(before["discovery_revision"], after["discovery_revision"])
        self.assertEqual(
            before["current_verification_id"], after["current_verification_id"]
        )
        self.assertEqual(
            before["current_classification_id"], after["current_classification_id"]
        )
        self.assertIsNone(self.claim())

    def test_same_version_reverification_requires_fresh_classification(self):
        self.verify()
        self.classify()
        old = self.current()["current_verification_id"]
        self.verify(force=True)
        self.assertNotEqual(old, self.current()["current_verification_id"])
        self.assertIsNone(self.current()["current_classification_id"])
        self.assertEqual(self.classify().status, "classified")
        self.assertEqual(
            self.connection.execute(
                "SELECT count(*) FROM puzzles WHERE verification_status='active'"
            ).fetchone()[0],
            1,
        )

    def test_changed_mainline_retires_old_identity_only_after_classification(self):
        self.verify()
        self.classify()
        original = dict(self.connection.execute("SELECT * FROM puzzles").fetchone())
        self.verify(force=True, result=self.result(("b7b6",)))
        self.assertEqual(
            self.connection.execute(
                "SELECT verification_status FROM puzzles"
            ).fetchone()[0],
            "active",
        )
        self.classify()
        retired = self.connection.execute(
            "SELECT * FROM puzzles WHERE id=?", (original["id"],)
        ).fetchone()
        self.assertEqual(retired["verification_status"], "withdrawn")
        self.assertEqual(retired["solution"], original["solution"])
        self.assertEqual(
            self.connection.execute("SELECT count(*) FROM puzzles").fetchone()[0], 2
        )

    def test_category_change_keeps_solve_id_and_advances_evidence(self):
        self.verify()
        self.classify()
        original = dict(self.connection.execute("SELECT * FROM puzzles").fetchone())
        self.classify(theme="anotherKill", version="2")
        rows = self.connection.execute("SELECT * FROM puzzles").fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], original["id"])
        self.assertEqual(rows[0]["line"], original["line"])
        self.assertEqual(
            rows[0]["canonical_assessment_id"], original["canonical_assessment_id"]
        )
        self.assertNotEqual(
            rows[0]["taxonomy_assessment_id"], original["taxonomy_assessment_id"]
        )
        self.assertIn("anotherKill", json.loads(rows[0]["themes"]))
        self.assertNotIn("testKill", json.loads(rows[0]["themes"]))

    def test_catalog_handoff_relabels_existing_id_and_preserves_later_manual_tags(self):
        from tools.puzzle_catalog.catalog import PuzzleCatalog, _json
        from tools.puzzle_catalog.authoring import reconcile_assessments
        from tools.puzzle_catalog.live import reconcile, pending_changes, wire_digest
        from tools.puzzle_catalog.test_catalog import puzzle

        official = patch(
            "tools.puzzle_catalog.publication.OFFICIAL_THEMES",
            frozenset({"testKill", "anotherKill"}),
        )
        official.start()
        self.addCleanup(official.stop)
        self.verify()
        self.classify(theme="testKill")
        original = self.connection.execute("SELECT * FROM puzzles").fetchone()
        document = {
            **puzzle(original["id"]),
            "themes": json.loads(original["themes"]),
            "gameSource": {"type": "catalog", "database": "test"},
            "retirementReason": None,
        }
        with PuzzleCatalog(Path(self.temp.name) / "catalog.sqlite3") as catalog:
            reconcile(
                catalog,
                [
                    {
                        "puzzle": document,
                        "digest": wire_digest(document),
                        "revision": "live-revision",
                    }
                ],
            )
            reconcile_assessments(catalog, self.path)
            self.classify(theme="anotherKill", version="2")
            reconcile_assessments(catalog, self.path)
            changes = pending_changes(catalog)
            self.assertEqual(len(changes), 1)
            self.assertEqual(changes[0]["puzzle"]["_id"], original["id"])
            self.assertEqual(changes[0]["expectedRevision"], "live-revision")
            self.assertIn("anotherKill", changes[0]["puzzle"]["themes"])
            self.assertNotIn("testKill", changes[0]["puzzle"]["themes"])
            self.assertFalse(changes[0]["puzzle"]["retired"])
            edited = {**catalog.puzzles()[0], "themes": ["whiteFacedGeneral"]}
            with catalog.db:
                catalog.db.execute(
                    "UPDATE catalog_puzzles SET document=?", (_json(edited),)
                )
            reconcile_assessments(catalog, self.path)
            self.assertEqual(catalog.puzzles(), [edited])

    def test_returning_to_previous_solution_reuses_its_id(self):
        self.verify()
        self.classify()
        original = self.connection.execute("SELECT id FROM puzzles").fetchone()[0]
        self.verify(force=True, result=self.result(("b7b6",)))
        self.classify()
        self.verify(force=True)
        self.classify(theme="anotherKill")
        self.assertEqual(
            self.connection.execute("SELECT count(*) FROM puzzles").fetchone()[0], 2
        )
        active = self.connection.execute(
            "SELECT * FROM puzzles WHERE verification_status='active'"
        ).fetchone()
        self.assertEqual(active["id"], original)
        self.assertIsNone(active["retired_at"])
        self.assertIsNone(active["retirement_reason"])

    def test_category_conflict_then_recovery_reuses_solve_id(self):
        branches = (self.result().primary, self.result(("b7b6",)).primary)
        self.verify(result=self.result(branches=branches))
        self.classify()
        original = self.connection.execute("SELECT id FROM puzzles").fetchone()[0]
        self.classify(version="2", predicate=lambda trace: trace.moves[0] == "a7a6")
        self.assertEqual(
            self.connection.execute(
                "SELECT verification_status FROM puzzles"
            ).fetchone()[0],
            "withdrawn",
        )
        self.classify(version="3")
        rows = self.connection.execute(
            "SELECT id,verification_status FROM puzzles"
        ).fetchall()
        self.assertEqual([tuple(row) for row in rows], [(original, "active")])

    def test_partial_coverage_cannot_classify(self):
        self.verify(result=self.result(complete=False))
        self.assertEqual(self.classify().status, "awaiting_verifier")
        self.assertIsNone(self.current()["current_verification_id"])
        self.assertEqual(
            self.connection.execute(
                "SELECT coverage FROM candidate_assessments"
            ).fetchone()[0],
            "incomplete",
        )

    def test_incomplete_reverification_preserves_current_evidence_and_publication(self):
        self.verify()
        self.classify()
        old = dict(self.current())
        self.verify(force=True, result=self.result(complete=False))
        self.assertEqual(
            self.current()["current_verification_id"], old["current_verification_id"]
        )
        self.assertEqual(
            self.current()["current_classification_id"],
            old["current_classification_id"],
        )
        self.assertEqual(
            self.connection.execute(
                "SELECT verification_status FROM puzzles"
            ).fetchone()[0],
            "active",
        )

    def test_conclusive_invalidity_withdraws_and_default_does_not_retry(self):
        self.verify()
        self.classify()
        claim = self.claim(force=True)
        finish_verification(
            self.connection,
            claim,
            self.config,
            self.engine,
            invalid="best_defense_escapes_mate",
        )
        self.assertEqual(
            self.connection.execute(
                "SELECT verification_status FROM puzzles"
            ).fetchone()[0],
            "withdrawn",
        )
        self.assertIsNone(
            self.claim(config=replace(self.config, version="next-test-version"))
        )

    def test_category_conflict_retains_solution_for_future_logic(self):
        branches = (self.result().primary, self.result(("b7b6",)).primary)
        self.verify(result=self.result(branches=branches))
        self.classify(predicate=lambda trace: trace.moves[0] == "a7a6")
        self.assertEqual(self.current()["status"], "rejected")
        self.assertEqual(
            self.connection.execute(
                "SELECT status FROM taxonomy_assessments"
            ).fetchone()[0],
            "category_conflict",
        )
        self.assertEqual(self.classify(version="2").status, "classified")
        self.assertEqual(self.current()["status"], "published")
        self.assertIsNone(self.claim())

    def test_untagged_retains_evidence_and_is_distinct_from_conflict(self):
        self.verify()
        self.classify(predicate=lambda trace: False)
        self.assertEqual(self.current()["status"], "untagged")
        self.assertEqual(
            self.connection.execute(
                "SELECT status FROM taxonomy_assessments"
            ).fetchone()[0],
            "uncategorized",
        )
        self.classify(version="2")
        self.assertEqual(self.current()["status"], "published")

    def test_stale_classifier_cannot_apply_to_new_verification(self):
        self.verify()
        previous = self.current()["current_verification_id"]
        self.verify(force=True)
        result = reclassify_canonical(
            self.connection, self.key, expected_verification_assessment_id=previous
        )
        self.assertEqual(result.status, "stale_canonical")

    def test_claims_exclude_concurrent_versions_and_reject_lost_leases(self):
        claim = self.claim()
        config = replace(self.config, version="next-test-version")
        self.assertIsNone(self.claim(config=config, reconstruct=True))
        self.connection.execute(
            "UPDATE verification_jobs SET claim_token='replaced' WHERE id=?",
            (claim.id,),
        )
        self.connection.commit()
        with self.assertRaisesRegex(RuntimeError, "claim"):
            finish_verification(
                self.connection, claim, self.config, self.engine, result=self.result()
            )
        self.assertIsNone(self.current()["current_verification_id"])

    def test_operational_failure_does_not_replace_evidence(self):
        self.verify()
        self.classify()
        previous = self.current()["current_verification_id"]
        claim = self.claim(force=True)
        self.assertEqual(
            fail_verification(self.connection, claim, "timeout", max_attempts=1),
            "failed",
        )
        self.assertEqual(self.current()["current_verification_id"], previous)
        self.assertEqual(
            self.connection.execute(
                "SELECT verification_status FROM puzzles"
            ).fetchone()[0],
            "active",
        )

    def test_operator_cancellation_remains_resumable_without_exhausting_retries(self):
        from tools.xiangqi_data.puzzle_mining.verification_store import (
            release_verification,
        )

        for _ in range(5):
            claim = self.claim()
            self.assertEqual(claim.candidate.attempts, 1)
            release_verification(self.connection, claim)
        self.verify()
        self.assertIsNotNone(self.current()["current_verification_id"])

    def test_migration_audits_limits_without_database_copy(self):
        self.verify()
        self.classify()
        self.connection.execute(
            "UPDATE candidate_assessments SET diagnostic=?",
            (json.dumps({"truncated": True, "limits": ["branch_limit"]}),),
        )
        self.connection.execute(
            "UPDATE metadata SET value='11' WHERE key='schema_version'"
        )
        self.connection.commit()
        self.connection.close()
        self.connection = open_database(self.path)
        self.assertEqual(
            self.connection.execute(
                "SELECT coverage FROM candidate_assessments"
            ).fetchone()[0],
            "legacy",
        )
        self.assertEqual(self.classify().status, "awaiting_branch_verification")
        self.assertEqual(list(self.path.parent.glob("*.pre-v*.sqlite3")), [])

    def test_publication_format_is_unchanged(self):
        self.verify()
        self.classify()
        row = self.connection.execute("SELECT * FROM puzzles").fetchone()
        self.assertEqual(json.loads(row["line"]), ["a4a5", "a7a6"])
        self.assertEqual(json.loads(row["solution"]), ["a7a6"])
        self.assertEqual(row["mate_in"], 1)
        self.assertEqual(len(row["id"]), 5)
        self.assertEqual(
            set(json.loads(row["themes"])), {"testKill", "mate", "mateIn1"}
        )

    def test_catalog_audit_cache_is_bound_to_exact_verification_and_taxonomy(self):
        from tools.puzzle_catalog.reclassification import current_audit_results
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            taxonomy_versions,
        )

        self.verify()
        cached = {
            "p": {
                "outcome": "qualifies",
                "taxonomyVersions": taxonomy_versions(),
                "evidence": {
                    "miningDatabase": str(self.path),
                    "candidateKey": self.key,
                    "assessmentId": self.current()["current_verification_id"],
                },
            }
        }
        self.assertEqual(dict(current_audit_results(cached)), {"p": "qualifies"})
        self.verify(force=True)
        self.assertEqual(dict(current_audit_results(cached)), {})

        cached["p"]["evidence"]["assessmentId"] = self.current()[
            "current_verification_id"
        ]
        cached["p"]["taxonomyVersions"]["__consensus__"] = "old"
        self.assertEqual(dict(current_audit_results(cached)), {})

    def test_collection_classification_skips_current_evidence_without_reloading_branches(
        self,
    ):
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            classify_solutions,
        )

        self.verify()
        registry = MotifRegistry([Motif("testKill", lambda trace: True)])
        self.assertEqual(
            classify_solutions(self.connection, registry=registry), {"classified": 1}
        )
        queries = []
        self.connection.set_trace_callback(queries.append)
        self.assertEqual(classify_solutions(self.connection, registry=registry), {})
        self.connection.set_trace_callback(None)
        self.assertFalse(any("SELECT branches_json" in query for query in queries))

    def test_source_validation_and_solution_construction_do_not_run_motif_removal(self):
        self.scope_categories(("centroidPawnMate",))
        from tools.xiangqi_data.puzzle_mining.verification import verify_candidate
        from tools.xiangqi_data.tests.test_puzzle_mining import CategorizerEngine

        timing_log = Path(self.temp.name) / "logs" / "verification.jsonl"
        self.enterContext(
            patch("tools.xiangqi_data.puzzle_mining.verification.TIMING_LOG", timing_log)
        )
        self.assertFalse(timing_log.parent.exists())
        source = Path(self.temp.name) / "source.sqlite3"
        with closing(sqlite3.connect(source)) as db, db:
            db.execute("CREATE TABLE games(id TEXT PRIMARY KEY,moves TEXT)")
            db.execute("INSERT INTO games VALUES (?,?)", ("g1", json.dumps(["a4a5"])))
        engine = CategorizerEngine()
        signature = verification_signature(self.config, engine)
        seed_verification(self.connection, signature)
        claim = claim_verification(self.connection, signature)
        with patch(
            "tools.xiangqi_data.puzzle_mining.classification_job.verify_removed_motif",
            side_effect=AssertionError("classification called by verifier"),
        ):
            status, _ = verify_candidate(
                self.connection, engine, claim, source, self.config
            )
        self.assertEqual(status, "complete")
        self.assertEqual(engine.resets, 1)
        timings = [json.loads(line) for line in timing_log.read_text().splitlines()]
        self.assertIn("source.load_game", [entry["stage"] for entry in timings])
        self.assertIn("verification.persist", [entry["stage"] for entry in timings])
        evidence = json.loads(
            self.connection.execute(
                "SELECT branches_json FROM candidate_assessments"
            ).fetchone()[0]
        )
        self.assertEqual(len(evidence), 1)
        self.assertEqual(
            self.connection.execute(
                "SELECT count(*) FROM taxonomy_assessments"
            ).fetchone()[0],
            0,
        )
        self.assertEqual(
            reclassify_canonical(self.connection, self.key).status,
            "awaiting_classification_evidence",
        )
        self.assertEqual(
            reclassify_canonical(
                self.connection, self.key, engine=engine, removal_nodes=100
            ).status,
            "classified",
        )
        with patch(
            "tools.xiangqi_data.puzzle_mining.classification_job.verify_removed_motif",
            side_effect=AssertionError("cached evidence rebuilt"),
        ):
            self.assertEqual(
                reclassify_canonical(self.connection, self.key, force=True).status,
                "classified",
            )
