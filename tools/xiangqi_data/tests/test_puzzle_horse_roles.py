import unittest
from copy import deepcopy

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish
from tools.xiangqi_data.puzzle_mining.horse_roles import HorseRole
from tools.xiangqi_data.puzzle_mining.models import SearchContext
from tools.xiangqi_data.puzzle_mining.patterns import (
    horse_role_candidate_squares,
    horse_role_escape_positions,
    matching_assessed_themes,
)
from tools.xiangqi_data.tests.test_puzzle_double_cannons import terminal


class HorseRolesTest(unittest.TestCase):
    def test_all_posts_both_colors_and_wrong_pieces(self):
        posts = {
            "elbowHorse": ("c9", "g9"),
            "anglerHorse": ("c8", "g8"),
            "highAnglerHorse": ("c7", "g7"),
            "palcornerHorse": ("d8", "f8", "d10", "f10"),
        }
        for theme, squares in posts.items():
            for square in squares:
                for mirror in (False, True):
                    square = (
                        square if not mirror else f"{square[0]}{11-int(square[1:])}"
                    )
                    losing, horse = ("red", "n") if mirror else ("black", "N")
                    with self.subTest(theme=theme, square=square, losing=losing):
                        self.assertEqual(
                            horse_role_candidate_squares(
                                terminal({square: horse}, losing), theme
                            ),
                            (square,),
                        )
                        for wrong in (horse.swapcase(), "R", "r"):
                            self.assertFalse(
                                horse_role_candidate_squares(
                                    terminal({square: wrong}, losing), theme
                                )
                            )
                        self.assertFalse(
                            horse_role_candidate_squares(
                                terminal({square: horse}, losing, False), theme
                            )
                        )
                        self.assertFalse(
                            horse_role_candidate_squares(
                                terminal({"a5": horse}, losing), theme
                            )
                        )

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_engine_check_escape_capture_and_blocked_legs(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        # Each horse controls the indicated escape from the general's square.
        for theme, horse, general, escape, leg in (
            ("elbowHorse", "c9", "f10", "e10", "d9"),
            ("anglerHorse", "c8", "e10", "d10", "c9"),
            ("highAnglerHorse", "c7", "e9", "d9", "c8"),
            ("palcornerHorse", "d8", "f10", "e10", "d9"),
        ):
            for mirror in (False, True):

                def pos(changes):
                    board = {general: "k", horse: "N", "f1": "K"}
                    for move, _ in horse_role_escape_positions(terminal(board)):
                        target = move[len(general) :]
                        if target != escape:
                            board[target] = "p"
                    board.update(changes)
                    if mirror:
                        board = {
                            f"{s[0]}{11-int(s[1:])}": p.swapcase()
                            for s, p in board.items()
                        }
                    return terminal(board, "red" if mirror else "black")

                role = HorseRole(theme)
                for occupant in (None, "R", "p"):
                    t = pos({escape: occupant} if occupant else {})
                    with self.subTest(theme=theme, mirror=mirror, occupant=occupant):
                        record = role.assess(engine, t)
                        self.assertEqual(
                            record["outcome"], "not_key" if occupant == "p" else "key"
                        )
                        self.assertEqual(
                            role.evidence_outcome(t, record), record["outcome"]
                        )
                        damaged = deepcopy(record)
                        damaged["terminal"]["fen"] = pos({"a5": "P"}).fen
                        self.assertIsNone(role.evidence_outcome(t, damaged))
                self.assertEqual(
                    role.assess(engine, pos({leg: "P"}))["outcome"], "not_key"
                )
                shared = role.assess(engine, pos({f"{escape[0]}1": "R"}))
                self.assertEqual(shared["outcome"], "key")
                self.assertTrue(
                    any(len(item["checkers"]) >= 2 for item in shared["escapes"])
                )
                # Move the general onto the attacked square: the horse checks directly.
                board = {escape: "k", horse: "N", "f1": "K"}
                if mirror:
                    board = {
                        f"{s[0]}{11-int(s[1:])}": p.swapcase() for s, p in board.items()
                    }
                t = terminal(board, "red" if mirror else "black")
                record = role.assess(engine, t)
                self.assertEqual(record["outcome"], "key")
                self.assertEqual(record["escapes"], [])
                self.assertEqual(
                    matching_assessed_themes(t, {theme: record}, {theme}), {theme}
                )

    def test_failed_inspection_stays_inconclusive(self):
        class BrokenEngine:
            def checking_pieces(self, context):
                raise TimeoutError("inspection timeout")

        role = HorseRole("elbowHorse")
        t = terminal({"e10": "k", "c9": "N", "f1": "K"})
        record = role.assess(BrokenEngine(), t)
        self.assertEqual(record["outcome"], "inconclusive")
        self.assertIsNone(role.evidence_outcome(t, record))
        self.assertFalse(
            matching_assessed_themes(t, {role.theme: record}, {role.theme})
        )

    def test_general_capture_removes_horse_and_friendly_occupants_are_excluded(self):
        from tools.xiangqi_data.puzzle_mining.position import decode_position

        t = terminal({"e8": "k", "d8": "N", "f8": "p", "e9": "R"})
        escapes = dict(horse_role_escape_positions(t))
        self.assertEqual(set(escapes), {"e8d8", "e8e9"})
        self.assertEqual(decode_position(escapes["e8d8"])["d8"], "k")

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_mate_and_persisted_reclassification(self):
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )
        from tools.xiangqi_data.puzzle_mining.solver import VerifiedBranch
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            reclassify_canonical,
        )

        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        # Keep the horse leg open while the rooks cover the general's exits.
        t = terminal(
            {"e10": "k", "c9": "N", "d5": "R", "f5": "R", "e9": "P", "e1": "K"}
        )
        status = engine.inspect(SearchContext(t.fen, ()))
        self.assertTrue(status.checkmate)
        f = PuzzleStorageLifecycleTest()
        f.setUp(themes=("elbowHorse",))
        self.addCleanup(f.tearDown)
        f.verify(result=f.result(branches=(VerifiedBranch(("b7c9",), status),)))
        result = reclassify_canonical(f.connection, f.key, engine=engine)
        self.assertIn("elbowHorse", result.themes)
        self.assertEqual(
            reclassify_canonical(f.connection, f.key).status, "already_current"
        )
