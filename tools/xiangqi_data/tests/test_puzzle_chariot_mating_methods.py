import json
from pathlib import Path
import unittest
from unittest.mock import Mock

from tools.xiangqi_data.puzzle_mining.chariot_mating_methods import (
    THEME,
    VERSION,
    assess,
    candidate,
    evidence_outcome,
)
from tools.xiangqi_data.puzzle_mining.piece_type_mating_methods import (
    ASSESSORS,
    BY_THEME,
)
from tools.xiangqi_data.puzzle_mining.position import decode_position
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for


class ChariotMatingMethodsTest(unittest.TestCase):
    def engine(self, trace, checkers=((), (), (), ("f9",))):
        engine = Mock()
        calls = 0

        def checking_pieces(context):
            nonlocal calls
            expected = checkers[calls]
            calls += 1
            return context.initial_fen, expected

        engine.checking_pieces.side_effect = checking_pieces
        return engine

    def test_every_losing_side_check_must_be_from_winning_chariots(self):
        trace = trace_for()
        self.assertIs(candidate(trace), True)
        engine = self.engine(trace)
        record = assess(engine, trace)
        self.assertEqual(record["outcome"], "key")
        self.assertEqual(evidence_outcome(trace, record), "key")
        self.assertEqual(engine.checking_pieces.call_count, 4)

        for checkers in (("f9", "c9"), ("f9", "e1"), ()):
            with self.subTest(checkers=checkers):
                self.assertEqual(
                    assess(self.engine(trace, ((), (), (), checkers)), trace)[
                        "outcome"
                    ],
                    "not_key",
                )

    def test_a_non_chariot_intermediate_check_is_rejected(self):
        trace = trace_for()
        engine = self.engine(trace, ((), ("c9",), (), ("f9",)))
        self.assertEqual(assess(engine, trace)["outcome"], "not_key")

    def test_non_chariot_winning_move_is_allowed_when_winning_side_is_checked(self):
        base = trace_for()
        pieces = decode_position(base.decisions[0].position_fen)
        pieces["e7"] = "N"
        trace = trace_for(pieces)
        engine = self.engine(trace, (("e9",), (), (), ("f9",)))
        self.assertEqual(assess(engine, trace)["outcome"], "key")

    def test_version_is_registered_for_studio_audits(self):
        from tools.xiangqi_data.puzzle_mining.patterns import THEME_LOGIC_VERSIONS

        self.assertEqual(THEME_LOGIC_VERSIONS[THEME], VERSION)


class PieceTypeMatingMethodsTest(unittest.TestCase):
    def engine(self, checkers):
        engine = Mock()
        calls = 0

        def checking_pieces(context):
            nonlocal calls
            expected = checkers[calls]
            calls += 1
            return context.initial_fen, expected

        engine.checking_pieces.side_effect = checking_pieces
        return engine

    def trace_for_piece(self, piece):
        base = trace_for()
        pieces = decode_position(base.decisions[0].position_fen)
        pieces["e7"] = piece
        pieces["h9"] = piece
        return trace_for(pieces)

    def trace_for_types(self, types, mirror=False):
        pieces = {"e1": "K", "f10": "k"}
        moves = []
        for index, piece in enumerate(sorted(types)):
            file = "abcd"[index]
            pieces[file + "4"] = piece
            if moves:
                moves.append("f10e10" if index % 2 else "e10f10")
            moves.append(file + "4" + file + "5")
        trace = trace_for(pieces, tuple(moves), mirror=mirror)
        last = "abcd"[len(types) - 1] + ("6" if mirror else "5")
        return trace, ((),) * len(moves) + ((last,),)

    def test_every_named_type_must_move_in_each_branch_for_both_colors(self):
        self.assertEqual(len(ASSESSORS), 15)
        for assessor in ASSESSORS:
            for mirror in (False, True):
                with self.subTest(theme=assessor.theme, mirror=mirror):
                    trace, checkers = self.trace_for_types(
                        assessor.allowed_types, mirror
                    )
                    self.assertEqual(
                        assessor.assess(self.engine(checkers), trace)["outcome"], "key"
                    )
                    if len(assessor.allowed_types) > 1:
                        for absent in assessor.allowed_types:
                            trace, checkers = self.trace_for_types(
                                assessor.allowed_types - {absent}, mirror
                            )
                            self.assertEqual(
                                assessor.assess(self.engine(checkers), trace)[
                                    "outcome"
                                ],
                                "not_key",
                            )

    def test_chariot_only_does_not_match_any_combined_category(self):
        trace = trace_for()
        for assessor in ASSESSORS:
            with self.subTest(theme=assessor.theme):
                result = assessor.assess(self.engine(((), (), (), ("f9",))), trace)
                self.assertEqual(
                    result["outcome"],
                    "key" if assessor.theme == "chariotMatingMethods" else "not_key",
                )

    def test_stationary_checker_does_not_supply_a_missing_move_type(self):
        trace = trace_for()
        assessor = BY_THEME["chariotHorseMatingMethods"]
        self.assertEqual(
            assessor.assess(self.engine(((), (), (), ("f9", "c9"))), trace)["outcome"],
            "not_key",
        )

    def test_evasion_does_not_supply_a_missing_move_type(self):
        pieces = decode_position(trace_for().decisions[0].position_fen)
        pieces["e7"] = "N"
        trace = trace_for(pieces)
        assessor = BY_THEME["chariotHorseMatingMethods"]
        self.assertEqual(
            assessor.assess(self.engine((("e9",), (), (), ("f9",))), trace)["outcome"],
            "not_key",
        )

    def test_multiple_checkers_must_all_belong_to_the_category(self):
        for assessor in ASSESSORS:
            trace, checkers = self.trace_for_types(assessor.allowed_types)
            for extra, expected in (("a5", "key"), ("e1", "not_key")):
                with self.subTest(theme=assessor.theme, extra=extra):
                    terminal = tuple(sorted(set(checkers[-1] + (extra,))))
                    self.assertEqual(
                        assessor.assess(
                            self.engine(checkers[:-1] + (terminal,)), trace
                        )["outcome"],
                        expected,
                    )

    def test_old_subset_evidence_is_stale(self):
        assessor = BY_THEME["chariotHorseMatingMethods"]
        trace = trace_for()
        record = assessor.assess(self.engine(((), (), (), ("f9",))), trace)
        record.update(logic_version="1.0", outcome="key")
        self.assertIsNone(assessor.evidence_outcome(trace, record))

    def test_combination_must_qualify_on_every_solution_branch(self):
        from tools.xiangqi_data.puzzle_mining.classification import TacticalClassifier
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            _evaluate_category,
        )

        combined, first_checks = self.trace_for_types({"R", "N"})
        chariot_only, second_checks = self.trace_for_types({"R"})
        connection = Mock()
        connection.execute.return_value.fetchone.return_value = None
        outcome, _ = _evaluate_category(
            connection,
            {"candidate_id": 1, "current_verification_id": 1},
            (combined, chariot_only),
            TacticalClassifier(),
            "chariotHorseMatingMethods",
            self.engine(first_checks + second_checks),
            None,
        )
        self.assertEqual(outcome, "conflict")

    def test_xrG6c_all_three_retained_solutions(self):
        from tools.xiangqi_data.puzzle_mining.models import (
            PositionStatus,
            SearchContext,
            SearchResult,
            VerifiedDecision,
            VerifiedTrace,
            fen_side,
        )
        from tools.xiangqi_data.puzzle_mining.position import FenState

        branches = json.loads(
            (
                Path(__file__).parent / "fixtures/piece_type_mating_xrG6c.json"
            ).read_text()
        )
        self.assertEqual(len(branches), 3)
        for branch in branches:
            state = FenState(branch["initialFen"])
            decisions = []
            for move in branch["moves"]:
                fen = state.fen()
                decisions.append(
                    VerifiedDecision(
                        SearchContext(fen, ()),
                        fen_side(fen),
                        (move,),
                        move,
                        SearchResult("test", "test", move, ()),
                        position_fen=fen,
                    )
                )
                state.push(move)
            trace = VerifiedTrace(
                tuple(branch["moves"]),
                PositionStatus(state.fen(), True, ()),
                tuple(decisions),
                verified=True,
            )
            matched = [
                assessor.theme
                for assessor in ASSESSORS
                if assessor.assess(self.engine(branch["checkers"]), trace)["outcome"]
                == "key"
            ]
            self.assertEqual(matched, ["chariotMatingMethods"])

    def test_non_category_move_is_allowed_when_winning_side_is_checked(self):
        trace = self.trace_for_piece("N")
        pieces = decode_position(trace.decisions[0].position_fen)
        pieces["e7"] = "C"
        trace = trace_for(pieces)
        assessor = BY_THEME["horseMatingMethods"]
        self.assertEqual(
            assessor.assess(self.engine((("e9",), (), (), ("f9",))), trace)["outcome"],
            "key",
        )

    def test_non_category_move_is_rejected_when_winning_side_is_not_checked(self):
        trace = self.trace_for_piece("N")
        pieces = decode_position(trace.decisions[0].position_fen)
        pieces["e7"] = "C"
        trace = trace_for(pieces)
        assessor = BY_THEME["horseMatingMethods"]
        self.assertEqual(
            assessor.assess(self.engine(((), (), (), ("f9",))), trace)["outcome"],
            "not_key",
        )
