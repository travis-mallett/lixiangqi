"""Bounded solution verification for mined Xiangqi candidates.

This module owns engine verification only.  Motif assessment lives in
``classification.py`` and persistence/publication is deliberately left to the
categorizer and storage layers.  A verified branch keeps the analysis at each
decision so a later reviewer can tell why every move was accepted.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any, Callable
import time

from .engine import (
    IncompleteSearchError,
    PuzzleEngine,
    ConstructionTimeout,
    construction_budget,
    check_deadline,
)
from .models import (
    PositionStatus,
    SearchContext,
    SearchResult,
    VerifiedDecision,
    VerifiedTrace,
    TacticEndpoint,
    fen_side,
    opposite,
)


@dataclass(frozen=True)
class SolverConfig:
    """Shared fixed-depth search settings and per-line safety bound."""

    depth: int = 20
    max_solution_plies: int = 31
    max_uncertainty_retries: int = 1

    def __post_init__(self) -> None:
        for name in (
            "depth",
            "max_solution_plies",
        ):
            if getattr(self, name) < 1:
                raise ValueError(f"{name} must be positive")
        if self.max_uncertainty_retries < 0:
            raise ValueError("invalid retry settings")


@dataclass(frozen=True)
class VerifiedBranch:
    moves: tuple[str, ...]
    terminal: PositionStatus
    decisions: tuple[VerifiedDecision, ...] = ()
    objective: str = "mate"
    endpoint: TacticEndpoint | None = None

    @property
    def trace(self) -> VerifiedTrace:
        return VerifiedTrace(
            moves=self.moves,
            terminal=self.terminal,
            decisions=self.decisions,
            objective=self.objective,
            verified=True,
            endpoint=self.endpoint,
        )

    def to_dict(self) -> dict[str, Any]:
        return self.trace.to_dict()


@dataclass(frozen=True)
class SolveResult:
    """Primary and completed equal-mate branches, with explicit exploration bounds."""

    branches: tuple[VerifiedBranch, ...]
    engine_version: str
    nnue: str
    nodes: int
    depth: int
    uncertainty: tuple[str, ...] = ()
    complete: bool = False
    diagnostic: str = ""
    revisions: int = 0
    metrics: dict[str, Any] = field(default_factory=dict, compare=False)

    @property
    def completed_branches(self) -> int:
        return len(self.branches)

    @property
    def truncated(self) -> bool:
        return bool(self.uncertainty)

    @property
    def primary(self) -> VerifiedBranch:
        if not self.branches:
            raise ValueError("no verified solution branches")
        # The first branch is the engine's selected canonical line.  Branches
        # are never reordered by length or by motif matching.
        return self.branches[0]

    @property
    def canonical(self) -> VerifiedTrace:
        return self.primary.trace


class SolutionRejected(RuntimeError):
    """The analyzed candidate failed a concrete verification requirement."""


class SolutionReview(RuntimeError):
    """The bounded proof did not establish enough evidence to publish."""


SolveProgress = Callable[[int, int, int], None]


def _analyse_with_retry(
    engine: PuzzleEngine,
    context: SearchContext,
    *,
    depth: int,
    multi_pv: int,
    config: SolverConfig,
) -> SearchResult:
    """Retry bounded/incomplete results without increasing the depth."""

    attempts = 0
    budget = depth
    while True:
        check_deadline(engine)
        try:
            result = engine.analyse(context, depth=budget, multi_pv=multi_pv)
            check_deadline(engine)
            if not result.lines:
                reason = "engine_search_inconclusive"
            elif len(result.lines) < multi_pv:
                reason = "engine_search_inconclusive"
            elif any(line.score.bound is not None for line in result.lines):
                reason = "bounded_engine_score"
            elif result.best_move is None:
                reason = "incoherent_engine_result"
            elif (
                not result.primary.moves or result.primary.moves[0] != result.best_move
            ):
                reason = "incoherent_engine_result"
            elif any(not line.moves for line in result.lines) or len(
                {line.moves[0] for line in result.lines}
            ) != len(result.lines):
                reason = "incoherent_engine_result"
            else:
                return replace(
                    result,
                    search_nodes=None,
                    search_depth=budget,
                    requested_multipv=multi_pv,
                )
            if attempts >= config.max_uncertainty_retries:
                raise SolutionReview(reason)
            attempts += 1
            continue
        except IncompleteSearchError as exc:
            if attempts >= config.max_uncertainty_retries:
                raise SolutionReview("engine_search_inconclusive") from exc
            attempts += 1


def _solve_checkmate(
    engine: PuzzleEngine,
    base: SearchContext,
    attacker_side: str,
    config: SolverConfig,
    progress: SolveProgress | None = None,
    *,
    seed_branches: tuple[VerifiedBranch, ...] = (),
    timing: Callable[[str, dict[str, Any]], None] | None = None,
) -> SolveResult:
    """Construct shortest terminal traces, reconciling attacker alternatives.

    Classification never controls exploration. Search state is owned by
    the engine; this invocation caches only completed results for exact contexts
    and settings. A wider result replaces the entire narrower analysis.
    """
    if getattr(engine, "threads", 1) != 1:
        raise ValueError("final verification requires one engine thread")
    cache: dict[tuple, SearchResult] = {}
    statuses: dict[SearchContext, PositionStatus] = {}
    total_nodes = max_depth = 0
    truncated: set[str] = set()
    metrics = dict(
        searches=0,
        search_ms=0.0,
        positions=0,
        completed_paths=0,
        discovered_paths=1,
        reconsiderations=0,
        max_multipv=0,
    )
    started = time.monotonic()

    def timed(label, action, **details):
        check_deadline(engine)
        started = time.perf_counter()
        try:
            value = action()
            check_deadline(engine)
            return value
        finally:
            if label == "engine.search":
                metrics["searches"] += 1
                metrics["search_ms"] += (time.perf_counter() - started) * 1000
                metrics["max_multipv"] = max(metrics["max_multipv"], details["multipv"])
            if timing:
                timing(
                    label,
                    {
                        **details,
                        "elapsed_ms": round((time.perf_counter() - started) * 1000, 3),
                    },
                )

    # Persisted completed decisions are reusable only under identical engine,
    # root/branch history, and requested depth/MultiPV settings. An old wider result is
    # not relabeled as a narrower search or combined with another result.
    for branch in seed_branches:
        for d in branch.decisions:
            result = d.analysis
            width, budget = result.requested_multipv, result.search_depth
            if (
                result.engine_version != engine.engine_version
                or result.nnue != engine.nnue
                or d.context.initial_fen != base.initial_fen
                or d.context.moves[: len(base.moves)] != base.moves
                or width is None
                or budget is None
                or result.search_nodes is not None
                or budget != config.depth
            ):
                continue
            key = (
                d.context,
                engine.engine_version,
                engine.nnue,
                budget,
                width,
                config.max_uncertainty_retries,
            )
            cache[key] = result

    def context_for(moves):
        return SearchContext(base.initial_fen, (*base.moves, *moves))

    def inspect(context):
        if context not in statuses:
            statuses[context] = timed(
                "engine.inspect",
                lambda: engine.inspect(context),
                ply=len(context.moves),
            )
        return statuses[context]

    def search(context, width, *, fresh=False):
        nonlocal total_nodes, max_depth
        budget = config.depth
        key = (
            context,
            engine.engine_version,
            engine.nnue,
            budget,
            width,
            config.max_uncertainty_retries,
        )
        if fresh or key not in cache:
            result = timed(
                "engine.search",
                lambda: _analyse_with_retry(
                    engine, context, depth=budget, multi_pv=width, config=config
                ),
                ply=len(context.moves),
                multipv=width,
                depth=budget,
            )
            if any(
                line.moves[0] not in inspect(context).legal_moves
                for line in result.lines
            ):
                raise SolutionReview("engine_illegal_multipv_root")
            cache[key] = result
            search_nodes = max(line.nodes for line in result.lines)
            search_depth = max(line.depth for line in result.lines)
            if timing:
                timing(
                    "engine.search.result",
                    {
                        "ply": len(context.moves),
                        "multipv": width,
                        "nodes": search_nodes,
                        "lines": len(result.lines),
                        "depth": search_depth,
                    },
                )
            total_nodes += search_nodes
            max_depth = max(max_depth, search_depth)
        return cache[key]

    def selected_move(result, attacking):
        score = result.primary.score
        if score.kind != "mate" or (
            score.value <= 0 if attacking else score.value >= 0
        ):
            if score.kind == "mate" and (
                score.value < 0 if attacking else score.value > 0
            ):
                raise SolutionRejected("best_defense_escapes_mate")
            # Product policy: a completed search without the required mate
            # discards this candidate; it is not a proof of a defensive escape.
            raise SolutionRejected("mate_not_reproduced")
        return result.best_move

    def decision(context, move, result):
        status = inspect(context)
        return VerifiedDecision(
            context=context,
            side=fen_side(status.fen),
            legal_moves=status.legal_moves,
            selected_move=move,
            analysis=result,
            certainty=(
                "shortest_constructed_mate"
                if fen_side(status.fen) == attacker_side
                else "best_defense"
            ),
            position_fen=status.fen,
        )

    def terminal(moves, decisions):
        status = inspect(context_for(moves))
        if status.legal_moves:
            if decisions:
                parent = decisions[-1]
                selected = next(
                    line
                    for line in parent.analysis.lines
                    if line.moves[0] == parent.selected_move
                )
                if selected.score.kind == "mate" and selected.score.value == 1:
                    # Pikafish also reports rule wins as mate scores. Perft
                    # still exposes legal moves there; this is no basic-kill
                    # terminal proof. Do not invent a continuation or a loss.
                    raise SolutionReview(
                        "reported_mate_without_terminal_position: "
                        f"solution_ply={len(moves)}, move={parent.selected_move}, "
                        f"legal_moves={len(status.legal_moves)}"
                    )
            return None
        if not status.terminal_win:
            raise SolutionRejected("terminal_position_is_not_checkmate_or_stalemate")
        if fen_side(status.fen) != opposite(attacker_side):
            raise SolutionRejected("attacker_is_terminally_defeated")
        return VerifiedBranch(moves, status, decisions)

    # Each generator owns one position. The explicit stack drives children,
    # avoiding Python recursion and retaining shared search results by full history.
    completed = []

    def eligible(context, width, threshold=None, *, fresh=False):
        while True:
            result = search(context, width, fresh=fresh)
            selected_move(result, True)
            cutoff = result.primary.score.value if threshold is None else threshold
            choices = [
                line.moves[0]
                for line in result.lines
                if line.score.kind == "mate" and 0 < line.score.value <= cutoff
            ]
            last = result.lines[-1].score
            count = len(inspect(context).legal_moves)
            if width >= count or last.kind != "mate" or not 0 < last.value <= cutoff:
                return result, choices, width
            width = min(count, width * 2)
            # A completed wider snapshot replaces the entire narrower ranking.
            fresh = True

    def visit(moves, decisions):
        check_deadline(engine)
        done = terminal(moves, decisions)
        if done is not None:
            completed.append(done)
            metrics["completed_paths"] += 1
            return [done]
        if len(moves) >= config.max_solution_plies:
            raise SolutionReview("ply_limit")
        metrics["positions"] += 1
        if progress:
            progress(
                metrics["completed_paths"] + 1,
                metrics["discovered_paths"],
                len(moves) + 1,
            )
        if timing:
            timing(
                "solution.position",
                dict(
                    position=metrics["positions"],
                    ply=len(moves),
                    completed_branches=metrics["completed_paths"],
                ),
            )
        context = context_for(moves)
        status = inspect(context)
        if fen_side(status.fen) != attacker_side:
            result = search(context, 1)
            move = selected_move(result, False)
            return (
                yield ((*moves, move), (*decisions, decision(context, move, result)))
            )

        width = min(2, len(status.legal_moves))
        result, choices, width = eligible(context, width)
        metrics["discovered_paths"] += len(choices) - 1
        explored = {}
        while True:
            check_deadline(engine)
            changed = False
            for move in choices:
                if move in explored:
                    continue
                children = yield (
                    (*moves, move),
                    (*decisions, decision(context, move, result)),
                )
                explored[move] = children
                actual = (len(children[0].moves) - len(moves) + 1) // 2
                predicted = next(
                    line.score.value for line in result.lines if line.moves[0] == move
                )
                changed |= actual != predicted
            shortest = min(len(branches[0].moves) for branches in explored.values())
            distance = (shortest - len(moves) + 1) // 2
            # A fresh ranking benefits from descendant searches. Reopen previously
            # excluded moves that now compete with the constructed best, including
            # moves beyond the originally tied MultiPV window. Completed child
            # trees remain evidence; a new estimate does not replace their lengths.
            if changed and len(status.legal_moves) > 1:
                metrics["reconsiderations"] += 1
                result, choices, width = eligible(context, width, distance, fresh=True)
            else:
                # Even unchanged outcomes can expose a competing move in an already
                # widened snapshot. No repeated search is needed in that case.
                choices = [
                    line.moves[0]
                    for line in result.lines
                    if line.score.kind == "mate" and 0 < line.score.value <= distance
                ]
            if not any(move not in explored for move in choices):
                return [
                    branch
                    for branches in explored.values()
                    for branch in branches
                    if len(branch.moves) == shortest
                ]
            metrics["discovered_paths"] += sum(move not in explored for move in choices)

    stack = [visit((), ())]
    value = None
    branches = []
    try:
        while stack:
            check_deadline(engine)
            try:
                child = stack[-1].send(value)
                value = None
                stack.append(visit(*child))
            except StopIteration as done:
                stack.pop()
                value = done.value
        check_deadline(engine)
        branches = value
    except ConstructionTimeout:
        truncated.add("construction_time_limit")
        branches = completed
    except SolutionReview as exc:
        # Preserve existing protocol-review behavior, but retain bounded-work
        # diagnostics for the normal construction safety limit.
        if str(exc) != "ply_limit":
            metrics["stopping_reason"] = str(exc)
            raise
        truncated.add("ply_limit")
        branches = completed
    except Exception as exc:
        metrics["stopping_reason"] = str(exc) or type(exc).__name__
        raise
    finally:
        for frame in stack:
            frame.close()
        metrics["elapsed_seconds"] = round(time.monotonic() - started, 3)
        metrics["search_ms"] = round(metrics["search_ms"], 3)
        metrics["unresolved_positions"] = len(stack)
        metrics["pending_paths"] = (
            metrics["discovered_paths"] - metrics["completed_paths"]
        )
        metrics.setdefault("stopping_reason", ",".join(sorted(truncated)) or "complete")
        if timing:
            timing("solution.summary", {**metrics, "limits": sorted(truncated)})

    return SolveResult(
        tuple(branches),
        engine.engine_version,
        engine.nnue,
        total_nodes,
        max_depth,
        tuple(sorted(truncated)),
        not truncated,
        revisions=metrics["reconsiderations"],
        metrics=metrics,
    )


def solve_checkmate(
    engine, base, attacker_side, config, progress=None, *, seed_branches=(), timing=None
):
    with construction_budget(engine, getattr(config, "construction_seconds", 300.0)):
        return _solve_checkmate(
            engine,
            base,
            attacker_side,
            config,
            progress,
            seed_branches=seed_branches,
            timing=timing,
        )
