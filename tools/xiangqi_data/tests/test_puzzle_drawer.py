import unittest
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining import drawer as detector
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
from tools.xiangqi_data.puzzle_mining.models import SearchContext
from tools.xiangqi_data.puzzle_mining.position import (
    decode_position,
    UI_MOVE,
    general_escape_positions,
)
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

BASE = {"d1": "K", "e10": "k", "a8": "R", "b8": "R", "c6": "C"}
MOVES = ("a8a10", "e10e9", "a10a9", "e9e10", "a9a10", "e10e9", "a10a9")


class DrawerTest(unittest.TestCase):
    def evidence(self, trace):
        red = trace.terminal.fen.split()[1] == "b"
        record = {
            **detector.stamp(trace),
            "terminal": {
                "fen": trace.terminal.fen,
                "checkers": ["a9" if red else "a2"],
            },
            "escapes": [],
            "replies": [],
        }
        for move, fen in general_escape_positions(
            trace.terminal.fen, "black" if red else "red", empty_only=True
        ):
            record["escapes"].append(
                {"move": move, "fen": fen, "checkers": ["c6" if red else "c5"]}
            )
        for reply in detector.sequence(trace)["replies"]:
            rook = next(s for s in reply["ids"] if s[0] == "a")
            record["replies"].append(
                {"index": reply["index"], "fen": reply["fen"], "checkers": [rook]}
            )
        return record

    def test_three_checked_vertical_replies_and_exact_finishing_chariot(self):
        for mirror in (False, True):
            trace = trace_for(BASE, MOVES, mirror)
            record = self.evidence(trace)
            self.assertEqual(detector.evidence_outcome(trace, record), "key")
            for checkers, expected in (
                ([], "not_key"),
                (["b8" if not mirror else "b3"], "not_key"),
                (["c6" if not mirror else "c5"], "key"),
            ):
                changed = {
                    **record,
                    "replies": [{**r, "checkers": checkers} for r in record["replies"]],
                }
                self.assertEqual(detector.evidence_outcome(trace, changed), expected)
            mixed = {
                **record,
                "replies": [
                    record["replies"][0],
                    {
                        **record["replies"][1],
                        "checkers": ["c6" if not mirror else "c5"],
                    },
                    record["replies"][2],
                ],
            }
            self.assertEqual(detector.evidence_outcome(trace, mixed), "key")
            self.assertFalse(detector.candidate(trace_for(BASE, MOVES[:-2], mirror)))
            self.assertIsNone(detector.candidate(replace(trace, decisions=())))
            self.assertFalse(
                detector.candidate(
                    replace(trace, terminal=replace(trace.terminal, checked=False))
                )
            )
            self.assertIsNone(
                detector.evidence_outcome(trace, {**record, "logic_version": "1.0"})
            )
            self.assertIsNone(
                detector.evidence_outcome(trace, {**record, "replies": []})
            )
            self.assertEqual(
                detector.evidence_outcome(
                    trace,
                    {
                        **record,
                        "terminal": {
                            **record["terminal"],
                            "checkers": ["c6" if not mirror else "c5"],
                        },
                    },
                ),
                "not_key",
            )
            no_cannon_control = {
                **record,
                "escapes": [{**p, "checkers": []} for p in record["escapes"]],
            }
            self.assertEqual(
                detector.evidence_outcome(trace, no_cannon_control), "not_key"
            )
            shared = {
                **record,
                "escapes": [
                    {**p, "checkers": p["checkers"] + ["b8" if not mirror else "b3"]}
                    for p in record["escapes"]
                ],
            }
            self.assertEqual(detector.evidence_outcome(trace, shared), "key")
            horizontal = trace_for(
                BASE,
                ("a8a10", "e10e9", "a10a9", "e9d9", "a9a10", "d9d10", "a10a9"),
                mirror,
            )
            self.assertFalse(detector.candidate(horizontal))

    def test_consecutive_replies_must_lead_directly_to_mate(self):
        for mirror in (False, True):
            # Three vertical replies still exist, but a horizontal reply
            # interrupts the run or separates the earlier run from mate.
            for moves in (
                MOVES[:4] + ("a9a8", "e10d10", "a8a10", "d10d9", "a10a9"),
                MOVES[:-1] + ("a10a8", "e9d9", "a8a9"),
            ):
                self.assertFalse(detector.candidate(trace_for(BASE, moves, mirror)))

            # A longer run qualifies, but only the final three checked replies
            # count: earlier checks cannot compensate for a later unchecked turn.
            moves = MOVES[:-1] + ("a10a9", "e9e10", "a9a10", "e10e9", "a10a9")
            trace = trace_for(BASE, moves, mirror)
            self.assertEqual(
                [r["index"] for r in detector.sequence(trace)["replies"]], [5, 7, 9]
            )
            record = self.evidence(trace)
            self.assertEqual(detector.evidence_outcome(trace, record), "key")
            for index in range(3):
                changed = {
                    **record,
                    "replies": [
                        {**r, "checkers": []} if i == index else r
                        for i, r in enumerate(record["replies"])
                    ],
                }
                self.assertEqual(detector.evidence_outcome(trace, changed), "not_key")

    def test_vertical_replies_must_alternate_direction(self):
        for mirror in (False, True):
            for ranks, expected in (
                ((10, 9, 10, 9), True),
                ((8, 9, 8, 9), True),
                ((10, 9, 8, 9), False),
                ((8, 9, 10, 9), False),
                ((9, 10, 9, 8), False),
                ((9, 8, 9, 10), False),
            ):
                board = {s: p for s, p in BASE.items() if p != "k"}
                board[f"e{ranks[0]}"] = "k"
                moves = list(MOVES)
                for index, (origin, target) in enumerate(zip(ranks, ranks[1:])):
                    moves[index * 2 + 1] = f"e{origin}e{target}"
                trace = trace_for(board, tuple(moves), mirror)
                self.assertEqual(detector.candidate(trace), expected)
                if expected:
                    record = self.evidence(trace)
                    self.assertEqual(detector.evidence_outcome(trace, record), "key")
                    self.assertIsNone(
                        detector.evidence_outcome(
                            trace, {**record, "logic_version": "1.1"}
                        )
                    )

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_lesson_rejects_sacrificed_chariot_as_third_check(self):
        board = decode_position(
            "3ak1b2/1C2a2R1/1n2b1n2/4p4/9/4C4/9/3RB4/1r2pr3/3K5 w - - 0 1"
        )
        moves = (
            "b9b10",
            "b8c10",
            "h9e9",
            "e10e9",
            "d3d9",
            "e9e10",
            "d9d10",
            "e10e9",
            "d10d9",
        )
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            trace = trace_for(board, moves, mirror)
            for decision in trace.decisions:
                self.assertIn(
                    decision.selected_move, engine.inspect(decision.context).legal_moves
                )
            self.assertTrue(
                engine.inspect(SearchContext(trace.terminal.fen, ())).checkmate
            )
            self.assertEqual(detector.assess(engine, trace)["outcome"], "not_key")

    def test_persistence_and_branch_consensus(self):
        from tools.xiangqi_data.tests.test_puzzle_chariots_threatening_advisor import (
            ChariotsThreateningAdvisorTest,
        )
        from tools.xiangqi_data.puzzle_mining.classification import TacticalClassifier
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            _evaluate_category,
            _save_category,
            taxonomy_versions,
        )

        trace = trace_for(BASE, MOVES)
        record = self.evidence(trace)
        inspected = {
            p["fen"]: p["checkers"]
            for p in [record["terminal"], *record["escapes"], *record["replies"]]
        }
        engine = Mock()
        engine.checking_pieces.side_effect = lambda context: (
            context.initial_fen,
            inspected[context.initial_fen],
        )
        helper = ChariotsThreateningAdvisorTest()
        fixture = helper.fixture(trace)
        self.addCleanup(helper.doCleanups)
        row = fixture.current()
        current = {
            "candidate_id": row["id"],
            "current_verification_id": row["current_verification_id"],
        }
        args = (
            fixture.connection,
            current,
            (trace,),
            TacticalClassifier(),
            detector.THEME,
        )
        outcome, proofs = _evaluate_category(*args, engine, None)
        self.assertEqual(outcome, "match")
        self.assertTrue(
            _save_category(
                fixture.connection,
                current,
                detector.THEME,
                taxonomy_versions(),
                outcome,
                proofs,
            )
        )
        self.assertEqual(_evaluate_category(*args, None, None)[0], "match")
        negative = trace_for(BASE, MOVES[:-2])
        self.assertEqual(
            _evaluate_category(
                fixture.connection,
                current,
                (trace, negative),
                TacticalClassifier(),
                detector.THEME,
                None,
                None,
            )[0],
            "conflict",
        )
