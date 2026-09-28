"""Puzzle roots discard source rules history; solution paths retain their own."""

import unittest

from tools.xiangqi_data.pikafish_rules import START_FEN
from tools.xiangqi_data.puzzle_mining.discovery import DiscoveryConfig, discover_game
from tools.xiangqi_data.puzzle_mining.position import (
    puzzle_root_fen,
    replay_fens,
    candidate_key,
)
from tools.xiangqi_data.tests.test_puzzle_mining import StaticEngine, result, score
from tools.xiangqi_data.tests.test_puzzle_equal_mates import TreeEngine, run, FEN


class IsolatedHistoryTest(unittest.TestCase):
    def test_discovery_compares_isolated_boards_and_preserves_source_provenance(self):
        initial = START_FEN.replace("0 1", "119 80")
        fens = replay_fens(["a4a5"], initial)
        calls = []

        def analyse(context, nodes):
            calls.append((context, nodes))
            self.assertEqual(context.moves, ())
            self.assertEqual(context.initial_fen.split()[4:], ["0", "1"])
            if context.initial_fen == puzzle_root_fen(fens[0]):
                return result(score("cp", 0, (0, 1000, 0)), "a4a5")
            self.assertEqual(context.initial_fen, puzzle_root_fen(fens[1]))
            return result(score("mate", 3), "a7a6")

        found = discover_game(
            StaticEngine(),
            source_database="test",
            game_id="source",
            source_url="",
            moves=["a4a5"],
            initial_fen=initial,
            config=DiscoveryConfig(),
            analyse=analyse,
        )
        self.assertEqual(len(found), 1)
        self.assertEqual({n for _, n in calls}, {20})
        self.assertEqual(found[0].position_fen, fens[1])
        self.assertEqual(found[0].pre_fen, fens[0])
        self.assertEqual(
            found[0].candidate_key, candidate_key(fens[1], ("a4a5",), initial)
        )
        self.assertEqual(found[0].search_settings["history_policy"], "isolated-root-v1")

    def test_single_line_retains_only_its_moves_from_the_puzzle_root(self):
        engine = TreeEngine(
            {
                (): ("w", [("a", ("mate", 2))]),
                ("a",): ("b", [("d", ("mate", -1)), ("e", ("mate", -1))]),
                ("a", "d"): ("w", [("x", ("mate", 1))]),
                ("a", "e"): ("w", [("y", ("mate", 1))]),
            },
            history=(),
        )
        solved = run(engine)
        self.assertTrue(solved.complete)
        self.assertEqual(len(solved.branches), 1)
        for branch in solved.branches:
            for index, decision in enumerate(branch.decisions):
                self.assertEqual(decision.context.initial_fen, FEN)
                self.assertEqual(decision.context.moves, branch.moves[:index])
