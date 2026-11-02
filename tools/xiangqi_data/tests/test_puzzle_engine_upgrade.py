"""Upgrade boundaries: fatal UCI output, native inspection, and worker ownership."""

import io
import json
from pathlib import Path
import queue
import threading
import unittest
from unittest.mock import Mock, patch

from external.pikafish_worker.ai import PikafishMoveEngine
from tools.xiangqi_data.native_rules import NativeRules
from tools.xiangqi_data.pikafish import EngineUnavailable, Pikafish, read_uci_line
from tools.xiangqi_data.pikafish_rules import (
    PikafishGameValidator,
    START_FEN,
    default_executable,
)
from tools.xiangqi_data.puzzle_mining.engine import (
    ConstructionTimeout,
    EngineCancelled,
    EngineProtocolError,
    OfflinePikafish,
)
from tools.xiangqi_data.puzzle_mining.models import SearchContext
from tools.xiangqi_data.puzzle_mining.workers import WorkerClaimLost


class UciFailureTests(unittest.TestCase):
    def test_buffered_result_is_read_even_after_deadline(self):
        output = queue.Queue()
        output.put("bestmove h0g2")
        self.assertEqual(read_uci_line(output, 0), "bestmove h0g2")

    def test_eof_and_critical_errors_close_both_live_clients(self):
        for factory in (Pikafish, PikafishMoveEngine):
            for line in (
                None,
                "info string CRITICAL ERROR: invalid FEN",
                "info string ERROR: missing NNUE",
            ):
                with self.subTest(client=factory.__name__, line=line):
                    engine = factory()
                    engine.output.put(line)
                    with patch.object(engine, "close") as close:
                        with self.assertRaises(EngineUnavailable):
                            engine._read_line(float("inf"))
                        close.assert_called_once()

    def test_reader_reports_eof_to_its_own_generation(self):
        for factory in (Pikafish, PikafishMoveEngine):
            output = queue.Queue()
            process = Mock(stdout=io.StringIO("readyok\n"))
            factory._pump_output(process, output)
            self.assertEqual(list(output.queue), ["readyok", None])

    def test_validator_reports_rejected_input_as_invalid_not_unavailable(self):
        engine = PikafishGameValidator()
        engine.process = Mock(
            stdout=io.StringIO("info string CRITICAL ERROR: illegal move\n")
        )
        with patch.object(engine, "close") as close:
            with self.assertRaisesRegex(ValueError, "illegal move"):
                engine._read_line()
            close.assert_called_once()

    def test_mining_reader_surfaces_native_diagnostic(self):
        engine = OfflinePikafish(Path("missing"))
        engine.output.put("info string CRITICAL ERROR: invalid FEN")
        with self.assertRaisesRegex(EngineProtocolError, "invalid FEN"):
            engine._read_until(float("inf"))


class NativeInspectionTests(unittest.TestCase):
    def bridge(self):
        rules = NativeRules(java="java")
        rules.start = Mock()
        rules.process = Mock()
        rules.close = Mock()
        return rules

    def test_wait_renews_lease_and_observes_cancellation_without_response(self):
        rules = self.bridge()
        rules.output = Mock()
        rules.output.get.side_effect = queue.Empty
        cancelled = EngineCancelled("stop")
        heartbeat = Mock(side_effect=[None, None, cancelled])
        with self.assertRaises(EngineCancelled) as raised:
            rules.position(START_FEN, (), inspection=True, on_wait=heartbeat)
        self.assertIs(raised.exception, cancelled)
        self.assertEqual(heartbeat.call_count, 3)
        rules.close.assert_called_once()
        self.assertTrue(
            all(
                call.kwargs["timeout"] <= 0.25
                for call in rules.output.get.call_args_list
            )
        )

    def test_complete_history_is_sent_and_checkers_required(self):
        rules = self.bridge()
        state = {"fen": START_FEN, "turn": "red", "gameResult": "*", "legalMoves": []}
        rules.output.put(json.dumps(state))
        with self.assertRaisesRegex(ValueError, "checking pieces"):
            rules.position(START_FEN, ("h1g3", "h10g8"), inspection=True)
        self.assertEqual(
            json.loads(rules.process.stdin.write.call_args.args[0]),
            {
                "initialFen": START_FEN,
                "moves": ["h1g3", "h10g8"],
                "inspection": True,
            },
        )

    def test_inspection_preserves_shutdown_deadline_and_lease_exceptions(self):
        for error in (
            EngineCancelled("stop"),
            ConstructionTimeout("budget"),
            WorkerClaimLost("reclaimed"),
        ):
            engine = OfflinePikafish(Path("missing"))
            engine._rules = Mock()
            rules = engine._rules

            def inspect(*args, **kwargs):
                engine.heartbeat = Mock(side_effect=error)
                kwargs["on_wait"]()

            rules.position.side_effect = inspect
            with self.subTest(error=type(error).__name__), self.assertRaises(
                type(error)
            ) as raised:
                engine.inspect(SearchContext(START_FEN, ()))
            self.assertIs(raised.exception, error)
            rules.close.assert_called_once()
            self.assertIsNone(engine._rules)

    def test_already_cancelled_inspection_never_starts_java(self):
        stop = threading.Event()
        stop.set()
        engine = OfflinePikafish(Path("missing"), cancel_event=stop)
        with patch("tools.xiangqi_data.puzzle_mining.engine.NativeRules") as factory:
            with self.assertRaises(EngineCancelled):
                engine.inspect(SearchContext(START_FEN, ()))
            factory.assert_not_called()

    @unittest.skipUnless(default_executable().is_file(), "installed Pikafish required")
    def test_native_replay_agrees_with_upgraded_engine_and_handles_counterfactuals(
        self,
    ):
        engine = OfflinePikafish(default_executable())
        try:
            with PikafishGameValidator() as oracle:
                moves = ("h1g3", "h10g8", "b1c3", "b10c8")
                for count in range(len(moves) + 1):
                    state = engine.inspect(SearchContext(START_FEN, moves[:count]))
                    fen, checked = oracle.inspect(START_FEN, moves[:count])
                    self.assertEqual(state.fen, fen)
                    self.assertEqual(state.checked, checked)
                    self.assertEqual(
                        set(state.legal_moves), set(oracle.legal_moves(fen))
                    )
            # An advisor outside its legal squares is useful occupancy for motif proofs,
            # but the new NNUE validator correctly rejects it as a searchable position.
            fen = "9/4k4/4a4/9/9/R8/9/9/9/3KC4 b - - 1 1"
            self.assertEqual(
                engine.checking_pieces(SearchContext(fen, ())), (fen, ("e1",))
            )
        finally:
            engine.close()
