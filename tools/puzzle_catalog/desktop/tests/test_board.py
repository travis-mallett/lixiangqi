import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication
from tools.puzzle_catalog.desktop.board import XiangqiBoard


class BoardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_setup_rank10_capture_and_reset(self):
        b = XiangqiBoard()
        b.set_puzzle({"fen": "9/9/9/9/9/9/9/9/9/R7p w - - 0 1", "line": "a1a10 a10i10"})
        assert b.error == "" and b.index == 2
        assert b.positions[1][("a", "10")][0] == "r"
        b.navigate(1)
        assert ("a", "10") not in b.positions[2] and b.positions[2][("i", "10")][
            0
        ] == "r"
        b.reset()
        assert b.index == 1

    def test_selection_starts_at_final_position_and_puts_winner_at_bottom(self):
        b = XiangqiBoard()
        b.set_puzzle({"fen": "9/9/9/9/9/9/9/9/9/R7p w - - 0 1", "line": "a1a10 a10i10"})
        assert b.index == 2
        assert b.flipped

        b.set_puzzle({"fen": "r8/9/9/9/9/9/9/9/9/P8 b - - 0 1", "line": "a10i10 a1a2"})
        assert b.index == 2
        assert not b.flipped

    def test_flip_coordinate(self):
        b = XiangqiBoard()
        assert b._coord("a", "10") == (0, 0)
        b.set_flipped(True)
        assert b._coord("a", "10") == (8, 9)

    def test_invalid_origin_is_visible_and_no_legality_claim(self):
        b = XiangqiBoard()
        b.set_puzzle({"fen": "9/9/9/9/9/9/9/9/9/9 w - - 0 1", "line": "a1a2"})
        assert "no piece" in b.error.lower()
        assert b.positions == []

    def test_invalid_notation_is_visible(self):
        b = XiangqiBoard()
        b.set_puzzle({"fen": "9/9/9/9/9/9/9/9/9/9 w - - 0 1", "line": "a0a1"})
        assert "invalid" in b.error.lower() and "move" in b.error.lower()


if __name__ == "__main__":
    unittest.main()
