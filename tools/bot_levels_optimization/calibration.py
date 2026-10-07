"""Bounded adjacent-pair tournament and iterative strength-curve inversion."""

from __future__ import annotations

import hashlib
import platform
import random
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path

from .measurement import overall, redistribute, summarize
from .openings import digest
from .profiles import describe, validate_coordinates
from .runtime import play_game
from .storage import write_json


@dataclass(frozen=True)
class Config:
    seed: int = 20261003
    games_per_pair: int = 200
    refinement_games: int = 500
    final_games: int = 2000
    exploratory_iterations: int = 3
    max_iterations: int = 10
    tolerance: float = 0.05
    damping: float = 0.5
    patience: int = 3
    max_plies: int = 600
    max_failed_pairs: int = 3
    mode: str = "calibrate"

    def validate(self):
        for n in (self.games_per_pair, self.refinement_games, self.final_games):
            if n < 2 or n % 2:
                raise ValueError(
                    "Game counts must be positive even numbers (at least two)"
                )
        if not self.games_per_pair <= self.refinement_games <= self.final_games:
            raise ValueError("Refinement/final game counts must not decrease")
        if not 0 < self.tolerance < 1 or not 0 < self.damping <= 1:
            raise ValueError("Require 0 < tolerance < 1 and 0 < damping <= 1")
        if (
            min(
                self.max_iterations,
                self.exploratory_iterations,
                self.patience,
                self.max_plies,
                self.max_failed_pairs,
            )
            < 1
        ):
            raise ValueError(
                "Iteration, patience, move and failure limits must be positive"
            )
        if self.mode not in {"calibrate", "validate"}:
            raise ValueError("Unknown calibration mode")


def file_hash(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def manifest(
    config: Config,
    suite: dict,
    coordinates,
    executable: Path,
    rules,
    explorer_url: str,
) -> dict:
    root = Path(__file__).resolve().parents[2]
    sources = list(Path(__file__).parent.glob("*.py"))
    sources += list(Path(__file__).parent.glob("*.java"))
    sources += list((root / "external/pikafish_worker").glob("*.py"))
    sources += list((root / "modules/xiangqi/src/main").rglob("*.scala"))
    try:
        revision = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=root, text=True
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        revision = None
    network = executable.parents[1] / "pikafish.nnue"
    return {
        "version": 1,
        "config": asdict(config),
        "initialCoordinates": list(coordinates),
        "openingSuite": suite,
        "suiteHash": digest(suite),
        "python": platform.python_version(),
        "platform": platform.platform(),
        "gitRevision": revision,
        "engine": {
            "path": str(executable),
            "sha256": file_hash(executable),
            "networkPath": str(network),
            "networkSha256": file_hash(network),
        },
        "sourceHashes": {
            str(p.relative_to(root)): file_hash(p) for p in sorted(sources)
        },
        "nativeRules": {
            "java": rules.java,
            "classPath": rules.class_path,
            "jarHashes": {str(path): file_hash(path) for path in rules.artifacts()},
        },
        "ruleset": "tiantian-v1",
        "explorerEndpoint": explorer_url if config.mode == "validate" else None,
        "metric": "internal paired self-play log odds; not a human xiangqi Elo rating",
    }


def plans(config: Config, suite: dict, iteration: int, lower: int, games: int):
    # Each matchup sees the same balanced, reproducibly shuffled suite cycles.
    order = list(range(len(suite["openings"])))
    random.Random(digest([config.seed, iteration, "openings"])).shuffle(order)
    for pair_index in range(games // 2):
        opening = suite["openings"][order[pair_index % len(order)]]
        pair_id = digest([config.seed, iteration, lower, pair_index])[:24]
        pair = []
        for reverse in (False, True):
            seed = digest([config.seed, iteration, lower, pair_index, reverse])
            pair.append(
                {
                    "gameId": seed[:32],
                    "rngSeed": seed,
                    "pairId": pair_id,
                    "iteration": iteration,
                    "lowerLevel": lower,
                    "higherLevel": lower + 1,
                    "openingId": opening["id"],
                    "pairIndex": pair_index,
                    "redLevel": lower + int(reverse),
                    "blackLevel": lower + int(not reverse),
                    "rngImplementation": "production SHA256(gameId|level|history); opening has separate production seed",
                }
            )
        yield opening, pair


def higher_score(game):
    if game["result"] == "1/2-1/2":
        return 0.5
    winner = game["redLevel"] if game["result"] == "1-0" else game["blackLevel"]
    return float(winner == game["higherLevel"])


def tournament(
    config,
    suite,
    coordinates,
    iteration,
    games,
    store,
    engine,
    rules,
    emit,
    play=play_game,
):
    matchups = []
    for lower in range(1, 9):
        scores = []
        failed = censored = excluded = 0
        for opening, pair in plans(config, suite, iteration, lower, games):
            records = []
            for plan in pair:
                record = store.game(plan["gameId"])
                if record is None:
                    record = play(
                        plan,
                        opening,
                        coordinates,
                        engine,
                        rules,
                        mode=config.mode,
                        max_plies=config.max_plies,
                    )
                    store.save_game(record)
                    emit(
                        {
                            "event": "game",
                            "gameId": plan["gameId"],
                            "iteration": iteration,
                            "pair": [lower, lower + 1],
                            "pairIndex": plan["pairIndex"],
                            "status": record["status"],
                            "result": record["result"],
                        }
                    )
                records.append(record)
            included = all(r["status"] == "completed" for r in records)
            for record in records:
                record["includedInStatistics"] = included
                store.save_game(record)
            if included:
                scores.append(tuple(higher_score(r) for r in records))
            else:
                excluded += 1
                failed += sum(r["status"] == "failed" for r in records)
                censored += sum(r["status"] == "censored" for r in records)
                if excluded >= config.max_failed_pairs:
                    break
        matchup = {
            "lowerLevel": lower,
            "higherLevel": lower + 1,
            **summarize(scores),
            "requestedGames": games,
            "failedGames": failed,
            "censoredGames": censored,
            "excludedPairs": excluded,
        }
        matchups.append(matchup)
        emit({"event": "matchup", "iteration": iteration, **matchup})
        if excluded >= config.max_failed_pairs:
            for pending in range(lower + 1, 9):
                matchups.append(
                    {
                        "lowerLevel": pending,
                        "higherLevel": pending + 1,
                        **summarize([]),
                        "requestedGames": games,
                        "failedGames": 0,
                        "censoredGames": 0,
                        "excludedPairs": 0,
                        "notAttempted": True,
                    }
                )
            break
    return matchups


def calibrate(
    config, suite, coordinates, store, engine, rules, emit=print, play=play_game
):
    config.validate()
    coordinates = list(validate_coordinates(coordinates))
    phase = "exploratory"
    best = None
    stalled = 0
    outcome = None
    for iteration in range(1, config.max_iterations + 1):
        if config.mode == "validate":
            phase = "verification"
        elif phase == "exploratory" and iteration > config.exploratory_iterations:
            phase, best, stalled = "refinement", None, 0
        games = {
            "exploratory": config.games_per_pair,
            "refinement": config.refinement_games,
            "verification": config.final_games,
        }[phase]
        report = store.report(iteration)
        if report is None:
            matchups = tournament(
                config,
                suite,
                coordinates,
                iteration,
                games,
                store,
                engine,
                rules,
                emit,
                play,
            )
            summary = (
                overall(matchups, config.tolerance, games)
                if len(matchups) == 8
                else {
                    "complete": False,
                    "pointConverged": False,
                    "maximumIntervalDeviation": None,
                    "totalMeasuredSpan": None,
                    "meanInterval": None,
                    "precisionSufficient": False,
                }
            )
            next_coordinates = coordinates
            fit = None
            measured = [0.0]
            for matchup in matchups:
                measured.append(
                    None
                    if measured[-1] is None or matchup["interval"] is None
                    else measured[-1] + matchup["interval"]
                )
            measured += [None] * (9 - len(measured))
            # Freeze a ladder while promoting it to a larger, independently
            # seeded verification sample. Never export an unmeasured proposal
            # as though the just-completed report verified it.
            if summary["complete"] and summary["totalMeasuredSpan"] > 0:
                proposal, fit = redistribute(
                    coordinates, [m["interval"] for m in matchups], config.damping
                )
                if not summary["pointConverged"] and config.mode == "calibrate":
                    next_coordinates = proposal
            report = {
                "iteration": iteration,
                "phase": phase,
                "levels": [
                    {**describe(i, s), "measuredStrength": measured[i - 1]}
                    for i, s in enumerate(coordinates, 1)
                ],
                "matchups": matchups,
                "overall": summary,
                "monotoneFittedStrengths": fit,
                "nextCoordinates": list(next_coordinates),
                "converged": phase == "verification" and summary["pointConverged"],
            }
            store.save_report(report)
        else:
            # Recover exports if a crash occurred after SQLite commit but before
            # the corresponding JSON file was replaced.
            store.save_report(report)
        emit({"event": "iteration", **report})
        summary = report["overall"]
        deviation = summary["maximumIntervalDeviation"]
        reason = None
        if not summary["complete"]:
            reason = "incomplete_pairs_or_infrastructure_failures"
        elif report["converged"]:
            reason = "converged"
        elif config.mode == "validate":
            reason = "validation_complete"
        elif summary["pointConverged"]:
            phase = "refinement" if phase == "exploratory" else "verification"
            best, stalled = None, 0
        elif phase != "exploratory":
            if deviation is not None and (best is None or deviation < best * 0.98):
                best, stalled = deviation, 0
            else:
                stalled += 1
            if stalled >= config.patience:
                reason = "statistical_noise_or_stalled_progress"
        if iteration == config.max_iterations and reason is None:
            reason = "maximum_iterations"
        if reason:
            outcome = {
                "status": reason,
                "converged": report["converged"],
                "iteration": iteration,
                "levels": report["levels"],
                "overall": summary,
                "proposedNextCoordinates": report["nextCoordinates"],
                "productionDeployment": False,
                "metric": "internal self-play log odds, not human Elo",
            }
            write_json(store.root / "result.json", outcome)
            break
        coordinates = report["nextCoordinates"]
    return outcome
