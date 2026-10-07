from __future__ import annotations

import random
import unittest
from collections import Counter
from unittest.mock import Mock, call, patch

from external.pikafish_worker.ai import STRENGTH_PROFILES, MoveWork, PikafishMoveEngine
from external.pikafish_worker.selection import (
    Candidate,
    candidate_probabilities,
    candidate_snapshot,
    rank_probabilities,
    sample_candidate,
)


def candidates(scores=(20, 12, 5, -10)):
    return {
        rank: Candidate(f"{file}0{file}1", "cp", score)
        for rank, (file, score) in enumerate(zip("abcd", scores), 1)
    }


POLICY = {"multi_pv": 4, "expected_rank": 2.8, "max_candidate_loss": 400}


class CandidateSelectionTest(unittest.TestCase):
    def test_beginner_profile_allows_material_mistakes_but_filters_extreme_losses(self):
        profile = STRENGTH_PROFILES[0]
        values = candidates((20, -480, -580, -800))
        probabilities = candidate_probabilities(
            values,
            multi_pv=profile.multi_pv,
            expected_rank=profile.expected_rank,
            max_candidate_loss=profile.max_candidate_loss,
        )
        self.assertEqual({1, 2, 3}, set(probabilities))
        self.assertAlmostEqual(1, sum(probabilities.values()))

    def test_distribution_has_requested_mean_and_spread(self):
        probabilities = rank_probabilities(4, 2.8)
        self.assertAlmostEqual(1, sum(probabilities))
        self.assertAlmostEqual(
            2.8, sum(rank * p for rank, p in enumerate(probabilities, 1))
        )
        for p, (low, high) in zip(
            probabilities, [(0.1, 0.15), (0.2, 0.25), (0.3, 0.35), (0.3, 0.35)]
        ):
            self.assertTrue(low <= p <= high)
        rng = random.Random(120)
        sample = Counter(
            sample_candidate(candidates(), rng=rng, **POLICY) for _ in range(40000)
        )
        for rank, p in enumerate(probabilities, 1):
            self.assertAlmostEqual(
                p, sample[candidates()[rank].move] / 40000, delta=0.01
            )

    def test_generic_distribution_approaches_best_and_handles_endpoints(self):
        for count in (1, 2, 4, 8):
            for expected in (1, 1.1, 1.5, 2.8, count):
                p = rank_probabilities(count, expected)
                self.assertAlmostEqual(1, sum(p))
                self.assertAlmostEqual(
                    min(count, max(1, expected)), sum(r * w for r, w in enumerate(p, 1))
                )
        self.assertEqual((1, 0, 0, 0), rank_probabilities(4, 1))

    def test_catastrophic_loss_removed_and_survivors_condition_original_weights(self):
        base = rank_probabilities(4, 2.8)
        for scores, survivors in [
            ((20, 0, -50, -800), (1, 2, 3)),
            ((20, 0, -500, -800), (1, 2)),
            ((20, -500, -600, -800), (1,)),
        ]:
            p = candidate_probabilities(candidates(scores), **POLICY)
            self.assertEqual(set(survivors), set(p))
            self.assertAlmostEqual(1, sum(p.values()))
            for rank in survivors:
                self.assertAlmostEqual(
                    base[rank - 1] / sum(base[r - 1] for r in survivors), p[rank]
                )
            rng = random.Random(13)
            moves = {
                sample_candidate(candidates(scores), rng=rng, **POLICY)
                for _ in range(1000)
            }
            self.assertEqual(
                {candidates(scores)[rank].move for rank in survivors}, moves
            )

    def test_loss_threshold_includes_boundary_and_is_relative(self):
        self.assertEqual(
            {1, 2, 3},
            set(
                candidate_probabilities(candidates((-500, -600, -900, -901)), **POLICY)
            ),
        )

    def test_forced_losses_are_excluded_but_forced_moves_are_played(self):
        values = candidates()
        values[3] = Candidate("c0c1", "mate", -20)
        values[4] = Candidate("d0d1", "mate", 0)
        self.assertEqual({1, 2}, set(candidate_probabilities(values, **POLICY)))
        for kind, score in (("cp", -10000), ("mate", -1), ("mate", 0)):
            only = {1: Candidate("a0a1", kind, score)}
            self.assertEqual(
                "a0a1", sample_candidate(only, rng=random.Random(7), **POLICY)
            )
        losses = {1: Candidate("a0a1", "mate", -5), 2: Candidate("b0b1", "mate", -2)}
        self.assertEqual({1, 2}, set(candidate_probabilities(losses, **POLICY)))

    def test_proven_wins_are_not_compared_as_centipawns(self):
        values = candidates()
        values[1] = Candidate("a0a1", "mate", 20)
        values[2] = Candidate("b0b1", "mate", 5)
        self.assertEqual({1, 2}, set(candidate_probabilities(values, **POLICY)))

    def test_snapshot_uses_complete_depth_and_rejects_duplicate_or_illegal_moves(self):
        complete = candidates()
        partial = {1: Candidate("a0a1", "cp", 500)}
        legal = [c.move for c in complete.values()]
        self.assertEqual(
            complete, candidate_snapshot({1: complete, 2: partial}, legal, 4)
        )
        self.assertEqual(partial, candidate_snapshot({2: partial}, legal, 4))
        self.assertEqual({}, candidate_snapshot({2: {2: complete[2]}}, legal, 4))
        dirty = {**complete, 4: complete[2], 5: Candidate("i0i1", "cp", 0)}
        self.assertEqual({1, 2, 3}, set(candidate_snapshot({1: dirty}, legal, 4)))


class BeginnerEngineTest(unittest.TestCase):
    def setUp(self):
        self.engine = PikafishMoveEngine()
        self.engine._ensure_started = Mock()
        self.engine._send = Mock()
        self.engine._read_until = Mock()
        self.work = MoveWork(
            "abcd1234", 1, "fen", (), legal_moves=("a1a2", "b1b2", "c1c2", "d1d2")
        )

    def output(self, scores=(20, 12, 5, -10)):
        return [
            f"info depth 2 multipv {rank} score cp {score} nodes 300 pv {move}"
            for rank, (move, score) in enumerate(
                zip(("a0a1", "b0b1", "c0c1", "d0d1"), scores), 1
            )
        ] + ["bestmove a0a1"]

    def test_node_budget_and_multipv_and_variety_across_reproducible_games(self):
        moves = tuple(
            f"{file}{rank}{file}{rank + 1}" for rank in (0, 2) for file in "abcdefghi"
        )[:16]
        legal = tuple(self.engine._to_ui_move(move) for move in moves)
        lines = [
            f"info depth 1 multipv {rank} score cp {-rank} pv {move}"
            for rank, move in enumerate(moves, 1)
        ] + ["bestmove a0a1"]
        results = Counter()
        for number in range(4000):
            work = MoveWork(f"{number:08}", 1, "fen", (), legal_moves=legal)
            self.engine._read_line = Mock(side_effect=lines)
            results[self.engine.best_move(work, STRENGTH_PROFILES[0])] += 1
        for move, p in zip(legal, rank_probabilities(16, 9.5)):
            self.assertAlmostEqual(p, results[move] / 4000, delta=0.025)
        self.assertGreater(sum(results[move] for move in legal[4:]) / 4000, 0.8)
        self.assertAlmostEqual(
            9.5,
            sum(rank * results[move] for rank, move in enumerate(legal, 1)) / 4000,
            delta=0.2,
        )
        self.assertIn(
            call("setoption name MultiPV value 16"), self.engine._send.call_args_list
        )
        self.assertIn(
            call("go nodes 149 searchmoves " + " ".join(moves)),
            self.engine._send.call_args_list,
        )
        repeated = []
        for _ in range(2):
            self.engine._read_line = Mock(side_effect=self.output())
            repeated.append(self.engine.best_move(self.work, STRENGTH_PROFILES[0]))
        self.assertEqual(repeated[0], repeated[1])

    def test_parser_preserves_bot_relative_cp_and_mate_scores(self):
        for turn in ("w", "b"):
            work = MoveWork(
                "abcd1234", 1, f"position {turn}", (), legal_moves=self.work.legal_moves
            )
            lines = self.output((20, 0, -50, -800))
            lines[2] = "info depth 2 multipv 3 score mate -3 pv c0c1"
            self.engine._read_line = Mock(side_effect=lines)
            with patch(
                "external.pikafish_worker.ai.sample_candidate", return_value="b0b1"
            ) as sample:
                self.assertEqual(
                    "b1b2", self.engine.best_move(work, STRENGTH_PROFILES[0])
                )
                snapshot = sample.call_args.args[0]
                self.assertEqual(Candidate("c0c1", "mate", -3), snapshot[3])
                self.assertEqual(Candidate("d0d1", "cp", -800), snapshot[4])
                self.assertEqual(600, sample.call_args.kwargs["max_candidate_loss"])

    def test_incomplete_and_bound_scores_do_not_contaminate_comparison(self):
        lines = self.output()[:-1] + [
            "info depth 3 multipv 1 score cp 500 pv a0a1",
            "info depth 3 multipv 2 score cp -1000 upperbound pv b0b1",
            "bestmove a0a1",
        ]
        self.engine._read_line = Mock(side_effect=lines)
        with patch(
            "external.pikafish_worker.ai.sample_candidate", return_value="a0a1"
        ) as sample:
            self.engine.best_move(self.work, STRENGTH_PROFILES[0])
            self.assertEqual(candidates(), sample.call_args.args[0])

    def test_forced_legal_move_survives_losing_mate(self):
        work = MoveWork("abcd1234", 1, "fen", (), legal_moves=("a1a2",))
        self.engine._read_line = Mock(
            side_effect=[
                "info depth 1 multipv 1 score mate -1 pv a0a1",
                "bestmove a0a1",
            ]
        )
        self.assertEqual("a1a2", self.engine.best_move(work, STRENGTH_PROFILES[0]))
        self.assertIn(
            call("setoption name MultiPV value 1"), self.engine._send.call_args_list
        )

    def test_fade_uses_guarded_sampling_and_node_levels_use_bestmove(self):
        for level, profile in enumerate(STRENGTH_PROFILES[1:], 2):
            work = MoveWork(
                "abcd1234", level, "fen", (), legal_moves=self.work.legal_moves
            )
            self.engine._read_line = Mock(side_effect=self.output())
            with patch("external.pikafish_worker.ai.sample_candidate", return_value="a0a1") as new_sampler:
                self.engine.best_move(work, profile)
                if level < 9:
                    new_sampler.assert_called_once()
                else:
                    new_sampler.assert_not_called()
            self.assertIn(
                call(f"go nodes {profile.nodes} searchmoves a0a1 b0b1 c0c1 d0d1"),
                self.engine._send.call_args_list,
            )


if __name__ == "__main__":
    unittest.main()
