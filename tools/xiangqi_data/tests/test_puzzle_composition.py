"""Composition acceptance, reverse captures, and anti-duplication regressions."""

import json
import random
import tempfile
import unittest
from contextlib import redirect_stderr
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_composition.board import (
    admissible,
    fen,
    play,
    reverse_geometry,
    split_move,
    valid_material,
)
from tools.xiangqi_data.puzzle_composition.cli import main
from tools.xiangqi_data.puzzle_composition.diversity import DiversityIndex, fingerprints
from tools.xiangqi_data.puzzle_composition.kernels import seeds
from tools.xiangqi_data.puzzle_composition.oracle import Oracle
from tools.xiangqi_data.puzzle_composition.retro import add_static
from tools.xiangqi_data.puzzle_composition.search import Candidate, SearchConfig, extend
from tools.xiangqi_data.puzzle_composition.verification import (
    Rejected,
    certify,
    exact_short_mate,
)
from tools.xiangqi_data.puzzle_mining.engine import (
    ConstructionTimeout,
    OfflinePikafish,
    construction_budget,
)
from tools.xiangqi_data.puzzle_mining.models import PositionStatus, SearchContext
from tools.xiangqi_data.puzzle_mining.position import decode_position

# Regression fixture only. The generator never loads these composed examples.
ROOT = "5c3/3n1k3/3ara3/4PR3/5N3/4C2N1/9/9/9/2BAKAB2 w - - 0 1"
MOVES = ("h5g7", "f9e9", "e7e8", "e9e8", "f7e7")
CHECKERS = ("e5", "f6", "e7", "g7")


def line_fens(root=ROOT, moves=MOVES):
    values = [root]
    for move in moves:
        values.append(play(values[-1], move))
    return values


class MaterialAndReverseTest(unittest.TestCase):
    def test_material_and_unreachable_uncrossed_pawns(self):
        board = decode_position(ROOT)
        self.assertTrue(valid_material(board))
        for location in ("a4", "a5"):
            board[location] = "P"
        self.assertFalse(valid_material(board))
        del board["a5"]
        board["c5"] = "P"
        self.assertTrue(valid_material(board))
        board["a10"] = "A"
        self.assertFalse(valid_material(board))

    def test_piece_territory_and_direction(self):
        self.assertFalse(admissible("p", "e8"))
        self.assertTrue(admissible("b", "e8"))
        self.assertFalse(admissible("P", "b5"))
        self.assertTrue(admissible("P", "b6"))
        self.assertFalse(reverse_geometry("P", "e8", "e7", {}, False))
        self.assertTrue(reverse_geometry("P", "f7", "e7", {}, False))
        self.assertEqual(split_move("e10d8"), ("e10", "d8"))

    def test_cannon_uncapture_needs_a_screen(self):
        self.assertTrue(reverse_geometry("c", "a9", "d9", {"b9": "N"}, True))
        self.assertFalse(reverse_geometry("c", "a9", "d9", {}, True))
        self.assertFalse(
            reverse_geometry("c", "a9", "d9", {"b9": "N", "c9": "P"}, True)
        )
        self.assertFalse(reverse_geometry("c", "a9", "d9", {"b9": "N"}, False))

    def test_added_defender_must_stay_off_entire_line(self):
        for location in ("h5", "g7", "e8", "e9", "e7"):
            self.assertIsNone(add_static(ROOT, MOVES, {location: "r"}))
        self.assertIsNotNone(add_static(ROOT, MOVES, {"a6": "r"}))
        self.assertIsNone(add_static(ROOT, MOVES, {"a6": "n", "b6": "n"}))


class DiversityTest(unittest.TestCase):
    def record(self, values=None, moves=MOVES, checkers=CHECKERS):
        return {"diversity": fingerprints(values or line_fens(), moves, checkers)}

    def test_same_ending_rejects_cosmetic_remote_piece(self):
        board = decode_position(ROOT)
        board["a5"] = "p"
        cosmetic = self.record(line_fens(fen(board)))
        self.assertEqual(
            DiversityIndex([self.record()]).conflict(cosmetic), "same_checking_geometry"
        )

    def test_file_reflection_and_color_reversal_are_duplicates(self):
        def transform_square(s, flip_color):
            return chr(105 - (ord(s[0]) - 97)) + str(
                11 - int(s[1:]) if flip_color else int(s[1:])
            )

        for flip_color in (False, True):
            transformed = []
            for value in line_fens():
                board = {
                    transform_square(s, flip_color): p.swapcase() if flip_color else p
                    for s, p in decode_position(value).items()
                }
                side = value.split()[1]
                if flip_color:
                    side = "b" if side == "w" else "w"
                transformed.append(fen(board, side))
            moves = tuple(
                "".join(transform_square(s, flip_color) for s in split_move(m))
                for m in MOVES
            )
            checkers = tuple(transform_square(s, flip_color) for s in CHECKERS)
            self.assertEqual(
                self.record()["diversity"],
                self.record(transformed, moves, checkers)["diversity"],
            )

    def test_longer_puzzle_cannot_reuse_shorter_solution(self):
        short = self.record(line_fens()[2:], MOVES[2:])
        long = self.record()
        # Independently exercise the suffix rule even if geometry differs.
        long["diversity"]["geometry"] = "another-geometry"
        self.assertEqual(
            DiversityIndex([short]).conflict(long), "shared_ending_sequence"
        )
        self.assertEqual(
            DiversityIndex([long]).conflict(short), "shared_ending_sequence"
        )

    def test_different_checker_material_is_not_a_cosmetic_change(self):
        board = decode_position(ROOT)
        board["f7"] = "P"
        pawn = self.record(line_fens(fen(board)))
        self.assertIsNone(DiversityIndex([self.record()]).conflict(pawn))

    def test_incomplete_line_is_not_fingerprinted(self):
        with self.assertRaises(ValueError):
            fingerprints(line_fens()[:-1], MOVES, CHECKERS)


class ExactProofTest(unittest.TestCase):
    def oracle(self, alternative):
        root = "root w - - 0 1"
        tree = {
            root: PositionStatus(root, False, ("a", "b")),
            "mate b": PositionStatus("mate b", True, ()),
            "other b": PositionStatus(
                "other b",
                alternative == "mate",
                () if alternative != "ongoing" else ("c",),
            ),
        }
        oracle = SimpleNamespace(engine=SimpleNamespace(), status=lambda f: tree[f])
        return root, oracle

    def test_quiet_stalemate_and_equal_mate_both_defeat_uniqueness(self):
        for alternative in ("stalemate", "mate"):
            root, oracle = self.oracle(alternative)
            with (
                patch(
                    "tools.xiangqi_data.puzzle_composition.verification.play",
                    side_effect=lambda f, m: "mate b" if m == "a" else "other b",
                ),
                self.assertRaisesRegex(Rejected, "uniqueness"),
            ):
                exact_short_mate(oracle, [root, "mate b"], ("a",))

    def test_exhaustive_label_cannot_be_used_for_longer_search(self):
        with self.assertRaises(ValueError):
            exact_short_mate(None, [], tuple("abcdefg"))


class CommandLineTest(unittest.TestCase):
    def test_invalid_lengths_and_existing_outputs_fail_before_engine_start(self):
        with tempfile.TemporaryDirectory() as temporary, redirect_stderr(StringIO()):
            path = Path(temporary)
            for extra in (
                ["--mates", "0,3"],
                ["--mates", "16"],
                ["--mates", "x"],
                ["--depth", "19"],
                ["--tail-plies", "4"],
                ["--seconds", "nan"],
                ["--seed-seconds", "inf"],
            ):
                with self.assertRaises(SystemExit) as result:
                    main(["--output", str(path), *extra])
                self.assertEqual(result.exception.code, 2)
            sentinel = path / "keep.txt"
            sentinel.write_text("preserve", encoding="utf-8")
            with self.assertRaises(SystemExit):
                main(["--output", str(path)])
            self.assertEqual(sentinel.read_text(), "preserve")


@unittest.skipUnless(default_executable().is_file(), "native Pikafish required")
class ComposerIntegrationTest(unittest.TestCase):
    def test_engine_restart_releases_pipes_and_reader(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for _ in range(2):
            engine.start()
            process, reader = engine.process, engine._reader
            engine.close()
            self.assertIsNotNone(process.poll())
            self.assertTrue(process.stdin.closed)
            self.assertTrue(process.stdout.closed)
            self.assertFalse(reader.is_alive())

    def test_crashed_engine_and_expired_search_release_resources(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        engine.start()
        process, reader = engine.process, engine._reader
        process.kill()
        process.wait(timeout=5)
        engine.start()
        self.assertTrue(process.stdin.closed)
        self.assertTrue(process.stdout.closed)
        self.assertFalse(reader.is_alive())
        process, reader = engine.process, engine._reader
        engine.construction_deadline = 0
        with self.assertRaises(ConstructionTimeout):
            engine.inspect(SearchContext(ROOT, ()))
        self.assertIsNone(engine.process)
        self.assertIsNotNone(process.poll())
        self.assertTrue(process.stdin.closed)
        self.assertTrue(process.stdout.closed)
        self.assertFalse(reader.is_alive())

    def test_unattended_seed_reverse_captures_and_certification(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        oracle = Oracle(engine)
        rng = random.Random(20260922)
        with construction_budget(engine, 45):
            kernel = next(seeds(oracle, rng, max_variants=3))
            self.assertNotEqual(kernel.fen, ROOT)
            found = extend(
                Candidate(kernel.fen, (kernel.move,), kernel.family),
                oracle,
                rng,
                SearchConfig(beam=2),
            )
            self.assertTrue(found)
            item = found[0]
            self.assertTrue(
                any(
                    step["restored_by_attacker"] or step["restored_by_defender"]
                    for step in item.construction
                )
            )
            result = certify(item, oracle, exact_through=2)
            self.assertEqual(result["mate"], 2)
            self.assertEqual(
                result["verification"]["method"], "exhaustive_bounded_minimax"
            )
            self.assertEqual(len(result["terminal_checkers"]), 4)
            self.assertEqual(result["legal_move_counts"][1::2], [1, 0])

    def test_time_limit_persists_partial_status_and_closes_engine(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = main(["--output", temporary, "--seconds", "0.00001"])
            self.assertEqual(result, 2)
            report = json.loads((Path(temporary) / "run.json").read_text())
            self.assertEqual(report["status"], "time_limit")
            self.assertEqual(
                json.loads((Path(temporary) / "puzzles.json").read_text())["puzzles"],
                [],
            )


if __name__ == "__main__":
    unittest.main()
