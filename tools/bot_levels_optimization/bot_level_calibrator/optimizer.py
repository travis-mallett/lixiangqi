from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Iterable

import numpy as np


@dataclass(frozen=True)
class Observation:
    strength: float
    score: float  # 1=win, .5=draw, 0=loss from Lixiangqi's perspective.
    side: str | None = None


@dataclass(frozen=True)
class Estimate:
    strength: float
    low_95: float
    high_95: float
    observations: int
    response_width: float
    red_strength_shift: float


def estimate_equal_strength(
    observations: Iterable[Observation],
    *,
    prior_strength: float | None = None,
    prior_sd: float = 0.22,
) -> Estimate:
    """Bayesian color-adjusted logistic estimate of balanced-score parity.

    The previous estimator fixed the logistic transition width at 0.10 and
    omitted color. That makes alternating Red wins and Black losses look like
    contradictory changes in the sole strength coordinate. This model
    integrates over both nuisance quantities while returning only the
    color-balanced parity coordinate for optimization.

    `red_strength_shift` enters with opposite signs for Red and Black. At the
    returned root, logistic(+shift/width) and logistic(-shift/width) average to
    exactly 50%, so no color pair or batch is required.
    """

    samples = tuple(observations)
    root_values = np.linspace(0.0, 1.0, 501, dtype=np.float64)
    width_values = np.geomspace(0.015, 0.25, 17, dtype=np.float64)
    shift_values = np.linspace(-0.12, 0.12, 25, dtype=np.float64)
    roots = root_values[:, None, None]
    widths = width_values[None, :, None]
    shifts = shift_values[None, None, :]

    center = 0.5 if prior_strength is None else min(1.0, max(0.0, prior_strength))
    log_weights = -0.5 * ((roots - center) / max(0.02, prior_sd)) ** 2
    log_weights = np.broadcast_to(
        log_weights, (len(root_values), len(width_values), len(shift_values))
    ).copy()
    # Weak regularization prevents separation on the first few decisive games
    # but lets the observed response replace the former hard-coded slope.
    log_weights += -0.5 * (np.log(widths / 0.075) / 0.8) ** 2
    log_weights += -0.5 * (shifts / 0.06) ** 2

    for sample in samples:
        side_sign = 1.0 if sample.side == "red" else -1.0 if sample.side == "black" else 0.0
        z = (float(sample.strength) - roots + side_sign * shifts) / widths
        score = min(1.0, max(0.0, float(sample.score)))
        log_weights += score * -np.logaddexp(0.0, -z)
        log_weights += (1.0 - score) * -np.logaddexp(0.0, z)

    log_weights -= float(log_weights.max())
    weights = np.exp(log_weights)
    weights /= float(weights.sum())
    root_marginal = weights.sum(axis=(1, 2))
    width_marginal = weights.sum(axis=(0, 2))
    shift_marginal = weights.sum(axis=(0, 1))

    return Estimate(
        _quantile(root_values, root_marginal, 0.50),
        _quantile(root_values, root_marginal, 0.025),
        _quantile(root_values, root_marginal, 0.975),
        len(samples),
        _quantile(width_values, width_marginal, 0.50),
        _quantile(shift_values, shift_marginal, 0.50),
    )


def _quantile(values: np.ndarray, weights: np.ndarray, fraction: float) -> float:
    cumulative = np.cumsum(weights / float(weights.sum()))
    index = min(len(values) - 1, int(np.searchsorted(cumulative, fraction, side="left")))
    return float(values[index])


def balanced_expected_score(estimate: Estimate, tested_strength: float) -> float:
    """Posterior-median score averaged across alternating Red and Black."""

    width = max(0.005, estimate.response_width)
    offset = float(tested_strength) - estimate.strength
    red = _logistic((offset + estimate.red_strength_shift) / width)
    black = _logistic((offset - estimate.red_strength_shift) / width)
    return 0.5 * (red + black)


def probability_balanced_equivalent(
    estimate: Estimate,
    tested_strength: float,
    rope: float = 0.05,
) -> float:
    """Approximate P(color-balanced score is inside the target ROPE).

    The root marginal is close to Gaussian once enough games exist. We retain
    its actual 95% quantiles and use their average width here so the GUI's
    convergence indicator reflects all compatible trials rather than only the
    handful played at the latest exact profile.
    """

    sigma = max(0.002, (estimate.high_95 - estimate.low_95) / 3.92)
    roots = np.linspace(0.0, 1.0, 4001)
    width = max(0.005, estimate.response_width)
    offset = float(tested_strength) - roots
    red = 1.0 / (1.0 + np.exp(np.clip(-(offset + estimate.red_strength_shift) / width, -60, 60)))
    black = 1.0 / (1.0 + np.exp(np.clip(-(offset - estimate.red_strength_shift) / width, -60, 60)))
    scores = 0.5 * (red + black)
    eligible = roots[(scores >= 0.5 - rope) & (scores <= 0.5 + rope)]
    if not len(eligible):
        return 0.0
    low_z = (float(eligible[0]) - estimate.strength) / sigma
    high_z = (float(eligible[-1]) - estimate.strength) / sigma
    return max(0.0, min(1.0, _normal_cdf(high_z) - _normal_cdf(low_z)))


def _logistic(value: float) -> float:
    bounded = max(-60.0, min(60.0, value))
    return 1.0 / (1.0 + math.exp(-bounded))


def _normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))
