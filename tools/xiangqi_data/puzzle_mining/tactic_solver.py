"""Construct one tactical line using solver-turn WDL uniqueness and best defense.

Searches retain the entire puzzle history. Ambiguity is a successful endpoint
only when both alternatives retain the advantage; search limits never qualify.
"""

import math
from dataclasses import dataclass

from .models import SearchContext, TacticEndpoint, VerifiedDecision, fen_side
from .position import FenState, normalized_fen
from .solver import (
    SolutionRejected,
    SolutionReview,
    SolverConfig,
    SolveResult,
    VerifiedBranch,
    _analyse_with_retry,
)


@dataclass(frozen=True)
class TacticSolverConfig(SolverConfig):
    max_positions: int = 4096
    advantage: float = 0.55
    uniqueness_gap: float = 0.50

    @property
    def objective(self):
        return "advantage"

    def __post_init__(self):
        super().__post_init__()
        if self.max_positions < 1:
            raise ValueError("max_positions must be positive")
        if not math.isfinite(self.advantage) or not 0 < self.advantage < 1:
            raise ValueError("advantage must be finite and between 0 and 1")
        if not math.isfinite(self.uniqueness_gap) or not 0 < self.uniqueness_gap <= 2:
            raise ValueError("uniqueness-gap must be finite and in (0, 2]")


def expected_scores(decision, solver):
    """Keep engine ranking, converting every score to the solver's perspective."""
    try:
        return tuple(
            (line.score if decision.side == solver else line.score.negated()).expected()
            for line in decision.analysis.lines
        )
    except ValueError as exc:
        raise SolutionReview("missing_tactic_wdl") from exc


def solve_tactic(engine, base, attacker_side, config, progress=None, *, timing=None):
    if getattr(engine, "threads", 1) != 1:
        raise ValueError("final verification requires one engine thread")
    moves, decisions, positions = [], [], []
    seen = set()
    nodes = depth = 0
    context = base

    def finish(terminal, endpoint, playable):
        if playable < 1:
            raise SolutionRejected("ambiguous_tactic_start")
        branch = VerifiedBranch(
            tuple(moves[:playable]),
            terminal,
            tuple(decisions[:playable]),
            config.objective,
            endpoint,
        )
        return SolveResult(
            (branch,), engine.engine_version, engine.nnue, nodes, depth, complete=True
        )

    # Two extra inspections/searches can prove the endpoint after the final
    # allowed solver move. They are evidence, never extra playable plies.
    while len(moves) <= config.max_solution_plies + 1:
        if len(positions) >= config.max_positions:
            raise SolutionReview("tactic_position_limit")
        if progress:
            progress(1, 1, len(moves))
        status = engine.inspect(context)
        side = fen_side(status.fen)
        if not positions and side != attacker_side:
            raise SolutionRejected("tactic_side_mismatch")
        if positions:
            replay = FenState(positions[-1].fen)
            replay.push(moves[-1])
            if normalized_fen(replay.fen()) != normalized_fen(status.fen):
                raise SolutionReview("incoherent_tactic_position")
        positions.append(status)
        if status.terminal_win:
            if side == attacker_side:
                raise SolutionRejected("solver_terminal_loss")
            if len(moves) > config.max_solution_plies:
                raise SolutionReview("tactic_length_limit")
            return finish(
                status,
                TacticEndpoint("terminal_win", config.advantage, config.uniqueness_gap),
                len(moves),
            )
        key = normalized_fen(status.fen)
        if key in seen:
            # Do not manufacture a draw/mate conclusion from a board cycle.
            # These require rule adjudication beyond this finite material line.
            raise SolutionReview("tactic_repetition")
        seen.add(key)
        result = _analyse_with_retry(
            engine,
            context,
            depth=config.depth,
            multi_pv=min(2, len(status.legal_moves)),
            config=config,
        )
        if any(line.moves[0] not in status.legal_moves for line in result.lines):
            raise SolutionReview("illegal_tactic_engine_move")
        nodes += max(line.nodes for line in result.lines)
        depth = max(depth, max(line.depth for line in result.lines))
        decision = VerifiedDecision(
            context,
            side,
            status.legal_moves,
            result.best_move,
            result,
            position_fen=status.fen,
        )
        scores = expected_scores(decision, attacker_side)
        if scores[0] < config.advantage:
            raise SolutionRejected("tactic_advantage_not_reproduced")
        if side == attacker_side and len(scores) > 1:
            gap = scores[0] - scores[1]
            if gap < 0:
                raise SolutionReview("incoherent_tactic_ranking")
            if gap < config.uniqueness_gap:
                if scores[1] < config.advantage:
                    raise SolutionRejected("ambiguous_tactic_continuation")
                if not moves:
                    raise SolutionRejected("ambiguous_tactic_start")
                # Last played move is the defense. Keep it outside the playable
                # line alongside the unplayed decision that establishes safety.
                return finish(
                    positions[-2],
                    TacticEndpoint(
                        "multiple_good_moves",
                        config.advantage,
                        config.uniqueness_gap,
                        decisions[-1],
                        decision,
                    ),
                    len(moves) - 1,
                )
        if side == attacker_side and len(moves) >= config.max_solution_plies:
            raise SolutionReview("tactic_length_limit")
        decisions.append(decision)
        moves.append(result.best_move)
        context = context.extend(result.best_move)
    raise SolutionReview("tactic_length_limit")


def capture_preserves_advantage(trace, plies):
    """Check saved best-defense evidence after a capture (one-based ply).

    Construction owns move uniqueness. Category trimming may omit further
    precise moves once the motif has paid off, but must retain the advantage
    against the engine's best defense in the complete verified continuation.
    """
    endpoint = trace.endpoint
    if trace.objective != "advantage" or not trace.complete or endpoint is None:
        return False
    if plies < 1 or plies > len(trace.moves) or plies % 2 != 1:
        return False
    if plies == len(trace.moves) and endpoint.reason == "terminal_win":
        return trace.terminal_win
    defense = (
        trace.decisions[plies] if plies < len(trace.decisions) else endpoint.defense
    )
    if defense is None or not trace.decisions:
        return False
    solver = trace.decisions[0].side
    if defense.side == solver:
        return False
    root = trace.decisions[0].context
    if defense.context != SearchContext(
        root.initial_fen, (*root.moves, *trace.moves[:plies])
    ):
        return False
    if (
        defense.certainty != "certain"
        or defense.selected_move not in defense.legal_moves
        or defense.selected_move != defense.analysis.best_move
        or not defense.analysis.lines
        or defense.analysis.primary.moves[:1] != (defense.selected_move,)
        or any(line.score.bound for line in defense.analysis.lines)
    ):
        return False
    try:
        scores = expected_scores(defense, solver)
    except SolutionReview:
        return False
    return scores[0] >= endpoint.advantage
