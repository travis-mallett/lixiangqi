import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from tools.xiangqi_data.pikafish_rules import START_FEN
from tools.xiangqi_data.puzzle_mining.checkmate import (
    CategorizerConfig,
    categorize_candidate,
    classify_mating_patterns,
    solve_checkmate,
)
from tools.xiangqi_data.puzzle_mining.discovery import (
    DiscoveryConfig,
    discover_game,
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
    is_centroid_pawn_mate,
    mate_themes,
)
from tools.xiangqi_data.puzzle_mining.position import (
    candidate_key,
    position_hash,
    replay_fens,
)
from tools.xiangqi_data.puzzle_mining.progress import format_progress
from tools.xiangqi_data.puzzle_mining.storage import (
    claim_checkmate_candidate,
    claim_game_job,
    fail_game_job,
    finish_candidate,
    finish_game_job,
    insert_candidate,
    open_database,
    retry_candidate,
    seed_game_job,
)


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
    engine_version = "Pikafish test"
    nnue = "test.nnue"

    def close(self) -> None:
        pass


class PatternTest(unittest.TestCase):
    def test_detects_mate_lengths_and_the_multiple_move_bucket(self) -> None:
        self.assertEqual(mate_themes(1), {"mate", "mateIn1"})
        self.assertEqual(mate_themes(3), {"mate", "mateIn2"})
        self.assertEqual(mate_themes(5), {"mate", "mateIn3"})
        self.assertEqual(mate_themes(7), {"mate", "mateIn4"})
        self.assertEqual(mate_themes(9), {"mate", "mateIn5"})

    def test_centroid_pawn_mate_for_red_attacker(self) -> None:
        terminal = TerminalPosition(
            "4k4/4P4/9/9/9/9/9/9/9/4K4 b - - 0 1", True, "black"
        )
        self.assertTrue(is_centroid_pawn_mate(terminal))

    def test_centroid_pawn_mate_for_black_attacker(self) -> None:
        terminal = TerminalPosition(
            "4k4/9/9/9/9/9/9/9/4p4/4K4 w - - 0 1", True, "red"
        )
        self.assertTrue(is_centroid_pawn_mate(terminal))

    def test_rejects_wrong_square_owner_back_rank_and_non_mate(self) -> None:
        cases = (
            TerminalPosition(
                "4k4/3P5/9/9/9/9/9/9/9/4K4 b - - 0 1", True, "black"
            ),
            TerminalPosition(
                "4k4/4p4/9/9/9/9/9/9/9/4K4 b - - 0 1", True, "black"
            ),
            TerminalPosition(
                "9/3kP4/9/9/9/9/9/9/9/4K4 b - - 0 1", True, "black"
            ),
            TerminalPosition(
                "4k4/4P4/9/9/9/9/9/9/9/4K4 b - - 0 1", False, "black"
            ),
        )
        for terminal in cases:
            with self.subTest(terminal=terminal):
                self.assertFalse(is_centroid_pawn_mate(terminal))


class DiscoveryTest(unittest.TestCase):
    def test_compares_after_score_from_the_movers_fixed_perspective(self) -> None:
        moves = ["a4a5"]
        config = DiscoveryConfig(
            screen_nodes=10,
            validation_nodes=100,
            screen_loss=0.35,
            validation_loss=0.50,
            tactic_advantage=0.55,
            max_mate_plies=9,
        )
        searches = {
            (0, 10): result(score("cp", 20, (650, 250, 100)), "b1c3"),
            (1, 10): result(score("cp", 80, (850, 100, 50)), "b10c8"),
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
            analyse=lambda context, nodes: searches[(len(context.moves), nodes)],
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
        self.assertIn(("screening", 1, 2), progress)
        self.assertTrue(any(stage == "validating" for stage, _current, _total in progress))

    def test_does_not_origin_blunder_when_mover_was_already_mated(self) -> None:
        moves = ["a4a5"]
        config = DiscoveryConfig(screen_nodes=10, validation_nodes=100)
        searches = {
            (0, 10): result(score("mate", -4), "a4a5"),
            (1, 10): result(score("mate", 3), "a7a6"),
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
            analyse=lambda context, nodes: searches[(len(context.moves), nodes)],
        )
        self.assertEqual(candidates, [])


class BranchEngine(StaticEngine):
    """A synthetic mate whose final geometry is absent from its start."""

    start = "4k4/9/9/9/9/9/9/9/P8/4K4 w - - 0 1"
    red_turn = "4k4/9/9/9/9/9/9/9/P8/4K4 w - - 0 1"
    black_turn = "4k4/9/9/9/9/9/9/9/P8/4K4 b - - 0 1"
    centroid = "4k4/4P4/9/9/9/9/9/9/9/4K4 b - - 0 1"
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
        terminal = self.wrong if self.mixed_patterns and moves[1] == "e10f10" else self.centroid
        return PositionStatus(terminal, True, ())

    def analyse(self, context, *, nodes, multi_pv):
        moves = context.moves
        if len(moves) == 0:
            return result(
                score("mate", 2),
                "a2a3",
                alternatives=((score("cp", -50, (50, 100, 850)), "a2b2"),),
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
            alternatives=((score("cp", -100, (20, 80, 900)), "a3b3"),),
        )


class CategorizerEngine(StaticEngine):
    """Black synthesizes a mate after the recorded game has stopped."""

    def __init__(self) -> None:
        self.base_fen = replay_fens(["a4a5"])[1]

    def inspect(self, context):
        synthetic = context.moves[1:]
        if len(synthetic) == 0:
            return PositionStatus(self.base_fen, False, ("a7a6", "c7c6"))
        if len(synthetic) == 1:
            red_fen = self.base_fen.replace(" b ", " w ")
            return PositionStatus(red_fen, False, ("e1d1", "e1f1"))
        if len(synthetic) == 2:
            return PositionStatus(self.base_fen, False, ("a6a5",))
        terminal = "4k4/9/9/9/9/9/9/9/4p4/4K4 w - - 0 1"
        return PositionStatus(terminal, True, ())

    def analyse(self, context, *, nodes, multi_pv):
        synthetic = context.moves[1:]
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
            alternatives=((score("cp", -100, (20, 80, 900)), "a6b6"),),
        )


class SolutionTest(unittest.TestCase):
    def test_follows_and_records_co_best_defenses(self) -> None:
        progress = []
        solved = solve_checkmate(
            BranchEngine(),
            SearchContextForTest(BranchEngine.start),
            "red",
            CategorizerConfig(nodes=10, max_solution_plies=7),
            progress=lambda branch, total, ply: progress.append(
                (branch, total, ply)
            ),
        )
        self.assertEqual(len(solved.branches), 2)
        self.assertEqual(solved.primary.moves[1], "e10d10")
        self.assertTrue(
            all(
                is_centroid_pawn_mate(
                    TerminalPosition(branch.terminal.fen, True, "black")
                )
                for branch in solved.branches
            )
        )
        self.assertNotIn("4P4", BranchEngine.start)
        self.assertTrue(progress)
        self.assertGreaterEqual(max(item[1] for item in progress), 2)

    def test_co_best_defenses_can_have_different_patterns(self) -> None:
        solved = solve_checkmate(
            BranchEngine(mixed_patterns=True),
            SearchContextForTest(BranchEngine.start),
            "red",
            CategorizerConfig(nodes=10, max_solution_plies=7),
        )
        matches = [
            is_centroid_pawn_mate(
                TerminalPosition(branch.terminal.fen, True, "black")
            )
            for branch in solved.branches
        ]
        self.assertEqual(sorted(matches), [False, True])
        disposition, themes, _rows = classify_mating_patterns(solved.branches)
        self.assertEqual(disposition, "review")
        self.assertEqual(themes, set())


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

    def test_discovery_version_requeues_each_game_once(self) -> None:
        seed_game_job(self.connection, "test", "g1", "", discovery_version="1")
        first = claim_game_job(self.connection, discovery_version="1")
        self.assertIsNotNone(first)
        finish_game_job(self.connection, first, 0)
        self.assertIsNone(claim_game_job(self.connection, discovery_version="1"))

        self.assertTrue(
            seed_game_job(self.connection, "test", "g1", "", discovery_version="2")
        )
        second = claim_game_job(self.connection, discovery_version="2")
        self.assertIsNotNone(second)
        self.assertEqual(second.discovery_version, "2")

    def test_migrates_existing_discovery_jobs_to_version_one(self) -> None:
        legacy = Path(self.temp.name) / "legacy.sqlite3"
        connection = sqlite3.connect(legacy)
        connection.executescript(
            """
            CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            INSERT INTO metadata VALUES ('schema_version', '2');
            CREATE TABLE candidates(
              id INTEGER PRIMARY KEY,
              candidate_type TEXT,
              status TEXT,
              next_attempt_at TEXT,
              position_hash TEXT
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
            """
        )
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
            self.assertIn("categorization_version", columns)
        finally:
            migrated.close()

    def test_checkmate_version_reclaims_terminal_candidates(self) -> None:
        insert_candidate(self.connection, self._candidate())
        first = claim_checkmate_candidate(self.connection, categorization_version="1")
        self.assertIsNotNone(first)
        finish_candidate(
            self.connection,
            first,
            status="rejected",
            categorization_version="1",
        )
        self.assertIsNone(
            claim_checkmate_candidate(self.connection, categorization_version="1")
        )

        second = claim_checkmate_candidate(self.connection, categorization_version="2")
        self.assertIsNotNone(second)
        self.assertEqual(second.attempts, 1)

    def test_candidate_rejection_is_diagnostic(self) -> None:
        insert_candidate(self.connection, self._candidate())
        claimed = claim_checkmate_candidate(self.connection)
        self.assertIsNotNone(claimed)
        finish_candidate(
            self.connection,
            claimed,
            status="rejected",
            diagnostic="mate_not_reproduced",
        )
        row = self.connection.execute(
            "SELECT status, diagnostic FROM candidates"
        ).fetchone()
        self.assertEqual((row["status"], row["diagnostic"]), ("rejected", "mate_not_reproduced"))

    def test_candidate_retry_has_an_attempt_limit(self) -> None:
        insert_candidate(self.connection, self._candidate())
        claimed = claim_checkmate_candidate(self.connection)
        self.assertEqual(
            retry_candidate(
                self.connection,
                claimed,
                "temporary timeout",
                max_attempts=2,
                retry_delay_seconds=0,
            ),
            "retry",
        )
        retried = claim_checkmate_candidate(self.connection)
        self.assertEqual(retried.attempts, 2)
        self.assertEqual(
            retry_candidate(
                self.connection,
                retried,
                "temporary timeout",
                max_attempts=2,
                retry_delay_seconds=0,
            ),
            "failed",
        )

    def test_deeper_analysis_can_invalidate_shallow_mate(self) -> None:
        source = Path(self.temp.name) / "source.sqlite3"
        source_connection = sqlite3.connect(source)
        source_connection.execute("CREATE TABLE games(id TEXT PRIMARY KEY, moves TEXT)")
        source_connection.execute(
            "INSERT INTO games VALUES (?, ?)", ("g1", json.dumps(["a4a5"]))
        )
        source_connection.commit()
        source_connection.close()
        insert_candidate(self.connection, self._candidate())
        claimed = claim_checkmate_candidate(self.connection)

        class InvalidatingEngine(StaticEngine):
            def inspect(self, context):
                return PositionStatus(
                    replay_fens(["a4a5"])[1], False, ("a7a6", "c7c6")
                )

            def analyse(self, context, *, nodes, multi_pv):
                return result(
                    score("cp", 50, (700, 200, 100)),
                    "a7a6",
                    alternatives=((score("cp", 40, (680, 220, 100)), "c7c6"),),
                )

        status, puzzle_id = categorize_candidate(
            self.connection,
            InvalidatingEngine(),
            claimed,
            source,
            CategorizerConfig(nodes=100),
        )
        self.assertEqual((status, puzzle_id), ("rejected", None))
        row = self.connection.execute(
            "SELECT diagnostic FROM candidates WHERE id = ?", (claimed.id,)
        ).fetchone()
        self.assertEqual(row["diagnostic"], "mate_not_reproduced")

    def test_verified_centroid_mate_is_promoted_with_actual_ply_length(self) -> None:
        source = Path(self.temp.name) / "source.sqlite3"
        source_connection = sqlite3.connect(source)
        source_connection.execute("CREATE TABLE games(id TEXT PRIMARY KEY, moves TEXT)")
        source_connection.execute(
            "INSERT INTO games VALUES (?, ?)", ("g1", json.dumps(["a4a5"]))
        )
        source_connection.commit()
        source_connection.close()
        insert_candidate(self.connection, self._candidate())
        claimed = claim_checkmate_candidate(self.connection)

        status, puzzle_id = categorize_candidate(
            self.connection,
            CategorizerEngine(),
            claimed,
            source,
            CategorizerConfig(nodes=100),
        )

        self.assertEqual(status, "published")
        self.assertIsNotNone(puzzle_id)
        puzzle = self.connection.execute("SELECT * FROM puzzles").fetchone()
        self.assertEqual(puzzle["solution_plies"], 3)
        self.assertEqual(json.loads(puzzle["line"])[0], "a4a5")
        self.assertEqual(
            set(json.loads(puzzle["themes"])),
            {"centroidPawnMate", "mate", "mateIn2"},
        )

    def test_verified_mate_without_a_named_pattern_is_published_by_length(self) -> None:
        source = Path(self.temp.name) / "source.sqlite3"
        source_connection = sqlite3.connect(source)
        source_connection.execute("CREATE TABLE games(id TEXT PRIMARY KEY, moves TEXT)")
        source_connection.execute(
            "INSERT INTO games VALUES (?, ?)", ("g1", json.dumps(["a4a5"]))
        )
        source_connection.commit()
        source_connection.close()
        insert_candidate(self.connection, self._candidate())
        claimed = claim_checkmate_candidate(self.connection)

        class UnnamedMateEngine(CategorizerEngine):
            def inspect(self, context):
                status = super().inspect(context)
                if status.checkmate:
                    return PositionStatus(
                        "4k4/9/9/9/9/9/9/9/3p5/4K4 w - - 0 1", True, ()
                    )
                return status

        status, puzzle_id = categorize_candidate(
            self.connection,
            UnnamedMateEngine(),
            claimed,
            source,
            CategorizerConfig(nodes=100),
        )

        self.assertEqual(status, "published")
        self.assertIsNotNone(puzzle_id)
        themes = json.loads(self.connection.execute("SELECT themes FROM puzzles").fetchone()[0])
        self.assertEqual(set(themes), {"mate", "mateIn2"})


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
            detail="dpxq:42 screening position 10/83",
        )

        self.assertIn("Checking game 1/232,195", line)
        self.assertIn("checkmate: 2", line)
        self.assertIn("tactic: 7", line)
        self.assertIn("dpxq:42 screening position 10/83", line)


if __name__ == "__main__":
    unittest.main()
