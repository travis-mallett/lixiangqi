"""Categorize verified checkmate candidates and promote matched puzzles."""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import sqlite3
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from external.xiangqi_explorer.catalog_databases import (
    catalog_database_id,
    installed_catalog_database_paths,
)
from tools.xiangqi_data.pikafish import _default_executable
from tools.xiangqi_data.pikafish_rules import START_FEN

from .engine import OfflinePikafish, PuzzleEngine
from .models import PositionStatus, SearchContext, SearchLine, fen_side, opposite
from .patterns import TerminalPosition, mate_themes, matching_themes
from .position import normalized_fen
from .progress import ProgressPrinter, format_progress
from .storage import (
    ClaimedCandidate,
    claim_checkmate_candidate,
    finish_candidate,
    open_database,
    promote_puzzle,
    retry_candidate,
)


DEFAULT_DATABASE = Path("data/local/xiangqi-puzzle-mining.sqlite3")
CHECKMATE_CATEGORIZER_VERSION = "2"


@dataclass(frozen=True)
class CategorizerConfig:
    version: str = CHECKMATE_CATEGORIZER_VERSION
    nodes: int = 2_000_000
    attacker_multipv: int = 2
    defense_multipv: int = 4
    uniqueness_gap: float = 0.40
    max_solution_plies: int = 31
    max_defense_branches: int = 8
    engine_threads: int = 1
    hash_mb: int = 128

    def settings(self) -> dict[str, int | float | str]:
        return {
            "version": self.version,
            "nodes": self.nodes,
            "attacker_multipv": self.attacker_multipv,
            "defense_multipv": self.defense_multipv,
            "uniqueness_gap": self.uniqueness_gap,
            "max_solution_plies": self.max_solution_plies,
            "max_defense_branches": self.max_defense_branches,
            "engine_threads": self.engine_threads,
            "hash_mb": self.hash_mb,
        }


@dataclass(frozen=True)
class VerifiedBranch:
    moves: tuple[str, ...]
    terminal: PositionStatus


@dataclass(frozen=True)
class SolveResult:
    branches: tuple[VerifiedBranch, ...]
    engine_version: str
    nnue: str
    nodes: int
    depth: int

    @property
    def primary(self) -> VerifiedBranch:
        return self.branches[0]


class SolutionRejected(RuntimeError):
    pass


class SolutionReview(RuntimeError):
    pass


SolveProgress = Callable[[int, int, int], None]


def classify_mating_patterns(
    branches: tuple[VerifiedBranch, ...],
) -> tuple[str, set[str], list[dict[str, Any]]]:
    """Require strict pattern tags to agree across all co-best defenses."""

    branch_rows: list[dict[str, Any]] = []
    theme_sets: list[set[str]] = []
    for branch in branches:
        terminal = TerminalPosition(
            fen=branch.terminal.fen,
            checkmate=branch.terminal.checkmate,
            losing_side=fen_side(branch.terminal.fen),
        )
        themes = matching_themes(terminal)
        theme_sets.append(themes)
        branch_rows.append(
            {
                "moves": list(branch.moves),
                "terminal_fen": branch.terminal.fen,
                "themes": sorted(themes),
            }
        )
    common_themes = set.intersection(*theme_sets) if theme_sets else set()
    all_themes = set.union(*theme_sets) if theme_sets else set()
    if all_themes != common_themes:
        return "review", common_themes, branch_rows
    if not common_themes:
        return "untagged", common_themes, branch_rows
    return "matched", common_themes, branch_rows


def attacker_move_is_unique(
    lines: tuple[SearchLine, ...], required_gap: float
) -> tuple[bool, str]:
    if len(lines) < 2:
        return False, "only_one_legal_attacker_move"
    best, second = lines[0].score, lines[1].score
    if best.kind == "mate" and best.value > 0:
        if second.kind == "mate" and second.value > 0:
            if best.value < second.value:
                return True, "unique_shortest_mate"
            return False, f"co_best_mate_{second.value}"
        gap = best.expected() - second.expected()
        return gap >= required_gap, f"alternative_gap_{gap:.3f}"
    gap = best.expected() - second.expected()
    return gap >= required_gap, f"alternative_gap_{gap:.3f}"


def equivalent_defense_moves(lines: tuple[SearchLine, ...]) -> tuple[str, ...]:
    """Return exact co-best mate defenses found inside the configured MultiPV."""

    if not lines or lines[0].score.kind != "mate" or lines[0].score.value >= 0:
        return ()
    primary = lines[0]
    moves: list[str] = []
    for line in lines:
        if (
            line.moves
            and line.score.kind == "mate"
            and line.score.value == primary.score.value
            and line.moves[0] not in moves
        ):
            moves.append(line.moves[0])
    return tuple(moves)


def solve_checkmate(
    engine: PuzzleEngine,
    base: SearchContext,
    attacker_side: str,
    config: CategorizerConfig,
    progress: SolveProgress | None = None,
) -> SolveResult:
    """Synthesize all practical co-best-defense lines to actual checkmate."""

    pending: list[tuple[str, ...]] = [()]
    branches: list[VerifiedBranch] = []
    total_nodes = 0
    max_depth = 0
    engine_version = engine.engine_version
    nnue = engine.nnue
    expanded_defenses = 0

    while pending:
        synthetic = pending.pop(0)
        while True:
            context = SearchContext(base.initial_fen, (*base.moves, *synthetic))
            status = engine.inspect(context)
            if not status.legal_moves:
                if not status.checkmate:
                    raise SolutionRejected("terminal_position_is_not_checkmate")
                if fen_side(status.fen) != opposite(attacker_side):
                    raise SolutionRejected("attacker_is_checkmated")
                branches.append(VerifiedBranch(synthetic, status))
                break
            if len(synthetic) >= config.max_solution_plies:
                raise SolutionRejected("solution_too_long")

            if progress is not None:
                progress(
                    len(branches) + 1,
                    len(branches) + len(pending) + 1,
                    len(synthetic) + 1,
                )
            attacker_turn = fen_side(status.fen) == attacker_side
            multi_pv = (
                config.attacker_multipv
                if attacker_turn
                else config.defense_multipv
            )
            result = engine.analyse(context, nodes=config.nodes, multi_pv=multi_pv)
            if not result.lines or result.best_move is None:
                raise SolutionRejected("engine_line_ended_early")
            engine_version = result.engine_version
            nnue = result.nnue
            total_nodes += result.primary.nodes
            max_depth = max(max_depth, result.primary.depth)
            score = result.primary.score

            if attacker_turn:
                if score.kind != "mate" or score.value <= 0:
                    raise SolutionRejected("mate_not_reproduced")
                remaining = config.max_solution_plies - len(synthetic)
                if 2 * score.value - 1 > remaining:
                    raise SolutionRejected("reported_mate_exceeds_maximum")
                unique, reason = attacker_move_is_unique(
                    result.lines, config.uniqueness_gap
                )
                if not unique:
                    raise SolutionRejected(reason)
                synthetic = (*synthetic, result.best_move)
                continue

            if score.kind != "mate" or score.value >= 0:
                raise SolutionRejected("best_defense_escapes_mate")
            defenses = equivalent_defense_moves(result.lines)
            if not defenses:
                defenses = (result.best_move,)
            alternatives = tuple(move for move in defenses if move != result.best_move)
            if alternatives:
                expanded_defenses += len(alternatives)
                if expanded_defenses + 1 > config.max_defense_branches:
                    raise SolutionReview("too_many_equivalent_defenses")
                pending.extend((*synthetic, move) for move in alternatives)
            synthetic = (*synthetic, result.best_move)

    if not branches:
        raise SolutionRejected("no_verified_solution")
    return SolveResult(
        branches=tuple(branches),
        engine_version=engine_version,
        nnue=nnue,
        nodes=total_nodes,
        depth=max_depth,
    )


def _load_source_moves(path: Path, game_id: str) -> list[str]:
    source = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    try:
        row = source.execute("SELECT moves FROM games WHERE id = ?", (game_id,)).fetchone()
    finally:
        source.close()
    if row is None:
        raise LookupError(f"source game {game_id} was not found")
    moves = json.loads(row["moves"])
    if not isinstance(moves, list) or not all(isinstance(move, str) for move in moves):
        raise ValueError("source game has an invalid move list")
    return moves


def categorize_candidate(
    connection: sqlite3.Connection,
    engine: PuzzleEngine,
    candidate: ClaimedCandidate,
    source_path: Path,
    config: CategorizerConfig,
    progress: SolveProgress | None = None,
) -> tuple[str, str | None]:
    """Validate, solve, match every branch, and persist one claimed candidate."""

    try:
        recorded_moves = _load_source_moves(source_path, candidate.game_id)
        if candidate.ply > len(recorded_moves):
            raise SolutionRejected("source_ply_is_out_of_range")
        prefix = tuple(recorded_moves[: candidate.ply])
        if not prefix or prefix[-1] != candidate.played_move:
            raise SolutionRejected("source_played_move_changed")
        base = SearchContext(START_FEN, prefix)
        reconstructed = engine.inspect(base)
        if normalized_fen(reconstructed.fen) != normalized_fen(candidate.position_fen):
            raise SolutionRejected("source_position_changed")
        if fen_side(reconstructed.fen) != candidate.side_to_move:
            raise SolutionRejected("source_side_to_move_changed")

        solved = solve_checkmate(
            engine,
            base,
            candidate.side_to_move,
            config,
            progress=progress,
        )
        primary_solution = list(solved.primary.moves)
        disposition, common_themes, branch_rows = classify_mating_patterns(
            solved.branches
        )
        themes = sorted({*common_themes, *mate_themes(len(primary_solution))})
        if disposition == "review":
            # Co-best defenses disagree on the named pattern, but all branches
            # are still verified mates of this length.
            diagnostic = "co_best_defenses_have_different_mating_patterns"
        else:
            diagnostic = ""
        puzzle_id = promote_puzzle(
            connection,
            candidate,
            solution=primary_solution,
            themes=themes,
            engine=solved.engine_version,
            nnue=solved.nnue,
            engine_nodes=solved.nodes,
            engine_depth=solved.depth,
        )
        finish_candidate(
            connection,
            candidate,
            status="published",
            diagnostic=diagnostic,
            solution=primary_solution,
            branches=branch_rows,
            themes=themes,
            verified_engine=solved.engine_version,
            verified_nnue=solved.nnue,
            categorization_settings=config.settings(),
            categorization_version=config.version,
        )
        return "published", puzzle_id
    except SolutionReview as exc:
        finish_candidate(
            connection,
            candidate,
            status="review",
            diagnostic=str(exc),
            verified_engine=engine.engine_version,
            verified_nnue=engine.nnue,
            categorization_settings=config.settings(),
            categorization_version=config.version,
        )
        return "review", None
    except (SolutionRejected, LookupError, ValueError, json.JSONDecodeError) as exc:
        finish_candidate(
            connection,
            candidate,
            status="rejected",
            diagnostic=str(exc),
            verified_engine=engine.engine_version,
            verified_nnue=engine.nnue,
            categorization_settings=config.settings(),
            categorization_version=config.version,
        )
        return "rejected", None


def _worker_main(
    worker_id: int,
    output_path: str,
    executable: str,
    source_paths: dict[str, str],
    config: CategorizerConfig,
    engine_threads: int,
    hash_mb: int,
    max_attempts: int,
    report_queue: mp.Queue,
) -> None:
    connection = open_database(Path(output_path))
    engine = OfflinePikafish(
        Path(executable), threads=engine_threads, hash_mb=hash_mb
    )
    try:
        while candidate := claim_checkmate_candidate(
            connection, categorization_version=config.version
        ):
            report_queue.put(
                ("started", worker_id, candidate.game_id, candidate.ply)
            )
            last_detail_at = 0.0

            def detail_progress(
                branch: int, branch_total: int, solution_ply: int
            ) -> None:
                nonlocal last_detail_at
                timestamp = time.monotonic()
                if timestamp - last_detail_at >= 1.0:
                    report_queue.put(
                        (
                            "detail",
                            worker_id,
                            candidate.game_id,
                            candidate.ply,
                            branch,
                            branch_total,
                            solution_ply,
                        )
                    )
                    last_detail_at = timestamp

            path = source_paths.get(candidate.source_database)
            if path is None:
                finish_candidate(
                    connection,
                    candidate,
                    status="rejected",
                    diagnostic="source database is not installed",
                    verified_engine=engine.engine_version,
                    verified_nnue=engine.nnue,
                    categorization_settings=config.settings(),
                    categorization_version=config.version,
                )
                status, puzzle_id = "rejected", None
            else:
                try:
                    status, puzzle_id = categorize_candidate(
                        connection,
                        engine,
                        candidate,
                        Path(path),
                        config,
                        progress=detail_progress,
                    )
                except Exception as exc:
                    status = retry_candidate(
                        connection,
                        candidate,
                        f"{type(exc).__name__}: {exc}",
                        max_attempts=max_attempts,
                    )
                    puzzle_id = None
            report_queue.put(
                (
                    "progress",
                    worker_id,
                    candidate.game_id,
                    candidate.ply,
                    status,
                    puzzle_id,
                )
            )
    finally:
        engine.close()
        connection.close()
        report_queue.put(("worker_done", worker_id))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--engine", type=Path, default=_default_executable())
    parser.add_argument(
        "--workers", type=int, default=max(1, min(4, (os.cpu_count() or 2) // 2))
    )
    parser.add_argument("--engine-threads", type=int, default=1)
    parser.add_argument("--hash-mb", type=int, default=128)
    parser.add_argument("--nodes", type=int, default=2_000_000)
    parser.add_argument("--attacker-multipv", type=int, default=2)
    parser.add_argument("--defense-multipv", type=int, default=4)
    parser.add_argument("--uniqueness-gap", type=float, default=0.40)
    parser.add_argument("--max-solution-plies", type=int, default=31)
    parser.add_argument("--max-defense-branches", type=int, default=8)
    parser.add_argument("--max-attempts", type=int, default=3)
    parser.add_argument("--source-db", action="append", type=Path)
    parser.add_argument("--version", default=CHECKMATE_CATEGORIZER_VERSION, help="checkmate detection revision")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.workers < 1 or args.engine_threads < 1:
        raise SystemExit("workers and engine-threads must be positive")
    if args.nodes < 1 or args.attacker_multipv < 2 or args.defense_multipv < 1:
        raise SystemExit("invalid search settings")
    if not args.engine.is_file():
        raise SystemExit(f"Pikafish is not installed at {args.engine}")
    paths = tuple(
        path.resolve()
        for path in (args.source_db or installed_catalog_database_paths())
        if path.is_file()
    )
    if not paths:
        raise SystemExit("No installed Xiangqi catalog databases were found")
    source_paths = {catalog_database_id(path): str(path) for path in paths}
    config = CategorizerConfig(
        version=args.version,
        nodes=args.nodes,
        attacker_multipv=args.attacker_multipv,
        defense_multipv=args.defense_multipv,
        uniqueness_gap=args.uniqueness_gap,
        max_solution_plies=args.max_solution_plies,
        max_defense_branches=args.max_defense_branches,
        engine_threads=args.engine_threads,
        hash_mb=args.hash_mb,
    )
    database = open_database(args.database.resolve())
    candidate_total = int(
        database.execute(
            "SELECT count(*) FROM candidates "
            "WHERE candidate_type = 'checkmate_candidate' "
            "AND (status = 'processing' OR categorization_version IS NULL "
            "OR categorization_version != ? OR status IN ('pending', 'retry'))",
            (args.version,),
        ).fetchone()[0]
    )
    database.close()
    print(
        f"Checkmate categorization: {candidate_total:,} queued candidate(s), "
        f"{args.workers} worker(s).",
        flush=True,
    )
    if candidate_total == 0:
        print("No checkmate candidates are waiting for categorization.", flush=True)
        return 0
    context = mp.get_context("spawn")
    report_queue = context.Queue()
    workers = [
        context.Process(
            target=_worker_main,
            args=(
                worker_id,
                str(args.database.resolve()),
                str(args.engine.resolve()),
                source_paths,
                config,
                args.engine_threads,
                args.hash_mb,
                args.max_attempts,
                report_queue,
            ),
            name=f"checkmate-categorizer-{worker_id}",
        )
        for worker_id in range(args.workers)
    ]
    for worker in workers:
        worker.start()
    totals = {
        "published": 0,
        "untagged": 0,
        "review": 0,
        "rejected": 0,
        "retry": 0,
        "failed": 0,
    }
    statistic_order = (
        "published",
        "untagged",
        "review",
        "rejected",
        "retry",
        "failed",
    )
    started = 0
    completed = 0
    done_workers = 0
    progress_printer = ProgressPrinter()
    while done_workers < len(workers):
        event = report_queue.get()
        if event[0] == "started":
            _kind, _worker_id, game_id, ply = event
            started += 1
            progress_printer.update(
                format_progress(
                    "Categorizing puzzle",
                    min(started, candidate_total),
                    candidate_total,
                    totals,
                    statistic_order,
                    detail=f"{game_id} ply {ply}",
                )
            )
        elif event[0] == "progress":
            _kind, _worker_id, game_id, ply, status, puzzle_id = event
            completed += 1
            totals[status] = totals.get(status, 0) + 1
            detail = f"{game_id} ply {ply}"
            if puzzle_id:
                detail += f" -> {puzzle_id}"
            progress_printer.update(
                format_progress(
                    "Categorizing puzzle",
                    min(max(started, completed), candidate_total),
                    candidate_total,
                    totals,
                    statistic_order,
                    detail=detail,
                )
            )
        elif event[0] == "detail":
            (
                _kind,
                _worker_id,
                game_id,
                ply,
                branch,
                branch_total,
                solution_ply,
            ) = event
            progress_printer.update(
                format_progress(
                    "Categorizing puzzle",
                    min(started, candidate_total),
                    candidate_total,
                    totals,
                    statistic_order,
                    detail=(
                        f"{game_id} ply {ply}  solution branch "
                        f"{branch}/{branch_total}, ply {solution_ply}"
                    ),
                )
            )
        elif event[0] == "worker_done":
            done_workers += 1
    for worker in workers:
        worker.join()
    progress_printer.finish(
        format_progress(
            "Categorized puzzles",
            completed,
            candidate_total,
            totals,
            statistic_order,
        )
    )
    print(
        f"Checkmate categorization complete after {completed:,} candidate(s).",
        flush=True,
    )
    return int(any(worker.exitcode for worker in workers))


if __name__ == "__main__":
    mp.freeze_support()
    sys.exit(main())
