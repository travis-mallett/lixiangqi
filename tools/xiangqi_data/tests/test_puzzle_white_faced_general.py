import unittest
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish, EngineProtocolError
from tools.xiangqi_data.puzzle_mining.models import SearchContext
from tools.xiangqi_data.puzzle_mining.patterns import (
    TerminalPosition,
    matching_assessed_themes,
    white_faced_general_escape_positions,
)
from tools.xiangqi_data.puzzle_mining.position import encode_position
from tools.xiangqi_data.puzzle_mining.white_faced_general import (
    assess,
    evidence_outcome,
)


def terminal(pieces, losing="black", checkmate=True):
    return TerminalPosition(
        encode_position(pieces) + (" b" if losing == "black" else " w") + " - - 0 1",
        checkmate,
        losing,
    )


BASE = {"e1": "K", "d10": "k", "d8": "R"}


class WhiteFacedGeneralTest(unittest.TestCase):
    def test_persisted_classification_and_branch_consensus(self):
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )
        from tools.xiangqi_data.puzzle_mining.solver import VerifiedBranch
        from tools.xiangqi_data.puzzle_mining.models import PositionStatus
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            reclassify_canonical,
        )

        fixture = PuzzleStorageLifecycleTest()
        fixture.setUp(themes=("whiteFacedGeneral",))
        self.addCleanup(fixture.tearDown)
        t = terminal(BASE)
        fixture.verify(
            result=fixture.result(
                branches=(VerifiedBranch(("d7d8",), PositionStatus(t.fen, True, ())),)
            )
        )
        engine = Mock()
        engine.checking_pieces.side_effect = lambda context: (
            context.initial_fen,
            ("e1",),
        )
        result = reclassify_canonical(fixture.connection, fixture.key, engine=engine)
        self.assertEqual(result.themes, ("mate", "mateIn1", "whiteFacedGeneral"))
        engine.analyse.assert_not_called()
        # A forced rerun needs no engine: the complete counterfactual is persisted.
        repeated = reclassify_canonical(fixture.connection, fixture.key, force=True)
        self.assertEqual(repeated.themes, result.themes)
        self.assertEqual(engine.checking_pieces.call_count, 1)
        self.assertEqual(
            fixture.connection.execute(
                "SELECT count(*) FROM candidate_assessments"
            ).fetchone()[0],
            1,
        )
        # An existing 1.0 classification must be revisited without a force flag.
        with fixture.connection:
            fixture.connection.execute(
                """UPDATE taxonomy_assessments SET taxonomy_version =
                   json_set(taxonomy_version, '$.versions.whiteFacedGeneral', '1.0')"""
            )
            fixture.connection.execute(
                "UPDATE category_assessments SET category_version='1.0' WHERE category='whiteFacedGeneral'"
            )
            fixture.connection.execute(
                "UPDATE motif_removal_evidence SET theme_version='1.0' WHERE theme='whiteFacedGeneral'"
            )
        stale = reclassify_canonical(fixture.connection, fixture.key)
        self.assertEqual(stale.status, "awaiting_classification_evidence")
        refreshed = reclassify_canonical(fixture.connection, fixture.key, engine=engine)
        self.assertEqual(refreshed.themes, result.themes)
        self.assertEqual(engine.checking_pieces.call_count, 2)
        # A branch whose escape is also attacked cannot share this category.
        other = terminal({**BASE, "e8": "R"})
        fixture.verify(
            force=True,
            result=fixture.result(
                branches=(
                    VerifiedBranch(("d7d8",), PositionStatus(t.fen, True, ())),
                    VerifiedBranch(("e7e8",), PositionStatus(other.fen, True, ())),
                )
            ),
        )
        engine.checking_pieces.side_effect = lambda context: (
            context.initial_fen,
            ("e1", "e8") if "3RR4" in context.initial_fen else ("e1",),
        )
        result = reclassify_canonical(fixture.connection, fixture.key, engine=engine)
        self.assertEqual(result.status, "category_conflict")
        self.assertFalse(result.themes)

    def test_geometry_requires_empty_horizontal_escape_on_adjacent_file(self):
        t = terminal(BASE)
        moves = white_faced_general_escape_positions(t)
        self.assertEqual([m for m, _ in moves], ["d10e10"])
        self.assertIn("4k4", moves[0][1])
        for piece in ("p", "P", "r", "R", "n", "N", "c", "C"):
            with self.subTest(piece=piece):
                self.assertFalse(
                    white_faced_general_escape_positions(
                        terminal({**BASE, "e10": piece})
                    )
                )
                self.assertFalse(
                    white_faced_general_escape_positions(
                        terminal({**BASE, "e5": piece})
                    )
                )
        for board in (
            {"d1": "K", "d10": "k", "d5": "p"},
            {"f1": "K", "d10": "k"},
            {"e1": "K", "e9": "k", "e8": "P"},
        ):
            self.assertFalse(white_faced_general_escape_positions(terminal(board)))
        self.assertFalse(
            white_faced_general_escape_positions(terminal(BASE, checkmate=False))
        )

    def test_competing_attack_and_incomplete_evidence(self):
        t = terminal(BASE)
        engine = Mock()
        fen = white_faced_general_escape_positions(t)[0][1]
        engine.checking_pieces.return_value = (fen, ("e1", "d8"))
        self.assertEqual(assess(engine, t)["outcome"], "not_key")
        engine.checking_pieces.return_value = (fen, ("e1",))
        record = assess(engine, t)
        self.assertEqual(record["outcome"], "key")
        self.assertEqual(
            matching_assessed_themes(t, {"whiteFacedGeneral": record}),
            {"whiteFacedGeneral"},
        )
        old_record = {**record, "logic_version": "1.0"}
        self.assertIsNone(evidence_outcome(t, old_record))
        record["escapes"] = []
        self.assertIsNone(evidence_outcome(t, record))
        engine.checking_pieces.side_effect = EngineProtocolError("bad reply")
        self.assertEqual(assess(engine, t)["outcome"], "inconclusive")
        engine.analyse.assert_not_called()

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_engine_both_colors_and_competing_attacks(self):
        engine = OfflinePikafish(default_executable())
        try:
            for extra, expected in [
                ({}, "key"),
                ({"e8": "R"}, "not_key"),
                ({"a10": "C", "c10": "P"}, "not_key"),
                ({"g9": "N"}, "not_key"),
                ({"g9": "N", "f9": "p"}, "key"),
                ({"f10": "P"}, "not_key"),
            ]:
                pieces = {**BASE, **extra}
                for mirror in (False, True):
                    board = (
                        {
                            f"{s[0]}{11-int(s[1:])}": p.swapcase()
                            for s, p in pieces.items()
                        }
                        if mirror
                        else pieces
                    )
                    t = terminal(board, "red" if mirror else "black")
                    self.assertTrue(engine.inspect(SearchContext(t.fen, ())).checkmate)
                    self.assertEqual(assess(engine, t)["outcome"], expected)
            # The old rule accepted this vertical capture; adjacent files are now required.
            t = terminal({"e1": "K", "e9": "k", "e8": "P", "d10": "R", "f10": "R"})
            self.assertTrue(engine.inspect(SearchContext(t.fen, ())).checkmate)
            record = assess(engine, t)
            self.assertEqual(record["outcome"], "not_key")
            self.assertEqual(record["escapes"], [])
            # A horizontal capture is also excluded even if only the general guards it.
            t = terminal({**BASE, "e10": "P"})
            self.assertTrue(engine.inspect(SearchContext(t.fen, ())).checkmate)
            self.assertEqual(assess(engine, t)["outcome"], "not_key")
        finally:
            engine.close()


if __name__ == "__main__":
    unittest.main()
