from tools.xiangqi_data.puzzle_mining.verification import VerifierConfig
from pathlib import Path
import sqlite3
import tempfile
import unittest

from tools.xiangqi_data.puzzle_mining.discovery import (
    DiscoveryConfig,
    discover_game,
    seed_jobs,
    seed_native_jobs,
)
from tools.xiangqi_data.puzzle_mining.models import (
    CandidateRecord,
    EngineScore,
    PositionStatus,
    SearchLine,
    SearchResult,
)
from tools.xiangqi_data.puzzle_mining.patterns import (
    TerminalPosition,
    classification_logic_version,
    centroid_pawn_candidate,
    mate_themes,
)
from tools.xiangqi_data.puzzle_mining.position import (
    candidate_key,
    position_hash,
    puzzle_root_fen,
    replay_fens,
)
from tools.xiangqi_data.puzzle_mining.progress import format_progress
from tools.xiangqi_data.puzzle_mining.storage import (
    claim_game_job,
    fail_game_job,
    finish_game_job,
    insert_candidate,
    open_database,
    recover_stale_game_jobs,
    seed_game_job,
)
from tools.xiangqi_data.puzzle_mining.solver import solve_checkmate


def score(kind: str, value: int, wdl=None) -> EngineScore:
    return EngineScore(kind, value, wdl)


def result(
    primary: EngineScore,
    move: str,
    *,
    alternatives: tuple[tuple[EngineScore, str], ...] = (),
) -> SearchResult:
    lines = [
        SearchLine(1, 24, 30, 1000, 10, primary, (move,)),
        *[
            SearchLine(index + 2, 24, 30, 1000, 10, alt_score, (alt_move,))
            for index, (alt_score, alt_move) in enumerate(alternatives)
        ],
    ]
    return SearchResult("Pikafish test", "test.nnue", move, tuple(lines))


class StaticEngine:
    def new_game(self):
        self.resets = getattr(self, "resets", 0) + 1

    engine_version = "Pikafish test"
    nnue = "test.nnue"

    def close(self) -> None:
        pass


class PatternTest(unittest.TestCase):
    def test_centroid_logic_revision_is_explicit_and_selectable(self) -> None:
        self.assertEqual(
            classification_logic_version({"centroidPawnMate"}),
            "centroidPawnMate@1.4",
        )
        with self.assertRaisesRegex(ValueError, "unknown puzzle theme"):
            classification_logic_version({"notATheme"})

    def test_detects_mate_lengths_and_the_multiple_move_bucket(self) -> None:
        self.assertEqual(mate_themes(1), {"mate", "mateIn1"})
        self.assertEqual(mate_themes(3), {"mate", "mateIn2"})
        self.assertEqual(mate_themes(5), {"mate", "mateIn3"})
        self.assertEqual(mate_themes(7), {"mate", "mateIn4"})
        self.assertEqual(mate_themes(9), {"mate", "mateIn5"})
        self.assertEqual(mate_themes(11), {"mate", "mateIn6"})
        self.assertEqual(mate_themes(13), {"mate", "mateIn7"})
        self.assertEqual(mate_themes(15), {"mate", "mateIn8"})
        self.assertEqual(mate_themes(17), {"mate"})

    def test_centroid_pawn_mate_for_red_attacker(self) -> None:
        terminal = TerminalPosition(
            "3k5/4P4/9/9/9/9/9/9/9/4K4 b - - 0 1", True, "black"
        )
        self.assertTrue(centroid_pawn_candidate(terminal))

    def test_centroid_pawn_mate_for_black_attacker(self) -> None:
        terminal = TerminalPosition("4k4/9/9/9/9/9/9/9/4p4/3K5 w - - 0 1", True, "red")
        self.assertTrue(centroid_pawn_candidate(terminal))

    def test_centroid_pawn_stalemate_qualifies_when_the_pawn_is_key(self) -> None:
        terminal = TerminalPosition(
            "3k5/4P4/9/9/9/9/9/9/9/4K4 b - - 0 1", False, "black", True
        )
        self.assertTrue(centroid_pawn_candidate(terminal))

    def test_centroid_geometry_does_not_claim_key_piece_proof(self) -> None:
        terminal = TerminalPosition(
            "3k5/4P4/9/9/9/9/9/9/9/4K4 b - - 0 1", True, "black"
        )
        self.assertTrue(centroid_pawn_candidate(terminal))

    def test_rejects_wrong_square_owner_back_rank_and_non_mate(self) -> None:
        cases = (
            TerminalPosition("4k4/3P5/9/9/9/9/9/9/9/4K4 b - - 0 1", True, "black"),
            TerminalPosition("4k4/4p4/9/9/9/9/9/9/9/4K4 b - - 0 1", True, "black"),
            TerminalPosition("9/3kP4/9/9/9/9/9/9/9/4K4 b - - 0 1", True, "black"),
            TerminalPosition("3k5/4P4/9/9/9/9/9/9/9/4K5 b - - 0 1", False, "black"),
            TerminalPosition("4k4/4P4/9/9/9/9/9/9/9/4K4 b - - 0 1", True, "black"),
        )
        for terminal in cases:
            with self.subTest(terminal=terminal):
                self.assertFalse(centroid_pawn_candidate(terminal))


class DiscoveryTest(unittest.TestCase):
    def test_compares_after_score_from_the_movers_fixed_perspective(self) -> None:
        moves = ["a4a5"]
        config = DiscoveryConfig(
            depth=100,
            loss=0.50,
            tactic_advantage=0.55,
            max_mate_plies=9,
        )
        searches = {
            (0, 100): result(score("cp", 30, (700, 200, 100)), "b1c3"),
            (1, 100): result(score("mate", 3), "b10c8"),
        }

        progress = []
        candidates = discover_game(
            StaticEngine(),
            source_database="test",
            game_id="g1",
            source_url="",
            moves=moves,
            config=config,
            analyse=lambda context, nodes: searches[
                (
                    [puzzle_root_fen(f) for f in replay_fens(moves)].index(
                        context.initial_fen
                    ),
                    nodes,
                )
            ],
            progress=lambda stage, current, total: progress.append(
                (stage, current, total)
            ),
        )

        self.assertEqual(len(candidates), 1)
        candidate = candidates[0]
        self.assertEqual(candidate.candidate_type, "checkmate_candidate")
        self.assertEqual(candidate.after_score, score("mate", -3))
        self.assertEqual(candidate.side_to_move, "black")
        self.assertGreater(candidate.evaluation_loss, 1.0)
        self.assertEqual(progress, [("evaluating", 1, 2), ("evaluating", 2, 2)])

    def test_does_not_origin_blunder_when_mover_was_already_mated(self) -> None:
        moves = ["a4a5"]
        config = DiscoveryConfig(depth=100)
        searches = {
            (0, 100): result(score("mate", -4), "a4a5"),
            (1, 100): result(score("mate", 3), "a7a6"),
        }
        candidates = discover_game(
            StaticEngine(),
            source_database="test",
            game_id="g1",
            source_url="",
            moves=moves,
            config=config,
            analyse=lambda context, nodes: searches[
                (
                    [puzzle_root_fen(f) for f in replay_fens(moves)].index(
                        context.initial_fen
                    ),
                    nodes,
                )
            ],
        )
        self.assertEqual(candidates, [])


class BranchEngine(StaticEngine):
    """A synthetic mate whose final geometry is absent from its start."""

    start = "4k4/9/9/9/9/9/9/9/P8/4K4 w - - 0 1"
    red_turn = "4k4/9/9/9/9/9/9/9/P8/4K4 w - - 0 1"
    black_turn = "4k4/9/9/9/9/9/9/9/P8/4K4 b - - 0 1"
    centroid = "3k5/4P4/9/9/9/9/9/9/9/4K4 b - - 0 1"
    wrong = "4k4/3P5/9/9/9/9/9/9/9/4K4 b - - 0 1"

    def __init__(self, mixed_patterns: bool = False) -> None:
        self.mixed_patterns = mixed_patterns

    def inspect(self, context):
        moves = context.moves
        if len(moves) == 0:
            return PositionStatus(self.red_turn, False, ("a2a3",))
        if len(moves) == 1:
            return PositionStatus(self.black_turn, False, ("e10d10", "e10f10"))
        if len(moves) == 2:
            return PositionStatus(self.red_turn, False, ("a3a4",))
        terminal = (
            self.wrong
            if self.mixed_patterns and moves[1] == "e10f10"
            else self.centroid
        )
        return PositionStatus(terminal, True, ())

    def analyse(self, context, *, nodes=None, depth=None, multi_pv):
        moves = context.moves
        if len(moves) == 0:
            return result(
                score("mate", 2),
                "a2a3",
            )
        if len(moves) == 1:
            return result(
                score("mate", -1),
                "e10d10",
                alternatives=((score("mate", -1), "e10f10"),),
            )
        return result(
            score("mate", 1),
            "a3a4",
        )


class CategorizerEngine(StaticEngine):
    """Black synthesizes a mate after the recorded game has stopped."""

    def __init__(self) -> None:
        self.base_fen = replay_fens(["a4a5"])[1]

    def checking_pieces(self, context):
        return context.initial_fen, ("e2",)

    def inspect(self, context):
        synthetic = context.moves
        if len(synthetic) == 0:
            return PositionStatus(self.base_fen, False, ("a7a6", "c7c6"))
        if len(synthetic) == 1:
            red_fen = self.base_fen.replace(" b ", " w ")
            return PositionStatus(red_fen, False, ("e1d1", "e1f1"))
        if len(synthetic) == 2:
            return PositionStatus(self.base_fen, False, ("a6a5",))
        terminal = "4k4/9/9/9/9/9/9/9/4p4/3K5 w - - 0 1"
        return PositionStatus(terminal, True, ())

    def analyse(self, context, *, nodes=None, depth=None, multi_pv):
        assert context.initial_fen == puzzle_root_fen(self.base_fen)
        assert "a4a5" not in context.moves
        synthetic = context.moves
        if len(synthetic) == 0:
            return result(
                score("mate", 2),
                "a7a6",
                alternatives=((score("cp", -50, (50, 100, 850)), "c7c6"),),
            )
        if len(synthetic) == 1:
            return result(
                score("mate", -1),
                "e1d1",
                alternatives=((score("mate", -1), "e1f1"),),
            )
        return result(
            score("mate", 1),
            "a6a5",
        )


class SolutionTest(unittest.TestCase):
    def test_follows_and_records_only_best_defense(self) -> None:
        progress = []
        solved = solve_checkmate(
            BranchEngine(),
            SearchContextForTest(BranchEngine.start),
            "red",
            VerifierConfig(depth=10, max_solution_plies=7),
            progress=lambda branch, total, ply: progress.append((branch, total, ply)),
        )
        self.assertEqual(len(solved.branches), 1)
        self.assertEqual(solved.primary.moves[1], "e10d10")
        self.assertTrue(
            all(
                centroid_pawn_candidate(
                    TerminalPosition(branch.terminal.fen, True, "black")
                )
                for branch in solved.branches
            )
        )
        self.assertNotIn("4P4", BranchEngine.start)
        self.assertTrue(progress)
        self.assertTrue(all(item[0] == item[1] == 1 for item in progress))


def SearchContextForTest(fen: str):
    from tools.xiangqi_data.puzzle_mining.models import SearchContext

    return SearchContext(fen, ())


class PersistenceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name) / "puzzles.sqlite3"
        self.connection = open_database(self.database)

    def tearDown(self) -> None:
        self.connection.close()
        self.temp.cleanup()

    def _candidate(self) -> CandidateRecord:
        fens = replay_fens(["a4a5"])
        return CandidateRecord(
            candidate_key=candidate_key(fens[1], ("a4a5",)),
            source_database="test",
            game_id="g1",
            source_url="",
            ply=1,
            side_to_move="black",
            pre_fen=fens[0],
            position_fen=fens[1],
            position_hash=position_hash(fens[1]),
            played_move="a4a5",
            best_move="b1c3",
            before_score=score("cp", 30, (700, 200, 100)),
            after_score=score("mate", -3),
            evaluation_loss=1.6,
            candidate_type="checkmate_candidate",
            engine_version="Pikafish shallow",
            nnue="shallow.nnue",
            search_settings={"nodes": 100},
        )

    def test_deduplicates_candidates(self) -> None:
        self.assertIsNotNone(insert_candidate(self.connection, self._candidate()))
        self.assertIsNone(insert_candidate(self.connection, self._candidate()))
        count = self.connection.execute("SELECT count(*) FROM candidates").fetchone()[0]
        self.assertEqual(count, 1)

    def test_idle_native_barrier_does_not_scan_catalog_or_acquire_writer(self):
        self.connection.executemany(
            """INSERT INTO game_jobs(discovery_version,source_database,game_id,
            created_at,updated_at) VALUES('1','catalog',?,'','')""",
            ((str(i),) for i in range(175_000)),
        )
        self.connection.commit()
        seed_game_job(self.connection, "lixiangqi:site", "live", "")
        live = claim_game_job(self.connection)
        self.assertEqual(live.game_id, "live")
        other = open_database(self.database)
        try:
            other.execute("BEGIN IMMEDIATE")
            self.connection.execute("PRAGMA busy_timeout=1")
            steps = []
            self.connection.set_progress_handler(
                lambda: steps.append(1) or len(steps) > 100, 1000
            )
            statements = []
            self.connection.set_trace_callback(statements.append)
            self.assertIsNone(claim_game_job(self.connection))
            self.assertFalse(any("BEGIN" in sql for sql in statements))
            self.assertFalse(self.connection.in_transaction)
        finally:
            self.connection.set_progress_handler(None, 0)
            self.connection.set_trace_callback(None)
            other.rollback()
            other.close()

    def test_busy_claim_is_retried_without_losing_or_failing_job(self):
        seed_game_job(self.connection, "catalog", "local", "")
        other = open_database(self.database)
        try:
            other.execute("BEGIN IMMEDIATE")
            self.connection.execute("PRAGMA busy_timeout=1")
            self.assertIsNone(claim_game_job(self.connection))
            self.assertFalse(self.connection.in_transaction)
            other.rollback()
            job = claim_game_job(self.connection)
            self.assertEqual(job.game_id, "local")
            self.assertEqual(job.attempts, 1)
        finally:
            other.close()

    def test_claiming_is_atomic_and_retryable(self) -> None:
        seed_game_job(self.connection, "test", "g1", "")
        other = open_database(self.database)
        try:
            first = claim_game_job(self.connection)
            self.assertIsNotNone(first)
            self.assertIsNone(claim_game_job(other))
            status = fail_game_job(
                self.connection,
                first,
                "temporary engine failure",
                retryable=True,
                max_attempts=3,
                retry_delay_seconds=0,
            )
            self.assertEqual(status, "retry")
            retried = claim_game_job(other)
            self.assertIsNotNone(retried)
            self.assertEqual(retried.attempts, 2)
        finally:
            other.close()

    def test_claiming_prioritizes_due_native_games_then_catalog_games(self) -> None:
        # Insert the catalog job first so this verifies priority rather than
        # relying on insertion order. Native jobs retain their own id order.
        seed_game_job(self.connection, "catalog", "catalog-first", "")
        seed_game_job(self.connection, "lixiangqi:https://live.example", "user-1", "")
        seed_game_job(self.connection, "lixiangqi:https://live.example", "user-2", "")

        first = claim_game_job(self.connection)
        self.assertIsNotNone(first)
        self.assertEqual(first.source_database, "lixiangqi:https://live.example")
        self.assertEqual(first.game_id, "user-1")
        finish_game_job(self.connection, first, 0)

        second = claim_game_job(self.connection)
        self.assertIsNotNone(second)
        self.assertEqual(second.game_id, "user-2")
        finish_game_job(self.connection, second, 0)

        third = claim_game_job(self.connection)
        self.assertIsNotNone(third)
        self.assertEqual(third.source_database, "catalog")
        self.assertEqual(third.game_id, "catalog-first")

    def test_local_discovery_waits_for_running_and_delayed_live_jobs(self) -> None:
        seed_game_job(self.connection, "catalog", "local", "")
        seed_game_job(self.connection, "lixiangqi:https://live.example", "live", "")
        live = claim_game_job(self.connection)
        self.assertEqual(live.game_id, "live")
        self.assertIsNone(claim_game_job(self.connection))
        fail_game_job(
            self.connection,
            live,
            "retry",
            retryable=True,
            max_attempts=3,
            retry_delay_seconds=60,
        )
        self.assertIsNone(claim_game_job(self.connection))
        self.connection.execute(
            "UPDATE game_jobs SET next_attempt_at=NULL WHERE id=?", (live.id,)
        )
        self.connection.commit()
        retried = claim_game_job(self.connection)
        self.assertEqual(retried.game_id, "live")
        finish_game_job(self.connection, retried, 0)
        self.assertEqual(claim_game_job(self.connection).game_id, "local")

    def test_rescan_skips_current_version_native_games(self) -> None:
        origin = "https://live.example"
        source = "lixiangqi:" + origin
        self.connection.execute(
            "INSERT INTO source_snapshots VALUES ('snapshot', ?, 'digest', 'now')",
            (origin,),
        )
        self.connection.execute(
            """INSERT INTO native_games(source_database,origin,game_id,moves_json,
               payload_json,payload_checksum,snapshot_id,created_at)
               VALUES (?,?,'live','[]','{}','checksum','snapshot','now')""",
            (source, origin),
        )
        self.connection.commit()
        seed_native_jobs(self.connection, "1")
        live = claim_game_job(self.connection)
        finish_game_job(self.connection, live, 2)
        self.connection.execute(
            "INSERT INTO game_analysis_depths VALUES (?, ?, 30)", (source, "live")
        )
        self.connection.commit()
        seed_game_job(self.connection, "catalog", "local", "")
        seed_native_jobs(self.connection, "1", rescan=True)
        rescanned = claim_game_job(self.connection)
        self.assertEqual(rescanned.game_id, "local")
        self.assertEqual(rescanned.attempts, 1)
        self.assertIsNone(claim_game_job(self.connection))

    def test_new_discovery_version_skips_sufficient_depth(
        self,
    ) -> None:
        seed_game_job(self.connection, "test", "g1", "", discovery_version="1")
        first = claim_game_job(self.connection, discovery_version="1")
        self.assertIsNotNone(first)
        finish_game_job(self.connection, first, 0)
        self.assertIsNone(claim_game_job(self.connection, discovery_version="1"))

        self.connection.execute(
            "INSERT INTO game_analysis_depths VALUES ('test','g1',30)"
        )
        self.connection.commit()
        self.assertFalse(
            seed_game_job(self.connection, "test", "g1", "", discovery_version="2")
        )
        self.assertIsNone(claim_game_job(self.connection, discovery_version="2"))
        self.assertEqual(
            self.connection.execute(
                "SELECT status FROM game_jobs WHERE discovery_version='1'"
            ).fetchone()[0],
            "complete",
        )

    def test_catalog_reconciliation_inserts_only_unknown_games(self) -> None:
        source = Path(self.temp.name) / "xiangqi-games.sqlite3"
        source_connection = sqlite3.connect(source)
        source_connection.execute(
            "CREATE TABLE games(id TEXT PRIMARY KEY, source_url TEXT NOT NULL)"
        )
        source_connection.executemany(
            "INSERT INTO games VALUES (?, ?)",
            (("complete", "one"), ("queued", "two"), ("new", "three")),
        )
        source_connection.commit()
        source_connection.close()

        seed_game_job(self.connection, "catalog", "complete", "one")
        completed = claim_game_job(self.connection)
        self.assertIsNotNone(completed)
        finish_game_job(self.connection, completed, 0)
        self.connection.execute(
            "INSERT INTO game_analysis_depths VALUES ('catalog','complete',30)"
        )
        self.connection.commit()
        seed_game_job(self.connection, "catalog", "queued", "two")

        self.assertEqual(
            seed_jobs(self.connection, (source,), None, discovery_version="1"), 1
        )
        self.assertEqual(
            seed_jobs(self.connection, (source,), None, discovery_version="1"), 0
        )
        self.assertEqual(
            self.connection.execute(
                "SELECT count(*) FROM game_jobs WHERE status = 'queued'"
            ).fetchone()[0],
            2,
        )
        self.assertEqual(
            seed_jobs(self.connection, (source,), None, discovery_version="3"), 2
        )
        self.assertEqual(
            seed_jobs(self.connection, (source,), None, discovery_version="3"), 0
        )
        self.assertEqual(
            self.connection.execute(
                "SELECT status FROM game_jobs WHERE game_id='complete' AND discovery_version='1'"
            ).fetchone()[0],
            "complete",
        )

    def test_discovery_status_recovers_expired_claims_before_workers_start(
        self,
    ) -> None:
        seed_game_job(self.connection, "catalog", "stale", "")
        claimed = claim_game_job(self.connection)
        self.assertIsNotNone(claimed)
        self.connection.execute(
            "UPDATE game_jobs SET claimed_at = '2000-01-01T00:00:00+00:00' "
            "WHERE id = ?",
            (claimed.id,),
        )
        self.connection.commit()

        self.assertEqual(recover_stale_game_jobs(self.connection), 1)
        row = self.connection.execute(
            "SELECT status, diagnostic FROM game_jobs WHERE id = ?", (claimed.id,)
        ).fetchone()
        self.assertEqual(
            (row["status"], row["diagnostic"]), ("retry", "claim lease expired")
        )

    def test_catalog_rescan_skips_completed_current_version(self) -> None:
        source = Path(self.temp.name) / "xiangqi-games.sqlite3"
        source_connection = sqlite3.connect(source)
        source_connection.execute(
            "CREATE TABLE games(id TEXT PRIMARY KEY, source_url TEXT NOT NULL)"
        )
        source_connection.execute("INSERT INTO games VALUES ('g1', '')")
        source_connection.commit()
        source_connection.close()
        seed_game_job(self.connection, "catalog", "g1", "")
        claimed = claim_game_job(self.connection)
        self.assertIsNotNone(claimed)
        finish_game_job(self.connection, claimed, 0)

        self.connection.execute(
            "INSERT INTO game_analysis_depths VALUES ('catalog','g1',30)"
        )
        self.connection.commit()
        seed_jobs(self.connection, (source,), None, discovery_version="1", rescan=True)

        self.assertEqual(
            self.connection.execute(
                "SELECT status FROM game_jobs WHERE game_id = 'g1'"
            ).fetchone()[0],
            "complete",
        )

    def test_explicit_rescan_requeues_completed_game_for_new_revision(self) -> None:
        seed_game_job(self.connection, "test", "g1", "", discovery_version="1")
        first = claim_game_job(self.connection, discovery_version="1")
        self.assertIsNotNone(first)
        finish_game_job(self.connection, first, 0)

        self.assertTrue(
            seed_game_job(
                self.connection,
                "test",
                "g1",
                "",
                discovery_version="2",
                rescan=True,
            )
        )
        self.assertFalse(
            seed_game_job(
                self.connection,
                "test",
                "g1",
                "",
                discovery_version="2",
                rescan=True,
            )
        )
        second = claim_game_job(self.connection, discovery_version="2")
        self.assertIsNotNone(second)

    def test_new_discovery_version_supersedes_queued_old_jobs(self) -> None:
        seed_game_job(self.connection, "test", "old", "", discovery_version="1")
        self.assertTrue(
            seed_game_job(self.connection, "test", "new", "", discovery_version="2")
        )
        status = self.connection.execute(
            "SELECT status FROM game_jobs WHERE game_id = 'old'"
        ).fetchone()[0]
        self.assertEqual(status, "rejected")
        self.assertIsNotNone(claim_game_job(self.connection, discovery_version="2"))

    def test_new_discovery_version_invalidates_old_claims(self) -> None:
        seed_game_job(self.connection, "test", "old", "", discovery_version="1")
        old = claim_game_job(self.connection, discovery_version="1")
        self.assertIsNotNone(old)
        seed_game_job(self.connection, "test", "new", "", discovery_version="2")
        self.assertIsNone(claim_game_job(self.connection, discovery_version="1"))
        self.assertEqual(
            self.connection.execute(
                "SELECT status FROM game_jobs WHERE id = ?", (old.id,)
            ).fetchone()[0],
            "rejected",
        )

    def test_migrates_existing_discovery_jobs_to_version_one(self) -> None:
        legacy = Path(self.temp.name) / "legacy.sqlite3"
        connection = sqlite3.connect(legacy)
        connection.executescript("""
            CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            INSERT INTO metadata VALUES ('schema_version', '2');
            CREATE TABLE candidates(
              id INTEGER PRIMARY KEY,
              candidate_type TEXT CHECK (candidate_type IN ('checkmate_candidate', 'tactic_candidate')),
              status TEXT,
              claim_token TEXT,
              claimed_at TEXT,
              next_attempt_at TEXT,
              position_hash TEXT,
              candidate_key TEXT,source_database TEXT,game_id TEXT,pre_fen TEXT,
              played_move TEXT,themes_json TEXT,updated_at TEXT
            );
            CREATE TABLE game_jobs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              source_database TEXT NOT NULL,
              game_id TEXT NOT NULL,
              source_url TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'queued',
              attempts INTEGER NOT NULL DEFAULT 0,
              discovered_count INTEGER NOT NULL DEFAULT 0,
              claim_token TEXT,
              claimed_at TEXT,
              next_attempt_at TEXT,
              diagnostic TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE (source_database, game_id)
            );
            INSERT INTO game_jobs(
              source_database, game_id, created_at, updated_at
            ) VALUES ('test', 'g1', 'now', 'now');
            """)
        connection.commit()
        connection.close()

        migrated = open_database(legacy)
        try:
            row = migrated.execute(
                "SELECT discovery_version FROM game_jobs WHERE game_id = 'g1'"
            ).fetchone()
            self.assertEqual(row["discovery_version"], "1")
            columns = {
                row["name"] for row in migrated.execute("PRAGMA table_info(candidates)")
            }
            self.assertIn("verifier_version", columns)
        finally:
            migrated.close()


class ProgressOutputTest(unittest.TestCase):
    def test_formats_large_live_totals_and_candidate_statistics(self) -> None:
        line = format_progress(
            "Checking game",
            1,
            232_195,
            {
                "checkmate": 2,
                "tactic": 7,
                "stored": 8,
                "duplicate": 1,
            },
            ("checkmate", "tactic", "stored", "duplicate"),
            detail="dpxq:42 evaluating position 10/83",
        )

        self.assertIn("Checking game 1/232,195", line)
        self.assertIn("checkmate: 2", line)
        self.assertIn("tactic: 7", line)
        self.assertIn("dpxq:42 evaluating position 10/83", line)


if __name__ == "__main__":
    unittest.main()
