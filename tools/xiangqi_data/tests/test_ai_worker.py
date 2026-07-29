from __future__ import annotations

import unittest
from unittest.mock import Mock

from external.pikafish_worker.ai import AiWorker, MoveWork, PikafishMoveEngine


class PikafishAiWorkerTest(unittest.TestCase):
    def test_parses_native_fishnet_move_work(self) -> None:
        work = MoveWork.parse(
            "abcd1234;5;30000 30000 0;xiangqi;"
            "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1;"
            "h3e3 h8e8"
        )

        self.assertEqual("abcd1234", work.game_id)
        self.assertEqual(5, work.level)
        self.assertEqual(("h3e3", "h8e8"), work.moves)
        self.assertEqual("h3e3h8e8", work.sign)

    def test_matches_native_position_sign_at_five_plies(self) -> None:
        work = MoveWork(
            game_id="abcd1234",
            level=1,
            initial_fen="fen",
            moves=("a4a5", "a7a6", "b1c3", "b10c8", "c4c5"),
        )

        self.assertEqual("a7a6b1c3b10c8c4c5", work.sign)

    def test_rejects_non_xiangqi_work(self) -> None:
        with self.assertRaises(ValueError):
            MoveWork.parse("abcd1234;5;;standard;fen;")

    def test_converts_canonical_coordinates_at_the_uci_boundary(self) -> None:
        self.assertEqual("a0a9", PikafishMoveEngine._to_engine_move("a1a10"))
        self.assertEqual("i10i1", PikafishMoveEngine._to_ui_move("i9i0"))

    def test_releases_deduplication_lock_when_engine_fails(self) -> None:
        worker = AiWorker.__new__(AiWorker)
        worker.publisher = Mock()
        worker.publisher.execute.side_effect = ["OK", RuntimeError("Pikafish stopped")]
        worker.engine = Mock()
        worker.engine.best_move.side_effect = RuntimeError("Pikafish stopped")

        worker._process(
            "abcd1234;1;;xiangqi;"
            "rnbakabnr/9/1c5c1/p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1;"
        )

        self.assertEqual(
            worker.publisher.execute.call_args_list[-1].args,
            ("DEL", "lixiangqi:ai:abcd1234:"),
        )

    def test_surfaces_redis_disconnect_for_the_reconnect_loop(self) -> None:
        worker = AiWorker.__new__(AiWorker)
        worker.publisher = Mock()
        worker.publisher.execute.side_effect = ConnectionError("Redis disconnected")
        worker.engine = Mock()

        with self.assertRaises(ConnectionError):
            worker._process(
                "abcd1234;1;;xiangqi;"
                "rnbakabnr/9/1c5c1/p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1;"
            )


if __name__ == "__main__":
    unittest.main()
