"""Evaluation-aware sampling of a single Pikafish MultiPV snapshot."""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Candidate:
    move: str
    # UCI scores are already relative to the searching side, including Black.
    kind: str
    score: int


def candidate_snapshot(
    by_depth: dict[int, dict[int, Candidate]],
    legal: list[str],
    multi_pv: int,
) -> dict[int, Candidate]:
    """Deepest full snapshot, otherwise deepest partial snapshot with PV1.

    Compare only scores from one depth. Never mix a partial deeper search with
    an older candidate's score; require a legal PV1 baseline.
    """
    snapshots = []
    for _, values in sorted(by_depth.items(), reverse=True):
        valid: dict[int, Candidate] = {}
        seen: set[str] = set()
        for rank, candidate in sorted(values.items()):
            if (
                1 <= rank <= multi_pv
                and candidate.move in legal
                and candidate.move not in seen
            ):
                valid[rank] = candidate
                seen.add(candidate.move)
        if 1 in valid:
            if len(valid) == min(multi_pv, len(legal)):
                return valid
            snapshots.append(valid)
    return snapshots[0] if snapshots else {}


@lru_cache(maxsize=128)
def rank_probabilities(count: int, expected_rank: float) -> tuple[float, ...]:
    """A broad bell-shaped distribution tilted to the requested mean rank.

    A width of half the candidate count keeps every rank competitive without
    concentrating on the last rank. Solve the exponential tilt once per profile.
    Four candidates at mean 2.8 give roughly 14%, 24%, 31%, 31%.
    """
    if count < 1 or not math.isfinite(expected_rank):
        raise ValueError("Invalid rank distribution")
    if expected_rank <= 1:
        return (1.0,) + (0.0,) * (count - 1)
    if expected_rank >= count:
        return (0.0,) * (count - 1) + (1.0,)
    prior = [
        -0.5 * ((rank - (count + 1) / 2) / (count / 2)) ** 2
        for rank in range(1, count + 1)
    ]
    low, high = -64.0, 64.0
    for _ in range(64):
        tilt = (low + high) / 2
        logs = [value + tilt * rank for rank, value in enumerate(prior)]
        maximum = max(logs)
        weights = [math.exp(value - maximum) for value in logs]
        total = sum(weights)
        probabilities = tuple(weight / total for weight in weights)
        mean = sum(
            rank * probability for rank, probability in enumerate(probabilities, 1)
        )
        if mean < expected_rank:
            low = tilt
        else:
            high = tilt
    return probabilities


def candidate_probabilities(
    candidates: dict[int, Candidate],
    *,
    multi_pv: int,
    expected_rank: float,
    max_candidate_loss: int,
) -> dict[int, float]:
    """Filter catastrophic scores, then condition the original rank distribution.

    Mate scores are categorical, not arbitrary centipawn conversions. Preserve
    a proven win; avoid a proven loss whenever a non-losing score is available.
    If all candidates lose by force, retain them rather than discarding moves.
    """
    wins = {
        rank: candidate
        for rank, candidate in candidates.items()
        if candidate.kind == "mate" and candidate.score > 0
    }
    centipawns = {
        rank: candidate
        for rank, candidate in candidates.items()
        if candidate.kind == "cp"
    }
    if wins:
        reasonable = wins
    elif centipawns:
        best = max(candidate.score for candidate in centipawns.values())
        reasonable = {
            rank: candidate
            for rank, candidate in centipawns.items()
            if best - candidate.score <= max_candidate_loss
        }
    else:
        reasonable = candidates
    if not reasonable:
        raise ValueError("No candidates to sample")
    weights = rank_probabilities(multi_pv, expected_rank)
    total = sum(weights[rank - 1] for rank in reasonable)
    if total == 0:
        # An endpoint distribution can lose its sole supported rank to filtering.
        best_rank = min(reasonable)
        return {best_rank: 1.0}
    return {rank: weights[rank - 1] / total for rank in reasonable}


def sample_candidate(
    candidates: dict[int, Candidate],
    *,
    multi_pv: int,
    expected_rank: float,
    max_candidate_loss: int,
    rng: random.Random,
) -> str:
    probabilities = candidate_probabilities(
        candidates,
        multi_pv=multi_pv,
        expected_rank=expected_rank,
        max_candidate_loss=max_candidate_loss,
    )
    ticket = rng.random()
    for rank, probability in probabilities.items():
        ticket -= probability
        if ticket < 0:
            return candidates[rank].move
    return candidates[next(reversed(probabilities))].move
