import json
import random
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from tools.bot_levels_optimization.rating_pool.game import GameRuntime
from tools.bot_levels_optimization.rating_pool.model import generate, match, rate
from tools.bot_levels_optimization.rating_pool.reports import export, propose
from tools.bot_levels_optimization.rating_pool.runner import run
from tools.bot_levels_optimization.rating_pool.store import (
    PoolStore,
    game_record,
    snapshot,
)

CONFIG = {"bots": 20, "seed": 7, "k": 32, "window": 100, "max_plies": 600}


class PoolTests(unittest.TestCase):
    def test_generation_endpoints_constraints_and_log_distribution(self):
        bots = generate(5000, 17)
        self.assertEqual(bots, generate(5000, 17))
        low, high = bots["endpoint-low"], bots["endpoint-high"]
        self.assertEqual(
            (low.nodes, low.MultiPV, low.expectedRank, low.maxCandidateLoss),
            (149, 16, 9, 600),
        )
        self.assertEqual(
            (high.nodes, high.MultiPV, high.expectedRank, high.maxCandidateLoss),
            (3318000, 1, 1, None),
        )
        self.assertEqual(
            len(
                {
                    (b.nodes, b.MultiPV, b.expectedRank, b.maxCandidateLoss)
                    for b in bots.values()
                }
            ),
            5000,
        )
        for bot in bots.values():
            self.assertTrue(149 <= bot.nodes <= 3318000)
            self.assertTrue(1 <= bot.expectedRank <= min(9, bot.MultiPV))
            self.assertEqual(bot.elo, 1500)
        # Uniform log sampling puts half the population below the geometric mean.
        self.assertTrue(
            2300 < sum(b.nodes < (149 * 3318000) ** 0.5 for b in bots.values()) < 2700
        )

    def test_elo_updates_are_zero_sum_and_counters_match(self):
        a, b = generate(2, 1).values()
        rate(a, b, "1-0", 32)
        self.assertEqual((a.elo, b.elo), (1516, 1484))
        rate(a, b, "1/2-1/2", 32)
        self.assertLess(a.elo, 1516)
        rate(a, b, "0-1", 32)
        self.assertAlmostEqual(a.elo + b.elo, 3000)
        self.assertEqual((a.games, a.wins, a.draws, a.losses), (3, 1, 1, 1))

    def test_matchmaking_nearby_fresh_busy_and_widening(self):
        bots = generate(5, 1)
        a, b, c, d, e = bots.values()
        for bot in (b, c, d, e):
            bot.games = 1
        a.lastOpponent = b.id
        d.elo, e.elo = 2000, 2600
        pair = match(bots, {e.id}, random.Random(1))
        self.assertEqual({p.id for p in pair}, {a.id, c.id})
        pair = match(bots, {b.id, c.id, d.id}, random.Random(1))
        self.assertEqual({p.id for p in pair}, {a.id, e.id})
        self.assertIsNone(match(bots, {b.id, c.id, d.id, e.id}, random.Random(1)))

    def test_transaction_resume_pending_and_duplicate_protection(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pool.db"
            store = PoolStore(path, config=CONFIG, provenance={"test": 1})
            plan = {
                "sequence": 1,
                "gameId": "one",
                "rngSeed": "seed",
                "red": "endpoint-low",
                "black": "endpoint-high",
            }
            store.reserve(plan)
            with self.assertRaises(sqlite3.OperationalError):
                PoolStore(path, resume=True)
            store.close()
            store = PoolStore(path, provenance={"test": 1}, resume=True)
            self.assertEqual(store.pending(), [plan])
            record = {
                **plan,
                "status": "completed",
                "result": "1-0",
                "book": {"fen": [["a0a1", 5]]},
            }
            store.finish(record)
            with self.assertRaises(ValueError):
                store.finish(record)
            self.assertEqual(game_record(path, 1)["book"], record["book"])
            summary = export(path, Path(directory) / "ratings.csv")
            self.assertEqual(summary["totalGamesCompleted"], 1)
            self.assertEqual(summary["maximumGamesPerBot"], 1)
            store.close()
            with self.assertRaises(ValueError):
                PoolStore(path, provenance={"test": 2}, resume=True)
            store = PoolStore(path, provenance={"test": 1}, resume=True)
            self.assertEqual(store.completed, 1)
            self.assertEqual(sum(b.games for b in store.bots.values()), 2)
            store.close()

    def test_concurrent_scheduler_isolated_busy_bots_failures_and_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pool.db"
            store = PoolStore(path, config=CONFIG, provenance={})
            barrier = threading.Barrier(4)
            lock = threading.Lock()
            playing = set()
            instances = []
            test = self

            class Runtime:
                def __init__(self):
                    self.closed = False
                    instances.append(self)

                def play(self, plan, red, black, *args, **kwargs):
                    with lock:
                        test.assertFalse({red.id, black.id} & playing)
                        playing.update((red.id, black.id))
                    if plan["sequence"] <= 4:
                        barrier.wait(timeout=5)
                    with lock:
                        playing.difference_update((red.id, black.id))
                    failed = plan["sequence"] == 1
                    return {
                        **plan,
                        "status": "failed" if failed else "completed",
                        "result": None if failed else "1/2-1/2",
                    }

                def close(self):
                    self.closed = True

            result = run(store, 12, 4, Runtime, emit=lambda _: None)
            self.assertEqual(result["status"], "complete")
            self.assertEqual(result["excludedThisRun"], 1)
            self.assertEqual(store.sequence, 13)
            self.assertEqual(len(instances), 4)
            self.assertTrue(all(r.closed for r in instances))
            self.assertEqual(sum(b.games for b in store.bots.values()), 24)
            self.assertEqual(sum(b.elo for b in store.bots.values()), 1500 * 20)
            store.close()
            store = PoolStore(path, resume=True)
            run(store, 14, 4, Runtime, emit=lambda _: None)
            self.assertEqual(store.completed, 14)
            store.close()

    def test_interrupt_leaves_game_pending_for_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            store = PoolStore(Path(directory) / "pool.db", config=CONFIG, provenance={})
            stop = threading.Event()

            class Runtime:
                def play(self, plan, *args, **kwargs):
                    stop.set()
                    return {**plan, "status": "interrupted", "result": None}

                def close(self):
                    pass

            result = run(store, 1, 1, Runtime, stop=stop, emit=lambda _: None)
            self.assertEqual(result["status"], "interrupted")
            self.assertEqual(len(store.pending()), 1)
            self.assertEqual(store.completed, 0)
            successful = Mock()
            successful.play.side_effect = lambda plan, *a, **kw: {
                **plan,
                "status": "completed",
                "result": "1-0",
            }
            run(store, 1, 1, lambda: successful, emit=lambda _: None)
            self.assertEqual(store.sequence, 1)
            self.assertEqual(store.completed, 1)
            store.close()

    def test_failure_limit_and_censored_games_never_rate(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pool.db"
            store = PoolStore(path, config=CONFIG, provenance={})
            runtime = Mock()
            runtime.play.side_effect = lambda plan, *a, **kw: {
                **plan,
                "status": "censored",
                "result": None,
            }
            result = run(
                store, 100, 1, lambda: runtime, max_failures=2, emit=lambda _: None
            )
            self.assertEqual(result["status"], "failure_limit")
            self.assertEqual(store.completed, 0)
            self.assertEqual(snapshot(path)[1], {"censored": 2})
            self.assertTrue(
                all(b.games == 0 and b.elo == 1500 for b in store.bots.values())
            )
            store.close()

    def test_level_selection_fixed_endpoints_unique_nearest_and_gaps(self):
        bots = list(generate(800, 1).values())
        with self.assertRaises(ValueError):
            propose(bots)
        bots[0].elo, bots[1].elo = 500, 2500
        for i, bot in enumerate(bots[2:]):
            bot.elo = 501 + i * 1998 / 797
        rows, report = propose(bots)
        self.assertEqual(len(rows), 720)
        self.assertEqual(len({r["bot id"] for r in rows}), 720)
        self.assertEqual(rows[0]["bot id"], "endpoint-low")
        self.assertEqual(rows[-1]["bot id"], "endpoint-high")
        self.assertAlmostEqual(rows[1]["target Elo"], 500 + 2000 / 719)
        self.assertTrue(report["unratedSelectedBots"])
        tiny = bots[:4]
        tiny[2].elo, tiny[3].elo = 501, 502
        _, report = propose(tiny, 4, 25)
        self.assertTrue(report["largePoolGaps"])
        self.assertTrue(report["distantTargets"])


class GameTests(unittest.TestCase):
    def runtime(self):
        runtime = GameRuntime.__new__(GameRuntime)
        runtime.engine, runtime.rules = Mock(), Mock()
        runtime.engine.book_position.return_value = ("fen", ("a0a1",))
        runtime.engine.invalid_output = False
        runtime.rules.position.side_effect = [
            {"fen": "fen", "turn": "red", "gameResult": "*", "legalMoves": ["a0a1"]},
            {
                "fen": "end",
                "turn": "black",
                "gameResult": "1-0",
                "termination": "checkmate",
                "legalMoves": [],
            },
        ]
        return runtime

    def test_book_capture_replay_and_production_policy(self):
        low, high = generate(2, 1).values()
        plan = {
            "sequence": 1,
            "gameId": "id",
            "rngSeed": "seed",
            "red": low.id,
            "black": high.id,
        }
        with patch(
            "tools.bot_levels_optimization.rating_pool.game.master_book_moves",
            return_value=[("a0a1", 20)],
        ) as lookup:
            runtime = self.runtime()
            result = runtime.play(plan, low, high, 600, True)
            self.assertEqual(result["status"], "completed")
            self.assertEqual(result["moves"], ("a0a1",))
            runtime.engine.best_move.assert_not_called()
            replay = self.runtime().play(
                plan,
                low,
                high,
                600,
                True,
                replay_book=json.loads(json.dumps(result["book"])),
            )
            self.assertEqual(result["result"], replay["result"])
            self.assertEqual(lookup.call_count, 1)

    def test_book_failure_excludes_game(self):
        low, high = generate(2, 1).values()
        runtime = self.runtime()
        with (
            patch(
                "tools.bot_levels_optimization.rating_pool.game.master_book_moves",
                side_effect=TimeoutError("offline"),
            ),
            self.assertLogs("external.pikafish_worker.opening", "WARNING"),
        ):
            record = runtime.play({"gameId": "id"}, low, high, 600)
        self.assertEqual(record["status"], "failed")
        self.assertEqual(record["failure"]["stage"], "opening")
        runtime.engine.close.assert_called_once()

    def test_engine_profile_and_invalid_output_exclusion(self):
        low, high = generate(2, 1).values()
        runtime = self.runtime()
        runtime.engine.best_move.return_value = "a0a1"
        with patch(
            "tools.bot_levels_optimization.rating_pool.game.master_book_moves",
            return_value=[],
        ):
            record = runtime.play({"gameId": "id"}, low, high, 600)
        self.assertEqual(record["status"], "completed")
        self.assertEqual(runtime.engine.best_move.call_args.args[1], low.profile())
        self.assertFalse(runtime.engine.available_count)
        runtime = self.runtime()
        runtime.engine.best_move.return_value = "i9i8"
        with patch(
            "tools.bot_levels_optimization.rating_pool.game.master_book_moves",
            return_value=[],
        ):
            record = runtime.play({"gameId": "id"}, low, high, 600)
        self.assertEqual(record["status"], "failed")
        self.assertNotIn("moves", record)


if __name__ == "__main__":
    unittest.main()
