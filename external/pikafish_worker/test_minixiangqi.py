import json
import shutil
import unittest

from .ai import MoveWork
from .minixiangqi import MiniXiangqiMoveEngine, strength

START = "rcnkncr/p1ppp1p/7/7/7/P1PPP1P/RCNKNCR w - - 0 1"

class MiniXiangqiTest(unittest.TestCase):
    def test_levels_are_bounded_and_strictly_increasing(self):
        profiles = [strength(level) for level in range(1, 11)]
        self.assertEqual(sorted({p.nodes for p in profiles}), [p.nodes for p in profiles])
        self.assertEqual(profiles[-1].nodes, 250_000)
        for invalid in [0, 11, True, 1.5]:
            with self.assertRaises(ValueError):
                strength(invalid)

    def test_protocol_binds_variant_rules_geometry_and_level(self):
        work = MoveWork("Mini0001", 4, START, (), ruleset="minixiangqi-v1", legal_moves=("a2b2",), variant="minixiangqi")
        value = {"version": 2, "type": "move", "gameId": work.game_id, "requestId": "MiniRequest1", "turnKey": work.computed_turn_key,
                 "level": 4, "position": {"variant": "minixiangqi", "ruleset": "minixiangqi-v1", "initialFen": START, "moves": [], "legalMoves": ["a2b2"]}}
        self.assertEqual(MoveWork.parse_v2(json.dumps(value)).variant, "minixiangqi")
        for field, changed in [("variant", "xiangqi"), ("ruleset", "tiantian-v1"), ("legalMoves", ["i10i9"]), ("initialFen", "9/9/9/9/9/9/9 w - - 0 1")]:
            invalid = value | {"position": value["position"] | {field: changed}}
            with self.assertRaises(ValueError):
                MoveWork.parse_v2(json.dumps(invalid))
        with self.assertRaises(ValueError):
            MoveWork.parse_v2(json.dumps(value | {"level": 11}))

    @unittest.skipUnless(shutil.which("node"), "Node is required for the packaged WASM engine")
    def test_packaged_engine_all_levels_and_black_history_obey_authoritative_moves(self):
        engine = MiniXiangqiMoveEngine()
        try:
            for level in range(1, 11):
                with self.subTest(level=level):
                    work = MoveWork("Mini0001", level, START, (), ruleset="minixiangqi-v1", legal_moves=("a2b2", "b1b6"), variant="minixiangqi")
                    self.assertIn(engine.best_move(work, strength(level)), work.legal_moves)
            work = MoveWork("Mini0001", 5, START, ("a2a3",), ruleset="minixiangqi-v1", legal_moves=("g6f6", "b7b2"), variant="minixiangqi")
            self.assertIn(engine.best_move(work, strength(5)), work.legal_moves)
        finally:
            engine.close()

if __name__ == "__main__":
    unittest.main()
