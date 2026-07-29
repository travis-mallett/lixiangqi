from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

from tools.xiangqi_data.engine import PositionRequest, create_board, line_notation
from tools.xiangqi_data.pikafish import Pikafish, to_engine_move, to_ui_move


class XiangqiAnalysisTest(unittest.TestCase):
    def test_pikafish_and_browser_coordinates_round_trip(self) -> None:
        self.assertEqual("h0g2", to_engine_move("h1g3"))
        self.assertEqual("h1g3", to_ui_move("h0g2"))
        self.assertEqual("a9a8", to_engine_move("a10a9"))

    def test_principal_variation_is_rendered_in_wxf(self) -> None:
        board = create_board(PositionRequest())
        self.assertEqual(["H2+3", "H8+7"], line_notation(board, ["h1g3", "h10g8"]))

    def test_pikafish_stream_emits_each_completed_multipv_depth(self) -> None:
        board = create_board(PositionRequest())
        engine = Pikafish(Path("missing-pikafish"))
        output = iter(
            [
                "info depth 1 seldepth 2 multipv 1 score cp 12 nodes 10 nps 1000 time 10 pv h0g2",
                "info depth 1 seldepth 2 multipv 2 score cp 8 nodes 10 nps 1000 time 10 pv b0c2",
                "info depth 2 seldepth 3 multipv 1 score cp 18 nodes 30 nps 1500 time 20 pv h0g2",
                "info depth 2 seldepth 3 multipv 2 score cp 11 nodes 30 nps 1500 time 20 pv b0c2",
                "bestmove h0g2",
            ]
        )
        with (
            patch.object(engine, "_ensure_started"),
            patch.object(engine, "_send"),
            patch.object(engine, "_read_until"),
            patch.object(engine, "_read_line", side_effect=lambda _deadline: next(output)),
        ):
            snapshots = list(engine.analyze_stream(board, multi_pv=2))

        self.assertEqual([1, 2, 2], [snapshot["depth"] for snapshot in snapshots])
        self.assertEqual(2, len(snapshots[0]["lines"]))
        self.assertEqual("h1g3", snapshots[-1]["bestMove"])

    def test_closing_pikafish_stream_stops_and_drains_search(self) -> None:
        board = create_board(PositionRequest())
        engine = Pikafish(Path("missing-pikafish"))
        commands: list[str] = []
        output = iter(
            [
                "info depth 1 seldepth 2 multipv 1 score cp 12 nodes 10 nps 1000 time 10 pv h0g2",
                "bestmove h0g2",
            ]
        )
        with (
            patch.object(engine, "_ensure_started"),
            patch.object(engine, "_send", side_effect=commands.append),
            patch.object(engine, "_read_until"),
            patch.object(engine, "_read_line", side_effect=lambda _deadline: next(output)),
        ):
            stream = engine.analyze_stream(board, multi_pv=1)
            next(stream)
            stream.close()

        self.assertEqual("stop", commands[-1])

if __name__ == "__main__":
    unittest.main()
