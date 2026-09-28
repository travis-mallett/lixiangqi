"""Focused regression tests for the engine/discovery boundary."""

from pathlib import Path
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from tools.xiangqi_data.puzzle_mining.discovery import DiscoveryConfig, discover_game
from tools.xiangqi_data.puzzle_mining.engine import (
    EngineCancelled,
    IncompleteSearchError,
    OfflinePikafish,
    _nnue_identity,
)
from tools.xiangqi_data.puzzle_mining.models import (
    EngineScore,
    SearchContext,
    SearchLine,
    SearchResult,
)
from tools.xiangqi_data.puzzle_mining.workers import start_workers


def _line(multipv: int, depth: int, move: str, *, bound: str | None = None) -> str:
    return (
        f"info depth {depth} seldepth {depth + 2} multipv {multipv} nodes 100 "
        f"time 10 score cp 20 wdl 600 200 200"
        + (f" {bound}bound" if bound else "")
        + f" pv {move.replace('10', '0')}"
    )


class FakePikafish(OfflinePikafish):
    def __init__(self, lines: list[str]) -> None:
        super().__init__(Path("does-not-exist"))
        self._lines = iter(lines)

    def start(self) -> None:
        self.engine_version = "fake"
        self.nnue = "fake"

    def _send(self, command: str) -> None:
        pass

    def _read_until(self, deadline: float) -> str:
        if self.cancel_event is not None and self.cancel_event.is_set():
            raise EngineCancelled
        try:
            return next(self._lines)
        except StopIteration as exc:
            raise TimeoutError from exc


class EngineBoundaryTest(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "Windows engine QoS")
    def test_engine_high_qos_applies_on_launch_and_restart(self):
        import ctypes

        # Bypass virtualenv/Store launchers: their child does not inherit QoS.
        executable = ctypes.create_unicode_buffer(32768)
        self.assertTrue(
            ctypes.windll.kernel32.GetModuleFileNameW(None, executable, len(executable))
        )
        # A real subprocess reports its own Windows policy through a small UCI
        # handshake, exercising the native API rather than mocking its result.
        program = """
import ctypes as c, sys
k = c.WinDLL('kernel32', use_last_error=True)
k.GetCurrentProcess.restype = c.c_void_p
k.GetProcessInformation.argtypes = [c.c_void_p, c.c_int, c.c_void_p, c.c_ulong]
for line in sys.stdin:
    if line.strip() == 'uci':
        state = (c.c_ulong * 3)(1, 0, 0)
        if not k.GetProcessInformation(k.GetCurrentProcess(), 4, c.byref(state), c.sizeof(state)):
            raise c.WinError(c.get_last_error())
        print(f'id name QoS={state[1]},{state[2]}', flush=True)
        print('uciok', flush=True)
    elif line.strip() == 'isready':
        print('readyok', flush=True)
    elif line.strip() == 'quit':
        break
"""
        popen = subprocess.Popen
        with patch(
            "tools.xiangqi_data.puzzle_mining.engine.subprocess.Popen",
            side_effect=lambda argv, **kwargs: popen(
                [executable.value, "-B", "-u", "-c", program], **kwargs
            ),
        ):
            for performance in (False, True):
                with self.subTest(high_performance=performance):
                    engine = OfflinePikafish(
                        Path(sys.executable), high_performance=performance
                    )
                    for _ in range(2):
                        process = None
                        try:
                            engine.start()
                            process = engine.process
                            self.assertIn(
                                f"QoS={int(performance)},0;", engine.engine_version
                            )
                        finally:
                            engine.close()
                            if process:
                                self.assertTrue(process.stdin.closed)
                                self.assertTrue(process.stdout.closed)

    def test_verification_uses_depth_only_and_records_it(self) -> None:
        from tools.xiangqi_data.puzzle_mining.solver import (
            SolverConfig,
            _analyse_with_retry,
        )

        engine = FakePikafish(["readyok", _line(1, 20, "a4a5"), "bestmove a4a5"])
        commands = []
        engine._send = commands.append
        result = _analyse_with_retry(
            engine,
            SearchContext("fen", ()),
            depth=20,
            multi_pv=1,
            config=SolverConfig(),
        )
        self.assertEqual([c for c in commands if c.startswith("go ")], ["go depth 20"])
        self.assertEqual(result.search_depth, 20)
        self.assertIsNone(result.search_nodes)

    def test_cancellation_interrupts_a_waiting_engine_read(self) -> None:
        cancel = threading.Event()
        cancel.set()
        engine = FakePikafish(["readyok"])
        engine.cancel_event = cancel
        with self.assertRaises(EngineCancelled):
            engine.analyse(SearchContext("fen", ()), nodes=10, multi_pv=1)

    def test_explicit_terminal_bestmove_is_an_empty_search(self) -> None:
        engine = FakePikafish(["readyok", "bestmove (none)"])
        result = engine.analyse(SearchContext("fen", ()), nodes=10, multi_pv=1)
        self.assertEqual(result.lines, ())
        self.assertIsNone(result.best_move)

    def test_bestmove_cannot_disagree_with_deepest_complete_snapshot(self) -> None:
        engine = FakePikafish(
            [
                "readyok",
                _line(1, 10, "a4a5"),
                _line(2, 10, "b4b5"),
                _line(1, 11, "c4c5"),
                _line(2, 11, "d4d5"),
                # Deliberately stale: the canonical move is PV 1 at depth 11.
                "bestmove a4a5",
            ]
        )
        result = engine.analyse(SearchContext("fen", ()), nodes=10, multi_pv=2)
        self.assertEqual(result.primary.depth, 11)
        self.assertEqual(result.primary.moves[0], "c5c6")
        self.assertEqual(result.best_move, "c5c6")

    def test_incomplete_deeper_iteration_does_not_mix_with_previous_snapshot(
        self,
    ) -> None:
        engine = FakePikafish(
            [
                "readyok",
                _line(1, 10, "a4a5"),
                _line(2, 10, "b4b5"),
                _line(1, 11, "c4c5"),
                "bestmove c4c5",
            ]
        )
        result = engine.analyse(SearchContext("fen", ()), nodes=10, multi_pv=2)
        self.assertEqual(result.primary.depth, 10)
        self.assertEqual(result.best_move, "a5a6")

    def test_bounded_only_snapshot_is_inconclusive(self) -> None:
        engine = FakePikafish(
            ["readyok", _line(1, 10, "a4a5", bound="lower"), "bestmove a4a5"]
        )
        with self.assertRaises(IncompleteSearchError):
            engine.analyse(SearchContext("fen", ()), nodes=10, multi_pv=1)

    def test_failed_search_replaces_protocol_queue_before_retry(self) -> None:
        engine = FakePikafish(["readyok", _line(1, 10, "a4a5"), "bestmove a4a5"])
        with self.assertRaises(IncompleteSearchError):
            engine.analyse(SearchContext("fen", ()), nodes=10, multi_pv=2)
        engine._lines = iter(
            [
                "readyok",
                _line(1, 11, "c4c5"),
                "bestmove c4c5",
            ]
        )
        result = engine.analyse(SearchContext("fen", ()), nodes=10, multi_pv=1)
        self.assertEqual(result.best_move, "c5c6")

    def test_binary_and_nnue_fingerprints_use_contents(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            executable = root / "bin" / "pikafish"
            executable.parent.mkdir()
            executable.write_bytes(b"engine-v1")
            nnue = root / "eval.nnue"
            nnue.write_bytes(b"nnue-v1")
            first = OfflinePikafish(executable)
            first_nnue = _nnue_identity(executable, "eval.nnue")
            executable.write_bytes(b"engine-v2")
            nnue.write_bytes(b"nnue-v2")
            second = OfflinePikafish(executable)
            second_nnue = _nnue_identity(executable, "eval.nnue")
            self.assertNotEqual(first.engine_version, second.engine_version)
            self.assertNotEqual(first_nnue, second_nnue)

    def test_worker_start_failure_stops_already_started_children(self) -> None:
        class FakeEvent:
            def __init__(self):
                self.set_called = False

            def set(self):
                self.set_called = True

        class FakeProcess:
            def __init__(self, fail=False):
                self.fail = fail
                self.alive = False
                self.joined = False

            def start(self):
                if self.fail:
                    raise RuntimeError("startup failure")
                self.alive = True

            def join(self, timeout=None):
                self.joined = True
                self.alive = False

            def is_alive(self):
                return self.alive

            def terminate(self):
                self.alive = False

        event = FakeEvent()
        workers = [FakeProcess(), FakeProcess(fail=True)]
        with self.assertRaises(RuntimeError):
            start_workers(workers, event)
        self.assertTrue(event.set_called)
        self.assertTrue(all(worker.joined and not worker.alive for worker in workers))


class DiscoveryBoundaryTest(unittest.TestCase):
    def test_terminal_endpoint_does_not_discard_prior_candidate(self) -> None:
        config = DiscoveryConfig(
            depth=100,
            loss=0.50,
            tactic_advantage=0.55,
        )

        def analyse(context: SearchContext, nodes: int) -> SearchResult:
            if context.initial_fen.split()[1] == "b":
                score = EngineScore("mate", 1, None)
                return SearchResult(
                    "fake",
                    "fake",
                    "a7a6",
                    (SearchLine(1, 10, 10, 100, 1, score, ("a7a6",)),),
                )
            if "P1P1P1P1P" in context.initial_fen:
                score = EngineScore("cp", 20, (650, 250, 100))
                return SearchResult(
                    "fake",
                    "fake",
                    "b1c3",
                    (SearchLine(1, 10, 10, 100, 1, score, ("b1c3",)),),
                )
            # The final position has no legal move/PV.  Discovery must still
            # retain the candidate caused by the recorded move.
            return SearchResult("fake", "fake", None, ())

        # The second move reaches a terminal position.  The first move is a
        # mating loss, and must still be retained as a candidate.
        class TerminalEngine:
            def new_game(self):
                self.resets = getattr(self, "resets", 0) + 1

            def inspect(self, context: SearchContext):
                from tools.xiangqi_data.puzzle_mining.models import PositionStatus

                return PositionStatus("terminal", False, ())

        engine = TerminalEngine()
        candidates = discover_game(
            engine,
            source_database="test",
            game_id="terminal",
            source_url="",
            moves=["a4a5", "a7a6"],
            config=config,
            analyse=analyse,
        )
        self.assertEqual(len(candidates), 1)
        self.assertEqual(engine.resets, 1)
