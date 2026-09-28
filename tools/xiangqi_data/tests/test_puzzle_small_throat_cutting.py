import unittest
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish, EngineProtocolError
from tools.xiangqi_data.puzzle_mining.models import SearchContext
from tools.xiangqi_data.puzzle_mining.patterns import THEME_LOGIC_VERSIONS
from tools.xiangqi_data.puzzle_mining.position import decode_position
from tools.xiangqi_data.puzzle_mining.throat_cutting import SMALL_MATE, CHARIOT_MATE
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for


def small_trace(finisher="R", mirror=False, double=False):
    pieces = decode_position(trace_for().decisions[0].position_fen)
    del pieces["e7"]
    del pieces["h9"]
    pieces["e8"] = "P"
    pieces["g9"] = finisher
    if double:
        pieces["g8"] = "N"
        del pieces["h8"]
        pieces["f8"] = "P"
    return trace_for(pieces, ("e8e9", "d10e9", "g9f9"), mirror)


class SmallThroatCuttingTest(unittest.TestCase):
    def engine(self, checkers=("f9",)):
        engine = Mock()
        engine.checking_pieces.side_effect = lambda context: (
            context.initial_fen,
            checkers,
        )
        return engine

    def test_both_finishers_and_colors(self):
        self.assertEqual(THEME_LOGIC_VERSIONS[SMALL_MATE.theme], "1.0")
        for finisher in ("R", "P"):
            for mirror in (False, True):
                with self.subTest(finisher=finisher, mirror=mirror):
                    trace = small_trace(finisher, mirror)
                    engine = self.engine(("f2",) if mirror else ("f9",))
                    self.assertTrue(SMALL_MATE.candidate(trace))
                    self.assertFalse(CHARIOT_MATE.candidate(trace))
                    record = SMALL_MATE.assess(engine, trace)
                    self.assertEqual(record["outcome"], "key")
                    self.assertEqual(SMALL_MATE.evidence_outcome(trace, record), "key")
                    self.assertEqual(engine.checking_pieces.call_count, 1)
                    engine.analyse.assert_not_called()

    def test_only_requested_piece_changes(self):
        self.assertFalse(SMALL_MATE.candidate(trace_for()))
        self.assertFalse(SMALL_MATE.candidate(small_trace("C")))
        trace = small_trace()
        pieces = decode_position(trace.decisions[0].position_fen)
        for square, piece in (("e9", "p"), ("d10", "r"), ("e8", "R")):
            self.assertFalse(
                SMALL_MATE.candidate(trace_for({**pieces, square: piece}, trace.moves))
            )
        self.assertFalse(SMALL_MATE.candidate(replace(trace, moves=("g9f9",))))
        self.assertFalse(SMALL_MATE.candidate(replace(trace, verified=False)))
        self.assertFalse(
            SMALL_MATE.candidate(
                replace(trace, terminal=replace(trace.terminal, checked=False))
            )
        )
        self.assertFalse(
            SMALL_MATE.candidate(trace_for(pieces, ("e8d9", "d10d9", "g9f9")))
        )
        for checkers in ((), ("e1",), ("f9", "e1")):
            self.assertEqual(
                SMALL_MATE.assess(self.engine(checkers), trace)["outcome"], "not_key"
            )

    def test_incomplete_and_stale_evidence(self):
        trace = small_trace("P")
        missing = replace(trace, decisions=())
        self.assertIsNone(SMALL_MATE.candidate(missing))
        self.assertEqual(
            SMALL_MATE.assess(self.engine(), missing)["outcome"], "inconclusive"
        )
        broken = replace(
            trace,
            decisions=(
                replace(trace.decisions[0], selected_move="e8e7"),
                *trace.decisions[1:],
            ),
        )
        self.assertIsNone(SMALL_MATE.candidate(broken))
        record = SMALL_MATE.assess(self.engine(), trace)
        for field, value in (
            ("logic_version", "old"),
            ("terminal_fen", "wrong"),
            ("moves", []),
            ("terminal", {}),
        ):
            self.assertIsNone(
                SMALL_MATE.evidence_outcome(trace, {**record, field: value})
            )
        engine = self.engine()
        engine.checking_pieces.side_effect = EngineProtocolError("failed")
        self.assertEqual(SMALL_MATE.assess(engine, trace)["outcome"], "inconclusive")

    def test_existing_inventory_reassessment_persistence_and_consensus(self):
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )
        from tools.xiangqi_data.puzzle_mining.solver import VerifiedBranch
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            reclassify_canonical,
            _evaluate_category,
        )
        from tools.xiangqi_data.puzzle_mining.classification import TacticalClassifier

        fixture = PuzzleStorageLifecycleTest()
        fixture.setUp(themes=(SMALL_MATE.theme, CHARIOT_MATE.theme))
        self.addCleanup(fixture.tearDown)
        trace = small_trace()
        branch = VerifiedBranch(trace.moves, trace.terminal, decisions=trace.decisions)
        fixture.verify(result=fixture.result(branches=(branch,)))
        result = reclassify_canonical(
            fixture.connection, fixture.key, engine=self.engine()
        )
        self.assertIn(SMALL_MATE.theme, result.themes)
        self.assertNotIn(CHARIOT_MATE.theme, result.themes)
        with fixture.connection:
            fixture.connection.execute(
                "DELETE FROM category_assessments WHERE category=?", (SMALL_MATE.theme,)
            )
            fixture.connection.execute(
                "UPDATE taxonomy_assessments SET taxonomy_version=json_remove(taxonomy_version, '$.versions.smallThroatCuttingMate')"
            )
        self.assertEqual(
            reclassify_canonical(fixture.connection, fixture.key).themes, result.themes
        )
        self.assertEqual(
            reclassify_canonical(fixture.connection, fixture.key).status,
            "already_current",
        )
        self.assertEqual(
            reclassify_canonical(fixture.connection, fixture.key, force=True).themes,
            result.themes,
        )
        current = {
            "candidate_id": fixture.current()["id"],
            "current_verification_id": fixture.current()["current_verification_id"],
        }
        outcome, _ = _evaluate_category(
            fixture.connection,
            current,
            (trace, trace_for()),
            TacticalClassifier(),
            SMALL_MATE.theme,
            None,
            None,
        )
        self.assertEqual(outcome, "conflict")

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_engine_both_colors_finishers_and_double_check_exclusion(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for finisher in ("R", "P"):
            for mirror in (False, True):
                for double in (False, True):
                    with self.subTest(finisher=finisher, mirror=mirror, double=double):
                        trace = small_trace(finisher, mirror, double)
                        for decision in trace.decisions:
                            self.assertIn(
                                decision.selected_move,
                                engine.inspect(decision.context).legal_moves,
                            )
                        self.assertTrue(
                            engine.inspect(
                                SearchContext(trace.terminal.fen, ())
                            ).checkmate
                        )
                        self.assertEqual(
                            SMALL_MATE.assess(engine, trace)["outcome"],
                            "not_key" if double else "key",
                        )
