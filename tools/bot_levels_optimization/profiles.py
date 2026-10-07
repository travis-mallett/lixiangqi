"""Continuous experimental profile family, with frozen production endpoints."""

from __future__ import annotations

import math
from dataclasses import asdict
from itertools import pairwise

from external.pikafish_worker.ai import STRENGTH_PROFILES, StrengthProfile

LOW = StrengthProfile(149, 16, 9.0, 600)
HIGH = StrengthProfile(3_318_000, 1, 1.0)
SEED_COORDINATES = tuple(i / 8 for i in range(9))


def profile_at(s: float) -> StrengthProfile:
    if not math.isfinite(s) or not 0 <= s <= 1:
        raise ValueError("strengthCoordinate must be finite and between 0 and 1")
    if s == 0:
        return LOW
    if s == 1:
        return HIGH
    return StrengthProfile(
        math.floor(149 * (3_318_000 / 149) ** s + 0.5),
        max(4, min(16, math.floor(16 - 12 * s + 0.5))),
        9 - 8 * s,
        600 * (1 - s),
    )


def validate_endpoints() -> None:
    if STRENGTH_PROFILES[0] != LOW or STRENGTH_PROFILES[-1] != HIGH:
        raise ValueError(
            "Production endpoints changed; review calibration before running"
        )


def validate_coordinates(values) -> tuple[float, ...]:
    values = tuple(float(v) for v in values)
    if (
        len(values) != 9
        or values[0] != 0
        or values[-1] != 1
        or any(not math.isfinite(v) for v in values)
        or any(a >= b for a, b in pairwise(values))
    ):
        raise ValueError(
            "Require nine strictly increasing coordinates, with endpoints 0 and 1"
        )
    return values


def describe(level: int, s: float) -> dict:
    p = profile_at(s)
    return {
        "level": level,
        "strengthCoordinate": s,
        "nodes": p.nodes,
        "MultiPV": p.multi_pv,
        "expectedRank": p.expected_rank,
        "maxCandidateLoss": p.max_candidate_loss,
        "threads": 1,
        "hashMiB": 128,
        "rankNormalization": "production" if s in (0, 1) else "available-candidates",
        "engineProfile": asdict(p),
    }
