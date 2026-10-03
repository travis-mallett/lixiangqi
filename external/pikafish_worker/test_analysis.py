from __future__ import annotations

import unittest
import os
from unittest.mock import Mock, patch

from external.pikafish_worker.analysis import analyse_game, external_snapshot, provide_external
from tools.xiangqi_data.pikafish import Pikafish

FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"


def snapshot(move="i10i9", red_cp=-22):
    return {"bestMove": move, "depth": 10, "timeMs": 100, "nodes": 200,
            "lines": [{"multipv": 1, "pvMoves": [move], "depth": 10, "timeMs": 100,
                       "nodes": 200, "nps": 2000, "score": {"cp": 22, "redCp": red_cp}}]}


class NativeAnalysisWorkerTest(unittest.TestCase):
    def test_external_provider_transports_native_history_and_red_scores(self):
        client, engine = Mock(), Mock(name="Pikafish")
        engine.search_stream.return_value = (value for value in [snapshot()])
        job = {"id": "job", "secret": "private", "work": {"initialFen": FEN, "moves": ["a4a5"],
               "legalMoves": ["i10i9"], "ruleset": "tiantian-v1", "depth": 10, "multiPv": 1, "threads": 1, "hash": 64}}
        provide_external(client, engine, job)
        self.assertEqual(engine.search_stream.call_args.kwargs["moves"], ["a4a5"])
        self.assertEqual(engine.search_stream.call_args.kwargs["legal_moves"], ["i10i9"])
        sent = client.post.call_args.args[1]
        self.assertEqual(sent["analysis"]["pvs"], [{"moves": ["i10i9"], "cp": -22}])
        self.assertTrue(sent["done"])

    def test_game_analysis_retains_terminal_and_skipped_positions(self):
        client, engine = Mock(), Mock()
        engine.name = "Pikafish test"
        engine.search_stream.return_value = (value for value in [snapshot("a4a5", 22)])
        job = {"position": FEN, "moves": "a4a5 i10i9", "ruleset": "unrestricted-v1", "work": {"id": "native01", "nodes": 200},
               "skipPositions": [1], "positions": [{"result": "*", "legalMoves": ["a4a5"]},
               {"result": "*", "legalMoves": ["i10i9"]}, {"result": "1/2-1/2", "legalMoves": []}]}
        analyse_game(client, engine, job, 1, 16)
        evaluations = client.post.call_args.args[1]["analysis"]
        self.assertEqual(len(evaluations), 3)
        self.assertEqual(evaluations[0]["pv"], "a4a5")
        self.assertEqual(evaluations[1], {"skipped": True})
        self.assertEqual(evaluations[2]["score"], {"cp": 0})

    def test_uci_bridge_preserves_history_restricts_root_and_rejects_bad_pv(self):
        engine = Pikafish()
        output = iter(["info depth 3 multipv 1 score cp 22 nodes 200 nps 2000 time 100 pv i9i8", "bestmove i9i8"])
        commands = []
        with patch.object(engine, "_ensure_started"), patch.object(engine, "_send", side_effect=commands.append), \
             patch.object(engine, "_read_until"), patch.object(engine, "_read_line", side_effect=lambda _: next(output)):
            results = list(engine.search_stream(initial_fen=FEN, moves=["a4a5"], search={"nodes": 200}, legal_moves=["i10i9"]))
        self.assertIn("position fen " + FEN + " moves a3a4", commands)
        self.assertIn("go nodes 200 searchmoves i9i8", commands)
        self.assertEqual(external_snapshot(results[-1])["pvs"][0]["cp"], -22)
        with self.assertRaises(ValueError):
            engine._parse_info("info depth 1 score cp 1 pv i9i8 INVALID", Mock(color=0))


@unittest.skipUnless(os.environ.get("LIXIANGQI_TEST_ENGINE"), "Requires an available native Pikafish worker")
class NativePikafishIntegrationTest(unittest.TestCase):
    def test_real_pikafish_native_history_rank_ten_and_multipv(self):
        engine = Pikafish()
        self.assertTrue(engine.installed)
        try:
            results = list(engine.search_stream(initial_fen=FEN, moves=["a4a5"],
                           legal_moves=["i10i9", "i10i8"], search={"depth": 6}, multi_pv=2))
            final = results[-1]
            self.assertIn("Pikafish", final["engine"])
            self.assertEqual(final["depth"], 6)
            self.assertEqual({line["pvMoves"][0] for line in final["lines"]}, {"i10i9", "i10i8"})
            self.assertIn(final["bestMove"], {"i10i9", "i10i8"})
        finally:
            engine.close()


if __name__ == "__main__":
    unittest.main()
