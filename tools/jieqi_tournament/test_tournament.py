import itertools
import copy
import sys
import tempfile
import threading
import unittest
from collections import Counter
from pathlib import Path

from .processes import Cancelled, Lines, engine_move, observation_fen
from .report import ENGINES, bootstrap, summarize
from .run import ROLES, SLOTS, make_deal, plans, run_lock
from .revalidate import check_compatible, verify_record


class TournamentTests(unittest.TestCase):
    def test_revalidation_allows_only_tooling_changes_and_worker_counts(self):
        saved = {"nodeVersion": "v24.0.0", "pythonVersion": "3.12.0", "config": {"workers": 4, "movetime": 1000},
                 "sha256": {"public/jieqi-engine/jqe/jqe.wasm": "engine", "tools/jieqi_tournament/run.py": "old"}}
        current = copy.deepcopy(saved)
        current["config"]["workers"] = 16
        current["sha256"]["tools/jieqi_tournament/run.py"] = "fixed"
        check_compatible(saved, current)
        for change in ("engine", "time", "runtime"):
            changed = copy.deepcopy(current)
            if change == "engine":
                changed["sha256"]["public/jieqi-engine/jqe/jqe.wasm"] = "different engine"
            elif change == "time":
                changed["config"]["movetime"] = 250
            else:
                changed["nodeVersion"] = "v24.1.0"
            with self.assertRaises(ValueError):
                check_compatible(saved, changed)

    def test_revalidation_rejects_changed_states_and_changed_engine_inputs(self):
        before = {"fen": "4k4/9/9/9/9/9/9/9/9/4K4 w j - 0 1", "turn": "red",
                  "remaining": {p: 0 for p in "RACPNBracpnb"}, "legalMoves": ["e1d1"], "result": "*"}
        after = {**before, "fen": "4k4/9/9/9/9/9/9/9/9/3K5 b j - 1 1",
                 "turn": "black", "legalMoves": [], "result": "1-0", "termination": "checkmate"}
        record = {"deal": {}, "red": "abjchess", "black": "jqe", "status": "completed",
                  "finalFen": after["fen"], "result": "1-0", "termination": "checkmate", "moves": [{
                      "engine": "abjchess", "move": "e1d1", "engineFen": observation_fen(before),
                      "go": "go movetime 1000 searchmoves e0d0", "after": after}]}

        class FakeReferee:
            def request(self, request):
                return before if "deal" in request else after

        verify_record(record, FakeReferee(), {})
        for field in ("engineFen", "go", "after"):
            changed = copy.deepcopy(record)
            if field == "after":
                changed["moves"][0][field]["result"] = "0-1"
            else:
                changed["moves"][0][field] += " invalid"
            with self.assertRaises(ValueError):
                verify_record(changed, FakeReferee(), {})

    def test_only_one_run_can_write_to_a_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            with run_lock(directory):
                self.assertTrue((directory / "run.lock").exists())
                with self.assertRaises(ValueError):
                    with run_lock(directory):
                        self.fail("Second writer was allowed")
            self.assertFalse((directory / "run.lock").exists())

    def test_deals_preserve_both_inventories_and_are_repeatable(self):
        for index in range(20):
            deal = make_deal(20261102, index)
            self.assertEqual(deal, make_deal(20261102, index))
            self.assertEqual(len(deal), 30)
            self.assertEqual(Counter(deal[s] for s in SLOTS), Counter(ROLES))
            self.assertEqual(Counter(v for s, v in deal.items() if s not in SLOTS), Counter(ROLES))
        self.assertNotEqual(make_deal(1, 0), make_deal(1, 1))
        self.assertNotEqual(make_deal(1, 0), make_deal(2, 0))

    def test_all_engines_face_both_opponents_in_both_colors(self):
        expected = set(itertools.permutations(ENGINES, 2))
        for index in range(20):
            plan = plans(7, index)
            self.assertEqual(len(plan), 6)
            self.assertEqual(set(plan), expected)
            self.assertEqual(plan, plans(7, index))

    def test_coordinate_boundary_in_both_directions(self):
        self.assertEqual(engine_move("b3b10"), "b2b9")
        self.assertEqual(engine_move("a10a1"), "a9a0")
        for invalid in ("a0a1", "a11a2", "j1a1", "a1", "a1a2\nquit"):
            with self.assertRaises(ValueError):
                engine_move(invalid)

    def test_engine_fen_uses_only_public_inventory(self):
        state = {"fen": "4k4/9/9/9/9/9/9/9/9/4K4 w j - 12 8",
                 "remaining": {p: 0 for p in "RACPNBracpnb"},
                 "deal": {"a1": "chariot"}}
        state["remaining"].update(R=1, P=3)
        self.assertEqual(observation_fen(state), "4k4/9/9/9/9/9/9/9/9/4K4 w R1P3 12 8")

    @staticmethod
    def games(index):
        # Synthetic statistics fixture, never written to a measurement directory.
        return [{"dealIndex": index, "red": a, "black": b, "status": "completed", "result": "1-0"}
                for a, b in itertools.permutations(ENGINES, 2)]

    def test_partial_and_censored_deals_do_not_bias_balanced_results(self):
        games = self.games(0) + self.games(1)[:5]
        result = summarize(games, 2)
        self.assertEqual(result["includedGames"], 6)
        self.assertEqual(result["excludedGames"], 5)
        for row in result["engines"].values():
            self.assertEqual((row["wins"], row["draws"], row["losses"]), (2, 0, 2))
        games[-1].update(status="censored", result=None)
        self.assertEqual(summarize(games, 2)["includedGames"], 6)

    def test_draws_are_not_wins(self):
        games = self.games(0)
        for game in games:
            game["result"] = "1/2-1/2"
        summary = summarize(games, 1)
        self.assertTrue(summary["complete"])
        for row in summary["engines"].values():
            self.assertEqual(row["score"], 0.5)
            self.assertEqual(row["winRate"], 0)
            self.assertEqual(row["draws"], 4)
            self.assertIsNone(row["score95"])

    def test_duplicate_games_are_rejected(self):
        games = self.games(0)
        with self.assertRaises(ValueError):
            summarize(games + [games[0]], 1)

    def test_bootstrap_is_reproducible_and_does_not_treat_colors_as_independent(self):
        values = [0.25, 0.5, 0.5, 0.75]
        self.assertEqual(bootstrap(values), bootstrap(values))
        low, high = bootstrap(values)
        self.assertLessEqual(low, 0.5)
        self.assertGreaterEqual(high, 0.5)
        self.assertIsNone(bootstrap([0.5]))

    def test_child_protocol_and_cancellation_cleanup(self):
        stop = threading.Event()
        with tempfile.TemporaryDirectory() as folder:
            child = Lines([sys.executable, "-u", "-c", "import sys\nfor line in sys.stdin: print(line.strip(), flush=True)"], stop, Path(folder))
            try:
                child.send("ready")
                self.assertEqual(child.until(lambda line: line == "ready"), ["ready"])
                stop.set()
                with self.assertRaises(Cancelled):
                    child.until(lambda _: False)
            finally:
                child.close()
            self.assertIsNotNone(child.process.poll())
            self.assertFalse(child.reader.is_alive())


if __name__ == "__main__":
    unittest.main()
