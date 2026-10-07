"""Paired score estimates and monotone inversion without numerical dependencies."""

from __future__ import annotations

import math


def interval(score: float) -> float:
    return 400 * math.log10(score / (1 - score))


def summarize(pairs: list[tuple[float, float]]) -> dict:
    """Scores are always from the higher-coordinate bot's perspective.

    A half-win and half-loss pseudocount keeps log odds finite. Confidence uses
    Wilson bounds on color-pair mean scores, treating a pair as one independent
    bounded observation. This is a conservative approximation, not human Elo.
    """
    scores = [score for pair in pairs for score in pair]
    n = len(scores)
    if not n:
        return {
            "wins": 0,
            "draws": 0,
            "losses": 0,
            "totalGames": 0,
            "score": None,
            "smoothedScore": None,
            "interval": None,
            "confidence95": None,
        }
    wins, draws, losses = (scores.count(v) for v in (1.0, 0.5, 0.0))
    raw = sum(scores) / n
    smoothed = (sum(scores) + 0.5) / (n + 1)
    count = len(pairs)
    z = 1.959963984540054
    divisor = 1 + z * z / count
    center = (raw + z * z / (2 * count)) / divisor
    radius = (
        z * math.sqrt(raw * (1 - raw) / count + z * z / (4 * count * count)) / divisor
    )
    low, high = max(1e-12, center - radius), min(1 - 1e-12, center + radius)
    return {
        "wins": wins,
        "draws": draws,
        "losses": losses,
        "totalGames": n,
        "score": raw,
        "smoothedScore": smoothed,
        "interval": interval(smoothed),
        "confidence95": {
            "method": "paired-score Wilson approximation",
            "score": [low, high],
            "interval": [interval(low), interval(high)],
        },
    }


def isotonic(values: list[float]) -> list[float]:
    """Pool-adjacent-violators least-squares fit; retains negative raw evidence elsewhere."""
    blocks = []
    for value in values:
        blocks.append([value, 1])
        while (
            len(blocks) > 1
            and blocks[-2][0] / blocks[-2][1] > blocks[-1][0] / blocks[-1][1]
        ):
            total, count = blocks.pop()
            blocks[-1][0] += total
            blocks[-1][1] += count
    return [total / count for total, count in blocks for _ in range(count)]


def redistribute(coordinates, deltas, damping=0.5) -> tuple[list[float], list[float]]:
    """Fit isotonic cumulative strengths, then invert a monotone linear curve.

    Linear interpolation cannot overshoot or reverse. Fixed endpoints anchor
    the fit. Flat fitted segments invert to their midpoint. Damping avoids
    chasing noisy measurements; strict coordinate order prevents duplicates.
    """
    cumulative = [0.0]
    for delta in deltas:
        cumulative.append(cumulative[-1] + delta)
    span = cumulative[-1]
    if span <= 0:
        raise ValueError("No positive endpoint strength span was measured")
    fitted = (
        [0.0] + isotonic([max(0.0, min(span, v)) for v in cumulative[1:-1]]) + [span]
    )
    result = [0.0]
    for level in range(1, 8):
        target = span * level / 8
        equal = [i for i, value in enumerate(fitted) if value == target]
        if equal:
            estimate = (coordinates[equal[0]] + coordinates[equal[-1]]) / 2
        else:
            i = next(i for i in range(8) if fitted[i] < target < fitted[i + 1])
            fraction = (target - fitted[i]) / (fitted[i + 1] - fitted[i])
            estimate = coordinates[i] + fraction * (coordinates[i + 1] - coordinates[i])
        result.append((1 - damping) * coordinates[level] + damping * estimate)
    result.append(1.0)
    return result, fitted


def overall(matchups: list[dict], tolerance: float, requested: int) -> dict:
    deltas = [m["interval"] for m in matchups]
    if any(d is None for d in deltas):
        return {
            "totalMeasuredSpan": None,
            "meanInterval": None,
            "maximumIntervalDeviation": None,
            "pointConverged": False,
            "complete": False,
            "precisionSufficient": False,
        }
    span = sum(deltas)
    mean = span / 8
    deviation = max(abs(d - mean) for d in deltas)
    relative = deviation / mean if mean > 0 else None
    complete = all(m["totalGames"] >= requested for m in matchups)
    precision = mean > 0 and all(
        max(abs(v - m["interval"]) for v in m["confidence95"]["interval"])
        <= tolerance * mean
        for m in matchups
    )
    return {
        "totalMeasuredSpan": span,
        "meanInterval": mean,
        "maximumAbsoluteDeviation": deviation,
        "maximumIntervalDeviation": relative,
        "pointConverged": complete and relative is not None and relative < tolerance,
        "complete": complete,
        "precisionSufficient": precision,
        "hasReversals": any(d < 0 for d in deltas),
    }
