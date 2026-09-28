import unittest
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.puzzle_mining import bold_chariot as motif
from tools.xiangqi_data.puzzle_mining.position import decode_position
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for


class BoldChariotTest(unittest.TestCase):
    def test_both_victims_colors_and_any_recapturing_piece(self):
        base = decode_position(trace_for().decisions[0].position_fen)
        for mirror in (False, True):
            for victim in ("a", "b"):
                for recapturer in ("a", "b", "n", "c", "r", "p", "k"):
                    t = trace_for(
                        {**base, "e9": victim, "d10": recapturer}, mirror=mirror
                    )
                    engine = Mock()
                    self.assertEqual(motif.assess(engine, t)["outcome"], "key")
                    self.assertEqual(engine.mock_calls, [])

    def test_sequence_anywhere_but_not_final_move(self):
        base = decode_position(trace_for().decisions[0].position_fen)
        t = trace_for(
            {**base, "a4": "P", "a7": "p"}, ("a4a5", "a7a6", "e7e9", "d10e9", "h9f9")
        )
        self.assertTrue(motif.candidate(t))
        self.assertFalse(motif.candidate(trace_for(base, ("e7e9",))))
        for bad in (
            replace(t, terminal=replace(t.terminal, checked=False)),
            replace(t, verified=False),
        ):
            self.assertFalse(motif.candidate(bad))
        for victim in ("p", "n", "c", "r", "A"):
            self.assertFalse(motif.candidate(trace_for({**base, "e9": victim})))

    def test_immediate_reply_must_capture_that_exact_chariot(self):
        base = decode_position(trace_for().decisions[0].position_fen)
        t = trace_for({**base, "a7": "p"}, ("e7e9", "a7a6", "h9h8", "d10e9", "h8f8"))
        self.assertFalse(motif.candidate(t))
        t = trace_for({**base, "h10": "r"}, ("e7e9", "h10h9", "e9f9"))
        self.assertFalse(motif.candidate(t))
        # The sacrificed attacker must itself be a chariot.
        self.assertFalse(motif.candidate(trace_for({**base, "e7": "C"})))

    def test_full_ledger_and_versioned_evidence(self):
        t = trace_for()
        record = motif.assess(None, t)
        for field in ("logic_version", "terminal_fen", "positions", "moves"):
            self.assertIsNone(motif.evidence_outcome(t, {**record, field: "stale"}))
        for bad in (
            replace(t, decisions=()),
            replace(
                t,
                decisions=(
                    *t.decisions[:-1],
                    replace(t.decisions[-1], position_fen=t.decisions[0].position_fen),
                ),
            ),
            replace(t, moves=(*t.moves[:-1], "bad")),
        ):
            self.assertEqual(motif.assess(None, bad)["outcome"], "inconclusive")

    def test_real_mating_line_both_colors(self):
        from tools.xiangqi_data.pikafish_rules import default_executable
        from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
        from tools.xiangqi_data.puzzle_mining.models import SearchContext

        if not default_executable().is_file():
            self.skipTest("local Pikafish required")
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            t = trace_for(mirror=mirror)
            for move, decision in zip(t.moves, t.decisions):
                self.assertIn(move, engine.inspect(decision.context).legal_moves)
            self.assertTrue(engine.inspect(SearchContext(t.terminal.fen, ())).checkmate)
            self.assertEqual(motif.assess(None, t)["outcome"], "key")

    def test_saved_proof_reuse_and_branch_consensus(self):
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            _evaluate_category,
            _save_category,
            taxonomy_versions,
        )
        from tools.xiangqi_data.puzzle_mining.classification import TacticalClassifier
        from tools.xiangqi_data.puzzle_mining.solver import VerifiedBranch
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )

        f = PuzzleStorageLifecycleTest()
        f.setUp(themes=None)
        self.addCleanup(f.tearDown)
        t = trace_for()
        f.verify(
            result=f.result(
                branches=(VerifiedBranch(t.moves, t.terminal, decisions=t.decisions),)
            )
        )
        row = f.current()
        current = {
            "candidate_id": row["id"],
            "current_verification_id": row["current_verification_id"],
        }
        self.assertIn(motif.THEME, taxonomy_versions())
        self.assertNotIn(
            motif.THEME, taxonomy_versions(candidate_type="tactic_candidate")
        )
        result, proofs = _evaluate_category(
            f.connection, current, (t,), TacticalClassifier(), motif.THEME, None, None
        )
        self.assertEqual(result, "match")
        self.assertTrue(
            _save_category(
                f.connection, current, motif.THEME, taxonomy_versions(), result, proofs
            )
        )
        reused, _ = _evaluate_category(
            f.connection, current, (t,), TacticalClassifier(), motif.THEME, None, None
        )
        self.assertEqual(reused, "match")
        bad = replace(t, terminal=replace(t.terminal, checked=False))
        conflict, _ = _evaluate_category(
            f.connection,
            current,
            (t, bad),
            TacticalClassifier(),
            motif.THEME,
            None,
            None,
        )
        self.assertEqual(conflict, "conflict")
