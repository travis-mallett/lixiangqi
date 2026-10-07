from dataclasses import asdict
from pathlib import Path
import random
import tempfile
import unittest
from unittest.mock import Mock, patch

from bot_level_calibrator.engine import PikafishEngine
from bot_level_calibrator.scheduler import (
    _profile_from_state,
    seed_strength_profiles,
    select_profile,
)
from bot_level_calibrator.storage import CalibrationStore
from bot_level_calibrator.strength import initial_profile_for_level, profile_for_strength
from external.pikafish_worker.ai import STRENGTH_PROFILES
from external.pikafish_worker.selection import Candidate, sample_candidate


class LevelOneTests(unittest.TestCase):
    def test_engine_uses_production_distribution_and_loss_filter(self):
        profile = initial_profile_for_level(1)
        candidates = {1: Candidate("a0a1", "cp", 100),
                      2: Candidate("b0c2", "cp", 50),
                      3: Candidate("c0e2", "cp", -1000)}
        for seed in range(20):
            engine = self.engine()
            engine._legal_moves_current_position.return_value = [c.move for c in candidates.values()]
            engine._read_line.side_effect = [
                f"info depth 1 multipv {rank} score cp {c.score} pv {c.move}"
                for rank, c in candidates.items()
            ] + ["bestmove a0a1"]
            actual = engine.choose_move(["a0a1"] * 20, profile, random.Random(seed))
            expected = sample_candidate(candidates, multi_pv=16, expected_rank=9.5,
                                        max_candidate_loss=600, rng=random.Random(seed))
            self.assertEqual(actual, expected)
            self.assertNotEqual(actual, "c0e2")

    def engine(self):
        engine = PikafishEngine(Path("unused.exe"))
        engine._ensure_started = Mock()
        engine._send = Mock()
        engine._read_until = Mock()
        engine._read_line = Mock(return_value="bestmove a0a1")
        engine._legal_moves_current_position = Mock(return_value=["a0a1", "b0c2"])
        engine.book_position = Mock(return_value=("position", ("a1a2", "b1c3")))
        return engine

    def test_seed_matches_live_level_one_and_survives_restart(self):
        seed = initial_profile_for_level(1)
        live = STRENGTH_PROFILES[0]
        self.assertEqual((seed.nodes, seed.multi_pv, seed.expected_rank),
                         (live.nodes, live.multi_pv, live.expected_rank))
        self.assertEqual(seed.max_candidate_loss, live.max_candidate_loss)
        self.assertTrue(seed.opening_book)
        for strength in (0.1, 0.5, 0.7):
            profile = profile_for_strength(strength, opening_book=True)
            self.assertEqual(_profile_from_state({"profile": asdict(profile)}), profile)

    def test_scheduler_retains_book_after_adjustment_and_storage(self):
        with tempfile.TemporaryDirectory() as directory:
            store = CalibrationStore(Path(directory) / "calibration.sqlite3")
            try:
                self.assertIn(1, seed_strength_profiles(store))
                seed = select_profile(store, 1).profile
                self.assertEqual(seed.nodes, 149)
                for index in range(3):
                    store.record(1, index, "red" if index % 2 == 0 else "black",
                                 seed, "loss", 40, "finished")
                self.assertEqual(store.results(1)[0].profile, seed)
                adjusted = select_profile(store, 1).profile
                self.assertTrue(adjusted.opening_book)
                self.assertLess(adjusted.expected_rank, seed.expected_rank)
                self.assertEqual(select_profile(store, 1).profile, adjusted)
            finally:
                store.close()

    @patch("external.pikafish_worker.opening.master_book_moves", return_value=[("b1c3", 10)])
    def test_first_turn_uses_book(self, lookup):
        engine = self.engine()
        self.assertEqual(engine.choose_move([], initial_profile_for_level(1), random.Random(1)), "b0c2")
        lookup.assert_called_once_with("position")
        self.assertFalse(any(c.args[0].startswith("go nodes") for c in engine._send.call_args_list))

    @patch("external.pikafish_worker.opening.master_book_moves", return_value=[])
    def test_missing_book_searches_five_million_nodes(self, lookup):
        engine = self.engine()
        engine.choose_move([], initial_profile_for_level(1), random.Random(1))
        engine._send.assert_any_call("go nodes 5000000")
        engine._send.assert_any_call("setoption name MultiPV value 1")

    @patch("external.pikafish_worker.opening.master_book_moves", return_value=[("b1c3", 10)])
    def test_tenth_turn_can_fade_to_seed_engine(self, lookup):
        engine = self.engine()
        engine.choose_move(["a0a1"] * 18, initial_profile_for_level(1), random.Random(1))
        lookup.assert_called_once()
        engine._send.assert_any_call("go nodes 149")

    @patch("external.pikafish_worker.opening.master_book_moves")
    def test_eleventh_turn_skips_book(self, lookup):
        engine = self.engine()
        engine.choose_move(["a0a1"] * 20, initial_profile_for_level(1), random.Random(1))
        lookup.assert_not_called()
        engine.book_position.assert_not_called()
        engine._send.assert_any_call("go nodes 149")

    @patch("external.pikafish_worker.opening.master_book_moves")
    def test_existing_levels_do_not_consult_book(self, lookup):
        engine = self.engine()
        engine.choose_move([], initial_profile_for_level(9))
        lookup.assert_not_called()
        engine._send.assert_any_call("go nodes 7849")
