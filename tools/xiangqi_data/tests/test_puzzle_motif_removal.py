import unittest

from tools.xiangqi_data.puzzle_mining.models import (
    EngineScore,
    PositionStatus,
    SearchContext,
    SearchLine,
    SearchResult,
)
from tools.xiangqi_data.puzzle_mining.motif_removal import verify_removed_motif
from tools.xiangqi_data.puzzle_mining.patterns import (
    OCTAGONAL_HORSE_THEME,
    TerminalPosition,
    octagonal_horse_removed_fens,
)


class RemovalEngine:
    def new_game(self):
        self.resets = getattr(self, "resets", 0) + 1

    engine_version = "test-engine"
    nnue = "test-nnue"

    def __init__(self, statuses, result):
        self.statuses = statuses
        self.result = result
        self.inspect_calls = []
        self.analyse_calls = []

    def inspect(self, context: SearchContext):
        self.inspect_calls.append(context.initial_fen)
        return self.statuses[context.initial_fen]

    def analyse(self, context, *, nodes, multi_pv):
        self.analyse_calls.append((context.initial_fen, nodes, multi_pv))
        return self.result

    def close(self):
        pass


def search_result(score, move):
    return SearchResult(
        "test-engine",
        "test-nnue",
        move,
        (SearchLine(1, 8, 8, 100, 1, score, (move,)),),
    )


class MotifRemovalTest(unittest.TestCase):
    def test_horse_both_colors_cp_and_positive_mate_are_key(self):
        cases = (
            (
                TerminalPosition("3k5/9/5N3/9/9/9/9/9/9/4K4 b - - 0 1", True, "black"),
                "d10e10",
            ),
            (
                TerminalPosition("4k4/9/9/9/9/9/9/5n3/9/3K5 w - - 0 1", True, "red"),
                "d1e1",
            ),
        )
        for terminal, move in cases:
            removed = octagonal_horse_removed_fens(terminal)[0][1]
            status = PositionStatus(removed, False, (move,))
            for score in (
                EngineScore("cp", 300, (700, 200, 100)),
                EngineScore("mate", 1),
            ):
                engine = RemovalEngine({removed: status}, search_result(score, move))
                evidence = verify_removed_motif(
                    engine, terminal, OCTAGONAL_HORSE_THEME, removed, nodes=1000
                )
                self.assertEqual(evidence["outcome"], "key")
                self.assertEqual(engine.analyse_calls[0][2], 1)

    def test_negative_mate_and_terminal_removal_are_not_key(self):
        terminal = TerminalPosition(
            "3k5/9/5N3/9/9/9/9/9/9/4K4 b - - 0 1", True, "black"
        )
        removed = octagonal_horse_removed_fens(terminal)[0][1]
        move = "d10e10"
        engine = RemovalEngine(
            {removed: PositionStatus(removed, False, (move,))},
            search_result(EngineScore("mate", -3), move),
        )
        self.assertEqual(
            verify_removed_motif(
                engine, terminal, OCTAGONAL_HORSE_THEME, removed, nodes=10
            )["outcome"],
            "not_key",
        )
        terminal_engine = RemovalEngine(
            {removed: PositionStatus(removed, True, ())},
            search_result(EngineScore("mate", 1), move),
        )
        self.assertEqual(
            verify_removed_motif(
                terminal_engine, terminal, OCTAGONAL_HORSE_THEME, removed, nodes=10
            )["outcome"],
            "not_key",
        )
        self.assertEqual(terminal_engine.analyse_calls, [])
        no_escape_engine = RemovalEngine(
            {removed: PositionStatus(removed, False, ("a7a6",))},
            search_result(EngineScore("mate", 1), move),
        )
        self.assertEqual(
            verify_removed_motif(
                no_escape_engine, terminal, OCTAGONAL_HORSE_THEME, removed, nodes=10
            )["outcome"],
            "not_key",
        )
        self.assertEqual(no_escape_engine.analyse_calls, [])

    def test_incomplete_or_bound_search_fails_closed(self):
        terminal = TerminalPosition(
            "3k5/9/5N3/9/9/9/9/9/9/4K4 b - - 0 1", True, "black"
        )
        removed = octagonal_horse_removed_fens(terminal)[0][1]
        move = "d10e10"
        status = PositionStatus(removed, False, (move,))
        engine = RemovalEngine(
            {removed: status},
            search_result(EngineScore("cp", 300, (700, 200, 100), "upper"), move),
        )
        evidence = verify_removed_motif(
            engine, terminal, OCTAGONAL_HORSE_THEME, removed, nodes=10
        )
        self.assertEqual(evidence["outcome"], "inconclusive")

    def test_octagonal_horse_uses_one_removed_candidate(self):
        fen = "3a1k3/4aP3/3N5/9/9/6r2/9/9/3p5/4K4 b - - 0 1"
        terminal = TerminalPosition(fen, True, "black")
        horse, removed = octagonal_horse_removed_fens(terminal)[0]
        status = PositionStatus(removed, False, ("f10e10", "f10f9"))
        engine = RemovalEngine(
            {removed: status},
            search_result(EngineScore("mate", 1), "f10f9"),
        )
        evidence = verify_removed_motif(
            engine, terminal, OCTAGONAL_HORSE_THEME, removed, nodes=100
        )
        self.assertEqual(evidence["outcome"], "key")
        self.assertEqual(
            evidence["piece_square"] if "piece_square" in evidence else horse, horse
        )


if __name__ == "__main__":
    unittest.main()
