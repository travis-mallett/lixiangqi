from __future__ import annotations

import json
import queue
import threading
import traceback
from dataclasses import asdict
from pathlib import Path

from .controller import CalibrationStopped, TIANTIAN_LEVELS, TiantianController
from .engine import PikafishEngine
from .optimizer import balanced_expected_score, probability_balanced_equivalent
from .progress_chart import RankProgressChart, StrengthProgressChart, score_progress
from .recognizer import XiangqiRecognizer
from .runtime import tk
from .scheduler import (
    current_profile,
    strength_calibration_games,
    seed_strength_profiles,
    select_profile,
    strength_progress,
)
from .storage import CalibrationStore
from .strength import describe_profile, initial_profile_for_level, profile_for_strength


TOOL_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = TOOL_ROOT / "data"
DATABASE = DATA_DIR / "calibration.sqlite3"
EXPORT_FILE = DATA_DIR / "recommended_profiles.json"
ENGINE_PATH = REPO_ROOT / ".tools" / "pikafish" / "Windows" / "pikafish-avx2.exe"


class CalibrationApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Lixiangqi Bot Strength Calibration")
        self.root.geometry("1360x820")
        self.root.minsize(1120, 680)
        self.store = CalibrationStore(DATABASE)
        # Match the deployed worker exactly. Thread count is fixed, not another
        # hidden strength parameter.
        self.engine = PikafishEngine(ENGINE_PATH, threads=1)
        self.stop_event = threading.Event()
        self.worker: threading.Thread | None = None
        self.events: queue.Queue[tuple[str, object]] = queue.Queue()
        self.closing = False
        self.export_lock = threading.Lock()

        self.level_var = tk.StringVar(value=str(TIANTIAN_LEVELS[0]))
        self.status_var = tk.StringVar(value="Ready. Leave Tiantian on the setup screen.")
        self.total_var = tk.StringVar()
        self.recent_var = tk.StringVar()
        self.difference_var = tk.StringVar()
        self.epoch_var = tk.StringVar()
        self.profile_var = tk.StringVar()
        self.side_var = tk.StringVar()
        self.strength_progress = tk.DoubleVar(value=0.0)

        self._build_ui()
        self._refresh_stats()
        self.root.after(80, self._drain_events)
        self.root.protocol("WM_DELETE_WINDOW", self._close)

    def _build_ui(self) -> None:
        from tkinter import scrolledtext, ttk

        outer = ttk.Frame(self.root, padding=14)
        outer.pack(fill="both", expand=True)
        controls = ttk.Frame(outer)
        controls.pack(fill="x")
        ttk.Label(controls, text="Tiantian level:").pack(side="left")
        self.level_combo = ttk.Combobox(
            controls,
            textvariable=self.level_var,
            values=[str(level) for level in TIANTIAN_LEVELS],
            state="readonly",
            width=8,
        )
        self.level_combo.pack(side="left", padx=(8, 18))
        self.level_combo.bind("<<ComboboxSelected>>", lambda _event: self._refresh_stats())
        self.start_button = ttk.Button(controls, text="Start", command=self._start)
        self.start_button.pack(side="left", padx=(0, 8))
        self.stop_button = ttk.Button(controls, text="Stop games", command=self._stop, state="disabled")
        self.stop_button.pack(side="left")
        ttk.Label(controls, textvariable=self.status_var).pack(side="left", padx=18)

        body = ttk.Panedwindow(outer, orient="horizontal")
        body.pack(fill="both", expand=True, pady=(14, 0))
        left = ttk.Frame(body, padding=(0, 0, 10, 0))
        right = ttk.Frame(body)
        body.add(left, weight=2)
        body.add(right, weight=3)

        stats = ttk.LabelFrame(left, text="Strength calibration", padding=12)
        stats.pack(fill="x")
        for label, variable in (
            ("Stored games", self.total_var),
            ("Current cohort score", self.recent_var),
            ("Strength estimate", self.difference_var),
            ("Next update", self.epoch_var),
            ("Current policy", self.profile_var),
            ("Next colour", self.side_var),
        ):
            row = ttk.Frame(stats)
            row.pack(fill="x", pady=4)
            ttk.Label(row, text=label, width=25).pack(side="left", anchor="n")
            ttk.Label(row, textvariable=variable, wraplength=350, justify="left").pack(
                side="left", fill="x", expand=True
            )

        convergence = ttk.LabelFrame(left, text="Convergence", padding=10)
        convergence.pack(fill="x", pady=(10, 0))
        row = ttk.Frame(convergence)
        row.pack(fill="x", pady=3)
        ttk.Label(row, text="Current score closeness to 50%", width=34).pack(side="left")
        ttk.Progressbar(row, maximum=100.0, variable=self.strength_progress).pack(
            side="left", fill="x", expand=True
        )

        instructions = ttk.LabelFrame(left, text="Operation", padding=12)
        instructions.pack(fill="x", pady=(12, 0))
        ttk.Label(
            instructions,
            justify="left",
            wraplength=440,
            text=(
                "One strength coordinate targets a 50% match score. Below Pikafish's bestmove "
                "floor it interpolates between adjacent Pikafish move ranks; above that boundary "
                "it plays rank 1 and increases nodes. Draws count as 50%. Colors alternate, "
                "but no color pair is required. Confidence-gated stochastic bisection tests the "
                "midpoint between confirmed too-weak and too-strong settings; inconclusive cohorts "
                "collect more games without moving the parameter."
            ),
        ).pack(fill="x")

        game_log_frame = ttk.LabelFrame(left, text="Game activity", padding=8)
        game_log_frame.pack(fill="both", expand=True, pady=(12, 0))
        self.log_box = scrolledtext.ScrolledText(
            game_log_frame, height=12, state="disabled", wrap="word"
        )
        self.log_box.pack(fill="both", expand=True)

        chart_frame = ttk.LabelFrame(
            right,
            text="Recent tested settings — score, uncertainty, and target",
            padding=8,
        )
        chart_frame.pack(fill="x", pady=(0, 10))
        self.progress_chart = StrengthProgressChart(chart_frame, height=240)
        self.progress_chart.pack(fill="x", expand=True)

        rank_frame = ttk.LabelFrame(
            right,
            text="Recent search path — parameter changes over games",
            padding=8,
        )
        rank_frame.pack(fill="both", expand=True)
        self.rank_chart = RankProgressChart(rank_frame, height=280)
        self.rank_chart.pack(fill="both", expand=True)

    def _start(self) -> None:
        if self.worker is not None and self.worker.is_alive():
            return
        self.stop_event.clear()
        self.level_combo.configure(state="disabled")
        self.start_button.configure(state="disabled")
        self.stop_button.configure(state="normal")
        level = int(self.level_var.get())
        self.worker = threading.Thread(
            target=self._run, args=(level,), daemon=True, name="calibration-loop"
        )
        self.worker.start()

    def _stop(self) -> None:
        self.stop_event.set()
        self.status_var.set("Stopping safely…")
        self.stop_button.configure(state="disabled")

    def _run(self, level: int) -> None:
        recognizer: XiangqiRecognizer | None = None
        try:
            self.events.put(("status", f"Loading Tiantian vision catalog for level {level}…"))
            recovery = self.store.recover()
            seeded = seed_strength_profiles(self.store)
            self.events.put(
                (
                    "log",
                    f"Crash recovery check passed: {recovery.games} committed games"
                    + (
                        f", {recovery.repaired_policy_states} state(s) reconciled."
                        if recovery.repaired_policy_states
                        else "."
                    ),
                )
            )
            if seeded:
                self.events.put(
                    (
                        "log",
                        "Installed confidence-gated bisection strength states for levels "
                        + ", ".join(str(item) for item in seeded)
                        + ".",
                    )
                )
            self.events.put(
                (
                    "log",
                    f"Pikafish uses {self.engine.threads} thread(s); the policy has one strength coordinate.",
                )
            )
            recognizer = XiangqiRecognizer()
            controller = TiantianController(
                recognizer,
                self.engine,
                self.stop_event,
                lambda message: self.events.put(("log", message)),
                lambda _image: None,
            )
            while not self.stop_event.is_set():
                results = self.store.results(level)
                decision = select_profile(self.store, level, results)
                profile = decision.profile
                game_number, side, seed, attempt_number = self.store.reserve_game_attempt(level)
                self._export_profiles()
                self.events.put(("log", f"Strength decision: {decision.message}"))
                self.events.put(("stats", None))
                self.events.put(
                    ("status", f"Playing level {level}, game {game_number}, Lixiangqi {side}.")
                )
                self.events.put(
                    (
                        "log",
                        f"Game {game_number}, attempt {attempt_number}: epoch {decision.epoch}, seed={seed}, "
                        f"{describe_profile(profile)}.",
                    )
                )
                try:
                    game = controller.play_game(level, side, profile, seed)
                except CalibrationStopped:
                    raise
                except Exception as error:
                    self._recover_after_game_error(
                        controller, game_number, error, traceback.format_exc(), committed=False
                    )
                    continue
                self.store.record(
                    level,
                    seed,
                    side,
                    profile,
                    game.result,
                    game.plies,
                    game.reason,
                    game.moves,
                )
                self.events.put(
                    ("log", f"Recorded {game.result.upper()} after {game.plies} plies ({game.reason}).")
                )
                self._export_profiles()
                self.events.put(("stats", None))
                if not self.stop_event.is_set():
                    _next_number, next_side, _next_seed = self.store.next_game(level)
                    try:
                        controller.prepare_next_game(level, next_side)
                    except CalibrationStopped:
                        raise
                    except Exception as error:
                        self._recover_after_game_error(
                            controller, game_number, error, traceback.format_exc(), committed=True
                        )
            self.events.put(("status", "Stopped. Completed games are saved."))
        except CalibrationStopped:
            self.events.put(("status", "Stopped. Completed games are saved."))
        except Exception as error:
            self.stop_event.set()
            self.events.put(("log", traceback.format_exc()))
            self.events.put(("status", f"Paused after error: {error}"))
        finally:
            if recognizer is not None:
                recognizer.close_capture()
            self.events.put(("finished", None))

    def _recover_after_game_error(
        self,
        controller: TiantianController,
        game_number: int,
        error: Exception,
        detail: str,
        *,
        committed: bool,
    ) -> None:
        disposition = "already committed" if committed else "discarded without saving"
        self.events.put(
            (
                "log",
                f"Game {game_number} encountered a recoverable automation error and was "
                f"{disposition}: {error}\n{detail}",
            )
        )
        self.events.put(("status", f"Recovering Tiantian setup after game {game_number} error…"))
        attempt = 0
        while True:
            attempt += 1
            if self.stop_event.is_set():
                raise CalibrationStopped()
            try:
                controller.return_to_setup(await_completed_result=True)
            except CalibrationStopped:
                raise
            except Exception as recovery_error:
                delay = min(8.0, 0.5 * (2 ** min(attempt - 1, 4)))
                self.events.put(
                    (
                        "log",
                        f"Setup recovery attempt {attempt} failed: {recovery_error}. "
                        f"Retrying in {delay:.1f}s; the runner remains active.",
                    )
                )
                if self.stop_event.wait(delay):
                    raise CalibrationStopped()
                continue
            self.events.put(
                (
                    "log",
                    f"Verified Tiantian setup after game {game_number} error; "
                    "continuing the calibration loop.",
                )
            )
            return

    def _export_profiles(self) -> None:
        with self.export_lock:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            levels: dict[str, object] = {}
            for level in TIANTIAN_LEVELS:
                results = self.store.results(level)
                compatible = strength_calibration_games(self.store, level, results)
                profile = current_profile(self.store, level, initial_profile_for_level(level))
                progress = strength_progress(self.store, level)
                wins = sum(game.result == "win" for game in compatible)
                draws = sum(game.result == "draw" for game in compatible)
                losses = sum(game.result == "loss" for game in compatible)
                levels[str(level)] = {
                    "storedGames": len(results),
                    "compatibleGames": len(compatible),
                    "wins": wins,
                    "draws": draws,
                    "losses": losses,
                    "score": (
                        (wins + 0.5 * draws) / len(compatible) if compatible else 0.5
                    ),
                    "strength": profile.strength,
                    "nodes": profile.nodes,
                    "multiPv": profile.multi_pv,
                    "expectedRank": profile.expected_rank,
                    "worseRankProbability": profile.worse_rank_probability,
                    "moveSelection": "bestmove" if profile.is_bestmove else "adjacent-pikafish-ranks",
                    "optimizerState": self.store.policy_state(level),
                }
                if progress is not None:
                    median = profile_for_strength(progress.estimate.strength)
                    low = profile_for_strength(progress.estimate.low_95)
                    high = profile_for_strength(progress.estimate.high_95)
                    levels[str(level)]["estimatedParityProfile"] = asdict(median)
                    levels[str(level)]["estimatedParityInterval95"] = [
                        asdict(low), asdict(high)
                    ]
                    levels[str(level)]["estimatedResponseWidth"] = (
                        progress.estimate.response_width
                    )
                    levels[str(level)]["estimatedRedStrengthShift"] = (
                        progress.estimate.red_strength_shift
                    )
                    levels[str(level)]["modeledBalancedScoreAtCurrent"] = (
                        balanced_expected_score(progress.estimate, profile.strength)
                    )
                    levels[str(level)]["probabilityScoreWithin45To55"] = (
                        probability_balanced_equivalent(
                            progress.estimate, profile.strength
                        )
                    )
                    levels[str(level)]["strengthBracket"] = [
                        progress.bracket_low,
                        progress.bracket_high,
                    ]
            temporary = EXPORT_FILE.with_suffix(".tmp")
            payload = {
                "method": "confidence-gated-stochastic-bisection-v1",
                "objective": "50-percent-match-score",
                "engineSignature": self.engine.signature,
                "tiantianLevels": levels,
            }
            temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
            temporary.replace(EXPORT_FILE)

    def _refresh_stats(self) -> None:
        level = int(self.level_var.get())
        results = self.store.results(level)
        compatible = strength_calibration_games(self.store, level, results)
        profile = current_profile(self.store, level, initial_profile_for_level(level))
        wins = sum(item.result == "win" for item in compatible)
        draws = sum(item.result == "draw" for item in compatible)
        losses = sum(item.result == "loss" for item in compatible)
        score = (wins + 0.5 * draws) / len(compatible) if compatible else 0.5
        self.total_var.set(
            f"{len(results)} total preserved; {len(compatible)} compatible — "
            f"{wins} W / {draws} D / {losses} L — score {score:.0%}"
        )
        progress = strength_progress(self.store, level)
        active_start = (
            len(compatible) - progress.cohort_games if progress is not None else None
        )
        active_target = progress.cohort_size if progress is not None else None
        cohorts = score_progress(
            compatible,
            active_start=active_start,
            active_target=active_target,
        )
        if cohorts and cohorts[-1].cohort_games:
            latest_cohort = cohorts[-1]
            self.recent_var.set(
                f"{latest_cohort.cohort_score:.0%} across "
                f"{latest_cohort.cohort_games}/{latest_cohort.target_games} game(s)"
            )
        elif progress is not None:
            self.recent_var.set(f"Next confirmation: 0/{progress.cohort_size} games")
        else:
            self.recent_var.set("Waiting for the first cohort")
        target_value = None
        target_low = None
        target_high = None
        if progress is None:
            seed = initial_profile_for_level(level)
            self.difference_var.set(
                f"Not started under the continuous policy. Seed: {describe_profile(seed)}."
            )
            self.epoch_var.set("Start to install the strength state and play the next game.")
            self.strength_progress.set(0.0)
        else:
            estimate = progress.estimate
            bracket_text = "No confirmed two-sided bracket"
            if progress.bracket_low is not None and progress.bracket_high is not None:
                bracket_midpoint = (progress.bracket_low + progress.bracket_high) / 2.0
                midpoint_profile = profile_for_strength(bracket_midpoint)
                if profile.is_bestmove:
                    target_value = float(midpoint_profile.nodes if midpoint_profile.is_bestmove else 1)
                    bracket_values = tuple(
                        float(candidate.nodes if candidate.is_bestmove else 1)
                        for candidate in (
                            profile_for_strength(progress.bracket_low),
                            profile_for_strength(progress.bracket_high),
                        )
                    )
                else:
                    target_value = midpoint_profile.expected_rank
                    bracket_values = (
                        profile_for_strength(progress.bracket_low).expected_rank,
                        profile_for_strength(progress.bracket_high).expected_rank,
                    )
                target_low, target_high = min(bracket_values), max(bracket_values)
                bracket_text = (
                    f"bracket {target_low:,.0f}–{target_high:,.0f} nodes"
                    if profile.is_bestmove else
                    f"bracket rank {target_low:.3f}–{target_high:.3f}"
                )

            def same_policy(game) -> bool:
                candidate = game.profile
                return (
                    candidate.nodes == profile.nodes
                    and candidate.multi_pv == profile.multi_pv
                    and abs(candidate.expected_rank - profile.expected_rank) < 1e-9
                )

            current_games = [game for game in compatible if same_policy(game)]
            current_wins = sum(game.result == "win" for game in current_games)
            current_draws = sum(game.result == "draw" for game in current_games)
            current_losses = sum(game.result == "loss" for game in current_games)
            current_score = (
                (current_wins + 0.5 * current_draws) / len(current_games)
                if current_games else 0.5
            )
            target_met = bool(current_games) and 0.45 <= current_score <= 0.55
            side_text = ""
            if current_games:
                red = [game for game in current_games if game.side == "red"]
                black = [game for game in current_games if game.side == "black"]
                red_score = sum(game.score for game in red) / len(red) if red else 0.5
                black_score = sum(game.score for game in black) / len(black) if black else 0.5
                side_text = f" Red {red_score:.0%}; Black {black_score:.0%}."
            self.difference_var.set(
                f"Current exact setting: {current_wins} W / {current_draws} D / "
                f"{current_losses} L = {current_score:.1%} across {len(current_games)} games; "
                f"{'TARGET MET' if target_met else 'outside 45–55% target'}. "
                f"{bracket_text}.{side_text}"
            )
            if target_met and len(current_games) >= 12:
                self.epoch_var.set(
                    f"CONVERGED CANDIDATE. Holding the same parameter; any additional run is a "
                    f"{progress.cohort_size}-game confirmation, not a new search probe."
                )
            else:
                self.epoch_var.set(
                    f"Search active: {progress.cohort_games}/{progress.cohort_size} games at the "
                    "current setting; a parameter update occurs only when this cohort completes."
                )
            closeness = max(0.0, 1.0 - abs(current_score - 0.5) / 0.5)
            self.strength_progress.set(100.0 * closeness if current_games else 0.0)
        self.progress_chart.set_results(
            compatible,
            profile,
            target_low=target_low,
            target_high=target_high,
        )
        self.rank_chart.set_results(
            compatible,
            profile,
            target_value=target_value,
            target_low=target_low,
            target_high=target_high,
        )
        self.profile_var.set(describe_profile(profile))
        _game, side, _seed = self.store.next_game(level)
        self.side_var.set(side.title())

    def _drain_events(self) -> None:
        while True:
            try:
                kind, value = self.events.get_nowait()
            except queue.Empty:
                break
            if kind == "status":
                self.status_var.set(str(value))
            elif kind == "log":
                self._append_log(self.log_box, str(value))
            elif kind == "stats":
                self._refresh_stats()
            elif kind == "finished":
                self.level_combo.configure(state="readonly")
                self.start_button.configure(state="normal")
                self.stop_button.configure(state="disabled")
        self.root.after(80, self._drain_events)

    @staticmethod
    def _append_log(widget, message: str) -> None:
        widget.configure(state="normal")
        widget.insert("end", message + "\n")
        widget.see("end")
        widget.configure(state="disabled")

    def _close(self) -> None:
        if self.closing:
            return
        self.closing = True
        self.stop_event.set()
        self.status_var.set("Stopping before exit…")
        self._finish_close_when_idle()

    def _finish_close_when_idle(self) -> None:
        if self.worker is not None and self.worker.is_alive():
            self.root.after(100, self._finish_close_when_idle)
            return
        self.engine.close()
        self.store.close()
        self.root.destroy()


def main() -> int:
    if tk is None:
        raise RuntimeError("Tkinter is required to run the calibration GUI.")
    root = tk.Tk()
    CalibrationApp(root)
    root.mainloop()
    return 0
