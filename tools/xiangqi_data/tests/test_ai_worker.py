from __future__ import annotations

import unittest
import json
import random
from unittest.mock import Mock, call

from external.pikafish_worker.ai import (
    STRENGTH_PROFILES,
    AiWorker,
    MoveWork,
    PikafishMoveEngine,
)


class PikafishAiWorkerTest(unittest.TestCase):
    def test_tiantian_turn_key_matches_server_and_includes_policy(self) -> None:
        work = MoveWork(
            "aikey001", 5,
            "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1",
            (), ruleset="tiantian-v1", legal_moves=("a4a5",),
        )
        self.assertEqual("7a1db703beeda4a3b9871eae7b6dd66025e95bbd0663b172d975bd02e1126d49", work.computed_turn_key)

    def test_search_is_restricted_to_server_permitted_moves(self) -> None:
        for level in (1, 9):
            engine = PikafishMoveEngine()
            engine._ensure_started = Mock()
            engine._send = Mock()
            engine._read_until = Mock()
            engine._read_line = Mock(side_effect=("bestmove a0a1",))
            work = MoveWork("abcd1234", level, "fen", (), ruleset="tiantian-v1", legal_moves=("b1c3",))
            self.assertEqual("b1c3", engine.best_move(work, STRENGTH_PROFILES[level - 1]))
            self.assertIn(call(f"go nodes {STRENGTH_PROFILES[level - 1].nodes} searchmoves b0c2"), engine._send.call_args_list)

    def test_engine_draw_does_not_override_site_adjudication(self) -> None:
        engine = PikafishMoveEngine()
        work = MoveWork("abcd1234", 9, "fen", (), ruleset="tiantian-v1", legal_moves=("b1c3",))
        self.assertEqual("b1c3", engine._permitted_result(None, work))

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

    def test_parses_and_verifies_versioned_move_work(self) -> None:
        work = MoveWork(
            "abcd1234",
            5,
            "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1",
            ("h3e3", "h8e8"),
            request_id="request12345",
        )
        payload = json.dumps(
            {
                "version": 2,
                "type": "move",
                "requestId": work.request_id,
                "gameId": work.game_id,
                "turnKey": work.computed_turn_key,
                "level": work.level,
                "position": {
                    "variant": "xiangqi",
                    "initialFen": work.initial_fen,
                    "moves": list(work.moves),
                },
            }
        )

        parsed = MoveWork.parse_v2(payload)

        self.assertEqual(work.game_id, parsed.game_id)
        self.assertEqual(work.request_id, parsed.request_id)
        self.assertEqual(work.computed_turn_key, parsed.turn_key)

    def test_turn_key_matches_the_server_contract_vector(self) -> None:
        work = MoveWork(
            "aikey001",
            5,
            "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1",
            (),
        )

        self.assertEqual(
            "642cc6d1a03e937016a7bd812d2b964ec0aa573ac0cea610f5230e4a6fe731f5",
            work.computed_turn_key,
        )

    def test_rejects_a_versioned_work_identity_mismatch(self) -> None:
        valid_key = "0" * 64
        payload = json.dumps(
            {
                "version": 2,
                "type": "move",
                "requestId": "request12345",
                "gameId": "abcd1234",
                "turnKey": valid_key,
                "level": 5,
                "position": {
                    "variant": "xiangqi",
                    "initialFen": "fen",
                    "moves": [],
                },
            }
        )

        with self.assertRaisesRegex(ValueError, "turn key"):
            MoveWork.parse_v2(payload)

    def test_rejects_malformed_versioned_identity_fields(self) -> None:
        payload = {
            "version": 2,
            "type": "move",
            "requestId": "short",
            "gameId": "abcd1234",
            "turnKey": "0" * 64,
            "level": 5,
            "position": {
                "variant": "xiangqi",
                "initialFen": "fen",
                "moves": [],
            },
        }

        with self.assertRaisesRegex(ValueError, "request ID"):
            MoveWork.parse_v2(json.dumps(payload))

    def test_converts_canonical_coordinates_at_the_uci_boundary(self) -> None:
        self.assertEqual("a0a9", PikafishMoveEngine._to_engine_move("a1a10"))
        self.assertEqual("i10i1", PikafishMoveEngine._to_ui_move("i9i0"))

    def test_strength_profiles_span_sampling_then_search_work(self) -> None:
        self.assertEqual(
            (
                (149, 2, 1.2109662691040561),
                (149, 2, 1.1654821783005245),
                (149, 2, 1.12170647737457),
                (149, 2, 1.0795749989234302),
                (149, 1, 1.0),
                (7_849, 1, 1.0),
                (24_389, 1, 1.0),
                (235_500, 1, 1.0),
                (3_318_000, 1, 1.0),
            ),
            tuple(
                (profile.nodes, profile.multi_pv, profile.expected_rank)
                for profile in STRENGTH_PROFILES
            ),
        )
        self.assertGreater(STRENGTH_PROFILES[0].expected_rank, 1.0)
        self.assertEqual(STRENGTH_PROFILES[-1].expected_rank, 1.0)
        self.assertEqual(STRENGTH_PROFILES[-1].multi_pv, 1)

    def test_weak_move_sampling_is_seed_reproducible(self) -> None:
        candidates = {1: "a0a1", 2: "b0b1", 3: "c0c1"}
        first = PikafishMoveEngine._sample_adjacent_rank(candidates, 1.8, random.Random(3))
        second = PikafishMoveEngine._sample_adjacent_rank(candidates, 1.8, random.Random(3))
        self.assertEqual(first, second)

    def test_level_nine_uses_fixed_work_and_the_engine_best_move(self) -> None:
        engine = PikafishMoveEngine()
        engine._ensure_started = Mock()
        engine._send = Mock()
        engine._read_until = Mock()
        engine._read_line = Mock(
            side_effect=(
                "info depth 22 multipv 1 score cp 40 wdl 500 400 100 pv a0a1",
                "bestmove a0a1",
            )
        )

        move = engine.best_move(
            MoveWork("abcd1234", 9, "fen", ()), STRENGTH_PROFILES[8]
        )

        self.assertEqual("a1a2", move)
        self.assertIn(call("setoption name MultiPV value 1"), engine._send.call_args_list)
        self.assertIn(call("go nodes 3318000"), engine._send.call_args_list)

    def test_profile_rejects_levels_outside_the_public_range(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unsupported computer level"):
            AiWorker._profile(0)
        with self.assertRaisesRegex(ValueError, "Unsupported computer level"):
            AiWorker._profile(10)

    def test_lease_has_headroom_over_the_cold_engine_deadline(self) -> None:
        self.assertGreaterEqual(
            AiWorker.LEASE_SECONDS,
            PikafishMoveEngine.MAX_COLD_WORK_SECONDS * 2,
        )

    def test_releases_deduplication_lock_when_engine_fails(self) -> None:
        worker = AiWorker.__new__(AiWorker)
        worker.publisher = Mock()
        worker.publisher.execute.side_effect = lambda *args: "OK" if args[0] == "SET" else 1
        worker.engine = Mock()
        worker.engine.best_move.side_effect = RuntimeError("Pikafish stopped")

        worker._process(
            "abcd1234;1;;xiangqi;"
            "rnbakabnr/9/1c5c1/p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1;"
        )

        release = worker.publisher.execute.call_args_list[-1].args
        self.assertEqual("EVAL", release[0])
        self.assertEqual("lixiangqi:ai:abcd1234:", release[3])

    def test_versioned_success_echoes_identity_and_caches_its_owned_result(self) -> None:
        worker = AiWorker.__new__(AiWorker)
        worker.publisher = Mock()

        def execute(*args: str) -> object:
            if args[0] == "GET":
                return None
            if args[0] in {"SET", "EVAL"}:
                return "OK"
            return 1

        worker.publisher.execute.side_effect = execute
        worker.engine = Mock()
        worker.engine.best_move.return_value = "a1a2"
        work = MoveWork(
            "abcd1234",
            5,
            "fen",
            (),
            request_id="request12345",
        )
        payload = json.dumps(
            {
                "version": 2,
                "type": "move",
                "requestId": work.request_id,
                "gameId": work.game_id,
                "turnKey": work.computed_turn_key,
                "level": work.level,
                "position": {
                    "variant": "xiangqi",
                    "initialFen": work.initial_fen,
                    "moves": [],
                },
            }
        )

        worker._process(payload, v2=True)

        completed = worker.publisher.execute.call_args_list[-2].args
        self.assertEqual("EVAL", completed[0])
        self.assertEqual(f"lixiangqi:ai:{work.game_id}:{work.request_id}", completed[3])
        self.assertEqual(f"done:a1a2", completed[5])
        published = worker.publisher.execute.call_args_list[-1].args
        self.assertEqual(("PUBLISH", AiWorker.V2_RESULT_CHANNEL), published[:2])
        result = json.loads(published[2])
        self.assertEqual("move", result["type"])
        self.assertEqual(work.request_id, result["requestId"])
        self.assertEqual(work.computed_turn_key, result["turnKey"])
        self.assertEqual(4, worker.publisher.execute.call_count)

    def test_versioned_duplicate_republishes_the_cached_result_without_computing(self) -> None:
        worker = AiWorker.__new__(AiWorker)
        worker.publisher = Mock()
        worker.publisher.execute.side_effect = ("done:a1a2", 1)
        worker.engine = Mock()
        work = MoveWork(
            "abcd1234",
            5,
            "fen",
            (),
            request_id="request12345",
        )
        payload = json.dumps(
            {
                "version": 2,
                "type": "move",
                "requestId": work.request_id,
                "gameId": work.game_id,
                "turnKey": work.computed_turn_key,
                "level": work.level,
                "position": {
                    "variant": "xiangqi",
                    "initialFen": work.initial_fen,
                    "moves": [],
                },
            }
        )

        worker._process(payload, v2=True)

        worker.engine.best_move.assert_not_called()
        self.assertEqual(
            ("GET", f"lixiangqi:ai:{work.game_id}:{work.request_id}"),
            worker.publisher.execute.call_args_list[0].args,
        )
        result = json.loads(worker.publisher.execute.call_args_list[1].args[2])
        self.assertEqual("a1a2", result["move"])

    def test_lease_contention_neither_computes_nor_releases_another_lease(self) -> None:
        worker = AiWorker.__new__(AiWorker)
        worker.publisher = Mock()
        worker.publisher.execute.return_value = None
        worker.engine = Mock()

        worker._process(
            "abcd1234;1;;xiangqi;"
            "rnbakabnr/9/1c5c1/p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1;"
        )

        worker.engine.best_move.assert_not_called()
        self.assertEqual(1, worker.publisher.execute.call_count)

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
