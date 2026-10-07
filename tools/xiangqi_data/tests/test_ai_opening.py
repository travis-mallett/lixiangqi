from __future__ import annotations

import random
import sqlite3
import unittest
from dataclasses import replace
from unittest.mock import Mock, patch

from external.pikafish_worker.ai import (
    BOOK_MISS_PROFILE,
    STRENGTH_PROFILES,
    AiWorker,
    MoveWork,
    PikafishMoveEngine,
)
from external.pikafish_worker.opening import choose_opening_move, master_book_moves
from external.xiangqi_explorer.explorer import master_book_moves as catalog_book_moves
from external.xiangqi_explorer.server import ExplorerHandler

START = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"


class OpeningTest(unittest.TestCase):
    def setUp(self):
        self.work = MoveWork("abcd1234", 1, START, (), legal_moves=("h3e3", "h1g3"))
        self.engine = Mock()
        self.engine.book_position.return_value = (START, self.work.legal_moves)
        self.lookup = self.enterContext(
            patch(
                "external.pikafish_worker.opening.master_book_moves",
                return_value=[("h3e3", 47), ("h1g3", 13)],
            )
        )

    def test_fade_for_both_sides_and_every_bot_turn(self):
        for number in range(1, 12):
            for offset in (0, 1):
                work = replace(self.work, moves=("a1a2",) * (2 * (number - 1) + offset))
                rng = random.Random(731)
                books = sum(
                    choose_opening_move(work, self.engine, rng) is not None
                    for _ in range(10000)
                )
                self.assertAlmostEqual(
                    max(0, (11 - number) / 10), books / 10000, delta=0.015
                )
        self.lookup.reset_mock()
        self.engine.reset_mock()
        self.assertIsNone(choose_opening_move(work, self.engine))
        self.lookup.assert_not_called()
        self.engine.book_position.assert_not_called()

    def test_frequency_sampling_renormalizes_only_legal_positive_counts(self):
        self.lookup.return_value += [("a1a10", 100000), ("b1c3", 0), ("c1e3", -4)]
        rng = random.Random(923)
        moves = [choose_opening_move(self.work, self.engine, rng) for _ in range(20000)]
        self.assertEqual({"h3e3", "h1g3"}, set(moves))
        self.assertAlmostEqual(47 / 60, moves.count("h3e3") / len(moves), delta=0.01)

    def test_single_move_and_deterministic_retry(self):
        self.lookup.return_value = [("h3e3", 1)]
        self.assertEqual("h3e3", choose_opening_move(self.work, self.engine))
        self.lookup.return_value.append(("h1g3", 100))
        self.assertEqual(
            choose_opening_move(self.work, self.engine),
            choose_opening_move(self.work, self.engine),
        )

    def test_engine_fallback_preserves_all_720_profiles(self):
        worker = AiWorker("localhost", 6379)
        worker.engine = self.engine
        self.engine.best_move.return_value = "engine"
        for level, profile in enumerate(STRENGTH_PROFILES, 1):
            work = replace(self.work, level=level)
            self.lookup.return_value = []
            self.assertEqual("engine", worker.choose_move(work))
            self.engine.best_move.assert_called_with(work, BOOK_MISS_PROFILE)
            self.engine.best_move.reset_mock()
            self.lookup.return_value = [("h3e3", 1)]
            with patch("external.pikafish_worker.opening.random.Random") as rng:
                rng.return_value.random.return_value = 0.99
                later = replace(work, moves=("a1a2",) * 8)
                self.assertEqual("engine", worker.choose_move(later))
                self.engine.best_move.assert_called_with(later, profile)
            after_book = replace(work, moves=("a1a2",) * 20)
            self.assertEqual("engine", worker.choose_move(after_book))
            self.engine.best_move.assert_called_with(after_book, profile)
            self.engine.best_move.reset_mock()
            self.assertEqual("h3e3", worker.choose_move(work))
            self.engine.best_move.assert_not_called()

    def test_empty_book_fallback_follows_book_side_of_fade(self):
        worker = AiWorker("localhost", 6379)
        worker.engine = self.engine
        self.lookup.return_value = []
        profile = STRENGTH_PROFILES[6]
        work = replace(self.work, level=7, moves=("a1a2",) * 10)
        self.engine.best_move.return_value = "engine"

        with patch("external.pikafish_worker.opening.random.Random") as rng:
            rng.return_value.random.return_value = 0.25
            self.assertEqual("engine", worker.choose_move(work))
        self.engine.best_move.assert_called_once_with(work, BOOK_MISS_PROFILE)

        self.engine.best_move.reset_mock()
        with patch("external.pikafish_worker.opening.random.Random") as rng:
            rng.return_value.random.return_value = 0.75
            self.assertEqual("engine", worker.choose_move(work))
        self.engine.best_move.assert_called_once_with(work, profile)

    def test_lookup_errors_fall_back(self):
        worker = AiWorker("localhost", 6379)
        worker.engine = self.engine
        self.engine.best_move.return_value = "h1g3"
        for error in (TimeoutError(), OSError(), ValueError("bad response")):
            self.lookup.side_effect = error
            with self.assertLogs("external.pikafish_worker.opening", level="WARNING"):
                self.assertEqual("h1g3", worker.choose_move(self.work))

    def test_out_of_book_does_not_disable_later_position_lookup(self):
        self.lookup.side_effect = [[], [("h3e3", 2)]]
        self.assertIsNone(choose_opening_move(self.work, self.engine))
        later = replace(self.work, moves=("h1g3", "h10g8"))
        self.engine.book_position.return_value = (
            "transposed position",
            self.work.legal_moves,
        )
        rng = Mock()
        rng.random.return_value = 0
        rng.randrange.return_value = 0
        self.assertEqual("h3e3", choose_opening_move(later, self.engine, rng))
        self.lookup.assert_called_with("transposed position")

    def test_position_inspection_uses_history_and_server_legality_without_search(self):
        engine = PikafishMoveEngine()
        engine._ensure_started = Mock()
        engine._send = Mock()
        engine._read_line = Mock(
            side_effect=["board output", "Fen: actual fen", "Checkers:", "readyok"]
        )
        work = replace(self.work, moves=("h3e3", "h8e8"))
        self.assertEqual(("actual fen", work.legal_moves), engine.book_position(work))
        commands = [c.args[0] for c in engine._send.call_args_list]
        self.assertEqual(
            [f"position fen {START} moves h2e2 h7e7", "d", "isready"], commands
        )

    def test_legacy_work_gets_engine_legal_moves(self):
        engine = PikafishMoveEngine()
        engine._ensure_started = Mock()
        engine._send = Mock()
        engine._read_line = Mock(side_effect=[f"Fen: {START}", "readyok"])
        engine._legal_moves = Mock(return_value=["h2e2"])
        self.assertEqual(
            (START, ("h3e3",)),
            engine.book_position(replace(self.work, legal_moves=None)),
        )

    def test_http_lookup_is_bounded_and_uses_master_only_endpoint(self):
        # Call the real HTTP adapter, independently of the selection mock.
        with patch("external.pikafish_worker.opening.urlopen") as open_url:
            open_url.return_value.__enter__.return_value.read.return_value = (
                b'{"moves":[["h3e3",47],["h1g3",13]]}'
            )
            self.assertEqual([("h3e3", 47), ("h1g3", 13)], master_book_moves(START))
            request = open_url.call_args.args[0]
            self.assertTrue(request.full_url.endswith("/opening-book"))
            self.assertEqual(0.5, open_url.call_args.kwargs["timeout"])


class CatalogBookTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.executescript("""
            CREATE TABLE explorer_positions(id INTEGER PRIMARY KEY, position_key TEXT);
            CREATE TABLE explorer_stats(position_id INTEGER, move TEXT,
                masters_red INTEGER, masters_draws INTEGER, masters_black INTEGER);
            CREATE TABLE games(id INTEGER, statistical_eligible INTEGER, record_kind TEXT);
            CREATE TABLE game_positions(game_id INTEGER, position_key TEXT, move TEXT);
            CREATE TABLE game_sources(game_id INTEGER, source TEXT, collection TEXT);
        """)
        # The production query owns the connection lifetime.
        self.enterContext(
            patch(
                "external.xiangqi_explorer.explorer.open_catalog_connection",
                return_value=self.db,
            )
        )

    def test_hot_position_returns_every_move_and_sums_outcomes_and_months(self):
        self.db.execute(
            "INSERT INTO explorer_positions VALUES (1, ?)",
            (" ".join(START.split()[:2]),),
        )
        self.db.executemany(
            "INSERT INTO explorer_stats VALUES (1, ?, 2, 3, 4)",
            [(f"move{i:02}",) for i in range(40)],
        )
        self.db.execute("INSERT INTO explorer_stats VALUES (1, 'move00', 1, 1, 1)")
        moves = catalog_book_moves(START.replace("0 1", "12 20"))
        self.assertEqual(40, len(moves))
        self.assertEqual(("move00", 12), moves[0])
        self.assertEqual(("move39", 9), moves[-1])

    def test_cold_position_uses_only_eligible_master_games_without_source_duplicates(
        self,
    ):
        key = " ".join(START.split()[:2])
        self.db.executemany(
            "INSERT INTO games VALUES (?, ?, ?)",
            [
                (1, 1, "played_game"),
                (2, 1, "played_game"),
                (3, 0, "played_game"),
                (4, 1, "manual"),
                (5, 1, "played_game"),
            ],
        )
        self.db.executemany(
            "INSERT INTO game_sources VALUES (?, 'dpxq', ?)",
            [(1, "m"), (1, "m"), (2, "n"), (3, "m"), (4, "m"), (5, "m")],
        )
        self.db.executemany(
            "INSERT INTO game_positions VALUES (?, ?, ?)",
            [(i, key, "h3e3") for i in range(1, 6)],
        )
        self.assertEqual([("h3e3", 2)], catalog_book_moves(START))

    def test_unknown_position(self):
        self.assertEqual([], catalog_book_moves(START))

    def test_endpoint_cannot_select_non_master_sources(self):
        with patch(
            "external.xiangqi_explorer.server.master_book_moves",
            return_value=[("h3e3", 47)],
        ) as lookup:
            self.assertEqual(
                {"moves": [("h3e3", 47)]},
                ExplorerHandler._opening_book({"fen": START, "database": "all"}),
            )
            lookup.assert_called_once_with(START)
        self.db.close()


class NativeBookPositionTest(unittest.TestCase):
    def test_transposed_histories_resolve_the_same_book_position(self):
        engine = PikafishMoveEngine()
        if not engine.executable.is_file():
            self.skipTest("Pikafish is not installed")

        def close_engine():
            process = engine.process
            engine.close()
            if process:
                if process.stdin:
                    process.stdin.close()
                if process.stdout:
                    process.stdout.close()

        self.addCleanup(close_engine)
        first = MoveWork("abcd1234", 1, START, ("h1g3", "h10g8", "b1c3", "b10c8"))
        second = replace(first, moves=("b1c3", "b10c8", "h1g3", "h10g8"))
        fen, legal = engine.book_position(first)
        other_fen, other_legal = engine.book_position(second)
        self.assertEqual(fen, other_fen)
        self.assertEqual(set(legal), set(other_legal))
        with patch(
            "external.pikafish_worker.opening.master_book_moves",
            side_effect=lambda current: [(legal[0], 1)] if current == fen else [],
        ) as lookup:
            rng = Mock()
            rng.random.return_value = 0
            rng.randrange.return_value = 0
            self.assertEqual(legal[0], choose_opening_move(second, engine, rng))
            lookup.assert_called_once_with(fen)


if __name__ == "__main__":
    unittest.main()
