import copy
import unittest
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining import moon_scooping, white_faced_general
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish, EngineProtocolError
from tools.xiangqi_data.puzzle_mining.models import (
    SearchContext,
    PositionStatus,
    fen_side,
)
from tools.xiangqi_data.puzzle_mining.patterns import TerminalPosition
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

# The Chinese annotated line's rear-entry phase, followed through checkmate.
# https://www.xiangqiqipu.com/Article/View-15039.html
BASE = {"e1": "K", "e10": "R", "a10": "C", "d9": "k", "d3": "r"}
MOVES = ("a10d10", "d3g3", "e10e5", "g3g8", "e5d5", "g8d8", "d10d8", "d9d10", "d8h8")


def trace(pieces=None, moves=MOVES, mirror=False):
    return trace_for(BASE if pieces is None else pieces, moves, mirror)


def terminal(t):
    return TerminalPosition(t.terminal.fen, t.checkmate, fen_side(t.terminal.fen))


class MoonScoopingTest(unittest.TestCase):
    def engine(self, legal=True, checkers=("d5",), general_support=True):
        engine = Mock()
        engine.checking_pieces.side_effect = lambda context: (
            context.initial_fen,
            (
                (("e1",) if general_support else ("e1", "d5"))
                if context.initial_fen.startswith("4k4/")
                else checkers
            ),
        )
        engine.inspect.side_effect = lambda context: PositionStatus(
            context.initial_fen, False, ("d10d3",) if legal else ()
        )
        return engine

    def test_geometry_both_colors_and_extra_material(self):
        for mirror in (False, True):
            for pieces in (BASE, {**BASE, "b3": "N", "i7": "p"}):
                t = trace(pieces, mirror=mirror)
                self.assertTrue(moon_scooping.candidate(t))
                found = moon_scooping.witnesses(t)
                self.assertEqual(len(found), 1)
                self.assertEqual(found[0]["capture"], "d1d8" if mirror else "d10d3")

    def test_geometry_excludes_unrelated_or_missing_maneuvers(self):
        self.assertFalse(moon_scooping.candidate(trace({**BASE, "d5": "p"})))
        self.assertFalse(moon_scooping.candidate(trace({**BASE, "d3": "n"})))
        self.assertFalse(moon_scooping.candidate(trace({**BASE, "a10": "R"})))
        self.assertFalse(moon_scooping.candidate(replace(trace(), verified=False)))
        self.assertFalse(
            moon_scooping.candidate(
                replace(trace(), terminal=replace(trace().terminal, checked=False))
            )
        )
        # A cannon already attacking through the king merely slides behind it.
        pieces = {"e1": "K", "e10": "R", "d10": "C", "d8": "k", "d3": "r"}
        self.assertFalse(
            moon_scooping.candidate(
                trace(
                    pieces, ("d10d9", "d3g3", "e10e5", "g3g8", "e5d5", "g8d7", "d5d7")
                )
            )
        )
        # A different cannon enters the rear only after the original was taken.
        # The defending rook never left its file in response to that threat.
        self.assertFalse(
            moon_scooping.candidate(
                trace(moves=("a10d10", "d9d10", "e10e5", "d3g3", "e5d5"))
            )
        )
        # The finishing chariot is a different piece from the one that entered.
        pieces = {**BASE, "d1": "R"}
        t = trace(pieces, ("a10d10", "d3g3", "e10e5", "g3g8", "d1d5"))
        self.assertFalse(moon_scooping.candidate(t))

    def test_legal_capture_and_checking_chariot_evidence(self):
        t = trace()
        engine = self.engine()
        record = moon_scooping.assess(engine, t)
        self.assertEqual(record["outcome"], "key")
        self.assertEqual(moon_scooping.evidence_outcome(t, record), "key")
        engine.analyse.assert_not_called()
        self.assertEqual(engine.inspect.call_count, 1)
        self.assertEqual(
            moon_scooping.assess(self.engine(legal=False), t)["outcome"], "not_key"
        )
        self.assertEqual(
            moon_scooping.assess(self.engine(checkers=("d10",)), t)["outcome"],
            "not_key",
        )
        for field, value in (
            ("logic_version", "old"),
            ("terminal_fen", "wrong"),
            ("witnesses", []),
            ("threats", {}),
        ):
            self.assertIsNone(
                moon_scooping.evidence_outcome(t, {**record, field: value})
            )
        broken = copy.deepcopy(record)
        next(iter(broken["threats"].values()))["fen"] = t.terminal.fen
        self.assertIsNone(moon_scooping.evidence_outcome(t, broken))
        engine = self.engine()
        engine.inspect.side_effect = EngineProtocolError("failed")
        self.assertEqual(moon_scooping.assess(engine, t)["outcome"], "inconclusive")

    def test_incomplete_and_incoherent_ledgers(self):
        t = trace()
        for broken in (
            replace(t, decisions=()),
            replace(
                t,
                decisions=(replace(t.decisions[0], position_fen=""), *t.decisions[1:]),
            ),
            replace(
                t,
                decisions=(
                    *t.decisions[:-1],
                    replace(t.decisions[-1], selected_move="d5d7"),
                ),
            ),
        ):
            self.assertIsNone(moon_scooping.candidate(broken))
            self.assertEqual(
                moon_scooping.assess(self.engine(), broken)["outcome"], "inconclusive"
            )

    def test_persistence_consensus_and_required_white_faced_finish(self):
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
        fixture.setUp(themes=(moon_scooping.THEME, "whiteFacedGeneral"))
        self.addCleanup(fixture.tearDown)
        t = trace()
        fixture.verify(
            result=fixture.result(
                branches=(VerifiedBranch(t.moves, t.terminal, decisions=t.decisions),)
            )
        )
        engine = self.engine()
        result = reclassify_canonical(fixture.connection, fixture.key, engine=engine)
        self.assertIn(moon_scooping.THEME, result.themes)
        self.assertIn("whiteFacedGeneral", result.themes)
        self.assertEqual(engine.inspect.call_count, 1)
        self.assertEqual(engine.checking_pieces.call_count, 2)
        self.assertEqual(
            reclassify_canonical(fixture.connection, fixture.key, force=True).themes,
            result.themes,
        )
        with fixture.connection:
            fixture.connection.execute(
                "DELETE FROM category_assessments WHERE category=?",
                (moon_scooping.THEME,),
            )
            fixture.connection.execute(
                "UPDATE taxonomy_assessments SET taxonomy_version=json_remove("
                "taxonomy_version, '$.versions.moonScoopingMate')"
            )
        self.assertEqual(
            reclassify_canonical(fixture.connection, fixture.key).themes, result.themes
        )
        current = {
            "candidate_id": fixture.current()["id"],
            "current_verification_id": fixture.current()["current_verification_id"],
        }
        outcome, _ = _evaluate_category(
            fixture.connection,
            current,
            (t, trace({**BASE, "d3": "n"})),
            TacticalClassifier(),
            moon_scooping.THEME,
            None,
            None,
        )
        self.assertEqual(outcome, "conflict")
        with fixture.connection:
            fixture.connection.execute(
                "DELETE FROM motif_removal_evidence WHERE theme='whiteFacedGeneral'"
            )
        outcome, _ = _evaluate_category(
            fixture.connection,
            current,
            (t,),
            TacticalClassifier(),
            moon_scooping.THEME,
            self.engine(general_support=False),
            None,
        )
        self.assertEqual(outcome, "no_match")

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_engine_full_and_partial_maneuvers(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        full = {"e1": "K", "e9": "R", "a10": "C", "d10": "k", "d3": "r"}
        cases = (
            (BASE, MOVES),
            ({**BASE, "b3": "N", "i7": "p"}, MOVES),
            (full, ("e9e10", "d10d9", *MOVES)),
            # Capturing the cannon does not save the general after displacement.
            (BASE, ("a10d10", "d3g3", "e10e5", "d9d10", "e5d5")),
            # The defender may stay on its file and be captured by the cannon.
            (BASE, ("a10d10", "d3d4", "e10e5", "d4d3", "d10d3", "d9d10", "e5d5")),
        )
        for pieces, moves in cases:
            for mirror in (False, True):
                with self.subTest(moves=moves, mirror=mirror):
                    t = trace(pieces, moves, mirror)
                    for decision in t.decisions:
                        self.assertIn(
                            decision.selected_move,
                            engine.inspect(decision.context).legal_moves,
                        )
                    self.assertTrue(
                        engine.inspect(SearchContext(t.terminal.fen, ())).checkmate
                    )
                    self.assertEqual(moon_scooping.assess(engine, t)["outcome"], "key")
                    self.assertEqual(
                        white_faced_general.assess(engine, terminal(t))["outcome"],
                        "key",
                    )
