"""One cannon chariot discovery rule serves the mating and tactic taxonomies."""

import unittest
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining import cannon_chariot_discovered as detector
from tools.xiangqi_data.puzzle_mining.classification import TacticalClassifier
from tools.xiangqi_data.puzzle_mining.classification_job import (
    _evaluate_category,
    _save_category,
    taxonomy_versions,
)
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
from tools.xiangqi_data.puzzle_mining.models import SearchContext
from tools.xiangqi_data.puzzle_mining.position import normalized_fen
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

# Red cannon e1 is masked by the red chariot e5 and the black advisor e8. The
# chariot steps off the file, leaving the advisor as the single screen.
BASE = {"d1": "K", "e1": "C", "e5": "R", "e8": "a", "e9": "k"}
MOVES = ("e5a5", "e8d9", "a5a9")
LATER = {**BASE, "a1": "R", "a7": "p"}
LATER_MOVES = ("a1a2", "a7a6", *MOVES)


class CannonChariotDiscoveredTest(unittest.TestCase):
    def test_both_colors_and_any_ply_without_engine_work(self):
        for pieces, moves, ply in ((BASE, MOVES, 0), (LATER, LATER_MOVES, 2)):
            for mirror in (False, True):
                with self.subTest(ply=ply, mirror=mirror):
                    trace = trace_for(pieces, moves, mirror)
                    engine = Mock()
                    record = detector.assess(engine, trace)
                    self.assertTrue(detector.candidate(trace))
                    self.assertEqual(record["outcome"], "key")
                    self.assertEqual(detector.evidence_outcome(trace, record), "key")
                    engine.checking_pieces.assert_not_called()
                    [found] = detector.uncovered_plies(trace)
                    self.assertEqual(found["ply"], ply)
                    self.assertEqual(found["move"], trace.moves[ply])
                    self.assertTrue(
                        detector.between(
                            found["vacated"], found["cannon"], found["general"]
                        )
                    )
                    self.assertFalse(
                        detector.between(
                            found["arrived"], found["cannon"], found["general"]
                        )
                    )

    def test_only_a_chariot_leaving_the_cannon_line_qualifies(self):
        trace = trace_for(BASE, MOVES)
        # The chariot may not be the gun; an unmasking pawn is another motif.
        self.assertFalse(detector.candidate(trace_for({**BASE, "e5": "P"}, MOVES)))
        # A second screen keeps the cannon blind to the general.
        self.assertFalse(detector.candidate(trace_for({**BASE, "e6": "p"}, MOVES)))
        # Moving onto the line to become the screen is the inverse of a discovery.
        self.assertFalse(
            detector.candidate(
                trace_for(
                    {"d1": "K", "e1": "C", "e9": "k", "a5": "R"},
                    ("a5e5", "e9e10", "e5e9"),
                )
            )
        )
        # Capturing the extra screen keeps the chariot on the cannon's line.
        self.assertFalse(
            detector.candidate(
                trace_for(
                    {"d1": "K", "e1": "C", "e5": "R", "e7": "p", "e9": "k"},
                    ("e5e7", "e9e10", "e7e9"),
                )
            )
        )
        # The losing side's own chariot uncovers nothing for the winner.
        defender = {
            "d1": "K",
            "d9": "c",
            "d10": "k",
            "d5": "r",
            "d3": "p",
            "a1": "R",
        }
        self.assertFalse(
            detector.candidate(trace_for(defender, ("a1a2", "d5a5", "a2a3")))
        )
        self.assertEqual(detector.assess(None, trace)["outcome"], "key")

    def test_missing_or_incoherent_ledgers_fail_closed(self):
        trace = trace_for(BASE, MOVES)
        self.assertIsNone(detector.candidate(replace(trace, decisions=())))
        self.assertIsNone(
            detector.candidate(
                replace(
                    trace,
                    decisions=(
                        replace(trace.decisions[0], position_fen=""),
                        *trace.decisions[1:],
                    ),
                )
            )
        )
        self.assertFalse(detector.candidate(replace(trace, verified=False)))
        record = detector.assess(None, trace)
        self.assertIsNone(
            detector.evidence_outcome(trace, {**record, "logic_version": "0"})
        )
        self.assertIsNone(
            detector.evidence_outcome(trace, {**record, "positions": []})
        )
        self.assertIsNone(detector.evidence_outcome(trace, None))

    def test_tactical_endpoint_without_mate_is_classified(self):
        trace = trace_for(BASE, MOVES)
        tactic = replace(
            trace,
            objective="advantage",
            terminal=replace(trace.terminal, checked=False, legal_moves=("e9f9",)),
        )
        self.assertFalse(tactic.checkmate)
        self.assertTrue(detector.candidate(tactic))
        self.assertEqual(detector.assess(None, tactic)["outcome"], "key")

    def test_both_taxonomies_register_the_shared_theme(self):
        from tools.puzzle_catalog.publication import OFFICIAL_THEMES

        self.assertEqual(taxonomy_versions()[detector.THEME], detector.VERSION)
        tactic = taxonomy_versions(candidate_type="tactic_candidate")
        self.assertEqual(tactic[detector.THEME], detector.VERSION)
        self.assertNotIn("__mate__", tactic)
        self.assertIn(detector.THEME, OFFICIAL_THEMES)

    def fixture(self, trace, candidate_type="checkmate_candidate"):
        from tools.xiangqi_data.tests.test_puzzle_chariots_threatening_advisor import (
            ChariotsThreateningAdvisorTest,
        )

        helper = ChariotsThreateningAdvisorTest()
        fixture = helper.fixture(trace)
        self.addCleanup(helper.doCleanups)
        if candidate_type != "checkmate_candidate":
            with fixture.connection:
                fixture.connection.execute(
                    "UPDATE candidates SET candidate_type=?", (candidate_type,)
                )
        row = fixture.current()
        current = {
            "candidate_id": row["id"],
            "current_verification_id": row["current_verification_id"],
        }
        return fixture, current

    def test_category_execution_matches_reuses_and_conflicts(self):
        trace = trace_for(BASE, MOVES)
        for candidate_type in ("checkmate_candidate", "tactic_candidate"):
            with self.subTest(candidate_type=candidate_type):
                fixture, current = self.fixture(trace, candidate_type)
                versions = taxonomy_versions(candidate_type=candidate_type)
                args = (
                    fixture.connection,
                    current,
                    (trace,),
                    TacticalClassifier(),
                    detector.THEME,
                )
                outcome, proofs = _evaluate_category(*args, None, None)
                self.assertEqual(outcome, "match")
                self.assertTrue(
                    _save_category(
                        fixture.connection,
                        current,
                        detector.THEME,
                        versions,
                        outcome,
                        proofs,
                    )
                )
                self.assertEqual(_evaluate_category(*args, None, None)[0], "match")
                unmasking_pawn = trace_for({**BASE, "e5": "P"}, MOVES)
                self.assertEqual(
                    _evaluate_category(
                        fixture.connection,
                        current,
                        (trace, unmasking_pawn),
                        TacticalClassifier(),
                        detector.THEME,
                        None,
                        None,
                    )[0],
                    "conflict",
                )

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_engine_confirms_the_uncovered_cannon_check(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            trace = trace_for(BASE, MOVES, mirror)
            for decision in trace.decisions:
                self.assertIn(
                    decision.selected_move, engine.inspect(decision.context).legal_moves
                )
            [found] = detector.uncovered_plies(trace)
            before, checkers = engine.checking_pieces(
                SearchContext(trace.decisions[found["ply"]].position_fen, ())
            )
            self.assertEqual(
                normalized_fen(before),
                normalized_fen(trace.decisions[found["ply"]].position_fen),
            )
            self.assertEqual(checkers, ())
            after, checkers = engine.checking_pieces(
                SearchContext(trace.decisions[found["ply"] + 1].position_fen, ())
            )
            self.assertEqual(
                normalized_fen(after),
                normalized_fen(trace.decisions[found["ply"] + 1].position_fen),
            )
            self.assertEqual(checkers, (found["cannon"],))


if __name__ == "__main__":
    unittest.main()
