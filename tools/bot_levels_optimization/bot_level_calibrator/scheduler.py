from __future__ import annotations

import math
from dataclasses import asdict, dataclass

from .optimizer import Estimate, Observation, estimate_equal_strength
from .storage import CalibrationStore, GameResult
from .strength import (
    StrengthProfile,
    describe_profile,
    initial_profile_for_level,
    profile_for_expected_rank,
    profile_for_nodes,
    profile_for_strength,
)


STATE_VERSION = 12
TARGET_ROPE = 0.05
MAX_COHORT_SIZE = 30
NODE_PROBE_GAMES = 3
NODE_CONFIRMATION_GAMES = 12
DIRECTION_CONFIDENCE = 0.70
MIN_DIRECTION_GAMES = 2
INITIAL_EXPANSION_STEP = 0.04
MIN_EXPANSION_STEP = 0.001
TIANTIAN_LEVELS = (2, 3, 4, 5, 7, 9, 12, 18, 25)


@dataclass(frozen=True)
class OutcomeEvidence:
    games: int
    median: float
    low_95: float
    high_95: float
    probability_below: float
    probability_equivalent: float
    probability_above: float


@dataclass(frozen=True)
class StrengthDecision:
    profile: StrengthProfile
    epoch: int
    changed: bool
    message: str
    estimate: Estimate
    outcome: OutcomeEvidence


@dataclass(frozen=True)
class StrengthProgress:
    epoch: int
    compatible_games: int
    active_games: int
    estimate: Estimate
    outcome: OutcomeEvidence
    message: str
    cohort_index: int
    cohort_size: int
    cohort_games: int
    bracket_low: float | None
    bracket_high: float | None


def calibration_cohort_size(index: int) -> int:
    """Growing update cohorts: 1, 2, 3, 5, ... capped at 30 games."""

    position = max(0, int(index))
    previous, current = 1, 2
    for _ in range(position):
        previous, current = current, previous + current
    return min(MAX_COHORT_SIZE, previous)


def adaptive_calibration_cohort_size(
    profile: StrengthProfile,
    cohort_games: list[GameResult],
    cohort_index: int,
) -> int:
    """Probe deterministic node budgets cheaply, then confirm non-rail results."""

    if not profile.is_bestmove:
        return calibration_cohort_size(cohort_index)
    scores = [game.score for game in cohort_games if not is_censored(game)]
    if len(scores) < NODE_PROBE_GAMES:
        return NODE_PROBE_GAMES
    saturated = all(score == 0.0 for score in scores) or all(
        score == 1.0 for score in scores
    )
    return NODE_PROBE_GAMES if saturated else NODE_CONFIRMATION_GAMES


def is_censored(game: GameResult) -> bool:
    return "absolute safety limit" in str(game.reason).lower()


def is_strength_policy(game: GameResult) -> bool:
    """Recognize either side of the adjacent-rank strength policy."""

    fixed_legacy_controls = (
        game.random_move_chance == 0.0
        and game.opening_plies == 0
        and game.opening_temperature == 0.0
        and game.opening_random_move_chance == 0.0
        and game.temperature == 0.0
    )
    deterministic = game.multi_pv == 1 and abs(game.expected_rank - 1.0) < 1e-9
    ranked = (
        game.expected_rank > 1.0
        and game.multi_pv == math.ceil(game.expected_rank - 1e-12)
    )
    return fixed_legacy_controls and (deterministic or ranked)


# Compatibility alias for callers and reports created by version 8.
is_plain_pikafish = is_strength_policy


def seed_strength_profiles(store: CalibrationStore) -> list[int]:
    """Install confidence-gated stochastic bisection version 12."""

    seeded: list[int] = []
    for level in TIANTIAN_LEVELS:
        old = store.policy_state(level)
        if old is not None and int(old.get("version", 0)) >= STATE_VERSION:
            continue
        results = store.results(level)
        old_version = int(old.get("version", 0)) if old else 0
        evidence_boundary = len(results)
        if old_version >= 9:
            evidence_boundary = _boundary(old, "strength_start_game_count", len(results))
        elif old_version == 8:
            evidence_boundary = _boundary(old, "plain_start_game_count", len(results))
        # Level 2's old bestmove-floor wins establish only that rank 1 is too
        # strong. They contain no information about the response curve between
        # ranks 2, 3, and beyond, so using them in the new logistic likelihood
        # would extrapolate an arbitrary and usually extreme starting rank.
        if level == 2 and old_version < 11:
            evidence_boundary = len(results)
        if level == 2 and old_version < 11:
            profile = initial_profile_for_level(level)
        elif old_version >= 11 and isinstance(old.get("profile"), dict):
            profile = _profile_from_state(old)
        elif old_version == 8 and isinstance(old.get("profile"), dict):
            profile = profile_for_nodes(int(dict(old["profile"])["nodes"]))
        else:
            profile = initial_profile_for_level(level)
        reusable = [
            game for game in results[evidence_boundary:]
            if is_strength_policy(game) and not is_censored(game)
        ]
        if reusable:
            migrated_estimate = estimate_equal_strength(
                [Observation(game.profile.strength, game.score, game.side) for game in reusable],
                prior_strength=initial_profile_for_level(level).strength,
            )
            bracket_low, bracket_high, bracket_conflict = _strength_bounds(reusable)
            profile = (
                profile_for_strength((bracket_low + bracket_high) / 2.0)
                if bracket_low is not None and bracket_high is not None
                else profile_for_strength(migrated_estimate.strength)
            )
        else:
            bracket_low, bracket_high, bracket_conflict = None, None, False
        cohort_index = max(0, int(old.get("cohort_index", 0))) if old_version >= 11 else 0
        cohort_size = adaptive_calibration_cohort_size(profile, [], cohort_index)
        store.save_policy_state(
            level,
            {
                "version": STATE_VERSION,
                "method": "confidence-gated-stochastic-bisection",
                "epoch": int(old.get("epoch", 1)) if old else 1,
                "profile": asdict(profile),
                "seed_strength": initial_profile_for_level(level).strength,
                "strength_start_game_count": evidence_boundary,
                "decision_game_count": len(results),
                "profile_start_game_count": len(results),
                "cohort_index": cohort_index,
                "cohort_start_compatible_count": len(reusable),
                "cohort_size": cohort_size,
                "bracket_low": bracket_low,
                "bracket_high": bracket_high,
                "bracket_conflict": bracket_conflict,
                "expansion_step": INITIAL_EXPANSION_STEP,
                "last_message": (
                    f"Started confidence-gated stochastic bisection at {describe_profile(profile)}. "
                    f"Reused {len(reusable)} compatible game(s); preserved all older games."
                ),
            },
        )
        seeded.append(level)
    return seeded


def select_profile(
    store: CalibrationStore,
    level: int,
    results: list[GameResult] | None = None,
) -> StrengthDecision:
    games = store.results(level) if results is None else results
    state = store.policy_state(level)
    if state is None or int(state.get("version", 0)) < STATE_VERSION:
        seed_strength_profiles(store)
        state = store.policy_state(level)
    if state is None:
        raise RuntimeError(f"Could not initialize strength state for level {level}")

    current = _profile_from_state(state)
    compatible = strength_calibration_games(store, level, games)
    seed = initial_profile_for_level(level)
    prior_strength = min(
        1.0,
        max(0.0, float(state.get("seed_strength", seed.strength))),
    )
    estimate = estimate_equal_strength(
        [Observation(game.profile.strength, game.score, game.side) for game in compatible],
        prior_strength=prior_strength,
    )
    cohort_index = max(0, int(state.get("cohort_index", 0)))
    cohort_start = min(
        len(compatible),
        max(0, int(state.get("cohort_start_compatible_count", 0))),
    )
    active_cohort = compatible[cohort_start:]
    cohort_evidence = active_cohort
    if current.is_bestmove and not cohort_evidence:
        cohort_evidence = [
            game for game in compatible if _same_profile(game.profile, current)
        ]
    cohort_size = adaptive_calibration_cohort_size(
        current, cohort_evidence, cohort_index
    )
    cohort_games = len(active_cohort)
    cohort_complete = cohort_games >= cohort_size
    bracket_low, bracket_high, bracket_conflict = _strength_bounds(compatible)
    selected, search_reason, next_expansion_step = (
        _select_bisection_profile(
            current,
            compatible,
            state,
            bracket_low,
            bracket_high,
            bracket_conflict,
        )
        if cohort_complete
        else (current, "cohort still collecting", float(state.get("expansion_step", INITIAL_EXPANSION_STEP)))
    )
    changed = cohort_complete and not _same_profile(current, selected)
    epoch = int(state.get("epoch", 1)) + (1 if cohort_complete else 0)
    next_cohort_index = cohort_index + (1 if cohort_complete else 0)
    next_cohort_start = len(compatible) if cohort_complete else cohort_start
    next_cohort_size = adaptive_calibration_cohort_size(
        selected,
        (
            active_cohort
            if cohort_complete and _same_profile(current, selected)
            else [] if cohort_complete
            else active_cohort
        ),
        next_cohort_index,
    )
    start = len(games) if changed else _boundary(state, "profile_start_game_count", len(games))
    active = [game for game in games[start:] if is_strength_policy(game)]
    outcome = _outcome_evidence(active, TARGET_ROPE)

    if not compatible:
        message = (
            f"Cohort 1: 0/{cohort_size} games at the evidence-informed seed, "
            f"{describe_profile(selected)}."
        )
    elif not cohort_complete:
        message = (
            f"Holding {describe_profile(current)} throughout cohort {cohort_index + 1}: "
            f"{cohort_games}/{cohort_size} games complete; next adjustment after "
            f"{cohort_size - cohort_games} more game(s)."
        )
    else:
        direction = (
            "Increased" if selected.strength > current.strength else
            "Decreased" if selected.strength < current.strength else
            "Held"
        )
        median = profile_for_strength(estimate.strength)
        low = profile_for_strength(estimate.low_95)
        high = profile_for_strength(estimate.high_95)
        message = (
            f"Completed cohort {cohort_index + 1} ({cohort_size} games). "
            f"{direction} strength to {describe_profile(selected)} after "
            f"{len(compatible)} total compatible game(s). Next cohort: "
            f"{next_cohort_size} games. Search decision: {search_reason}. "
            f"Secondary logistic estimate: "
            f"{describe_profile(median)} (95% {describe_profile(low)} to "
            f"{describe_profile(high)}). Learned response width "
            f"{estimate.response_width:.3f}; Red shift "
            f"{estimate.red_strength_shift:+.3f}."
        )

    store.save_policy_state(
        level,
        {
            "version": STATE_VERSION,
            "method": "confidence-gated-stochastic-bisection",
            "epoch": epoch,
            "profile": asdict(selected),
            "seed_strength": float(state.get("seed_strength", seed.strength)),
            "strength_start_game_count": _boundary(
                state, "strength_start_game_count", len(games)
            ),
            "decision_game_count": len(games),
            "profile_start_game_count": start,
            "cohort_index": next_cohort_index,
            "cohort_start_compatible_count": next_cohort_start,
            "cohort_size": next_cohort_size,
            "compatible_games": len(compatible),
            "parity_strength": estimate.strength,
            "parity_low_95": estimate.low_95,
            "parity_high_95": estimate.high_95,
            "response_width": estimate.response_width,
            "red_strength_shift": estimate.red_strength_shift,
            "bracket_low": bracket_low,
            "bracket_high": bracket_high,
            "bracket_conflict": bracket_conflict,
            "expansion_step": next_expansion_step,
            "last_message": message,
        },
    )
    return StrengthDecision(selected, epoch, changed, message, estimate, outcome)


def current_profile(
    store: CalibrationStore, level: int, fallback: StrengthProfile | None = None
) -> StrengthProfile:
    state = store.policy_state(level)
    if state is None or int(state.get("version", 0)) < STATE_VERSION:
        return fallback or initial_profile_for_level(level)
    return _profile_from_state(state)


def strength_progress(store: CalibrationStore, level: int) -> StrengthProgress | None:
    state = store.policy_state(level)
    if state is None or int(state.get("version", 0)) < STATE_VERSION:
        return None
    games = store.results(level)
    compatible = strength_calibration_games(store, level, games)
    seed = initial_profile_for_level(level)
    prior_strength = min(
        1.0,
        max(0.0, float(state.get("seed_strength", seed.strength))),
    )
    estimate = estimate_equal_strength(
        [Observation(game.profile.strength, game.score, game.side) for game in compatible],
        prior_strength=prior_strength,
    )
    start = _boundary(state, "profile_start_game_count", len(games))
    active = [game for game in games[start:] if is_strength_policy(game)]
    cohort_index = max(0, int(state.get("cohort_index", 0)))
    cohort_start = min(
        len(compatible),
        max(0, int(state.get("cohort_start_compatible_count", 0))),
    )
    active_cohort = compatible[cohort_start:]
    current = _profile_from_state(state)
    cohort_evidence = active_cohort
    if current.is_bestmove and not cohort_evidence:
        cohort_evidence = [
            game for game in compatible if _same_profile(game.profile, current)
        ]
    cohort_size = adaptive_calibration_cohort_size(
        current, cohort_evidence, cohort_index
    )
    bracket_low, bracket_high, _bracket_conflict = _strength_bounds(compatible)
    return StrengthProgress(
        epoch=int(state.get("epoch", 1)),
        compatible_games=len(compatible),
        active_games=len(active),
        estimate=estimate,
        outcome=_outcome_evidence(active, TARGET_ROPE),
        message=str(state.get("last_message", "")),
        cohort_index=cohort_index,
        cohort_size=cohort_size,
        cohort_games=len(active_cohort),
        bracket_low=bracket_low,
        bracket_high=bracket_high,
    )


def strength_calibration_games(
    store: CalibrationStore,
    level: int,
    results: list[GameResult] | None = None,
) -> list[GameResult]:
    games = store.results(level) if results is None else results
    state = store.policy_state(level)
    if state is None or int(state.get("version", 0)) < STATE_VERSION:
        return []
    start = _boundary(state, "strength_start_game_count", len(games))
    return [
        game for game in games[start:]
        if is_strength_policy(game) and not is_censored(game)
    ]


# Compatibility alias for version-8 GUI/test imports.
plain_calibration_games = strength_calibration_games


def _select_bisection_profile(
    current: StrengthProfile,
    games: list[GameResult],
    state: dict[str, object],
    bracket_low: float | None,
    bracket_high: float | None,
    bracket_conflict: bool,
) -> tuple[StrengthProfile, str, float]:
    """Choose a noisy-binary-search midpoint or expand until one is bracketed."""

    step = max(
        MIN_EXPANSION_STEP,
        float(state.get("expansion_step", INITIAL_EXPANSION_STEP)),
    )
    if bracket_conflict:
        return (
            current,
            "directional evidence is non-monotonic, so no unsafe bound was accepted; "
            "held the current setting for more evidence",
            step,
        )
    if bracket_low is not None and bracket_high is not None:
        midpoint = (bracket_low + bracket_high) / 2.0
        midpoint_profile = profile_for_strength(midpoint)
        width = bracket_high - bracket_low
        if _same_profile(current, midpoint_profile):
            current_games = [
                game for game in games
                if _same_profile(game.profile, current)
            ]
            evidence = _outcome_evidence(current_games, TARGET_ROPE)
            return (
                current,
                f"the bracket midpoint remains directionally inconclusive "
                f"(P below 45%={evidence.probability_below:.0%}, "
                f"P within 45–55%={evidence.probability_equivalent:.0%}, "
                f"P above 55%={evidence.probability_above:.0%}); held it for another cohort",
                max(MIN_EXPANSION_STEP, width / 2.0),
            )
        return (
            midpoint_profile,
            f"bisected the confirmed strength bracket [{bracket_low:.4f}, {bracket_high:.4f}] "
            f"to its midpoint; bracket width {width:.4f}",
            max(MIN_EXPANSION_STEP, width / 2.0),
        )

    current_games = [
        game for game in games
        if abs(game.profile.strength - current.strength) < 1e-8
    ]
    evidence = _outcome_evidence(current_games, TARGET_ROPE)
    direction = _direction(evidence)
    if direction is None:
        return (
            current,
            f"direction remains uncertain at the current setting "
            f"(P weak={evidence.probability_below:.0%}, P strong={evidence.probability_above:.0%}); "
            "held it for a larger cohort",
            step,
        )

    if bracket_low is not None:
        candidate = min(1.0, bracket_low + step)
        reason = f"only a too-weak bound is confirmed; expanded stronger by {step:.4f}"
    elif bracket_high is not None:
        candidate = max(0.0, bracket_high - step)
        reason = f"only a too-strong bound is confirmed; expanded weaker by {step:.4f}"
    elif direction == "weak":
        candidate = min(1.0, current.strength + step)
        reason = f"current setting is credibly too weak; expanded stronger by {step:.4f}"
    else:
        candidate = max(0.0, current.strength - step)
        reason = f"current setting is credibly too strong; expanded weaker by {step:.4f}"
    return profile_for_strength(candidate), reason, min(0.25, step * 2.0)


def _strength_bracket(games: list[GameResult]) -> tuple[float | None, float | None]:
    low, high, _conflict = _strength_bounds(games)
    return low, high


def _strength_bounds(
    games: list[GameResult],
) -> tuple[float | None, float | None, bool]:
    """Return confidence-supported bounds and flag non-monotonic evidence."""

    grouped: dict[float, list[GameResult]] = {}
    for game in games:
        grouped.setdefault(round(game.profile.strength, 8), []).append(game)
    weak: list[float] = []
    strong: list[float] = []
    for strength, group in grouped.items():
        direction = _direction(_outcome_evidence(group, TARGET_ROPE))
        if direction == "weak":
            weak.append(strength)
        elif direction == "strong":
            strong.append(strength)
    low = max(weak) if weak else None
    high = min(strong) if strong else None
    # Contradictory noisy classifications are not a valid bracket. Holding and
    # collecting more evidence is safer than discarding the true root.
    if low is not None and high is not None and low >= high:
        return None, None, True
    return low, high, False


def _direction(evidence: OutcomeEvidence) -> str | None:
    if evidence.games < MIN_DIRECTION_GAMES:
        return None
    if evidence.probability_below >= DIRECTION_CONFIDENCE:
        return "weak"
    if evidence.probability_above >= DIRECTION_CONFIDENCE:
        return "strong"
    return None


def _same_profile(left: StrengthProfile, right: StrengthProfile) -> bool:
    return (
        left.nodes == right.nodes
        and left.multi_pv == right.multi_pv
        and abs(left.expected_rank - right.expected_rank) < 1e-9
    )


def _profile_from_state(state: dict[str, object]) -> StrengthProfile:
    profile = dict(state["profile"])  # type: ignore[arg-type]
    if float(profile.get("expected_rank", 1.0)) > 1.0:
        return profile_for_expected_rank(float(profile["expected_rank"]))
    if int(profile.get("multi_pv", 1)) == 1 and "nodes" in profile:
        return profile_for_nodes(int(profile["nodes"]))
    if "strength" in profile:
        return profile_for_strength(float(profile["strength"]))
    return profile_for_nodes(int(profile["nodes"]))


def _boundary(state: dict[str, object] | None, key: str, game_count: int) -> int:
    if state is None:
        return game_count
    return min(game_count, max(0, int(state.get(key, game_count))))


def _outcome_evidence(games: list[GameResult], rope: float) -> OutcomeEvidence:
    scores = [game.score for game in games if not is_censored(game)]
    alpha = 0.5 + sum(scores)
    beta = 0.5 + len(scores) - sum(scores)
    grid = [index / 4000.0 for index in range(1, 4000)]
    logs = [
        (alpha - 1.0) * math.log(value) + (beta - 1.0) * math.log(1.0 - value)
        for value in grid
    ]
    peak = max(logs)
    weights = [math.exp(value - peak) for value in logs]
    total = sum(weights)

    def quantile(fraction: float) -> float:
        threshold = total * fraction
        cumulative = 0.0
        for value, weight in zip(grid, weights):
            cumulative += weight
            if cumulative >= threshold:
                return value
        return grid[-1]

    below = sum(weight for value, weight in zip(grid, weights) if value < 0.5 - rope) / total
    equivalent = sum(
        weight for value, weight in zip(grid, weights) if 0.5 - rope <= value <= 0.5 + rope
    ) / total
    return OutcomeEvidence(
        len(scores),
        quantile(0.5),
        quantile(0.025),
        quantile(0.975),
        below,
        equivalent,
        max(0.0, 1.0 - below - equivalent),
    )
