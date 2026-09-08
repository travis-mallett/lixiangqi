from __future__ import annotations

import math
from dataclasses import dataclass

from .runtime import tk
from .scheduler import calibration_cohort_size, is_censored
from .storage import GameResult
from .strength import BESTMOVE_BOUNDARY_NODES, StrengthProfile


@dataclass(frozen=True)
class ScorePoint:
    start_games: int
    games: int
    cohort_games: int
    target_games: int
    cohort_score: float
    low_95: float
    high_95: float
    complete: bool


@dataclass(frozen=True)
class RankPoint:
    games: int
    expected_rank: float


@dataclass(frozen=True)
class ParameterPoint:
    games: int
    value: float


@dataclass(frozen=True)
class EvidencePoint:
    value: float
    games: int
    wins: int
    draws: int
    losses: int
    censored: int
    score: float
    low_95: float
    high_95: float
    current: bool


RECENT_PARAMETER_RUNS = 4


def score_progress(
    results: list[GameResult],
    *,
    active_start: int | None = None,
    active_target: int | None = None,
) -> list[ScorePoint]:
    """Return non-overlapping scores for growing cohorts capped at 30 games."""

    points: list[ScorePoint] = []
    start = 0
    cohort_index = 0
    history_end = len(results) if active_start is None else min(len(results), max(0, active_start))
    while start < history_end:
        target_games = calibration_cohort_size(cohort_index)
        cohort = results[start : min(start + target_games, history_end)]
        scores = [game.score for game in cohort if not is_censored(game)]
        mean = sum(scores) / len(scores) if scores else 0.5
        low, high = _beta_interval(scores) if scores else (0.0, 1.0)
        end = start + len(cohort)
        points.append(
            ScorePoint(
                start,
                end,
                len(cohort),
                target_games,
                mean,
                low,
                high,
                len(cohort) == target_games,
            )
        )
        start = end
        cohort_index += 1
    if active_start is not None and active_target is not None:
        cohort = results[history_end:]
        scores = [game.score for game in cohort if not is_censored(game)]
        mean = sum(scores) / len(scores) if scores else 0.5
        low, high = _beta_interval(scores) if scores else (0.0, 1.0)
        points.append(
            ScorePoint(
                history_end,
                len(results),
                len(cohort),
                active_target,
                mean,
                low,
                high,
                len(cohort) >= active_target,
            )
        )
    return points


def rank_progress(
    results: list[GameResult], current_profile: StrengthProfile
) -> list[RankPoint]:
    """Return the policy selected after each completed-game count.

    A stored game contains the policy chosen before it. The first game's policy
    therefore belongs at x=0, the second at x=1, and the current state at
    x=len(results).
    """

    points = [
        RankPoint(index, game.profile.expected_rank)
        for index, game in enumerate(results)
    ]
    points.append(RankPoint(len(results), current_profile.expected_rank))
    return points


def parameter_progress(
    results: list[GameResult], current_profile: StrengthProfile
) -> tuple[str, list[ParameterPoint]]:
    """Return the parameter actually controlling the current strength regime."""

    use_nodes = current_profile.is_bestmove

    def value(profile: StrengthProfile) -> float:
        # Rank-sampling profiles sit below the bestmove/node regime. Should a
        # search cross that boundary, show them at the shared node floor rather
        # than treating rank selection as a different search workload.
        if use_nodes:
            return float(profile.nodes if profile.is_bestmove else BESTMOVE_BOUNDARY_NODES)
        return profile.expected_rank

    points = [
        ParameterPoint(index, value(game.profile))
        for index, game in enumerate(results)
    ]
    points.append(ParameterPoint(len(results), value(current_profile)))
    return ("nodes" if use_nodes else "rank"), points


def recent_parameter_progress(
    points: list[ParameterPoint], max_runs: int = RECENT_PARAMETER_RUNS
) -> list[ParameterPoint]:
    """Keep complete data for storage while charting only recent parameter runs."""

    if not points:
        return []
    run_starts = [0]
    for index in range(1, len(points)):
        if not math.isclose(points[index].value, points[index - 1].value, rel_tol=1e-9):
            run_starts.append(index)
    start = run_starts[-max(1, int(max_runs))] if len(run_starts) > max_runs else 0
    return points[start:]


def parameter_evidence(
    results: list[GameResult], current_profile: StrengthProfile
) -> tuple[str, list[EvidencePoint]]:
    """Aggregate evidence at the latest four distinct deployed settings."""

    parameter, trajectory = parameter_progress(results, current_profile)
    recent = recent_parameter_progress(trajectory)
    selected_values: list[float] = []
    for point in recent:
        if not any(math.isclose(point.value, value, rel_tol=1e-9) for value in selected_values):
            selected_values.append(point.value)

    def value(profile: StrengthProfile) -> float:
        if parameter == "nodes":
            return float(profile.nodes if profile.is_bestmove else BESTMOVE_BOUNDARY_NODES)
        return profile.expected_rank

    current_value = value(current_profile)
    evidence: list[EvidencePoint] = []
    for selected in selected_values:
        group = [
            game for game in results
            if math.isclose(value(game.profile), selected, rel_tol=1e-9)
        ]
        usable = [game for game in group if not is_censored(game)]
        scores = [game.score for game in usable]
        score = sum(scores) / len(scores) if scores else 0.5
        low, high = _beta_interval(scores) if scores else (0.0, 1.0)
        evidence.append(
            EvidencePoint(
                selected,
                len(usable),
                sum(game.result == "win" for game in usable),
                sum(game.result == "draw" for game in usable),
                sum(game.result == "loss" for game in usable),
                len(group) - len(usable),
                score,
                low,
                high,
                math.isclose(selected, current_value, rel_tol=1e-9),
            )
        )
    return parameter, sorted(evidence, key=lambda point: point.value)


def _beta_interval(scores: list[float]) -> tuple[float, float]:
    alpha = 0.5 + sum(scores)
    beta = 0.5 + len(scores) - sum(scores)
    grid = [index / 1000.0 for index in range(1, 1000)]
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

    return quantile(0.025), quantile(0.975)


class StrengthProgressChart:
    """Compact evidence plot: tested setting versus match score."""

    def __init__(self, parent, *, height: int = 230) -> None:
        self.canvas = tk.Canvas(parent, height=height, background="#ffffff", highlightthickness=0)
        self.points: list[EvidencePoint] = []
        self.parameter = "rank"
        self.target_low: float | None = None
        self.target_high: float | None = None
        self.canvas.bind("<Configure>", lambda _event: self._draw())

    def pack(self, **kwargs) -> None:
        self.canvas.pack(**kwargs)

    def set_results(
        self,
        results: list[GameResult],
        current_profile: StrengthProfile,
        *,
        target_low: float | None = None,
        target_high: float | None = None,
    ) -> None:
        self.parameter, self.points = parameter_evidence(results, current_profile)
        self.target_low = target_low
        self.target_high = target_high
        self._draw()

    def _draw(self) -> None:
        canvas = self.canvas
        canvas.delete("all")
        width = max(300, canvas.winfo_width())
        height = max(180, canvas.winfo_height())
        left, right, top, bottom = 52, width - 20, 42, height - 42
        plot_width, plot_height = max(1, right - left), max(1, bottom - top)

        values = [point.value for point in self.points]
        if self.target_low is not None:
            values.append(self.target_low)
        if self.target_high is not None:
            values.append(self.target_high)
        transformed = [
            math.log10(max(1.0, value)) if self.parameter == "nodes" else value
            for value in values
        ]
        value_min = min(transformed, default=0.0)
        value_max = max(transformed, default=1.0)
        minimum_span = 0.08 if self.parameter == "nodes" else 0.02
        span = max(minimum_span, value_max - value_min)
        x_min = value_min - span * 0.12
        x_max = value_max + span * 0.12

        def x(value: float) -> float:
            plotted = math.log10(max(1.0, value)) if self.parameter == "nodes" else value
            return left + plot_width * (plotted - x_min) / (x_max - x_min)

        def y(score: float) -> float:
            return bottom - plot_height * score

        if self.target_low is not None and self.target_high is not None:
            canvas.create_rectangle(
                x(min(self.target_low, self.target_high)), top,
                x(max(self.target_low, self.target_high)), bottom,
                fill="#fff7ed", outline="",
            )
            canvas.create_text(
                (x(self.target_low) + x(self.target_high)) / 2, bottom - 5,
                text="confirmed bracket", anchor="s", fill="#92400e", font=("Segoe UI", 8),
            )
        canvas.create_rectangle(left, y(0.55), right, y(0.45), fill="#e8f5ea", outline="")
        for score in (0.0, 0.5, 1.0):
            color = "#94a3b8" if score == 0.5 else "#e2e8f0"
            dash = (7, 5) if score == 0.5 else None
            canvas.create_line(left, y(score), right, y(score), fill=color, dash=dash)
            canvas.create_text(
                left - 7, y(score), text=f"{score:.0%}", anchor="e",
                fill="#475569", font=("Segoe UI", 8),
            )
        canvas.create_text(
            right, y(0.5) - 6, text="45–55% target", anchor="se",
            fill="#64748b", font=("Segoe UI", 8),
        )
        canvas.create_line(left, top, left, bottom, fill="#94a3b8")
        canvas.create_line(left, bottom, right, bottom, fill="#94a3b8")
        for point in self.points:
            canvas.create_line(x(point.value), bottom, x(point.value), bottom + 4, fill="#94a3b8")
            canvas.create_text(
                x(point.value), bottom + 8,
                text=(f"{point.value:,.0f}" if self.parameter == "nodes" else f"{point.value:.3f}"),
                anchor="n",
                fill="#475569", font=("Segoe UI", 8),
            )
        canvas.create_text(
            (left + right) / 2, height - 4,
            text=("search nodes (log scale)" if self.parameter == "nodes" else "expected move rank"),
            anchor="s",
            fill="#475569", font=("Segoe UI", 8),
        )

        if not self.points:
            canvas.create_text(
                (left + right) / 2, (top + bottom) / 2,
                text="Complete one game at this setting to begin the evidence plot.",
                fill="#64748b", font=("Segoe UI", 10),
            )
            return
        for point in self.points:
            px = x(point.value)
            canvas.create_line(
                px, y(point.low_95), px, y(point.high_95), fill="#64748b", width=2,
            )
            canvas.create_line(px - 5, y(point.low_95), px + 5, y(point.low_95), fill="#64748b")
            canvas.create_line(px - 5, y(point.high_95), px + 5, y(point.high_95), fill="#64748b")
            radius = 6 if point.current else 4
            canvas.create_oval(
                px - radius, y(point.score) - radius,
                px + radius, y(point.score) + radius,
                fill="#2563eb" if point.current else "#64748b",
                outline="#1d4ed8" if point.current else "#ffffff", width=2,
            )
            anchor = "s" if point.score <= 0.72 else "n"
            offset = -9 if anchor == "s" else 9
            note = f"{point.score:.0%} · n={point.games}"
            if point.censored:
                note += f" (+{point.censored} censored)"
            canvas.create_text(
                px, y(point.score) + offset, text=note, anchor=anchor,
                fill="#0f172a" if point.current else "#475569", font=("Segoe UI", 8),
            )

        current = next((point for point in self.points if point.current), None)
        if current is None:
            headline = "Current setting is untested"
        else:
            target = 0.45 <= current.score <= 0.55
            headline = (
                f"CURRENT {current.value:,.0f} nodes" if self.parameter == "nodes"
                else f"CURRENT rank {current.value:.3f}"
            ) + f"  ·  {current.score:.0%} over {current.games} games  ·  " + (
                "TARGET MET" if target else "outside target"
            )
        canvas.create_text(
            left, 5,
            text=headline,
            anchor="nw", fill="#0f172a", font=("Segoe UI Semibold", 9),
        )
        if self.target_low is not None and self.target_high is not None:
            width_percent = 100.0 * (
                max(self.target_low, self.target_high) / min(self.target_low, self.target_high) - 1.0
            ) if self.parameter == "nodes" else abs(self.target_high - self.target_low)
            bracket = (
                f"bracket {min(self.target_low, self.target_high):,.0f}–"
                f"{max(self.target_low, self.target_high):,.0f} nodes · width {width_percent:.1f}%"
                if self.parameter == "nodes" else
                f"bracket {min(self.target_low, self.target_high):.3f}–"
                f"{max(self.target_low, self.target_high):.3f}"
            )
            canvas.create_text(
                left, 23, text=bracket, anchor="nw", fill="#64748b", font=("Segoe UI", 8),
            )


class RankProgressChart:
    """Trajectory of whichever parameter currently controls playing strength."""

    def __init__(self, parent, *, height: int = 260) -> None:
        self.canvas = tk.Canvas(parent, height=height, background="#ffffff", highlightthickness=0)
        self.points: list[ParameterPoint] = []
        self.parameter = "rank"
        self.target_value: float | None = None
        self.target_low: float | None = None
        self.target_high: float | None = None
        self.canvas.bind("<Configure>", lambda _event: self._draw())

    def pack(self, **kwargs) -> None:
        self.canvas.pack(**kwargs)

    def set_results(
        self,
        results: list[GameResult],
        current_profile: StrengthProfile,
        *,
        target_value: float | None = None,
        target_low: float | None = None,
        target_high: float | None = None,
    ) -> None:
        self.parameter, self.points = parameter_progress(results, current_profile)
        self.target_value = target_value
        self.target_low = target_low
        self.target_high = target_high
        self._draw()

    def _draw(self) -> None:
        canvas = self.canvas
        canvas.delete("all")
        width = max(300, canvas.winfo_width())
        height = max(190, canvas.winfo_height())
        left, right, top, bottom = 64, width - 18, 30, height - 40
        plot_width, plot_height = max(1, right - left), max(1, bottom - top)
        visible_points = recent_parameter_progress(self.points)
        games_completed = visible_points[-1].games if visible_points else 0
        min_games = visible_points[0].games if visible_points else 0
        max_games = max(min_games + 8, games_completed)

        visible_values = [point.value for point in visible_points]
        if self.target_value is not None:
            visible_values.append(self.target_value)
        if self.target_low is not None:
            visible_values.append(self.target_low)
        if self.target_high is not None:
            visible_values.append(self.target_high)
        if self.parameter == "nodes":
            transformed = [math.log10(max(1.0, value)) for value in visible_values]
            value_min = min(transformed, default=0.0)
            value_max = max(transformed, default=1.0)
            span = max(0.08, value_max - value_min)
            y_min = max(0.0, value_min - span * 0.10)
            y_max = value_max + span * 0.10
        else:
            value_min = max(1.0, min(visible_values, default=1.0))
            value_max = max(visible_values, default=2.0)
            span = max(0.02, value_max - value_min)
            y_min = max(1.0, value_min - span * 0.16)
            y_max = value_max + span * 0.16
            if y_max - y_min < 0.04:
                midpoint = (y_min + y_max) / 2.0
                y_min = max(1.0, midpoint - 0.02)
                y_max = midpoint + 0.02

        def x(game_count: float) -> float:
            return left + plot_width * (game_count - min_games) / (max_games - min_games)

        def y(value: float) -> float:
            plotted = math.log10(max(1.0, value)) if self.parameter == "nodes" else value
            bounded = max(y_min, min(y_max, plotted))
            return bottom - plot_height * (bounded - y_min) / (y_max - y_min)

        def tick_label(plotted: float) -> str:
            if self.parameter == "nodes":
                nodes = 10 ** plotted
                if nodes >= 1_000_000:
                    return f"{nodes / 1_000_000:.1f}M"
                if nodes >= 1_000:
                    return f"{nodes / 1_000:.1f}k"
                return f"{nodes:.0f}"
            return f"{plotted:.2f}" if y_max - y_min < 4 else f"{plotted:.1f}"

        canvas.create_line(left, top, left, bottom, fill="#94a3b8")
        canvas.create_line(left, bottom, right, bottom, fill="#94a3b8")
        for index in range(5):
            plotted = y_min + (y_max - y_min) * index / 4
            actual = 10 ** plotted if self.parameter == "nodes" else plotted
            canvas.create_line(left, y(actual), right, y(actual), fill="#e2e8f0")
            canvas.create_text(
                left - 7, y(actual), text=tick_label(plotted),
                anchor="e", fill="#475569", font=("Segoe UI", 8),
            )
            game_count = int(round(min_games + (max_games - min_games) * index / 4))
            canvas.create_line(x(game_count), bottom, x(game_count), bottom + 4, fill="#94a3b8")
            canvas.create_text(
                x(game_count), bottom + 8, text=str(game_count), anchor="n",
                fill="#475569", font=("Segoe UI", 8),
            )
        canvas.create_text(
            12, (top + bottom) / 2,
            text=("search nodes\n(log scale)" if self.parameter == "nodes" else
                  "expected rank\n(higher = weaker)"),
            anchor="w", justify="center", fill="#475569", font=("Segoe UI", 8),
        )
        canvas.create_text(
            (left + right) / 2, height - 4, text="games completed", anchor="s",
            fill="#475569", font=("Segoe UI", 8),
        )

        if self.target_low is not None and self.target_high is not None:
            raw_low = min(self.target_low, self.target_high)
            raw_high = max(self.target_low, self.target_high)
            low = max(
                y_min,
                math.log10(max(1.0, raw_low)) if self.parameter == "nodes" else raw_low,
            )
            high = min(
                y_max,
                math.log10(max(1.0, raw_high)) if self.parameter == "nodes" else raw_high,
            )
            if low <= high:
                displayed_low = 10 ** low if self.parameter == "nodes" else low
                displayed_high = 10 ** high if self.parameter == "nodes" else high
                canvas.create_rectangle(
                    left, y(displayed_high), right, y(displayed_low),
                    fill="#fff7ed", outline="",
                )
        if self.target_value is not None:
            canvas.create_line(
                left, y(self.target_value), right, y(self.target_value),
                fill="#f59e0b", dash=(7, 5), width=2,
            )
            canvas.create_text(
                right, y(self.target_value) - 5,
                text=(f"search midpoint {self.target_value:,.0f} nodes"
                      if self.parameter == "nodes" else
                      f"search midpoint rank {self.target_value:.3f}"),
                anchor="se",
                fill="#92400e", font=("Segoe UI", 8),
            )

        trajectory: list[tuple[float, float]] = []
        if visible_points:
            trajectory.append((x(visible_points[0].games), y(visible_points[0].value)))
            for previous, current in zip(visible_points, visible_points[1:]):
                trajectory.append((x(current.games), y(previous.value)))
                trajectory.append((x(current.games), y(current.value)))
        if len(trajectory) >= 2:
            canvas.create_line(
                *[coordinate for point in trajectory for coordinate in point],
                fill="#7c3aed", width=3,
            )
        for point in visible_points:
            px, py = x(point.games), y(point.value)
            canvas.create_oval(px - 3, py - 3, px + 3, py + 3, fill="#7c3aed", outline="#ffffff")

        latest = visible_points[-1] if visible_points else ParameterPoint(0, 1.0)
        previous = next(
            (point for point in reversed(visible_points[:-1])
             if not math.isclose(point.value, latest.value, rel_tol=1e-9)),
            latest,
        )
        adjustment = latest.value - previous.value
        if self.parameter == "nodes":
            summary = f"current nodes {latest.value:,.0f}   latest adjustment {adjustment:+,.0f}"
        else:
            summary = f"current rank {latest.value:.3f}   latest adjustment {adjustment:+.3f}"
        canvas.create_text(
            left, 5,
            text=summary,
            anchor="nw", fill="#0f172a", font=("Segoe UI Semibold", 9),
        )
