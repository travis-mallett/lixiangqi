import json
import shutil
import unittest

from .ai import MoveWork
from .fairy_xiangqi import FairyXiangqiMoveEngine, strength

START = "m1bakab1r/9/9/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w m - 0 1"


class ManchuTest(unittest.TestCase):
    def test_work_binds_variant_rules_and_geometry(self):
        work = MoveWork("Manchu01", 4, START, (), ruleset="manchu-v1", legal_moves=("a4a5",), variant="manchu")
        value = {"version": 2, "type": "move", "gameId": work.game_id, "requestId": "ManchuReq001",
                 "turnKey": work.computed_turn_key, "level": 4,
                 "position": {"variant": "manchu", "ruleset": "manchu-v1", "initialFen": START,
                              "moves": [], "legalMoves": ["a4a5"]}}
        self.assertEqual(MoveWork.parse_v2(json.dumps(value)).variant, "manchu")
        for field, changed in [("variant", "xiangqi"), ("ruleset", "tiantian-v1"),
                               ("initialFen", START.replace("m1bakab1r", "m1bakab2r"))]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                MoveWork.parse_v2(json.dumps(value | {"position": value["position"] | {field: changed}}))
        for level in [0, 11, True]:
            with self.assertRaises(ValueError):
                MoveWork.parse_v2(json.dumps(value | {"level": level}))

    @unittest.skipUnless(shutil.which("node"), "Node is required for the packaged WASM engine")
    def test_real_engine_all_levels_black_banner_and_captured_banner(self):
        engine = FairyXiangqiMoveEngine("manchu")
        try:
            for level in range(1, 11):
                work = MoveWork("Manchu01", level, START, (), ruleset="manchu-v1",
                                legal_moves=("a4a5", "b3b10"), variant="manchu")
                self.assertIn(engine.best_move(work, strength(level)), work.legal_moves)
            work = MoveWork("Manchu01", 5, START, ("a4a5",), ruleset="manchu-v1",
                            legal_moves=("a10b8", "a10b10"), variant="manchu")
            self.assertIn(engine.best_move(work, strength(5)), work.legal_moves)
            captured = "4k4/9/9/9/4p4/9/9/9/R8/4K4 b m - 0 1"
            work = MoveWork("Manchu01", 5, captured, (), ruleset="manchu-v1",
                            legal_moves=("e10d10", "e10f10"), variant="manchu")
            self.assertIn(engine.best_move(work, strength(5)), work.legal_moves)
        finally:
            engine.close()


if __name__ == "__main__":
    unittest.main()
