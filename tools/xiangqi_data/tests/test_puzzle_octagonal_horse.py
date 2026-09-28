import unittest

from tools.xiangqi_data.puzzle_mining.patterns import (
    OCTAGONAL_HORSE_THEME,
    TerminalPosition,
    octagonal_horse_candidate,
    matching_themes,
)
from tools.xiangqi_data.puzzle_mining.position import encode_position


def terminal(pieces, *, losing="black", checkmate=False, stalemate=True):
    return TerminalPosition(
        f"{encode_position(pieces)} {'b' if losing == 'black' else 'w'} - - 0 1",
        checkmate,
        losing,
        stalemate,
    )


class OctagonalHorseTest(unittest.TestCase):
    def test_screenshot_position_and_all_palace_corner_pairs(self):
        screenshot = "3a1k3/4aP3/3N5/9/9/6r2/9/9/3p5/4K4 b - - 0 1"
        self.assertTrue(octagonal_horse_candidate(TerminalPosition(screenshot, True, "black")))

        pairs = {
            "d8": "f10", "f8": "d10", "d10": "f8", "f10": "d8",
            "d1": "f3", "f1": "d3", "d3": "f1", "f3": "d1",
        }
        for horse, general in pairs.items():
            red = horse[1:] in {"8", "10"}
            pieces = {horse: "N" if red else "n", general: "k" if red else "K"}
            # Put the other general safely outside the tested palace.
            pieces["e1" if red else "e10"] = "K" if red else "k"
            self.assertTrue(
                octagonal_horse_candidate(terminal(pieces, losing="black" if red else "red")),
                (horse, general),
            )

    def test_horse_leg_blocking_and_exclusive_exits(self):
        base = {"d8": "N", "f10": "k", "a1": "K"}
        self.assertTrue(octagonal_horse_candidate(terminal(base)))
        self.assertTrue(octagonal_horse_candidate(terminal({**base, "d9": "p"})))
        self.assertTrue(octagonal_horse_candidate(terminal({**base, "e8": "p"})))
        self.assertTrue(octagonal_horse_candidate(terminal({**base, "d9": "p", "e8": "p"})))

        # Another red attacker may restrict one exit; the horse remains the
        # exclusive restriction on the other.
        self.assertTrue(octagonal_horse_candidate(terminal({**base, "g10": "R"})))
        self.assertTrue(octagonal_horse_candidate(terminal({**base, "g10": "R", "f1": "R"})))

    def test_occupied_exits_are_evaluated_as_real_general_moves(self):
        base = {"d8": "N", "f10": "k", "a1": "K"}
        # Capturing an enemy man still lands on a horse-attacked square.
        self.assertTrue(octagonal_horse_candidate(terminal({**base, "f9": "P"})))
        # A friendly man blocks that exit; the other horse restriction remains.
        self.assertTrue(octagonal_horse_candidate(terminal({**base, "f9": "p"})))
        self.assertTrue(octagonal_horse_candidate(terminal({**base, "e10": "p", "f9": "p"})))

    def test_discovered_rook_and_cannon_attacks_after_general_vacates(self):
        # The horse's e8 leg is blocked, leaving only e10 to test. On the
        # original board the general screens e10 from the rook; once the
        # general moves there, the rook also attacks it through empty f10.
        base = {"d8": "N", "f10": "k", "d1": "K", "e8": "p"}
        self.assertTrue(octagonal_horse_candidate(terminal(base)))
        self.assertTrue(octagonal_horse_candidate(terminal({**base, "g10": "R"})))
        # The same departure reduces the cannon's two screens to one.
        self.assertTrue(octagonal_horse_candidate(terminal({**base, "h10": "C", "g10": "p"})))

    def test_flying_general_is_a_competing_restriction(self):
        pieces = {"d8": "N", "f10": "k", "f1": "K", "e1": "R"}
        self.assertTrue(octagonal_horse_candidate(terminal(pieces)))

    def test_terminal_and_piece_colour_guards(self):
        pieces = {"d8": "N", "f10": "k", "e1": "K"}
        self.assertFalse(octagonal_horse_candidate(terminal(pieces, stalemate=False)))
        self.assertFalse(octagonal_horse_candidate(terminal({**pieces, "d8": "n"})))
        self.assertFalse(octagonal_horse_candidate(terminal({**pieces, "d8": "R"})))
        self.assertEqual(matching_themes(terminal(pieces), {OCTAGONAL_HORSE_THEME}), {OCTAGONAL_HORSE_THEME})


if __name__ == "__main__":
    unittest.main()
