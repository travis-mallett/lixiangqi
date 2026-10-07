from __future__ import annotations

import math
from dataclasses import dataclass, replace

from external.pikafish_worker.ai import STRENGTH_PROFILES


# One ordered coordinate spans two deliberately simple regimes. Weak play uses
# one fixed analysis budget and interpolates between adjacent Pikafish ranks.
# Strong play always selects rank 1 and increases only search work.
BESTMOVE_BOUNDARY = 0.50
RANKING_NODES = 149
# The two regimes meet at the calibrated Level 7 workload. As expected rank
# approaches one, rank sampling at 149 nodes becomes exactly the same policy as
# MultiPV 1 at 149 nodes; stronger levels then increase nodes continuously.
BESTMOVE_BOUNDARY_NODES = RANKING_NODES
MAX_SEARCH_NODES = 25_000_000
MAX_EXPECTED_RANK = 128.0
TIANTIAN_LEVELS = (1, 2, 3, 4, 5, 7, 9, 12, 18, 25)

# Final release profiles also serve as evidence-informed starting points for a
# fresh calibration. Levels 3-5 intentionally remain interpolation-only.
INITIAL_LEVEL_POLICY: dict[int, tuple[int, float]] = {
    2: (RANKING_NODES, 1.2109662691040561),
    # Levels 3–5 are equal steps on the normalized strength coordinate between
    # the fitted Level 2 profile (s=.48027438) and Level 7's rank-1 boundary
    # (s=.5). The Level 5→7 gap deliberately counts as two such steps.
    3: (RANKING_NODES, 1.1654821783005245),
    4: (RANKING_NODES, 1.12170647737457),
    5: (RANKING_NODES, 1.0795749989234302),
    7: (RANKING_NODES, 1.0),
    9: (7_849, 1.0),
    12: (24_389, 1.0),
    18: (235_500, 1.0),
    25: (3_318_000, 1.0),
}


@dataclass(frozen=True)
class StrengthProfile:
    """A deployed policy generated from the sole normalized strength value."""

    strength: float
    nodes: int
    multi_pv: int
    expected_rank: float
    opening_book: bool = False
    max_candidate_loss: int | None = None

    @property
    def is_bestmove(self) -> bool:
        return self.expected_rank <= 1.0 + 1e-12

    @property
    def worse_rank_probability(self) -> float:
        """Probability of selecting ceil(expected_rank)."""

        lower = math.floor(self.expected_rank + 1e-12)
        return max(0.0, min(1.0, self.expected_rank - lower))


def profile_for_strength(strength: float, *, opening_book: bool = False) -> StrengthProfile:
    """Map [0, 1] from high expected move rank to deep bestmove."""

    ranking_nodes = RANKING_NODES
    boundary_nodes = BESTMOVE_BOUNDARY_NODES
    value = min(1.0, max(0.0, float(strength)))
    if value < BESTMOVE_BOUNDARY:
        weakness = (BESTMOVE_BOUNDARY - value) / BESTMOVE_BOUNDARY
        expected_rank = min(
            MAX_EXPECTED_RANK,
            math.exp(weakness * math.log(MAX_EXPECTED_RANK)),
        )
        multi_pv = max(2, min(int(MAX_EXPECTED_RANK), math.ceil(expected_rank - 1e-12)))
        if opening_book:
            expected_rank = round(expected_rank, 12)
            multi_pv = max(STRENGTH_PROFILES[0].multi_pv, multi_pv)
        return StrengthProfile(value, ranking_nodes, multi_pv, expected_rank, opening_book,
                               STRENGTH_PROFILES[0].max_candidate_loss if opening_book else None)

    node_fraction = (value - BESTMOVE_BOUNDARY) / (1.0 - BESTMOVE_BOUNDARY)
    nodes = round(
        math.exp(
            math.log(boundary_nodes)
            + node_fraction * math.log(MAX_SEARCH_NODES / boundary_nodes)
        )
    )
    return StrengthProfile(value, nodes, 1, 1.0, opening_book)


def profile_for_nodes(nodes: int) -> StrengthProfile:
    """Return deterministic bestmove at the requested search work."""

    requested = max(1, min(MAX_SEARCH_NODES, int(round(nodes))))
    if requested <= BESTMOVE_BOUNDARY_NODES:
        return StrengthProfile(BESTMOVE_BOUNDARY, requested, 1, 1.0)
    fraction = math.log(requested / BESTMOVE_BOUNDARY_NODES) / math.log(
        MAX_SEARCH_NODES / BESTMOVE_BOUNDARY_NODES
    )
    strength = BESTMOVE_BOUNDARY + (1.0 - BESTMOVE_BOUNDARY) * fraction
    return StrengthProfile(min(1.0, strength), requested, 1, 1.0)


def profile_for_expected_rank(expected_rank: float) -> StrengthProfile:
    """Return the adjacent-rank policy for a desired mean move rank."""

    bounded = min(MAX_EXPECTED_RANK, max(1.0, float(expected_rank)))
    if bounded <= 1.0 + 1e-12:
        return profile_for_strength(BESTMOVE_BOUNDARY)
    weakness = math.log(bounded) / math.log(MAX_EXPECTED_RANK)
    strength = BESTMOVE_BOUNDARY * (1.0 - weakness)
    multi_pv = max(2, min(int(MAX_EXPECTED_RANK), math.ceil(bounded - 1e-12)))
    return StrengthProfile(strength, RANKING_NODES, multi_pv, bounded)


def profile_from_policy(nodes: int, multi_pv: int, expected_rank: float) -> StrengthProfile:
    """Reconstruct the normalized coordinate recorded with a completed game."""

    if float(expected_rank) > 1.0 or int(multi_pv) > 1:
        return profile_for_expected_rank(expected_rank)
    return profile_for_nodes(nodes)


def initial_profile_for_level(level: int) -> StrengthProfile:
    if int(level) == 1:
        seed = STRENGTH_PROFILES[0]
        coordinate = BESTMOVE_BOUNDARY * (1 - math.log(seed.expected_rank) / math.log(MAX_EXPECTED_RANK))
        return StrengthProfile(coordinate, seed.nodes, seed.multi_pv, seed.expected_rank, True, seed.max_candidate_loss)
    nodes, expected_rank = INITIAL_LEVEL_POLICY.get(int(level), (600_000, 1.0))
    return (
        profile_for_expected_rank(expected_rank)
        if expected_rank > 1.0
        else profile_for_nodes(nodes)
    )


def describe_profile(profile: StrengthProfile) -> str:
    if profile.opening_book:
        return "master book fade (5M-node miss): " + describe_profile(replace(profile, opening_book=False))
    if profile.max_candidate_loss is not None and not profile.is_bestmove:
        return (f"production rank sampler: expected rank {profile.expected_rank:.3f}, "
                f"{profile.nodes:,} nodes, MultiPV {profile.multi_pv}, "
                f"candidate-loss limit {profile.max_candidate_loss} cp")
    if profile.is_bestmove:
        return f"rank 1 bestmove at {profile.nodes:,} nodes (MultiPV 1)"
    lower = math.floor(profile.expected_rank + 1e-12)
    upper = math.ceil(profile.expected_rank - 1e-12)
    probability = profile.worse_rank_probability
    if lower == upper:
        selection = f"always rank {lower}"
    else:
        selection = (
            f"rank {lower} {(1.0 - probability):.0%} / "
            f"rank {upper} {probability:.0%}"
        )
    return (
        f"expected rank {profile.expected_rank:.3f} ({selection}) at "
        f"{profile.nodes:,} ranking nodes (MultiPV {profile.multi_pv})"
    )
