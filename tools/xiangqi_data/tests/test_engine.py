from __future__ import annotations

import unittest

from tools.xiangqi_data.engine import (
    IllegalMove,
    InvalidLesson,
    PositionRequest,
    START_FEN,
    import_move_tree,
    inspect_position,
    play_move,
    validate_lesson,
)
from tools.xiangqi_data.pikafish_rules import wxf_notation


class XiangqiEngineTest(unittest.TestCase):
    def test_initial_position_is_exact_pikafish_xiangqi(self) -> None:
        state = inspect_position(PositionRequest())
        self.assertEqual(START_FEN, state["fen"])
        self.assertEqual("red", state["turn"])
        self.assertEqual(44, len(state["legalMoves"]))

    def test_move_uses_lixiangqi_wxf_notation_and_pikafish_fen(self) -> None:
        state = play_move(PositionRequest(), "a4a5")
        self.assertEqual("P9+1", state["notation"])
        self.assertFalse(state["capture"])
        self.assertFalse(state["checkmate"])
        self.assertEqual("black", state["turn"])
        self.assertEqual("rnbakabnr/9/1c5c1/p1p1p1p1p/9/P8/2P1P1P1P/1C5C1/9/RNBAKABNR b - - 1 1", state["fen"])

    def test_move_reports_capture_from_the_authoritative_position(self) -> None:
        state = play_move(
            PositionRequest(initial_fen="4k4/9/9/9/4p4/9/9/9/p8/R3K4 w - - 0 1"),
            "a1a2",
        )
        self.assertTrue(state["capture"])

    def test_move_reports_check_without_checkmate(self) -> None:
        state = play_move(
            PositionRequest(initial_fen="4k4/9/9/9/9/9/9/R8/9/5K3 w - - 0 1"),
            "a3e3",
        )
        self.assertTrue(state["check"])
        self.assertFalse(state["checkmate"])

    def test_move_reports_checkmate(self) -> None:
        state = play_move(
            PositionRequest(initial_fen="4k4/9/9/9/9/9/3R5/R8/9/5K3 w - - 0 1"),
            "a3e3",
        )
        self.assertTrue(state["check"])
        self.assertTrue(state["checkmate"])
        self.assertEqual("1-0", state["gameResult"])

    def test_black_checkmate_reports_black_as_winner(self) -> None:
        state = play_move(
            PositionRequest(initial_fen="4K4/9/9/9/9/9/3r5/r8/9/5k3 b - - 0 1"),
            "a3e3",
        )
        self.assertTrue(state["checkmate"])
        self.assertEqual("0-1", state["gameResult"])

    def test_horse_move_uses_expected_wxf_notation(self) -> None:
        state = play_move(PositionRequest(), "h1g3")
        self.assertEqual("H2+3", state["notation"])

    def test_three_tandem_pawns_use_wxf_ordinal_and_file(self) -> None:
        position = {"i9": "P", "i8": "P", "i6": "P"}
        self.assertEqual("21=2", wxf_notation(position, "i8h8"))

    def test_illegal_move_is_rejected(self) -> None:
        with self.assertRaises(IllegalMove):
            play_move(PositionRequest(), "a4b4")

    def test_lesson_rejects_advisor_on_an_unreachable_palace_point(self) -> None:
        position = PositionRequest(
            initial_fen="4k4/9/9/9/9/9/9/4A4/9/3K5 w - - 0 1",
            moves=("e3d2",),
        )
        with self.assertRaisesRegex(InvalidLesson, "Advisor cannot reach e3"):
            validate_lesson(position)

    def test_lesson_accepts_advisor_on_its_five_reachable_points(self) -> None:
        result = validate_lesson(
            PositionRequest(
                initial_fen="4k4/9/9/9/9/4p4/9/9/4A4/3K5 w - - 0 1",
                moves=("e2f3", "f3e2", "e2d3"),
            )
        )
        self.assertEqual(4, len(result["positions"]))
        self.assertEqual(3, len(result["notations"]))

    def test_lesson_rejects_facing_generals(self) -> None:
        with self.assertRaisesRegex(InvalidLesson, "Generals face each other"):
            validate_lesson(
                PositionRequest(initial_fen="4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1")
            )

    def test_lesson_rejects_a_move_that_exposes_the_flying_general(self) -> None:
        with self.assertRaisesRegex(IllegalMove, "e5d7"):
            validate_lesson(
                PositionRequest(
                    initial_fen="4k4/9/9/9/9/4N4/9/9/9/4K4 w - - 0 1",
                    moves=("e5d7",),
                )
            )

    def test_lesson_rejects_skipping_a_reply_after_check(self) -> None:
        with self.assertRaisesRegex(InvalidLesson, "opponent's reply cannot be skipped"):
            validate_lesson(
                PositionRequest(
                    initial_fen="3k5/9/9/9/9/9/9/9/R8/5K3 w - - 0 1",
                    moves=("a2d2", "d2d3"),
                )
            )

    def test_imports_recursive_wxf_variations_as_an_ordered_tree(self) -> None:
        tree = import_move_tree(
            '[Variant "Xiangqi"]\n\n1. P9+1 P1+1 (1... H2+3 2. P7+1) 2. P7+1'
        )

        first = tree["children"][0]
        self.assertEqual("a4a5", first["move"])
        self.assertEqual(["a7a6", "b10c8"], [node["move"] for node in first["children"]])
        self.assertEqual([2, 2], [node["state"]["ply"] for node in first["children"]])
        self.assertEqual("c4c5", first["children"][0]["children"][0]["move"])
        self.assertEqual("c4c5", first["children"][1]["children"][0]["move"])

    def test_import_accepts_uci_and_merges_duplicate_first_moves(self) -> None:
        tree = import_move_tree("1. a4a5 (1. a4a5 c7c6) a7a6")
        first = tree["children"][0]
        self.assertEqual("a4a5", first["move"])
        self.assertEqual(["c7c6", "a7a6"], [node["move"] for node in first["children"]])

    def test_imports_stored_uci_mainline_with_native_states(self) -> None:
        tree = import_move_tree("h1g3 h10g8")
        red = tree["children"][0]
        black = red["children"][0]
        self.assertEqual(("h1g3", "H2+3", 1), (red["move"], red["notation"], red["state"]["ply"]))
        self.assertEqual(("h10g8", "H8+7", 2), (black["move"], black["notation"], black["state"]["ply"]))
        self.assertFalse(red["state"]["capture"])
        self.assertFalse(red["state"]["checkmate"])
        self.assertTrue(black["state"]["legalMoves"])

    def test_imported_move_states_keep_authoritative_sound_events(self) -> None:
        capture = import_move_tree(
            '[FEN "4k4/9/9/9/4p4/9/9/9/p8/R3K4 w - - 0 1"]\n\na1a2'
        )["children"][0]["state"]
        mate = import_move_tree(
            '[FEN "4k4/9/9/9/9/9/3R5/R8/9/5K3 w - - 0 1"]\n\na3e3'
        )["children"][0]["state"]

        self.assertTrue(capture["capture"])
        self.assertFalse(capture["checkmate"])
        self.assertTrue(mate["check"])
        self.assertTrue(mate["checkmate"])
        self.assertEqual("1-0", mate["gameResult"])

    def test_import_rejects_unbalanced_variations(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unclosed variation"):
            import_move_tree("1. P9+1 (1... H2+3")

if __name__ == "__main__":
    unittest.main()
