"""Tactic construction boundaries, reverse forks and immutable publication evidence."""

import json
import sqlite3
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from tools.xiangqi_data.pikafish_rules import START_FEN, default_executable
from tools.xiangqi_data.puzzle_mining import (
    cannon_chariot_discovered,
    detonating_mine,
    exchange_material,
    fork,
)
from tools.xiangqi_data.puzzle_mining.classification_job import (
    reclassify_canonical,
    taxonomy_versions,
)
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
from tools.xiangqi_data.puzzle_mining.models import (
    CandidateRecord,
    EngineScore,
    PositionStatus,
    SearchContext,
    SearchLine,
    SearchResult,
    TacticEndpoint,
    VerifiedDecision,
    VerifiedTrace,
    fen_side,
)
from tools.xiangqi_data.puzzle_mining.position import (
    FenState,
    candidate_key,
    encode_position,
    position_hash,
)
from tools.xiangqi_data.puzzle_mining.solver import (
    SolutionRejected,
    SolutionReview,
    SolveResult,
    VerifiedBranch,
)
from tools.xiangqi_data.puzzle_mining.storage import insert_candidate, open_database
from tools.xiangqi_data.puzzle_mining.tactic_solver import (
    TacticSolverConfig,
    capture_preserves_advantage,
    solve_tactic,
)
from tools.xiangqi_data.puzzle_mining.verification import (
    TacticVerifierConfig,
)
from tools.xiangqi_data.puzzle_mining.verification_store import (
    claim_verification,
    seed_verification,
)


def score(value):
    # Draw mass permits exact expectations throughout [-1,1].
    amount = round(abs(value) * 1000)
    return EngineScore(
        "cp",
        round(value * 500),
        (amount, 1000 - amount, 0) if value >= 0 else (0, 1000 - amount, amount),
    )


def analysis(moves, values):
    return SearchResult(
        "test",
        "test",
        moves[0],
        tuple(
            SearchLine(i + 1, 20, 24, 100, 1, score(v), (move,))
            for i, (move, v) in enumerate(zip(moves, values))
        ),
    )


class LineEngine:
    def new_game(self):
        self.resets = getattr(self, "resets", 0) + 1

    engine_version = nnue = "test"
    moves = ("a4a5", "a7a6", "c4c5", "c7c6", "e4e5")

    def __init__(self, values=None, forced=()):
        self.values = values or [
            (0.9, 0.2),
            (-0.85, -0.86),
            (0.9, 0.2),
            (-0.85, -0.86),
            (0.9, 0.8),
        ]
        self.forced = forced
        self.calls = []

    def inspect(self, context):
        state = FenState(context.initial_fen)
        for move in context.moves:
            state.push(move)
        n = len(context.moves)
        moves = (
            (self.moves[n],)
            if n in self.forced
            else (self.moves[n], "b1c3" if n % 2 == 0 else "b10c8")
        )
        return PositionStatus(state.fen(), False, moves)

    def analyse(self, context, *, nodes=None, depth=None, multi_pv):
        self.calls.append((context, depth if depth is not None else nodes, multi_pv))
        return analysis(
            self.inspect(context).legal_moves[:multi_pv],
            self.values[len(context.moves)][:multi_pv],
        )


class TacticConstructionTests(unittest.TestCase):
    def solve(self, engine=None, **config):
        return solve_tactic(
            engine or LineEngine(),
            SearchContext(START_FEN, ()),
            "red",
            TacticSolverConfig(**config),
        )

    def test_best_defense_gap_does_not_stop_and_endpoint_is_retained(self):
        engine = LineEngine()
        result = self.solve(engine)
        self.assertEqual(result.primary.moves, engine.moves[:3])
        trace = result.canonical
        self.assertEqual(trace.endpoint.defense.selected_move, "c7c6")
        self.assertEqual(trace.endpoint.decision.context.moves, engine.moves[:4])
        self.assertTrue(capture_preserves_advantage(trace, 3))
        self.assertTrue(capture_preserves_advantage(trace, 1))
        self.assertEqual(VerifiedTrace.from_dict(trace.to_dict()), trace)
        self.assertEqual([c[2] for c in engine.calls], [2] * 5)
        self.assertEqual({c[1] for c in engine.calls}, {20})

    def test_gap_boundary_and_advantage_boundary(self):
        engine = LineEngine(values=[(0.75, 0.25), (-0.55, -0.7), (0.55, 0.55)])
        result = self.solve(engine)
        self.assertEqual(result.primary.moves, ("a4a5",))
        self.assertTrue(capture_preserves_advantage(result.canonical, 1))

    def test_ambiguous_start_and_ambiguous_unsatisfactory_end(self):
        for values, reason in [
            ([(0.9, 0.8)], "ambiguous_tactic_start"),
            ([(0.7, 0.3)], "ambiguous_tactic_continuation"),
        ]:
            with (
                self.subTest(reason=reason),
                self.assertRaisesRegex(SolutionRejected, reason),
            ):
                self.solve(LineEngine(values))

    def test_advantage_lost_under_best_defense_rejects(self):
        with self.assertRaisesRegex(SolutionRejected, "advantage_not_reproduced"):
            self.solve(LineEngine([(0.9, 0.2), (-0.3, -0.9)]))

    def test_forced_move_does_not_stop(self):
        engine = LineEngine(forced=(0, 2))
        self.assertEqual(len(self.solve(engine).primary.moves), 3)
        self.assertEqual([c[2] for c in engine.calls], [1, 2, 1, 2, 2])

    def test_length_limit_is_not_success_but_endpoint_lookahead_is_allowed(self):
        self.assertEqual(len(self.solve(max_solution_plies=3).primary.moves), 3)
        with self.assertRaisesRegex(SolutionReview, "length_limit"):
            self.solve(max_solution_plies=1)
        with self.assertRaisesRegex(SolutionReview, "position_limit"):
            self.solve(max_positions=4)

    def test_missing_wdl_and_bounded_results_are_inconclusive(self):
        from unittest.mock import patch

        for bad in (
            EngineScore("cp", 400),
            EngineScore("cp", 400, (900, 100, 0), "lower"),
        ):
            engine = LineEngine()
            original = engine.analyse

            def altered(context, original=original, bad=bad, **kwargs):
                r = original(context, **kwargs)
                return replace(r, lines=(replace(r.lines[0], score=bad), r.lines[1]))

            with (
                patch.object(engine, "analyse", side_effect=altered),
                self.assertRaises(SolutionReview),
            ):
                self.solve(engine)

    def test_invalid_configuration(self):
        for settings in (
            {"advantage": float("nan")},
            {"uniqueness_gap": 0},
            {"depth": 0},
        ):
            with self.assertRaises(ValueError):
                TacticSolverConfig(**settings)

    def test_verification_queues_are_disjoint(self):
        with tempfile.TemporaryDirectory() as root:
            db = open_database(Path(root) / "mining.db")
            self.addCleanup(db.close)
            for kind, played in (
                ("checkmate_candidate", "a4a5"),
                ("tactic_candidate", "c4c5"),
            ):
                state = FenState(START_FEN)
                state.push(played)
                insert_candidate(
                    db,
                    CandidateRecord(
                        kind,
                        "test",
                        kind,
                        "",
                        1,
                        "black",
                        START_FEN,
                        state.fen(),
                        position_hash(state.fen()),
                        played,
                        "c4c5",
                        score(0),
                        score(-0.9),
                        0.9,
                        kind,
                        "test",
                        "test",
                        {},
                    ),
                )
            self.assertEqual(seed_verification(db, "mate"), 1)
            self.assertEqual(
                seed_verification(db, "tactic", candidate_type="tactic_candidate"), 1
            )
            self.assertEqual(
                claim_verification(db, "mate").candidate.candidate_type,
                "checkmate_candidate",
            )
            self.assertEqual(
                claim_verification(db, "tactic").candidate.candidate_type,
                "tactic_candidate",
            )
            db.close()

    def test_local_schema_upgrade_preserves_proofs_without_database_copy(self):
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )

        fixture = PuzzleStorageLifecycleTest()
        fixture.setUp()
        self.addCleanup(fixture.tearDown)
        fixture.verify()
        fixture.classify()
        db = fixture.connection
        before = tuple(
            db.execute(
                "SELECT branches_json,solution_json FROM candidate_assessments"
            ).fetchone()
        )
        with db:
            db.execute("UPDATE metadata SET value='15' WHERE key='schema_version'")
        db.close()
        fixture.connection = db = open_database(fixture.path)
        self.assertNotIn(
            "solution_plies",
            {r[1] for r in db.execute("PRAGMA table_info(taxonomy_assessments)")},
        )
        self.assertEqual(
            tuple(
                db.execute(
                    "SELECT branches_json,solution_json FROM candidate_assessments"
                ).fetchone()
            ),
            before,
        )
        self.assertEqual(list(fixture.path.parent.glob("*.pre-v*.sqlite3")), [])


def fen(pieces, turn="w"):
    return f"{encode_position(pieces)} {turn} - - 0 1"


@unittest.skipUnless(default_executable().is_file(), "Pikafish not installed")
class ReverseForkTests(unittest.TestCase):
    def setUp(self):
        self.engine = OfflinePikafish(default_executable())
        self.addCleanup(self.engine.close)

    def trace(self, initial, moves, defense=None):
        context = SearchContext(initial, ())
        decisions = []
        for move in moves:
            status = self.engine.inspect(context)
            self.assertIn(move, status.legal_moves, (status.fen, move))
            choices = [move] + [m for m in status.legal_moves if m != move][:1]
            values = (
                (0.9, 0.2)
                if fen_side(status.fen) == fen_side(initial)
                else (-0.85, -0.9)
            )
            decisions.append(
                VerifiedDecision(
                    context,
                    fen_side(status.fen),
                    status.legal_moves,
                    move,
                    analysis(choices, values),
                    position_fen=status.fen,
                )
            )
            context = context.extend(move)
        terminal = self.engine.inspect(context)
        if terminal.terminal_win:
            endpoint = TacticEndpoint("terminal_win", 0.55, 0.5)
        else:
            defense = defense or terminal.legal_moves[0]
            self.assertIn(defense, terminal.legal_moves)
            d = VerifiedDecision(
                context,
                fen_side(terminal.fen),
                terminal.legal_moves,
                defense,
                analysis([defense], [-0.85]),
                position_fen=terminal.fen,
            )
            following = self.engine.inspect(context.extend(defense))
            self.assertGreaterEqual(len(following.legal_moves), 2)
            decision = VerifiedDecision(
                context.extend(defense),
                fen_side(following.fen),
                following.legal_moves,
                following.legal_moves[0],
                analysis(following.legal_moves[:2], [0.9, 0.85]),
                position_fen=following.fen,
            )
            endpoint = TacticEndpoint("multiple_good_moves", 0.55, 0.5, d, decision)
        return VerifiedTrace(
            tuple(moves), terminal, tuple(decisions), "advantage", True, endpoint
        )

    def pawn_fork(self):
        return self.trace(
            fen(
                {
                    "e1": "K",
                    "e10": "k",
                    "e5": "P",
                    "f5": "P",
                    "e6": "r",
                    "g6": "c",
                    "c7": "n",
                    "h8": "n",
                }
            ),
            ["f5f6", "e6e7", "f6g6"],
            "h8g6",
        )

    def test_pawn_forks_two_defended_more_valuable_pieces(self):
        trace = self.pawn_fork()
        record = fork.assess(self.engine, trace)
        self.assertEqual(record["outcome"], "key")
        self.assertNotIn("solution_plies", record)
        self.assertEqual(record["saved_targets"], [{"before": "e6", "after": "e7"}])
        self.assertEqual(fork.evidence_outcome(trace, record), "key")
        self.assertIsNone(
            fork.evidence_outcome(
                replace(trace, endpoint=replace(trace.endpoint, advantage=0.99)), record
            )
        )

    def test_checking_horse_fork_general_move_and_horse_leg_block(self):
        base = {"e1": "K", "e10": "k", "e5": "p", "c6": "N", "f9": "r"}
        for pieces, response, defense in [
            (base, "e10f10", "f10e10"),
            ({**base, "a9": "r"}, "a9d9", "d9f9"),
        ]:
            with self.subTest(response=response):
                record = fork.assess(
                    self.engine,
                    self.trace(fen(pieces), ["c6d8", response, "d8f9"], defense),
                )
                self.assertEqual(record["outcome"], "key")
                self.assertEqual(record["saved_targets"][0]["before"], "e10")

    def test_cannon_target_saved_by_adding_second_screen(self):
        trace = self.trace(
            fen(
                {
                    "d1": "K",
                    "f10": "k",
                    "e4": "C",
                    "a5": "r",
                    "i5": "r",
                    "c5": "P",
                    "g5": "p",
                    "h8": "r",
                }
            ),
            ["e4e5", "h8h5", "e5a5"],
            "i5i6",
        )
        record = fork.assess(self.engine, trace)
        self.assertEqual(record["outcome"], "key")
        self.assertIn({"before": "i5", "after": "i5"}, record["saved_targets"])

    def test_undefended_lower_value_targets(self):
        trace = self.trace(
            fen({"d1": "K", "f10": "k", "d5": "R", "e8": "n", "h5": "c"}),
            ["d5e5", "h5h7", "e5e8"],
        )
        self.assertEqual(fork.assess(self.engine, trace)["outcome"], "key")

    def test_both_colors(self):
        red = self.pawn_fork()

        def rotate(s):
            return chr(ord("i") - (ord(s[0]) - ord("a"))) + str(11 - int(s[1:]))

        pieces = FenState(red.decisions[0].position_fen).position
        initial = fen({rotate(s): p.swapcase() for s, p in pieces.items()}, "b")
        moves = ["".join(rotate(s) for s in fork.squares(move)) for move in red.moves]
        defense = "".join(
            rotate(s) for s in fork.squares(red.endpoint.defense.selected_move)
        )
        self.assertEqual(
            fork.assess(self.engine, self.trace(initial, moves, defense))["outcome"],
            "key",
        )

    def test_opening_fork_requires_a_player_creation_move(self):
        original = self.pawn_fork()
        trace = self.trace(
            original.decisions[2].position_fen, [original.moves[2]], "h8g6"
        )
        self.assertEqual(fork.assess(self.engine, trace)["outcome"], "not_key")

    def test_old_evidence_and_earlier_payoff_cannot_authorize_publication(self):
        trace = self.pawn_fork()
        record = fork.assess(self.engine, trace)
        self.assertIsNone(
            fork.evidence_outcome(trace, {**record, "logic_version": "1"})
        )
        extended = self.trace(
            trace.decisions[0].position_fen, [*trace.moves, "h8g6", "e1d1"]
        )
        self.assertIsNone(
            fork.evidence_outcome(
                extended, {**record, "trace_key": fork.trace_key(extended)}
            )
        )

    def test_incidental_fork_before_the_verified_endpoint_is_rejected(self):
        original = self.pawn_fork()
        trace = self.trace(
            original.decisions[0].position_fen, [*original.moves, "h8g6", "e1d1"]
        )
        self.assertTrue(capture_preserves_advantage(trace, 3))
        self.assertEqual(fork.assess(self.engine, trace)["outcome"], "not_key")

    def test_stationary_cannon_fork_can_be_created_by_a_new_screen(self):
        pieces = {
            "d1": "K",
            "f10": "k",
            "e5": "C",
            "a5": "r",
            "i5": "r",
            "c4": "P",
            "g5": "p",
        }
        trace = self.trace(fen(pieces), ["c4c5", "i5i6", "e5a5"])
        record = fork.assess(self.engine, trace)
        self.assertEqual(record["outcome"], "key")
        self.assertEqual(record["attacker_before"], "e5")
        self.assertEqual(record["attacker"], "e5")

    def test_quiet_move_does_not_qualify_an_existing_fork(self):
        trace = self.trace(
            fen(
                {
                    "d1": "K",
                    "f10": "k",
                    "e5": "C",
                    "a5": "r",
                    "i5": "r",
                    "c5": "P",
                    "g5": "p",
                }
            ),
            ["d1d2", "i5i6", "e5a5"],
        )
        record = fork.assess(self.engine, trace)
        self.assertEqual(record["outcome"], "not_key")
        self.assertEqual(record["reason"], "payoff_already_available")

    def test_equal_value_defended_targets_and_still_attacked_target_do_not_qualify(
        self,
    ):
        inspector = fork.ThreatInspector(self.engine)
        state = FenState(fen({"d1": "K", "f10": "k", "e5": "R", "a5": "r", "i5": "r"}))
        # Either capture allows the other rook to recapture along the cleared rank.
        self.assertFalse(inspector.qualifies(state, "e5", "a5"))
        self.assertFalse(inspector.qualifies(state, "e5", "i5"))
        trace = self.trace(
            fen({"d1": "K", "f10": "k", "d5": "R", "e8": "n", "h5": "c"}),
            ["d5e5", "h5i5", "e5e8"],
        )
        self.assertEqual(fork.assess(self.engine, trace)["outcome"], "not_key")

    def test_blocked_and_pinned_attackers_are_not_capture_threats(self):
        inspector = fork.ThreatInspector(self.engine)
        blocked = FenState(
            fen({"e1": "K", "e10": "k", "e5": "P", "d8": "N", "e8": "p", "f9": "r"})
        )
        self.assertFalse(inspector.qualifies(blocked, "d8", "f9"))
        pinned = FenState(fen({"e1": "K", "e10": "k", "e5": "N", "g6": "r"}))
        self.assertFalse(inspector.qualifies(pinned, "e5", "g6"))

    def test_endpoint_requires_advantage_against_best_defense(self):
        trace = self.pawn_fork()
        defense = replace(
            trace.endpoint.defense,
            analysis=analysis(trace.endpoint.defense.legal_moves[:2], [-0.3, -0.9]),
        )
        # Preserve the selected best move while weakening its solver-side score.
        defense = replace(defense, selected_move=defense.analysis.best_move)
        trace = replace(trace, endpoint=replace(trace.endpoint, defense=defense))
        self.assertEqual(fork.assess(self.engine, trace)["outcome"], "not_key")

    def test_reported_puzzle_regressions(self):
        cases = [
            (
                "B9x1F",
                "4kab2/4aC3/3c4c/2R5p/9/2p3p2/P3r3P/9/4C4/2BAKAB2 w - - 0 1",
                ("c7c10", "d8d10", "c10c5"),
                "d10d8",
                "not_key",
            ),
            (
                "syEq4",
                "2baka1n1/9/8b/2p1p4/r1c3p1p/6P2/P3N3P/1C2Br1C1/9/R2AK2R1 b - - 0 1",
                ("f3e3",),
                "d1e2",
                "not_key",
            ),
            (
                "4970A",
                "r1bakabnr/9/2n4c1/p3p3p/2p3p2/9/PcP1P3P/1CN3C2/9/R1BAKABNR w - - 0 1",
                ("g3g10", "f10e9", "g10i10"),
                "h10f9",
                "key",
            ),
            (
                "kJXKF",
                "2bak1b2/4a4/5rC2/p3p3p/2p3p2/4P4/P1c4RP/4B4/2r1A4/3CKAB1R b - - 0 1",
                ("f8g8",),
                "i1h1",
                "not_key",
            ),
            (
                "eYLEo",
                "4k1b2/4a4/4ba3/5P3/4n4/5N3/4c4/2p1BA1p1/C3A4/2B1K4 b - - 0 1",
                ("e6g5", "e1d1", "g5f7"),
                "a2a7",
                "key",
            ),
            (
                "tb3yi",
                "2bakab2/r8/2n1c1n1c/p5p1p/2p1pN3/7C1/P1r5P/2N1C4/5R3/1RBAKA3 w - - 0 1",
                ("f6g8",),
                "d10e9",
                "not_key",
            ),
            (
                "FMYwW",
                "2r1kabr1/4a4/2n1b1n2/pNRCp1p1p/4c4/2p3P2/P7P/4C2c1/2N1A4/2B1KABR1 w - - 0 1",
                ("c7c5",),
                "h10h4",
                "not_key",
            ),
        ]
        for identifier, initial, moves, defense, expected in cases:
            with self.subTest(puzzle=identifier):
                trace = self.trace(initial, moves, defense)
                record = fork.assess(self.engine, trace)
                self.assertEqual(record["outcome"], expected)
                if expected == "key":
                    self.assertNotIn("solution_plies", record)

    def test_publication_uses_tactic_theme_and_retains_raw_evidence(self):
        trace = self.pawn_fork()
        # The setup move brings black's cannon to g6; red then delivers the fork.
        pieces = FenState(trace.decisions[0].position_fen).position
        pieces["g7"] = pieces.pop("g6")
        pre = fen(pieces, "b")
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / "source.db"
            source_db = sqlite3.connect(source)
            source_db.execute(
                "CREATE TABLE games(id TEXT PRIMARY KEY,initial_fen TEXT,moves TEXT,red_name TEXT,black_name TEXT,red_rating INTEGER,black_rating INTEGER,event TEXT,source_url TEXT)"
            )
            source_db.execute(
                "INSERT INTO games VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    "fork-game",
                    pre,
                    json.dumps(["g7g6", *trace.moves]),
                    "Red",
                    "Black",
                    None,
                    None,
                    "Fixture",
                    "",
                ),
            )
            source_db.commit()
            source_db.close()
            db = open_database(Path(root) / "mining.db")
            try:
                key = candidate_key(trace.decisions[0].position_fen, ("g7g6",), pre)
                insert_candidate(
                    db,
                    CandidateRecord(
                        key,
                        "test",
                        "fork-game",
                        "",
                        1,
                        "red",
                        pre,
                        trace.decisions[0].position_fen,
                        position_hash(trace.decisions[0].position_fen),
                        "g7g6",
                        "e10d10",
                        score(0),
                        score(-0.9),
                        0.9,
                        "tactic_candidate",
                        "test",
                        "test",
                        {},
                    ),
                )
                config = TacticVerifierConfig()
                seed_verification(db, "tactic", candidate_type="tactic_candidate")
                claim = claim_verification(db, "tactic")
                result = SolveResult(
                    (
                        VerifiedBranch(
                            trace.moves,
                            trace.terminal,
                            trace.decisions,
                            trace.objective,
                            trace.endpoint,
                        ),
                    ),
                    "test",
                    "test",
                    100,
                    20,
                    complete=True,
                )
                from unittest.mock import patch

                from tools.xiangqi_data.puzzle_mining.verification import (
                    verify_candidate,
                )

                with (
                    patch(
                        "tools.xiangqi_data.puzzle_mining.verification.solve_tactic",
                        return_value=result,
                    ) as solve,
                    patch(
                        "tools.xiangqi_data.puzzle_mining.verification.solve_checkmate"
                    ) as mate,
                ):
                    self.assertEqual(
                        verify_candidate(db, self.engine, claim, source, config)[0],
                        "complete",
                    )
                    solve.assert_called_once()
                    mate.assert_not_called()
                before = db.execute(
                    "SELECT branches_json,solution_json FROM candidate_assessments"
                ).fetchone()
                # Double-attack detection is switched off by default; this
                # pipeline test exercises the category explicitly.
                with patch(
                    "tools.xiangqi_data.puzzle_mining.classification_job.DOUBLE_ATTACK_DETECTION_ENABLED",
                    True,
                ):
                    self.assertEqual(
                        reclassify_canonical(db, key).status,
                        "awaiting_classification_evidence",
                    )
                    assessment = reclassify_canonical(db, key, engine=self.engine)
                    self.assertEqual(assessment.status, "classified")
                p = db.execute(
                    "SELECT * FROM puzzles WHERE verification_status='active'"
                ).fetchone()
                self.assertEqual(json.loads(p["themes"]), [fork.THEME])
                self.assertIsNone(p["mate_in"])
                self.assertEqual(json.loads(p["solution"]), list(trace.moves))
                self.assertEqual(
                    tuple(before),
                    tuple(
                        db.execute(
                            "SELECT branches_json,solution_json FROM candidate_assessments"
                        ).fetchone()
                    ),
                )
                self.assertEqual(
                    reclassify_canonical(db, key).status, "already_current"
                )
                self.assertEqual(
                    taxonomy_versions(candidate_type="tactic_candidate"),
                    {
                        fork.THEME: fork.VERSION,
                        exchange_material.THEME: exchange_material.VERSION,
                        cannon_chariot_discovered.THEME: (
                            cannon_chariot_discovered.VERSION
                        ),
                        detonating_mine.THEME: detonating_mine.VERSION,
                        "__consensus__": "2",
                    },
                )
                from tools.puzzle_catalog.authoring import admit_candidate
                from tools.puzzle_catalog.catalog import PuzzleCatalog

                with PuzzleCatalog(Path(root) / "catalog.db") as catalog:
                    catalog._set_meta("baseline", [])
                    catalog.db.commit()
                    self.assertEqual(
                        admit_candidate(
                            catalog, Path(root) / "mining.db", p["id"], source
                        ),
                        p["id"],
                    )
                    release = catalog.build_release(source_catalog_digest="a" * 64)
                    self.assertEqual(release["puzzles"][0]["themes"], [fork.THEME])
                    self.assertEqual(
                        release["puzzles"][0]["line"].split(),
                        ["g7g6", *trace.moves],
                    )
            finally:
                db.close()


if __name__ == "__main__":
    unittest.main()
