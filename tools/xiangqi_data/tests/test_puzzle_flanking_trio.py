import json
import unittest
from pathlib import Path
from copy import deepcopy
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining.attack_evidence import geometric_attack
from tools.xiangqi_data.puzzle_mining import flanking_trio_roles
from tools.xiangqi_data.puzzle_mining.engine import EngineProtocolError, OfflinePikafish
from tools.xiangqi_data.puzzle_mining.flanking_trio import (
    THEME,
    VERSION,
    assess,
    candidate,
    evidence_outcome,
    tracked_trio,
)
from tools.xiangqi_data.puzzle_mining.models import (
    SearchContext,
    SearchResult,
    VerifiedDecision,
    VerifiedTrace,
    fen_side,
)
from tools.xiangqi_data.puzzle_mining.patterns import (
    TerminalPosition,
    classification_logic_version,
    flanking_trio_boxes,
    matching_assessed_themes,
)
from tools.xiangqi_data.puzzle_mining.position import (
    FenState,
    UI_MOVE,
    decode_position,
    encode_position,
    normalized_fen,
)
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

# Extend the existing Theme-page lesson with the horse move leading into it.
BASE = {
    "i10": "C",
    "f9": "R",
    "h9": "N",
    "d9": "k",
    "e9": "a",
    "e8": "b",
    "i4": "c",
    "e3": "p",
    "g3": "n",
    "d2": "p",
    "e1": "K",
    "f1": "A",
}
MOVES = ("h9f10", "d9d8", "i10i8", "e8g6", "f9f8", "g6e8", "f8e8")


def trio_trace(pieces=None, moves=MOVES, *, mirror=False, left=False):
    pieces = dict(BASE if pieces is None else pieces)
    if left:
        flip = lambda square: chr(ord("a") + ord("i") - ord(square[0])) + square[1:]
        pieces = {flip(s): p for s, p in pieces.items()}
        moves = tuple(
            flip(m[1] + m[2]) + flip(m[3] + m[4])
            for move in moves
            for m in [UI_MOVE.fullmatch(move)]
        )
    return trace_for(pieces, moves, mirror)


class FlankingTrioTest(unittest.TestCase):
    def engine(self, trace, checkers=("e8",)):
        engine = Mock()

        def inspection(context):
            fen = context.initial_fen
            if normalized_fen(fen) == normalized_fen(trace.terminal.fen):
                return fen, checkers
            board = decode_position(fen)
            general = "k" if fen_side(fen) == "black" else "K"
            target = next(s for s, p in board.items() if p == general)
            attackers = tuple(
                s
                for s, p in board.items()
                if p.isupper() != general.isupper()
                and geometric_attack(board, s, target)
            )
            return fen, attackers

        engine.checking_pieces.side_effect = inspection
        return engine

    def test_same_identities_on_both_flanks_for_both_colors(self):
        for mirror in (False, True):
            for left in (False, True):
                with self.subTest(mirror=mirror, left=left):
                    trace = trio_trace(mirror=mirror, left=left)
                    witness = tracked_trio(trace)
                    self.assertEqual(witness["flank"], "left" if left else "right")
                    self.assertEqual(len(witness["pieces"]), 3)
                    self.assertTrue(candidate(trace))
                    engine = self.engine(trace, ("e3" if mirror else "e8",))
                    record = assess(engine, trace)
                    self.assertEqual(record["outcome"], "key")
                    self.assertGreater(engine.checking_pieces.call_count, 1)
                    engine.inspect.assert_not_called()
                    engine.analyse.assert_not_called()
                    terminal = TerminalPosition(
                        trace.terminal.fen, True, "red" if mirror else "black"
                    )
                    self.assertEqual(
                        matching_assessed_themes(terminal, {THEME: record}, {THEME}),
                        {THEME},
                    )
                    self.assertEqual(
                        matching_assessed_themes(terminal, {}, {THEME}), set()
                    )
        self.assertEqual(
            tracked_trio(trio_trace())["pieces"], {"h9": "f10", "f9": "e8", "i10": "i8"}
        )

    def test_box_boundaries_and_center_file_overlap(self):
        for mirror in (False, True):
            losing = "red" if mirror else "black"
            for pieces, flank in (
                ({"e6": "R", "f10": "N", "i8": "C"}, "right"),
                ({"e10": "R", "b6": "N", "a8": "C"}, "left"),
            ):
                if mirror:
                    pieces = {
                        f"{s[0]}{11 - int(s[1:])}": p.swapcase()
                        for s, p in pieces.items()
                    }
                self.assertEqual(set(flanking_trio_boxes(pieces, losing)), {flank})
            center = {"e6": "R", "e8": "N", "e10": "C"}
            if mirror:
                center = {
                    f"{s[0]}{11 - int(s[1:])}": p.swapcase() for s, p in center.items()
                }
            self.assertEqual(
                set(flanking_trio_boxes(center, losing)), {"left", "right"}
            )
        # Touching the enemy river bank is allowed throughout the sequence.
        moves = ("f9f6", "i4i5", "f6f9", "i5i4", *MOVES)
        self.assertTrue(candidate(trio_trace(moves=moves)))

    def test_extra_friendly_pieces_are_forbidden_only_inside_the_fixed_box(self):
        for piece in "RNCABK":
            self.assertFalse(candidate(trio_trace({**BASE, "g7": piece})))
        # Other winning pieces may remain outside the identified box.
        self.assertTrue(
            candidate(trio_trace({**BASE, "a7": "P", "b8": "R", "g5": "N"}))
        )
        # Enemy occupants inside the box are unrestricted.
        self.assertTrue(candidate(trio_trace({**BASE, "g7": "p", "h7": "r"})))
        # A fourth friendly piece may not enter and leave again between endpoints.
        moves = ("d6e6", "i4i5", "e6d6", "i5i4", *MOVES)
        self.assertFalse(candidate(trio_trace({**BASE, "d6": "R"}, moves)))

    def test_leaving_the_flank_or_crossing_back_over_river_is_not_repaired_by_return(
        self,
    ):
        for out, back in (("i10d10", "d10i10"), ("f9f5", "f5f9")):
            trace = trio_trace(moves=(out, "i4i5", back, "i5i4", *MOVES))
            engine = self.engine(trace)
            self.assertFalse(candidate(trace))
            self.assertEqual(assess(engine, trace)["outcome"], "not_key")
            engine.checking_pieces.assert_not_called()

    def test_a_second_trio_is_forbidden_even_temporarily(self):
        self.assertFalse(
            candidate(trio_trace({**BASE, "a10": "R", "c10": "N", "b8": "C"}))
        )
        moves = ("b5b6", "i4i5", "b6b5", "i5i4", *MOVES)
        self.assertFalse(
            candidate(trio_trace({**BASE, "a10": "R", "c10": "N", "b5": "C"}, moves))
        )

    def test_capture_replacement_and_trading_flanks_do_not_preserve_the_trio(self):
        pieces = {
            "e1": "K",
            "d8": "k",
            "f9": "R",
            "h9": "N",
            "i10": "C",
            "f8": "r",
            "a7": "p",
        }
        switched = trio_trace(
            {**pieces, "a9": "R", "c9": "N"},
            ("h9g7", "f8f9", "i10b10", "a7a6", "a9a8", "a6a5", "c9a10"),
        )
        replaced = trio_trace(
            {**pieces, "f4": "R"},
            ("h9g7", "f8f9", "f4f9", "a7a6", "i10i8"),
        )
        for trace in (switched, replaced):
            self.assertFalse(candidate(trace))
            self.assertEqual(assess(self.engine(trace), trace)["outcome"], "not_key")

    def test_all_three_identical_tracked_pieces_must_move(self):
        state = FenState(trio_trace().decisions[0].position_fen)
        for move in MOVES[:2]:
            state.push(move)
        # The shorter Theme-page lesson never moves its horse.
        stationary_horse = trio_trace(state.position, MOVES[2:])
        stationary_cannon = trio_trace(moves=("h9f10", "d9d8", "f9f8", "i4i5", "f8e8"))
        stationary_chariot = trio_trace(
            moves=("h9f10", "d9d8", "i10i8", "e8g6", "i8i9")
        )
        for trace in (stationary_horse, stationary_cannon, stationary_chariot):
            self.assertFalse(candidate(trace))
        for move in ("h9f10", "f9f8", "i10i8"):
            self.assertFalse(candidate(trio_trace(moves=(move,))))
        self.assertFalse(candidate(trio_trace(moves=("h9f10", "i4i5", "f10h9"))))

    def test_late_formation_is_rejected_even_when_all_three_pieces_move(self):
        pieces = {**BASE, "h5": "N"}
        del pieces["h9"]
        moves = ("h5f6", "i4i5", "f6h7", "i5i4", "h7f8", "i4i5", "f8h9", "i5i4", *MOVES)
        self.assertFalse(candidate(trio_trace(pieces, moves)))

    def test_another_horse_cannot_supply_the_stationary_trio_horses_move(self):
        state = FenState(trio_trace().decisions[0].position_fen)
        for move in MOVES[:2]:
            state.push(move)
        pieces = {**state.position, "b4": "N"}
        moves = ("b4c6", "i4i5", *MOVES[2:])
        self.assertFalse(candidate(trio_trace(pieces, moves)))

    def test_moves_by_other_pieces_do_not_count_toward_trio_participation(self):
        self.assertFalse(
            candidate(trio_trace({**BASE, "a6": "R"}, moves=("a6a7", "i4i5", "h9f10")))
        )
        self.assertFalse(
            candidate(trio_trace({**BASE, "g6": "P"}, moves=("g6g7", "i4i5", "h9f10")))
        )

    def test_a_tracked_piece_must_check_but_other_checkers_are_allowed(self):
        trace = trio_trace({**BASE, "a6": "R"})
        for checkers, expected in (
            (("e8",), "key"),
            (("i8",), "key"),
            (("f10",), "key"),
            (("a6", "e8", "i8"), "key"),
            (("a6",), "not_key"),
            ((), "not_key"),
            (("e8", "e8"), "inconclusive"),
            (("e8", "e9"), "inconclusive"),
        ):
            self.assertEqual(
                assess(self.engine(trace, checkers), trace)["outcome"], expected
            )

    def test_missing_inconsistent_or_unverified_ledgers_do_not_qualify(self):
        trace = trio_trace()
        changed = decode_position(trace.terminal.fen)
        changed["a5"] = "p"
        wrong_terminal = encode_position(changed) + " b - - 0 1"
        for damaged in (
            replace(trace, decisions=()),
            replace(
                trace,
                decisions=(
                    replace(trace.decisions[0], position_fen="bad"),
                    *trace.decisions[1:],
                ),
            ),
            replace(
                trace,
                decisions=(
                    trace.decisions[0],
                    replace(trace.decisions[1], position_fen=""),
                    *trace.decisions[2:],
                ),
            ),
            replace(
                trace,
                decisions=(
                    trace.decisions[0],
                    replace(
                        trace.decisions[1],
                        position_fen=trace.decisions[1].position_fen.replace(
                            " b ", " w "
                        ),
                    ),
                    *trace.decisions[2:],
                ),
            ),
            replace(
                trace,
                decisions=(
                    *trace.decisions[:-1],
                    replace(trace.decisions[-1], selected_move="f8g8"),
                ),
            ),
            replace(trace, terminal=replace(trace.terminal, fen=wrong_terminal)),
        ):
            self.assertIsNone(candidate(damaged))
            self.assertEqual(
                assess(self.engine(damaged), damaged)["outcome"], "inconclusive"
            )
        for damaged in (
            replace(trace, verified=False),
            replace(trace, terminal=replace(trace.terminal, checked=False)),
            replace(trace, terminal=replace(trace.terminal, legal_moves=("d8d9",))),
        ):
            self.assertFalse(candidate(damaged))

    def contribution_engine(self, trace, *, horse=True, cannon=True, substitute=False):
        trio = tracked_trio(trace)
        positions = flanking_trio_roles.inspection_positions(trace, trio)
        schedule = {
            normalized_fen(trace.terminal.fen): ("e8",),
            normalized_fen(positions[(3, "")][0]): ("i8",) if cannon else (),
            # Shared escape control counts; this horse never has to give check.
            normalized_fen(positions[(7, "d8d9")][0]): (
                (("b6",) if substitute else ("f10",)) if horse else ()
            ),
        }
        engine = Mock()
        engine.checking_pieces.side_effect = lambda context: (
            context.initial_fen,
            schedule.get(normalized_fen(context.initial_fen), ()),
        )
        return engine

    def test_every_exact_piece_needs_a_check_or_escape_contribution(self):
        trace = trio_trace({**BASE, "b6": "N"})
        for horse, cannon, substitute, expected in (
            (True, True, False, "key"),
            (False, True, False, "not_key"),
            (True, False, False, "not_key"),
            (True, True, True, "not_key"),
        ):
            engine = self.contribution_engine(
                trace, horse=horse, cannon=cannon, substitute=substitute
            )
            record = assess(engine, trace)
            self.assertEqual(record["outcome"], expected)
            self.assertEqual(evidence_outcome(trace, record), expected)
            inspected = [
                normalized_fen(call.args[0].initial_fen)
                for call in engine.checking_pieces.call_args_list
            ]
            self.assertEqual(len(inspected), len(set(inspected)))
            if expected == "key":
                self.assertLess(
                    len(record["contributions"]),
                    len(
                        flanking_trio_roles.inspection_positions(
                            trace, tracked_trio(trace)
                        )
                    ),
                )
            engine.analyse.assert_not_called()

    def test_contribution_evidence_cannot_be_omitted_forged_or_duplicated(self):
        trace = trio_trace({**BASE, "b6": "N"})
        record = assess(self.contribution_engine(trace), trace)
        self.assertEqual(record["outcome"], "key")
        for mutate in (
            lambda r: r.pop("contributions"),
            lambda r: r.update(contributions=[]),
            lambda r: r["contributions"].append(deepcopy(r["contributions"][0])),
            lambda r: r["contributions"][0].update(ply=999),
            lambda r: r["contributions"][0].update(fen=trace.decisions[0].position_fen),
            lambda r: r["contributions"][0].update(checkers=["d9"]),
        ):
            bad = deepcopy(record)
            mutate(bad)
            self.assertIsNone(evidence_outcome(trace, bad))
        no_match = assess(self.contribution_engine(trace, horse=False), trace)
        self.assertEqual(no_match["outcome"], "not_key")
        no_match["contributions"].pop()
        self.assertIsNone(evidence_outcome(trace, no_match))

    def test_captured_piece_and_defenders_own_occupants_do_not_supply_escape_roles(
        self,
    ):
        trace = trio_trace()
        positions = flanking_trio_roles.inspection_positions(trace, tracked_trio(trace))
        # e8 contains the tracked chariot; the hypothetical king capture removes it.
        fen, identities = positions[(7, "d8e8")]
        self.assertNotIn("e8", identities)
        self.assertEqual(decode_position(fen)["e8"], "k")
        self.assertNotIn((0, "d9e9"), positions)  # Defending advisor blocks the step.

    def test_pawns_need_two_orthogonal_steps_from_palace_on_both_flanks(self):
        for mirror in (False, True):
            # Includes the enemy river bank, diagonals, side edges, and far flanks.
            for square in ("d6", "e6", "f6", "c7", "g7", "b8", "h8", "a10", "i9", "e5"):
                with self.subTest(mirror=mirror, allowed=square):
                    self.assertTrue(
                        candidate(trio_trace({**BASE, square: "P"}, mirror=mirror))
                    )
            for square in ("d7", "e7", "f7", "c8", "g8", "c10", "g10", "d10"):
                with self.subTest(mirror=mirror, forbidden=square):
                    self.assertFalse(
                        candidate(trio_trace({**BASE, square: "P"}, mirror=mirror))
                    )
            for origin, target in (("g7", "f7"), ("c7", "d7")):
                moves = (origin + target, "i4i5", target + origin, "i5i4", *MOVES)
                self.assertFalse(
                    candidate(trio_trace({**BASE, origin: "P"}, moves, mirror=mirror))
                )

    def test_persisted_evidence_binds_initial_position_moves_trio_and_terminal(self):
        trace = trio_trace()
        record = assess(self.engine(trace), trace)
        for field, value in (
            ("logic_version", "1.2"),
            ("initial_fen", "old"),
            ("terminal_fen", "old"),
            ("moves", list(reversed(trace.moves))),
            ("trio", {}),
            ("terminal", {"fen": trace.terminal.fen, "checkers": ["a1"]}),
        ):
            self.assertIsNone(evidence_outcome(trace, {**record, field: value}))
        wrong_side = deepcopy(record)
        wrong_side["trio"]["flank"] = "left"
        self.assertIsNone(evidence_outcome(trace, wrong_side))
        engine = self.engine(trace)
        engine.checking_pieces.side_effect = EngineProtocolError("failed")
        self.assertEqual(assess(engine, trace)["outcome"], "inconclusive")
        self.assertEqual(classification_logic_version({THEME}), f"{THEME}@{VERSION}")

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_legal_mating_sequence_for_both_colors_and_flanks(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            for left in (False, True):
                trace = trio_trace(mirror=mirror, left=left)
                for move, decision in zip(trace.moves, trace.decisions):
                    self.assertIn(move, engine.inspect(decision.context).legal_moves)
                self.assertTrue(
                    engine.inspect(SearchContext(trace.terminal.fen, ())).checkmate
                )
                self.assertEqual(assess(engine, trace)["outcome"], "key")

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_cnyrj_all_three_verified_branches(self):
        fixture = json.loads(
            (Path(__file__).parent / "fixtures/flanking_trio_cnyrj.json").read_text()
        )
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for moves in fixture["lines"]:
            state = FenState(fixture["fen"])
            decisions = []
            for move in moves:
                fen = state.fen()
                self.assertIn(move, engine.inspect(SearchContext(fen, ())).legal_moves)
                decisions.append(
                    VerifiedDecision(
                        SearchContext(fen, ()),
                        fen_side(fen),
                        (move,),
                        move,
                        SearchResult("fixture", "fixture", move, ()),
                        position_fen=fen,
                    )
                )
                state.push(move)
            terminal = engine.inspect(SearchContext(state.fen(), ()))
            self.assertTrue(terminal.checkmate)
            trace = VerifiedTrace(
                tuple(moves), terminal, tuple(decisions), verified=True
            )
            self.assertFalse(candidate(trace))
            inspector = self.engine(trace)
            self.assertEqual(assess(inspector, trace)["outcome"], "not_key")
            inspector.checking_pieces.assert_not_called()

    def test_initial_pawn_distance_is_enforced_even_if_it_moves_away(self):
        moves = ("f7g7", "i4i5", *MOVES)
        self.assertFalse(candidate(trio_trace({**BASE, "f7": "P"}, moves)))
        self.assertTrue(candidate(trio_trace({**BASE, "g7": "P"})))

    def test_category_persistence_reuse_queue_and_branch_consensus(self):
        from tools.xiangqi_data.puzzle_mining.category_status import pool_counts
        from tools.xiangqi_data.puzzle_mining.classification import TacticalClassifier
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            _evaluate_category,
            _save_category,
            taxonomy_versions,
        )
        from tools.xiangqi_data.puzzle_mining.solver import VerifiedBranch
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )

        f = PuzzleStorageLifecycleTest()
        f.setUp(themes=None)
        self.addCleanup(f.tearDown)
        trace = trio_trace()
        f.verify(
            result=f.result(
                branches=(
                    VerifiedBranch(
                        trace.moves, trace.terminal, decisions=trace.decisions
                    ),
                )
            )
        )
        current = {
            "candidate_id": f.current()["id"],
            "current_verification_id": f.current()["current_verification_id"],
        }
        versions = taxonomy_versions()
        selected = {
            key: value
            for key, value in versions.items()
            if key in {THEME, "__consensus__"}
        }
        engine = self.engine(trace)
        self.assertEqual(pool_counts(f.connection, selected)["pending_checks"], 1)
        outcome, proofs = _evaluate_category(
            f.connection, current, (trace,), TacticalClassifier(), THEME, engine, None
        )
        self.assertEqual(outcome, "match")
        self.assertTrue(
            _save_category(f.connection, current, THEME, versions, outcome, proofs)
        )
        self.assertEqual(pool_counts(f.connection, selected)["pending_checks"], 0)
        inspection_count = engine.checking_pieces.call_count
        reused, _ = _evaluate_category(
            f.connection, current, (trace,), TacticalClassifier(), THEME, None, None
        )
        self.assertEqual(reused, "match")
        self.assertEqual(engine.checking_pieces.call_count, inspection_count)
        with f.connection:
            f.connection.execute(
                "DELETE FROM category_assessments WHERE category=?", (THEME,)
            )
        self.assertEqual(pool_counts(f.connection, selected)["pending_checks"], 1)
        other = trio_trace({**BASE, "g7": "R"})
        conflict, _ = _evaluate_category(
            f.connection,
            current,
            (trace, other),
            TacticalClassifier(),
            THEME,
            None,
            None,
        )
        self.assertEqual(conflict, "conflict")


if __name__ == "__main__":
    unittest.main()
