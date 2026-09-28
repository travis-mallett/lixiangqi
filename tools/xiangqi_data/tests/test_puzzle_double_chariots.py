import copy
import unittest
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining.double_chariots import assess, evidence_outcome
from tools.xiangqi_data.puzzle_mining.engine import EngineProtocolError, OfflinePikafish
from tools.xiangqi_data.puzzle_mining.models import SearchContext
from tools.xiangqi_data.puzzle_mining.patterns import (
    double_chariots_candidate,
    double_chariots_escape_positions,
    matching_assessed_themes,
)
from tools.xiangqi_data.tests.test_puzzle_white_faced_general import terminal

BASE = {"f1": "K", "d10": "k", "d8": "R", "e7": "R"}
THEME = "doubleChariotsMate"
BTJ8Z_TERMINALS = (
    "1Cba1R1R1/3r1kr2/4b1c2/p1p1C3p/5n3/2P2N3/P3P1c1P/2N1B4/9/2BAKA3 b - - 1 1",
    "1CbaRR3/3r1kr2/4b1c2/p1p1C3p/5n3/2P2N3/P3P1c1P/2N1B4/9/2BAKA3 b - - 1 1",
)


class DoubleChariotsTest(unittest.TestCase):
    def engine(self, competing=False, checking=("d8",)):
        engine = Mock()
        engine.checking_pieces.side_effect = lambda context: (
            context.initial_fen,
            (
                (("e7", "f1") if competing else ("e7",))
                if context.initial_fen.startswith("4k4")
                else checking
            ),
        )
        return engine

    def test_exclusive_second_chariot_and_checking_role(self):
        t = terminal(BASE)
        for engine, expected in (
            (self.engine(), "key"),
            (self.engine(competing=True), "not_key"),
            (self.engine(checking=("f1",)), "not_key"),
            (self.engine(checking=("e7",)), "not_key"),
        ):
            with self.subTest(expected=expected):
                record = assess(engine, t)
                self.assertEqual(record["outcome"], expected)
                self.assertEqual(evidence_outcome(t, record), expected)
                self.assertEqual(
                    matching_assessed_themes(t, {THEME: record}, {THEME}),
                    {THEME} if expected == "key" else set(),
                )
                engine.analyse.assert_not_called()
        self.assertEqual(matching_assessed_themes(t, {}, {THEME}), set())

    def test_geometry_requires_empty_escape_squares(self):
        self.assertFalse(double_chariots_candidate(terminal(BASE, checkmate=False)))
        self.assertFalse(double_chariots_candidate(terminal({**BASE, "e7": "r"})))
        self.assertEqual(
            [m for m, _ in double_chariots_escape_positions(terminal(BASE))],
            ["d10e10", "d10d9"],
        )
        for occupant in "pPrRnNcCaAbBkK":
            with self.subTest(occupant=occupant):
                self.assertNotIn(
                    "d10e10",
                    dict(
                        double_chariots_escape_positions(
                            terminal({**BASE, "e10": occupant})
                        )
                    ),
                )

    def test_evidence_rejects_incomplete_stale_and_wrong_boards(self):
        t = terminal(BASE)
        record = assess(self.engine(), t)
        for mutate in (
            lambda r: r.update(logic_version="1.0"),
            lambda r: r.update(terminal_fen="wrong"),
            lambda r: r["escapes"].pop(),
            lambda r: r["escapes"].__setitem__(1, r["escapes"][0]),
            lambda r: r["terminal"].update(fen="wrong"),
            lambda r: r["escapes"][0].update(checkers=["a5"]),
        ):
            changed = copy.deepcopy(record)
            mutate(changed)
            self.assertIsNone(evidence_outcome(t, changed))
        engine = self.engine()
        engine.checking_pieces.side_effect = EngineProtocolError("failed")
        self.assertEqual(assess(engine, t)["outcome"], "inconclusive")

    def test_persistence_and_all_branch_consensus(self):
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )
        from tools.xiangqi_data.puzzle_mining.solver import VerifiedBranch
        from tools.xiangqi_data.puzzle_mining.models import PositionStatus
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            reclassify_canonical,
        )

        fixture = PuzzleStorageLifecycleTest()
        fixture.setUp(themes=(THEME,))
        self.addCleanup(fixture.tearDown)
        t = terminal(BASE)
        branch = VerifiedBranch(("d7d8",), PositionStatus(t.fen, True, ()))
        fixture.verify(result=fixture.result(branches=(branch,)))
        engine = self.engine()
        result = reclassify_canonical(fixture.connection, fixture.key, engine=engine)
        self.assertEqual(result.themes, (THEME, "mate", "mateIn1"))
        repeated = reclassify_canonical(fixture.connection, fixture.key, force=True)
        self.assertEqual(repeated.themes, result.themes)
        self.assertEqual(engine.checking_pieces.call_count, 3)
        # Revision 1.0 proofs and category verdicts cannot authorize 1.1,
        # even when the correct outcome happens to remain positive.
        with fixture.connection:
            fixture.connection.execute(
                "UPDATE taxonomy_assessments SET taxonomy_version=json_set(taxonomy_version, '$.versions.doubleChariotsMate', '1.0')"
            )
            fixture.connection.execute(
                "UPDATE category_assessments SET category_version='1.0' WHERE category=?",
                (THEME,),
            )
            fixture.connection.execute(
                "UPDATE motif_removal_evidence SET theme_version='1.0', evidence_json=json_set(evidence_json, '$.logic_version', '1.0') WHERE theme=?",
                (THEME,),
            )
        pending = reclassify_canonical(fixture.connection, fixture.key)
        self.assertEqual(pending.status, "awaiting_classification_evidence")
        refreshed = reclassify_canonical(fixture.connection, fixture.key, engine=engine)
        self.assertEqual(refreshed.themes, result.themes)
        self.assertEqual(engine.checking_pieces.call_count, 6)
        self.assertEqual(
            fixture.connection.execute(
                "SELECT count(*) FROM candidate_assessments"
            ).fetchone()[0],
            1,
        )
        other = terminal({**BASE, "e7": "p"})
        fixture.verify(
            force=True,
            result=fixture.result(
                branches=(
                    branch,
                    VerifiedBranch(("e6e7",), PositionStatus(other.fen, True, ())),
                )
            ),
        )
        result = reclassify_canonical(fixture.connection, fixture.key, engine=engine)
        self.assertEqual(result.status, "category_conflict")

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_engine_both_colors_competing_and_discovered_attacks(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        cases = [
            (BASE, "key"),
            ({**BASE, "g9": "N"}, "not_key"),
            ({**BASE, "g9": "N", "f9": "p"}, "key"),
            ({**BASE, "e10": "P"}, "not_key"),
            ({**BASE, "e10": "p"}, "not_key"),
            # Vacating d10 opens the checking chariot's rank attack on e10.
            ({"f1": "K", "d10": "k", "a10": "R", "e9": "R"}, "key"),
            # Blocking d9 removes the only escape controlled exclusively by e9.
            ({"f1": "K", "d10": "k", "a10": "R", "e9": "R", "d9": "p"}, "not_key"),
            # The checking chariot and general both cover the only escape.
            ({"e1": "K", "d10": "k", "d9": "p", "d8": "R", "f10": "R"}, "not_key"),
            # Chariots restrict both sides, but the terminal checker is a cannon.
            (
                {"e1": "K", "e10": "k", "e7": "C", "e3": "C", "d1": "R", "f1": "R"},
                "not_key",
            ),
        ]
        for pieces, expected in cases:
            for mirror in (False, True):
                board = (
                    {f"{s[0]}{11-int(s[1:])}": p.swapcase() for s, p in pieces.items()}
                    if mirror
                    else pieces
                )
                t = terminal(board, "red" if mirror else "black")
                with self.subTest(board=board):
                    self.assertTrue(engine.inspect(SearchContext(t.fen, ())).checkmate)
                    self.assertEqual(assess(engine, t)["outcome"], expected)

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_btj8z_protecting_the_checking_chariot_does_not_qualify(self):
        from tools.xiangqi_data.puzzle_mining.position import decode_position

        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for fen in BTJ8Z_TERMINALS:
            pieces = decode_position(fen)
            for mirror in (False, True):
                board = (
                    {f"{s[0]}{11-int(s[1:])}": p.swapcase() for s, p in pieces.items()}
                    if mirror
                    else pieces
                )
                t = terminal(board, "red" if mirror else "black")
                with self.subTest(fen=t.fen):
                    self.assertTrue(engine.inspect(SearchContext(t.fen, ())).checkmate)
                    record = assess(engine, t)
                    self.assertEqual(record["outcome"], "not_key")
                    self.assertNotIn(
                        "f2f1" if mirror else "f9f10",
                        [escape["move"] for escape in record["escapes"]],
                    )
                    self.assertFalse(
                        matching_assessed_themes(t, {THEME: record}, {THEME})
                    )


if __name__ == "__main__":
    unittest.main()
