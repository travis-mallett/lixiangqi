import unittest
import json
import tempfile
from contextlib import closing
from unittest.mock import patch
from pathlib import Path

from tools.xiangqi_data.puzzle_mining.classification import (
    MotifRegistry,
    TacticalClassifier,
    classify_tactical_candidate,
    reclassify_stored_trace,
)
from tools.xiangqi_data.puzzle_mining.models import PositionStatus, VerifiedTrace
from tools.xiangqi_data.puzzle_mining.models import (
    CandidateRecord,
    EngineScore,
    SearchContext,
    SearchLine,
    SearchResult,
)
from tools.xiangqi_data.puzzle_mining.storage import (
    insert_candidate,
    open_database,
)
from tools.xiangqi_data.puzzle_mining.solver import (
    SolutionReview,
    SolutionRejected,
    SolverConfig,
    solve_checkmate,
)
from tools.xiangqi_data.puzzle_mining.engine import (
    IncompleteSearchError,
)
from tools.xiangqi_data.puzzle_mining.patterns import THEME_LOGIC_VERSIONS
from tools.xiangqi_data.pikafish_rules import START_FEN


def trace(*, checkmate: bool) -> VerifiedTrace:
    return VerifiedTrace(
        moves=("a2a3",),
        terminal=PositionStatus(
            "3k5/9/9/9/9/9/9/9/9/5K3 b - - 0 1" if checkmate else START_FEN,
            checkmate,
            ("b2b3",) if not checkmate else (),
        ),
        objective="mate" if checkmate else "tactic",
        verified=True,
    )


class TacticalClassifierTest(unittest.TestCase):
    def test_force_reclassification_is_explicit(self):
        from tools.xiangqi_data.puzzle_mining.checkmate import parse_args

        with patch("sys.argv", ["categorize", "--force-reclassify-same-version"]):
            self.assertTrue(parse_args().force_reclassify_same_version)

    def test_empty_registry_is_ready_but_does_not_claim_a_tactic(self) -> None:
        classifier = TacticalClassifier(MotifRegistry())
        self.assertEqual(
            classifier.classify(trace(checkmate=True)).status, "awaiting_logic"
        )
        self.assertEqual(classify_tactical_candidate().status, "awaiting_verifier")

    def test_registered_detector_receives_mating_and_nonmating_traces(self) -> None:
        seen: list[bool] = []
        registry = MotifRegistry()

        def detector(candidate: VerifiedTrace) -> bool:
            seen.append(candidate.checkmate)
            return True

        registry.register("syntheticMotif", detector)
        classifier = TacticalClassifier(registry)
        self.assertEqual(
            classifier.classify(trace(checkmate=True)).themes, ("syntheticMotif",)
        )
        self.assertEqual(
            classifier.classify(trace(checkmate=False)).themes, ("syntheticMotif",)
        )
        self.assertEqual(seen, [True, False])

    def test_reclassifies_only_persisted_verified_evidence(self) -> None:
        self.assertEqual(reclassify_stored_trace(None).status, "awaiting_verifier")
        raw = trace(checkmate=True).to_dict()
        raw["verified"] = False
        self.assertEqual(reclassify_stored_trace(raw).status, "awaiting_verifier")
        registry = MotifRegistry()
        registry.register("stored", lambda _trace: True)
        self.assertEqual(
            reclassify_stored_trace(
                trace(checkmate=True).to_dict(), registry=registry
            ).themes,
            ("stored",),
        )

    @patch("tools.xiangqi_data.puzzle_mining.classification.THEME_LOGIC_VERSIONS", {})
    def test_canonical_reclassification_persists_themes_without_changing_line(
        self,
    ) -> None:
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            reclassify_canonical,
        )

        with (
            tempfile.TemporaryDirectory() as directory,
            closing(open_database(Path(directory) / "puzzles.sqlite3")) as connection,
        ):
            candidate = CandidateRecord(
                candidate_key="k",
                source_database="source",
                game_id="g",
                source_url="",
                ply=1,
                side_to_move="red",
                pre_fen=START_FEN,
                position_fen=START_FEN,
                position_hash="h",
                played_move="a2a3",
                best_move="a2a4",
                before_score=EngineScore("cp", 0, (500, 0, 500)),
                after_score=EngineScore("cp", -100, (400, 0, 600)),
                evaluation_loss=0.1,
                candidate_type="checkmate_candidate",
                engine_version="e",
                nnue="n",
                search_settings={},
            )
            insert_candidate(connection, candidate)
            candidate_id = connection.execute(
                "SELECT id FROM candidates WHERE candidate_key = 'k'"
            ).fetchone()[0]
            stored = json.dumps([{"verification": trace(checkmate=True).to_dict()}])
            connection.execute(
                """
                INSERT INTO candidate_assessments(coverage,
                  candidate_id, revision_key, status, solution_json, solution_plies,
                  branches_json, themes_json, verified_engine_version, verified_nnue,
                  verification_settings_json, engine_nodes, engine_depth,
                  accepted, created_at
                ) VALUES ('complete',?, 'rev', 'published', '[\"a2a3\"]', 1, ?, '[]',
                          'e', 'n', '{"history_policy":"isolated-root-v1"}', 10, 2, 1, 'now')
                """,
                (candidate_id, stored),
            )
            assessment_id = connection.execute(
                "SELECT id FROM candidate_assessments WHERE candidate_id = ?",
                (candidate_id,),
            ).fetchone()[0]
            connection.execute(
                """
                INSERT INTO puzzles(
                  id, candidate_id, game_id, source_url, fen, display_fen, initial_ply,
                  line, solution, solution_plies, themes, engine, nnue, engine_nodes,
                  engine_depth, generator_version, created_at, canonical_assessment_id
                ) VALUES ('p1', ?, 'g', '', ?, ?, 1, '[\"a2a3\"]', '[\"a2a3\"]',
                          1, '[]', 'e', 'n', 10, 2, 2, 'now', ?)
                """,
                (candidate_id, START_FEN, START_FEN, assessment_id),
            )
            connection.execute("SELECT 1")
            connection.execute(
                "UPDATE candidates SET current_verification_id=(SELECT canonical_assessment_id FROM puzzles WHERE candidate_id=candidates.id AND verification_status='active'), current_classification_id=(SELECT taxonomy_assessment_id FROM puzzles WHERE candidate_id=candidates.id AND verification_status='active') WHERE current_verification_id IS NULL"
            )
            connection.commit()
            registry = MotifRegistry()
            motif_enabled = [True]
            registry.register("stored", lambda _trace: motif_enabled[0])
            result = reclassify_canonical(connection, "k", registry=registry)
            self.assertEqual(result.themes, ("mate", "mateIn1", "stored"))
            live = connection.execute(
                "SELECT * FROM puzzles WHERE verification_status='active'"
            ).fetchone()
            self.assertNotEqual(live["id"], "p1")
            self.assertEqual(json.loads(live["solution"]), ["a2a3"])
            self.assertEqual(
                connection.execute(
                    "SELECT verification_status FROM puzzles WHERE id='p1'"
                ).fetchone()[0],
                "withdrawn",
            )
            repeated = reclassify_canonical(connection, "k", registry=registry)
            self.assertFalse(repeated.changed)
            motif_enabled[0] = False
            forced = reclassify_canonical(
                connection, "k", registry=registry, force=True
            )
            self.assertEqual(forced.themes, ())
            self.assertEqual(
                connection.execute(
                    "SELECT count(*) FROM puzzles WHERE verification_status='active'"
                ).fetchone()[0],
                1,
            )
            self.assertEqual(
                connection.execute(
                    "SELECT count(*) FROM candidate_assessments"
                ).fetchone()[0],
                1,
            )
            self.assertEqual(
                connection.execute(
                    "SELECT count(*) FROM taxonomy_assessments"
                ).fetchone()[0],
                2,
            )

    def test_new_theme_reclassifies_persisted_centroid_version_once(self) -> None:
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            reclassify_canonical,
        )

        with (
            tempfile.TemporaryDirectory() as directory,
            closing(open_database(Path(directory) / "puzzles.sqlite3")) as connection,
        ):
            candidate = CandidateRecord(
                candidate_key="persisted-octagonal",
                source_database="source",
                game_id="g",
                source_url="",
                ply=1,
                side_to_move="red",
                pre_fen=START_FEN,
                position_fen=START_FEN,
                position_hash="h",
                played_move="a2a3",
                best_move="a2a4",
                before_score=EngineScore("cp", 0, (500, 0, 500)),
                after_score=EngineScore("cp", -100, (400, 0, 600)),
                evaluation_loss=0.1,
                candidate_type="checkmate_candidate",
                engine_version="e",
                nnue="n",
                search_settings={},
            )
            insert_candidate(connection, candidate)
            candidate_id = connection.execute(
                "SELECT id FROM candidates WHERE candidate_key = 'persisted-octagonal'"
            ).fetchone()[0]
            octagonal_terminal = PositionStatus(
                "3a1k3/4aP3/3N5/9/9/6r2/9/9/9/4K4 b - - 0 1",
                True,
                (),
            )
            octagonal_trace = VerifiedTrace(
                moves=("a2a3",),
                terminal=octagonal_terminal,
                verified=True,
            )
            stored = json.dumps([{"verification": octagonal_trace.to_dict()}])
            connection.execute(
                """
                INSERT INTO candidate_assessments(coverage,
                  candidate_id, revision_key, status, solution_json, solution_plies,
                  branches_json, themes_json, verified_engine_version, verified_nnue,
                  verification_settings_json, engine_nodes, engine_depth,
                  accepted, created_at
                ) VALUES ('complete',?, 'rev', 'published', '[\"a2a3\"]', 1, ?, '[]',
                          'e', 'n', '{"history_policy":"isolated-root-v1"}', 10, 2, 1, 'now')
                """,
                (candidate_id, stored),
            )
            assessment_id = connection.execute(
                "SELECT id FROM candidate_assessments WHERE candidate_id = ?",
                (candidate_id,),
            ).fetchone()[0]
            taxonomy = connection.execute(
                """
                INSERT INTO taxonomy_assessments(
                    candidate_id, verification_assessment_id, taxonomy_version,
                    status, themes_json, created_at
                ) VALUES (?, ?, ?, 'classified', '[\"centroidPawnMate\"]', 'now')
                """,
                (
                    candidate_id,
                    assessment_id,
                    '{"versions":{"centroidPawnMate":"1.1"}}',
                ),
            )
            taxonomy_id = taxonomy.lastrowid
            connection.execute(
                """
                INSERT INTO puzzles(
                  id, candidate_id, game_id, source_url, fen, display_fen, initial_ply,
                  line, solution, solution_plies, themes, engine, nnue, engine_nodes,
                  engine_depth, generator_version, created_at, canonical_assessment_id,
                  taxonomy_assessment_id, verification_status
                ) VALUES ('oct01', ?, 'g', '', ?, ?, 1, '[\"a2a3\"]', '[\"a2a3\"]',
                          1, '[\"centroidPawnMate\",\"unrelated\"]', 'e', 'n', 10, 2, 2, 'now', ?, ?, 'active')
                """,
                (candidate_id, START_FEN, START_FEN, assessment_id, taxonomy_id),
            )
            connection.execute(
                "UPDATE candidates SET current_verification_id=(SELECT canonical_assessment_id FROM puzzles WHERE candidate_id=candidates.id AND verification_status='active'), current_classification_id=(SELECT taxonomy_assessment_id FROM puzzles WHERE candidate_id=candidates.id AND verification_status='active') WHERE current_verification_id IS NULL"
            )
            connection.commit()

            first = reclassify_canonical(
                connection,
                "persisted-octagonal",
                selected_themes={"octagonalHorse"},
            )
            self.assertEqual(first.status, "awaiting_classification_evidence")
            second = reclassify_canonical(
                connection,
                "persisted-octagonal",
                selected_themes={"octagonalHorse"},
            )
            self.assertEqual(second.status, "awaiting_classification_evidence")

    @patch(
        "tools.xiangqi_data.puzzle_mining.classification.THEME_LOGIC_VERSIONS",
        {"octagonalHorse": THEME_LOGIC_VERSIONS["octagonalHorse"]},
    )
    def test_canonical_reclassification_verifies_old_geometry_without_replacing_line(
        self,
    ) -> None:
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            reclassify_canonical,
        )
        from tools.xiangqi_data.puzzle_mining.patterns import (
            TerminalPosition,
            octagonal_horse_removed_fens,
        )

        with (
            tempfile.TemporaryDirectory() as directory,
            closing(open_database(Path(directory) / "puzzles.sqlite3")) as connection,
        ):
            candidate = CandidateRecord(
                candidate_key="old-geometry",
                source_database="source",
                game_id="g",
                source_url="",
                ply=1,
                side_to_move="red",
                pre_fen=START_FEN,
                position_fen=START_FEN,
                position_hash="h",
                played_move="a2a3",
                best_move="a2a4",
                before_score=EngineScore("cp", 0, (500, 0, 500)),
                after_score=EngineScore("cp", -100, (400, 0, 600)),
                evaluation_loss=0.1,
                candidate_type="checkmate_candidate",
                engine_version="e",
                nnue="n",
                search_settings={},
            )
            insert_candidate(connection, candidate)
            candidate_id = connection.execute(
                "SELECT id FROM candidates WHERE candidate_key = 'old-geometry'"
            ).fetchone()[0]
            terminal = PositionStatus(
                "3a1k3/4aP3/3N5/9/9/6r2/9/9/9/4K4 b - - 0 1",
                True,
                (),
            )
            stored = json.dumps(
                [
                    {
                        "verification": VerifiedTrace(
                            moves=("a2a3",),
                            terminal=terminal,
                            verified=True,
                        ).to_dict(),
                    }
                ]
            )
            connection.execute(
                """
                INSERT INTO candidate_assessments(coverage,
                  candidate_id, revision_key, status, solution_json, solution_plies,
                  branches_json, themes_json, verified_engine_version, verified_nnue,
                  verification_settings_json, engine_nodes, engine_depth,
                  accepted, created_at
                ) VALUES ('complete',?, 'rev', 'published', '[\"a2a3\"]', 1, ?, '[]',
                          'e', 'n', '{"history_policy":"isolated-root-v1"}', 10, 2, 1, 'now')
                """,
                (candidate_id, stored),
            )
            assessment_id = connection.execute(
                "SELECT id FROM candidate_assessments WHERE candidate_id = ?",
                (candidate_id,),
            ).fetchone()[0]
            connection.execute(
                """
                INSERT INTO puzzles(
                  id, candidate_id, game_id, source_url, fen, display_fen, initial_ply,
                  line, solution, solution_plies, themes, engine, nnue, engine_nodes,
                  engine_depth, generator_version, created_at, canonical_assessment_id, verification_status
                ) VALUES ('old01', ?, 'g', '', ?, ?, 1, '[\"a2a3\"]', '[\"a2a3\"]',
                          1, '[\"unrelated\"]', 'e', 'n', 10, 2, 2, 'now', ?, 'active')
                """,
                (candidate_id, START_FEN, START_FEN, assessment_id),
            )
            connection.execute(
                "UPDATE candidates SET current_verification_id=(SELECT canonical_assessment_id FROM puzzles WHERE candidate_id=candidates.id AND verification_status='active'), current_classification_id=(SELECT taxonomy_assessment_id FROM puzzles WHERE candidate_id=candidates.id AND verification_status='active') WHERE current_verification_id IS NULL"
            )
            connection.commit()

            removed = octagonal_horse_removed_fens(
                TerminalPosition(terminal.fen, True, "black")
            )[0][1]

            class CanonicalRemovalEngine:
                def new_game(self):
                    self.resets = getattr(self, "resets", 0) + 1

                engine_version = "test-engine"
                nnue = "test-nnue"

                def __init__(self) -> None:
                    self.inspect_calls: list[str] = []

                def checking_pieces(self, context: SearchContext):
                    return context.initial_fen, ()

                def inspect(self, context: SearchContext) -> PositionStatus:
                    self.inspect_calls.append(context.initial_fen)
                    self.assert_context = context
                    return PositionStatus(removed, False, ("f10e10", "f10f9"))

                def analyse(
                    self, context: SearchContext, *, nodes: int, multi_pv: int
                ) -> SearchResult:
                    return SearchResult(
                        "test-engine",
                        "test-nnue",
                        "f10f9",
                        (
                            SearchLine(
                                1, 8, 8, nodes, 1, EngineScore("mate", 1), ("f10f9",)
                            ),
                        ),
                    )

            engine = CanonicalRemovalEngine()
            result = reclassify_canonical(
                connection,
                "old-geometry",
                engine=engine,
                removal_nodes=100,
                selected_themes={"octagonalHorse"},
            )
            self.assertEqual(result.status, "classified")
            self.assertIn("octagonalHorse", result.themes)
            self.assertEqual(engine.inspect_calls, [removed])
            puzzle = connection.execute(
                "SELECT line, canonical_assessment_id FROM puzzles WHERE id = 'old01'"
            ).fetchone()
            self.assertEqual(puzzle["line"], '["a2a3"]')
            self.assertEqual(puzzle["canonical_assessment_id"], assessment_id)
            self.assertEqual(
                connection.execute(
                    "SELECT count(*) FROM candidate_assessments"
                ).fetchone()[0],
                1,
            )
            self.assertEqual(
                connection.execute(
                    "SELECT count(*) FROM motif_removal_evidence WHERE theme='octagonalHorse'"
                ).fetchone()[0],
                1,
            )


def search_result(
    score: EngineScore, moves: tuple[str, ...], count: int = 1
) -> SearchResult:
    lines = tuple(
        SearchLine(i + 1, 10, 12, 100, 1, score, (move,))
        for i, move in enumerate(moves[:count])
    )
    return SearchResult("test", "test.nnue", moves[0], lines)


class SyntheticVerifier:
    engine_version = "test"
    nnue = "test.nnue"

    def __init__(self, defenses: tuple[str, ...] = ("d1",)) -> None:
        self.defenses = defenses
        self.calls: list[int] = []

    def inspect(self, context: SearchContext) -> PositionStatus:
        if len(context.moves) == 0:
            return PositionStatus(START_FEN, False, ("a1",))
        if len(context.moves) == 1:
            return PositionStatus(START_FEN.replace(" w ", " b "), False, self.defenses)
        if len(context.moves) == 2:
            return PositionStatus(START_FEN, False, ("x",))
        return PositionStatus("4k4/4P4/9/9/9/9/9/9/9/4K4 b - - 0 1", True, ())

    def analyse(
        self, context: SearchContext, *, nodes=None, depth=None, multi_pv: int
    ) -> SearchResult:
        self.calls.append(multi_pv)
        if len(context.moves) == 0:
            return search_result(EngineScore("mate", 2), ("a1",))
        if len(context.moves) == 2:
            return search_result(EngineScore("mate", 1), ("x",))
        return search_result(
            EngineScore("mate", -1), self.defenses, min(multi_pv, len(self.defenses))
        )


class SolverArchitectureTest(unittest.TestCase):
    def test_forced_suffix_is_accepted(self) -> None:
        solved = solve_checkmate(
            SyntheticVerifier(), SearchContext(START_FEN, ()), "red", SolverConfig()
        )
        self.assertEqual(solved.primary.moves, ("a1", "d1", "x"))

    def test_tied_defenses_follow_only_best_reply(self) -> None:
        engine = SyntheticVerifier(("d1", "d2", "d3", "d4", "d5"))
        solved = solve_checkmate(
            engine,
            SearchContext(START_FEN, ()),
            "red",
            SolverConfig(),
        )
        self.assertEqual(len(solved.branches), 1)
        self.assertEqual(engine.calls, [1, 1, 1])

    def test_bounded_score_is_inconclusive(self) -> None:
        class Bounded(SyntheticVerifier):
            def analyse(self, context, *, nodes=None, depth=None, multi_pv):
                result = super().analyse(
                    context, nodes=nodes, depth=depth, multi_pv=multi_pv
                )
                if len(context.moves) == 0:
                    line = result.lines[0]
                    bounded = EngineScore("mate", 1, bound="lower")
                    return SearchResult(
                        "test",
                        "test.nnue",
                        "a1",
                        (
                            SearchLine(
                                line.multipv,
                                line.depth,
                                line.seldepth,
                                line.nodes,
                                line.time_ms,
                                bounded,
                                line.moves,
                            ),
                        ),
                    )
                return result

        with self.assertRaisesRegex(SolutionReview, "bounded_engine_score"):
            solve_checkmate(
                Bounded(), SearchContext(START_FEN, ()), "red", SolverConfig()
            )

    def test_incomplete_search_escalates_once(self) -> None:
        class Incomplete(SyntheticVerifier):
            def __init__(self):
                super().__init__()
                self.failed = False

            def analyse(self, context, *, nodes=None, depth=None, multi_pv):
                if not self.failed:
                    self.failed = True
                    raise IncompleteSearchError("unfinished")
                return super().analyse(
                    context, nodes=nodes, depth=depth, multi_pv=multi_pv
                )

        engine = Incomplete()
        solved = solve_checkmate(
            engine, SearchContext(START_FEN, ()), "red", SolverConfig()
        )
        self.assertEqual(solved.primary.moves, ("a1", "d1", "x"))

    def test_illegal_engine_selection_is_review_not_disproof(self) -> None:
        class IllegalSelection(SyntheticVerifier):
            def analyse(self, context, *, nodes=None, depth=None, multi_pv):
                if len(context.moves) == 0:
                    return search_result(EngineScore("mate", 1), ("illegal",))
                return super().analyse(
                    context, nodes=nodes, depth=depth, multi_pv=multi_pv
                )

        with self.assertRaisesRegex(SolutionReview, "engine_illegal_multipv_root"):
            solve_checkmate(
                IllegalSelection(), SearchContext(START_FEN, ()), "red", SolverConfig()
            )

    def test_illegal_alternative_root_is_review_not_accepted(self) -> None:
        class IllegalAlternative(SyntheticVerifier):
            def analyse(self, context, *, nodes=None, depth=None, multi_pv):
                if len(context.moves) == 0:
                    return SearchResult(
                        "test",
                        "test.nnue",
                        "a1",
                        (
                            SearchLine(
                                1, 10, 12, 100, 1, EngineScore("mate", 1), ("a1",)
                            ),
                            SearchLine(
                                2, 10, 12, 100, 1, EngineScore("mate", 1), ("illegal",)
                            ),
                        ),
                    )
                return super().analyse(
                    context, nodes=nodes, depth=depth, multi_pv=multi_pv
                )

        with self.assertRaisesRegex(SolutionReview, "engine_illegal_multipv_root"):
            solve_checkmate(
                IllegalAlternative(),
                SearchContext(START_FEN, ()),
                "red",
                SolverConfig(),
            )

    def test_attacker_stalemate_is_rejected(self) -> None:
        class AttackerStalemateVerifier(SyntheticVerifier):
            def inspect(self, context):
                if not context.moves:
                    return PositionStatus("4k4/9/9/9/9/9/9/9/4K4 w - - 0 1", False, ())
                return super().inspect(context)

        with self.assertRaisesRegex(
            SolutionRejected, "attacker_is_terminally_defeated"
        ):
            solve_checkmate(
                AttackerStalemateVerifier(),
                SearchContext(START_FEN, ()),
                "red",
                SolverConfig(),
            )


if __name__ == "__main__":
    unittest.main()
