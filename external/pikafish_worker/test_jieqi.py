import copy
import shutil
import unittest

from .ai import MoveWork
from .jieqi import JieqiMoveEngine, engine_fen, strength, validate_observation


START = "xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w j - 0 1"


def observation():
    return {"fen": START, "remaining": {p: 5 if p.lower() == "p" else 2 for p in "RACPNBracpnb"}}


class JieqiObservationTest(unittest.TestCase):
    def test_engine_input_contains_only_the_information_set(self):
        self.assertEqual(engine_fen(observation()), START.split()[0] + " w R2A2C2P5N2B2r2a2c2p5n2b2 0 1")
        leaked = observation() | {"deal": {"a1": "chariot"}}
        with self.assertRaises(ValueError):
            validate_observation(leaked)

    def test_unknown_captures_stay_in_the_pool(self):
        public = observation()
        public["fen"] = public["fen"].replace("xxxxkxxxx", "x1xxkxxxx")
        validate_observation(public)
        known = copy.deepcopy(public)
        known["remaining"]["r"] -= 1
        validate_observation(known)
        self.assertNotEqual(engine_fen(public), engine_fen(known))

    def test_impossible_inventory_and_secret_tokens_are_rejected(self):
        for changed in [{"R": 0}, {"R": -1}, {"R": True}, {"k": 1}]:
            value = observation()
            value["remaining"].update(changed)
            with self.assertRaises(ValueError):
                validate_observation(value)
        value = observation()
        value["fen"] += " secret"
        with self.assertRaises(ValueError):
            validate_observation(value)

    def test_ten_levels_have_increasing_bounded_budgets(self):
        profiles = [strength(level) for level in range(1, 11)]
        self.assertEqual(sorted({p.nodes for p in profiles}), [p.nodes for p in profiles])
        self.assertEqual(profiles[-1].nodes, 250_000)
        for level in [0, 11, True, 1.5]:
            with self.assertRaises(ValueError):
                strength(level)

    @unittest.skipUnless(shutil.which("node"), "Node is required for the packaged WASM engine")
    def test_packaged_engine_all_levels_obey_authoritative_moves(self):
        engine = JieqiMoveEngine()
        try:
            for level in range(1, 11):
                with self.subTest(level=level):
                    work = MoveWork("Jieqi001", level, START, (), ruleset="jieqi-v1",
                                    legal_moves=("a4a5", "b3b10"), variant="jieqi", observation=observation())
                    self.assertIn(engine.best_move(work, strength(level)), work.legal_moves)
            # A different unobservable deal cannot be passed to this boundary; identical
            # observations after a cleared search have identical results.
            self.assertEqual(engine.best_move(work, strength(5)), engine.best_move(work, strength(5)))
        finally:
            engine.close()


if __name__ == "__main__":
    unittest.main()
