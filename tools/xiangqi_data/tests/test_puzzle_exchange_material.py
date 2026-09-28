import unittest
import copy
from dataclasses import replace
from unittest.mock import Mock, patch

from tools.xiangqi_data.puzzle_mining import exchange_material as motif
from tools.xiangqi_data.puzzle_mining.models import (
    EngineScore,
    PositionStatus,
    SearchContext,
    SearchLine,
    SearchResult,
    TacticEndpoint,
)
from tools.xiangqi_data.puzzle_mining.position import FenState, UI_MOVE, puzzle_root_fen
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

BASE = {"e1": "K", "f10": "k", "c3": "N", "d5": "c", "f6": "n", "d1": "R"}
MOVES = ("c3d5", "f6d5", "d1d5")


def trace(board=None, moves=MOVES, mirror=False):
    t = trace_for(board or BASE, moves, mirror)
    context = t.decisions[0].context
    decisions = []
    for decision in t.decisions:
        decisions.append(
            replace(
                decision,
                context=context,
                analysis=replace(decision.analysis, search_depth=20),
            )
        )
        context = context.extend(decision.selected_move)
    return replace(
        t,
        objective="advantage",
        decisions=tuple(decisions),
        endpoint=TacticEndpoint("multiple_good_moves", 0.55, 0.5),
        terminal=replace(
            t.terminal, checked=False, legal_moves=("f10f9" if not mirror else "f1f2",)
        ),
    )


def mirror_move(move):
    m = UI_MOVE.fullmatch(move)
    return m[1] + str(11 - int(m[2])) + m[3] + str(11 - int(m[4]))


def setup_before(t, origin=None, target=None, captured=None):
    """Prepend a setup move to a fixture without changing the playable trace."""
    state = FenState((t.decisions or trace().decisions)[0].context.initial_fen)
    if target is None:
        target = "f10" if state.turn == "w" else "f1"
        origin = "f9" if state.turn == "w" else "f2"
    state.position[origin] = state.position.pop(target)
    if captured:
        state.position[target] = captured
    state.turn = "b" if state.turn == "w" else "w"
    return {"pre_fen": state.fen(), "setup_move": origin + target}


def assess(engine, t, **setup):
    return motif.assess(engine, t, **(setup or setup_before(t)))


def evidence_outcome(t, record, **setup):
    return motif.evidence_outcome(t, record, **(setup or setup_before(t)))


def inspect_exchange(t, **setup):
    return motif.inspect_exchange(t, **(setup or setup_before(t)))


class ContinuationEngine:
    """Scripted engine tree: tests control defense, alternatives and check state."""

    def __init__(self, t, variations=None, checked=(), values=None):
        self.trace = t
        self.searches = []
        self.inspections = []
        self.checked = checked
        self.values = values
        self.resets = 0
        if variations is None:
            end = UI_MOVE.fullmatch(t.moves[-1])
            origin = end[3] + end[4]
            mirrored = t.decisions[0].side == "black"
            if mirrored:
                origin = end[3] + str(11 - int(end[4]))
            moves = (
                "f10f9",
                origin + "b5",
                "f9e9",
                "b5b4",
                "e9e10",
                "b4b3",
                "e10d10",
                "b3b2",
            )
            if mirrored:
                moves = tuple(mirror_move(move) for move in moves)
            variations = (moves,)
        self.variations = variations

    def suffix(self, context):
        assert context.initial_fen == self.trace.decisions[0].context.initial_fen
        assert context.moves[: len(self.trace.moves)] == self.trace.moves
        return context.moves[len(self.trace.moves) :]

    def new_game(self):
        self.resets += 1

    def inspect(self, context):
        suffix = self.suffix(context)
        self.inspections.append(suffix)
        state = FenState(context.initial_fen)
        for move in context.moves:
            state.push(move)
        legal = tuple(
            dict.fromkeys(
                v[len(suffix)]
                for v in self.variations
                if v[: len(suffix)] == suffix and len(v) > len(suffix)
            )
        )
        return PositionStatus(state.fen(), len(suffix) in self.checked, legal)

    def analyse(self, context, *, depth, multi_pv):
        suffix = self.suffix(context)
        self.searches.append((suffix, depth, multi_pv))
        lines = []
        for variation in self.variations:
            moves = variation[len(suffix) :]
            if variation[: len(suffix)] != suffix or any(
                line.moves[0] == moves[0] for line in lines
            ):
                continue
            value = (
                -0.95
                if not suffix
                else (self.values or [0.95] * len(self.variations))[len(lines)]
            )
            wdl = (
                (int(value * 1000), 1000 - int(value * 1000), 0)
                if value >= 0
                else (0, 1000 + int(value * 1000), -int(value * 1000))
            )
            lines.append(
                SearchLine(
                    len(lines) + 1,
                    depth,
                    depth,
                    100,
                    1,
                    EngineScore("cp", int(value * 500), wdl),
                    moves,
                )
            )
            if len(lines) == multi_pv:
                break
        return SearchResult(
            "test",
            "test",
            lines[0].moves[0],
            tuple(lines),
            search_depth=depth,
            requested_multipv=multi_pv,
        )


class ExchangeMaterialTest(unittest.TestCase):
    def test_setup_captures_are_debited_and_three_net_points_qualify_both_colors(self):
        for mirror in (False, True):
            for victim, captured, gain, expected in (
                ("n", "P", 3, "key"),
                ("n", "B", 2, "not_key"),
                ("n", "N", 0, "not_key"),
                ("r", "N", 5, "key"),
                ("r", "R", 0, "not_key"),
            ):
                with self.subTest(mirror=mirror, victim=victim, captured=captured):
                    t = trace({**BASE, "f6": victim, "h4": "r"}, mirror=mirror)
                    setup = setup_before(
                        t,
                        "h3" if mirror else "h8",
                        "h7" if mirror else "h4",
                        captured.swapcase() if mirror else captured,
                    )
                    engine = ContinuationEngine(t)
                    record = assess(engine, t, **setup)
                    self.assertEqual(record["material"]["material_gain"], gain)
                    self.assertEqual(record["outcome"], expected)
                    self.assertEqual(evidence_outcome(t, record, **setup), expected)
                    if expected == "not_key":
                        self.assertEqual(engine.searches, [])

    def test_setup_capture_does_not_disqualify_a_player_exchange_with_net_three(self):
        t = trace({**BASE, "d6": "p"})
        setup = setup_before(t, "d8", "d5", "P")
        record = assess(ContinuationEngine(t), t, **setup)
        self.assertTrue(record["material"]["opening_exchange"])
        self.assertEqual(record["material"]["material_gain"], 3)
        self.assertEqual(record["outcome"], "key")

    def test_retention_also_counts_from_before_setup(self):
        t = trace({**BASE, "h4": "r", "a6": "p"})
        setup = setup_before(t, "h8", "h4", "P")
        moves = ("a6a5", "d5d4", "f10f9", "d4c4", "f9e9", "c4c3", "e9e10", "c3b3")
        engine = ContinuationEngine(t, (moves,))
        t = replace(
            t, terminal=engine.inspect(t.decisions[-1].context.extend(t.moves[-1]))
        )
        record = assess(engine, t, **setup)
        self.assertEqual(record["material"]["material_gain"], 3)
        # Root-relative gain retains 3/4, but including setup retains only 2/3.
        self.assertEqual(record["outcome"], "not_key")
        self.assertEqual(max(map(len, engine.inspections)), 7)

    def test_setup_must_reproduce_root_and_evidence_is_bound_to_setup(self):
        t = trace({**BASE, "h4": "r"})
        setup = setup_before(t, "h8", "h4", "P")
        record = assess(ContinuationEngine(t), t, **setup)
        changed = setup_before(t, "h8", "h4", "N")
        self.assertIsNone(evidence_outcome(t, record, **changed))
        self.assertIsNone(
            evidence_outcome(t, {**record, "logic_version": "2"}, **setup)
        )
        for bad in (
            {**setup, "setup_move": "h8h5"},
            {**setup, "pre_fen": t.decisions[0].position_fen},
        ):
            self.assertEqual(assess(None, t, **bad)["outcome"], "inconclusive")

    def assess_variations(self, t, variations, **kwargs):
        engine = ContinuationEngine(t, variations, **kwargs)
        endpoint = t.decisions[-1].context.extend(t.moves[-1])
        t = replace(t, terminal=engine.inspect(endpoint))
        return t, engine, assess(engine, t)

    def test_75_percent_uses_start_relative_gain_and_no_second_four_point_floor(self):
        for pawn, expected in (("h5", "key"), ("h6", "not_key")):
            t = trace({**BASE, "h10": "r", pawn: "P"})
            moves = (
                "h10" + pawn,
                "d5d4",
                pawn + "h4",
                "d4c4",
                "h4h3",
                "c4c3",
                "h3h2",
                "c3b3",
            )
            t, engine, record = self.assess_variations(t, (moves,))
            self.assertEqual(record["material"]["material_gain"], 4)
            self.assertEqual(record["outcome"], expected)
            self.assertEqual(
                max(map(len, engine.inspections)), 5 if expected == "key" else 7
            )
            self.assertEqual(evidence_outcome(t, record), expected)

    def test_intermediate_loss_recovers_on_sixth_ply_and_survives_seventh(self):
        t = trace({**BASE, "h10": "r", "f7": "N"})
        moves = ("h10d10", "d5d8", "d10d8", "f7h8", "d8d9", "h8d9", "f10f9", "d9b8")
        t, engine, record = self.assess_variations(t, (moves,), checked=(4,))
        self.assertEqual(record["outcome"], "key")
        self.assertEqual(max(map(len, engine.inspections)), 7)
        balances = [
            motif.material_balance(FenState(item["fen"]).position, True)
            - record["material"]["initial_balance"]
            for item in record["retention"]["continuations"][0]
        ]
        self.assertEqual(balances, [4, -5, -5, -5, 4, 4])

    def test_nine_point_gain_requires_seven_not_six(self):
        for extra_pawn, expected in ((False, "key"), (True, "not_key")):
            board = {**BASE, "f6": "r", "h10": "r", "h6": "B"}
            if extra_pawn:
                board["h4"] = "P"
            t = trace(board)
            moves = ("h10h6", "d5d4", "h6h4", "d4c4", "h4h3", "c4c3", "h3h2", "c3b3")
            _, _, record = self.assess_variations(t, (moves,))
            self.assertEqual(record["material"]["material_gain"], 9)
            self.assertEqual(record["outcome"], expected)

    def test_optional_sacrifice_does_not_hide_a_winning_material_retaining_choice(self):
        t = trace({**BASE, "h10": "r"})
        sacrifice = ("h10d10", "d5d8", "d10d8", "e1f1", "d8d7", "f1f2", "d7d6", "f2e2")
        retain = ("h10d10", "d5c5", "d10d9", "c5c4", "d9d8", "c4c3", "d8d7", "c3c2")
        for values, expected in (([0.95, 0.8], "key"), ([0.95, 0.5], "not_key")):
            _, engine, record = self.assess_variations(
                t, (sacrifice, retain), values=values
            )
            self.assertEqual(record["outcome"], expected)
            self.assertEqual(engine.searches[-1][2], 2)

    def test_unresolved_check_or_pending_capture_at_limit_is_inconclusive(self):
        t = trace({**BASE, "h10": "r", "f7": "N"})
        moves = ("h10d10", "d5d8", "d10d8", "f7h8", "d8d9", "h8g6", "d9d6", "g6d6")
        _, engine, record = self.assess_variations(t, (moves,))
        self.assertEqual(record["outcome"], "inconclusive")
        self.assertEqual(max(map(len, engine.inspections)), 7)
        _, _, record = self.assess_variations(
            t, (moves[:-1] + ("g6f8",),), checked=(5, 7)
        )
        self.assertEqual(record["outcome"], "inconclusive")

    def test_missing_engine_short_pv_repetition_and_damaged_proof_are_inconclusive(
        self,
    ):
        t = trace()
        self.assertEqual(assess(None, t)["outcome"], "inconclusive")
        engine = ContinuationEngine(t)
        # Stop the PV while legal replies still exist in native inspection.
        original = engine.analyse

        def short(*args, **kwargs):
            result = original(*args, **kwargs)
            return replace(
                result,
                lines=tuple(
                    replace(line, moves=line.moves[:2]) for line in result.lines
                ),
            )

        engine.analyse = short
        self.assertEqual(assess(engine, t)["outcome"], "inconclusive")
        moves = ("f10f9", "d5d4", "f9f10", "d4d5", "f10f9", "d5d4", "f9e9", "d4c4")
        _, _, record = self.assess_variations(t, (moves,))
        self.assertEqual(record["outcome"], "inconclusive")
        record = assess(ContinuationEngine(t), t)
        for mutate in (
            lambda r: r["retention"].update(depth=24),
            lambda r: r["retention"].update(continuations=[]),
            lambda r: r["retention"]["continuations"][0][-1].update(fen=t.terminal.fen),
            lambda r: r["retention"]["choices"]["lines"][0]["score"].update(
                bound="lower"
            ),
        ):
            bad = copy.deepcopy(record)
            mutate(bad)
            self.assertIsNone(evidence_outcome(t, bad))

    def test_search_depth_uses_shared_setting_and_rejected_openings_need_no_engine(
        self,
    ):
        from tools.xiangqi_data.puzzle_mining.solver import SolverConfig

        t = trace()
        t = replace(
            t,
            decisions=tuple(
                replace(d, analysis=replace(d.analysis, search_depth=None))
                for d in t.decisions
            ),
        )
        engine = ContinuationEngine(t)
        with patch.object(motif, "SolverConfig", return_value=SolverConfig(depth=30)):
            self.assertEqual(assess(engine, t)["outcome"], "key")
        self.assertEqual([s[1] for s in engine.searches], [30, 30])
        engine = Mock()
        self.assertEqual(assess(engine, trace(moves=("c3d5",)))["outcome"], "not_key")
        self.assertEqual(engine.mock_calls, [])

    def test_exact_four_point_gain_nonmate_both_colors(self):
        for mirror in (False, True):
            t = trace(mirror=mirror)
            engine = ContinuationEngine(t)
            before = t.to_dict()
            record = assess(engine, t)
            self.assertEqual(record["outcome"], "key")
            self.assertEqual(record["material"]["material_gain"], 4)
            self.assertFalse(t.terminal_win)
            self.assertEqual(t.to_dict(), before)
            self.assertEqual(engine.resets, 1)
            self.assertEqual([search[1] for search in engine.searches], [20, 20])
            self.assertEqual(max(map(len, engine.inspections)), 5)

    def test_allowed_opening_pairs(self):
        for mirror in (False, True):
            for attacker in ("N", "C", "R"):
                for defender in ("n", "c", "r"):
                    origin = "c3"
                    target = "d5" if attacker == "N" else "c5"
                    board = {
                        "e1": "K",
                        "f10": "k",
                        origin: attacker,
                        target: defender,
                        "a8": "r",
                        "a5": "R",
                    }
                    recapturer = "d8" if attacker == "N" else "c8"
                    board[recapturer] = board.pop("a8")
                    if attacker == "C":
                        board["c4"] = "P"
                    t = trace(
                        board,
                        (origin + target, recapturer + target, "a5" + target),
                        mirror,
                    )
                    expected = (attacker in {"N", "C"} and defender in {"n", "c"}) or (
                        attacker,
                        defender,
                    ) == ("R", "r")
                    self.assertEqual(
                        assess(ContinuationEngine(t), t)["outcome"],
                        "key" if expected else "not_key",
                    )

    def test_balance_change_not_absolute_lead_and_threshold(self):
        t = trace({**BASE, "i10": "r"})
        record = assess(ContinuationEngine(t), t)
        self.assertLess(record["material"]["initial_balance"], 0)
        self.assertEqual(record["outcome"], "key")
        # The opponent's river crossing lowers the net gain from four to three.
        t = trace({**BASE, "a6": "p"}, (*MOVES, "a6a5", "d5e5"))
        record = assess(ContinuationEngine(t), t)
        self.assertEqual(record["material"]["material_gain"], 3)
        self.assertEqual(record["outcome"], "key")
        # Capturing an elephant after the trade gives only two, despite a large lead.
        board = {**BASE, "i1": "R", "f7": "b"}
        del board["f6"]
        record = assess(None, trace(board, ("c3d5", "f7d5", "d1d5")))
        self.assertGreater(record["material"]["terminal_balance"], 4)
        self.assertEqual(record["outcome"], "not_key")

    def test_piece_values_and_both_river_banks(self):
        for piece, value in (
            ("A", 2),
            ("B", 2),
            ("N", 4),
            ("C", 4),
            ("R", 9),
            ("K", 0),
        ):
            self.assertEqual(motif.material_balance({"a1": piece}, True), value)
            self.assertEqual(
                motif.material_balance({"a10": piece.lower()}, True), -value
            )
        for square, piece, value in (
            ("a5", "P", 1),
            ("a6", "P", 2),
            ("a6", "p", 1),
            ("a5", "p", 2),
        ):
            self.assertEqual(
                motif.material_balance({square: piece}, piece.isupper()), value
            )

    def test_first_capture_and_immediate_same_piece_recapture_required(self):
        board = {**BASE, "a7": "p"}
        for moves in (
            ("d1d2", "a7a6", "c3d5", "f6d5", "d2d5"),
            ("c3d5", "a7a6", "d1d8"),
        ):
            self.assertEqual(assess(None, trace(board, moves))["outcome"], "not_key")
        # Capturing a different horse on another square is not a recapture.
        board = {**BASE, "h5": "N"}
        self.assertEqual(
            assess(None, trace(board, ("c3d5", "f6h5", "d1d8")))["outcome"],
            "not_key",
        )
        board = {**BASE, "c3": "P"}
        self.assertEqual(assess(None, trace(board))["outcome"], "not_key")

    def test_incomplete_inconsistent_and_stale_evidence(self):
        t = trace()
        for bad in (
            replace(t, verified=False),
            replace(t, decisions=()),
            replace(
                t,
                decisions=(replace(t.decisions[0], position_fen=""), *t.decisions[1:]),
            ),
            replace(t, moves=("bad", *t.moves[1:])),
        ):
            self.assertEqual(assess(None, bad)["outcome"], "inconclusive")
        record = assess(ContinuationEngine(t), t)
        for field in ("logic_version", "trace_key", "material"):
            self.assertIsNone(evidence_outcome(t, {**record, field: "stale"}))

    def test_tactic_registration_persistence_and_branch_consensus(self):
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

        self.assertIn(motif.THEME, taxonomy_versions(candidate_type="tactic_candidate"))
        self.assertNotIn(
            motif.THEME, taxonomy_versions(candidate_type="checkmate_candidate")
        )
        f = PuzzleStorageLifecycleTest()
        f.setUp(themes=None)
        self.addCleanup(f.tearDown)
        t = trace()
        f.verify(
            result=f.result(
                branches=(
                    VerifiedBranch(
                        t.moves,
                        t.terminal,
                        decisions=t.decisions,
                        objective=t.objective,
                        endpoint=t.endpoint,
                    ),
                )
            )
        )
        row = f.current()
        current = {
            "candidate_id": row["id"],
            "current_verification_id": row["current_verification_id"],
            "pre_fen": setup_before(t)["pre_fen"],
            "played_move": setup_before(t)["setup_move"],
        }
        result, proofs = _evaluate_category(
            f.connection,
            current,
            (t,),
            TacticalClassifier(),
            motif.THEME,
            ContinuationEngine(t),
            None,
        )
        self.assertEqual(result, "match")
        self.assertTrue(
            _save_category(
                f.connection,
                current,
                motif.THEME,
                taxonomy_versions(candidate_type="tactic_candidate"),
                result,
                proofs,
            )
        )
        reused, _ = _evaluate_category(
            f.connection, current, (t,), TacticalClassifier(), motif.THEME, None, None
        )
        self.assertEqual(reused, "match")
        nonmatch = trace(moves=("c3d5", "f6d5", "d1d2"))
        result, _ = _evaluate_category(
            f.connection,
            current,
            (t, nonmatch),
            TacticalClassifier(),
            motif.THEME,
            None,
            None,
        )
        self.assertEqual(result, "conflict")

        # Exercise the normal worker query that supplies pre-setup metadata.
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            reclassify_canonical,
        )

        with f.connection:
            f.connection.execute(
                "UPDATE candidates SET candidate_type='tactic_candidate',pre_fen=?,played_move=?,position_fen=? WHERE id=?",
                (
                    current["pre_fen"],
                    current["played_move"],
                    t.decisions[0].position_fen,
                    row["id"],
                ),
            )
        self.assertEqual(reclassify_canonical(f.connection, f.key).status, "classified")

    def test_real_legal_nonmating_exchange(self):
        from tools.xiangqi_data.pikafish_rules import default_executable
        from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
        from tools.xiangqi_data.puzzle_mining.models import SearchContext

        if not default_executable().is_file():
            self.skipTest("local Pikafish required")
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            t = trace(mirror=mirror)
            for move, decision in zip(t.moves, t.decisions):
                self.assertIn(move, engine.inspect(decision.context).legal_moves)
            self.assertFalse(
                engine.inspect(SearchContext(t.terminal.fen, ())).terminal_win
            )
            self.assertTrue(inspect_exchange(t)["opening_exchange"])

    def test_reviewed_puzzles_with_native_depth_twenty_searches(self):
        from tools.xiangqi_data.pikafish_rules import default_executable
        from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
        from tools.xiangqi_data.puzzle_mining.models import (
            VerifiedDecision,
            VerifiedTrace,
            fen_side,
        )

        if not default_executable().is_file():
            self.skipTest("local Pikafish required")
        engine = OfflinePikafish(default_executable(), hash_mb=128)
        self.addCleanup(engine.close)
        cases = (
            (
                "gkXuH",
                "1rbak2r1/4a4/2n3n2/p3p1p2/2b5p/1N3R1C1/P3P1P1c/1c2C1N2/3R5/2BAKAB2 w - - 0 13",
                "b5d6",
                ("c8d6", "d2d6", "b3g3"),
                "key",
            ),
            (
                "dI8D9",
                "2bak4/4a4/4b1n2/p1P1c1R2/5r3/9/2N6/9/2C1K4/2BA1AB2 b - - 12 31",
                "f6g6",
                ("g7g6", "e8g6", "c7d7", "g6e8", "d7e7"),
                "not_key",
            ),
            (
                "yBBjN",
                "2baka3/9/4b4/8p/PC3rn2/6R1P/2P1P4/4B4/4A4/4KA3 b - - 25 48",
                "f6e6",
                ("b6g6", "e6g6", "g5g6"),
                "not_key",
            ),
            (
                "I9xJK",
                "2bak1b2/4a4/4c3n/p1r1C3p/9/5R3/P1n1P1P1P/2c1C4/4N4/3AKAB2 w - - 0 30",
                "e2c3",
                ("c4e3", "e7e3", "c7c3"),
                "not_key",
            ),
            (
                "mhlq6",
                "3akab2/7rc/2R1b1n2/p3pN1cp/3r5/2BN3RP/P3P4/5C3/4A4/4KAB2 b - - 11 23",
                "g8f6",
                ("d5f6", "d6f6", "h5h7"),
                "key",
            ),
            (
                "d9tpl",
                "3ak1Cr1/4a2r1/b5n2/p3p1N1p/3n2P2/2P6/P2Rc3P/N3C2c1/4A4/2BAK1BR1 b - - 3 17",
                "h3a3",
                ("h1h9", "h10h9", "d4d6"),
                "not_key",
            ),
            (
                "BAoCY",
                "1r1akab2/9/1cn1bc3/pRp1p3p/6p2/2PN3R1/P2rP1n1P/3CC1N2/4A4/2BAK1B2 w - - 4 12",
                "d5e7",
                ("g4e3", "g1e3", "c8e7"),
                "key",
            ),
        )
        for identifier, pre_fen, setup_move, moves, expected in cases:
            with self.subTest(puzzle=identifier):
                setup = {"pre_fen": pre_fen, "setup_move": setup_move}
                self.assertIn(
                    setup_move, engine.inspect(SearchContext(pre_fen, ())).legal_moves
                )
                state = FenState(pre_fen)
                state.push(setup_move)
                initial = puzzle_root_fen(state.fen())
                context = SearchContext(initial, ())
                decisions = []
                for move in moves:
                    status = engine.inspect(context)
                    self.assertIn(move, status.legal_moves)
                    decisions.append(
                        VerifiedDecision(
                            context,
                            fen_side(status.fen),
                            status.legal_moves,
                            move,
                            SearchResult(
                                "fixture", "fixture", move, (), search_depth=20
                            ),
                            position_fen=status.fen,
                        )
                    )
                    context = context.extend(move)
                t = VerifiedTrace(
                    moves,
                    engine.inspect(context),
                    tuple(decisions),
                    "advantage",
                    True,
                    TacticEndpoint("multiple_good_moves", 0.55, 0.5),
                )
                before = t.to_dict()
                record = assess(engine, t, **setup)
                self.assertEqual(record["outcome"], expected)
                self.assertEqual(evidence_outcome(t, record, **setup), expected)
                if "retention" in record:
                    self.assertEqual(record["retention"]["depth"], 20)
                if identifier in {"d9tpl", "I9xJK"}:
                    self.assertEqual(record["material"]["material_gain"], 0)
                if identifier == "BAoCY":
                    self.assertEqual(record["material"]["material_gain"], 3)
                self.assertEqual(t.to_dict(), before)

    def test_single_ply_cannot_be_an_exchange_even_without_old_decision_boards(self):
        t = trace(moves=("c3d5",))
        self.assertEqual(assess(None, replace(t, decisions=()))["outcome"], "not_key")
