"""Run repeated games for each adjacent pair of production levels 1-9.

From the repository root:
    .venv/Scripts/python.exe -m tools.bot_levels_optimization.rating_pool.middle_neighbors

Each bot uses its exact production profile, including MultiPV and move
selection for levels 1-8. The production opening-book fade remains enabled.
Adjacent pairs play 1,000 games by default, alternating colors game by game.
Results are stored in a new versioned database separate from earlier runs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import signal
import sys
import threading
import zlib
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path

from external.xiangqi_explorer.catalog_databases import catalog_is_readable
from external.pikafish_worker.ai import STRENGTH_PROFILES

from .game import GameRuntime
from .model import Bot
from .runner import provenance
from .store import PoolStore


LEVELS = tuple(range(1, 10))
PAIR_COUNT = len(LEVELS) - 1
BOT_IDS = {level: f"level-{level}" for level in LEVELS}
BOT_LEVELS = {bot_id: level for level, bot_id in BOT_IDS.items()}
PROFILES = tuple(
    Bot(BOT_IDS[level], profile.nodes, profile.multi_pv, profile.expected_rank, profile.max_candidate_loss)
    for level, profile in zip(LEVELS, STRENGTH_PROFILES[: len(LEVELS)], strict=True)
)
EXPERIMENT_ID = "adjacent-production-levels-1-9-v1"
EXPERIMENT_KEY = "adjacent-production-levels-1-9-v1"
EXPERIMENT_POOL = Path("tools/bot_levels_optimization/runs/pool-adjacent-levels-1-9-v1.sqlite3")
GAMES_PER_PAIR = 1_000
CONCURRENCY = 16
MAX_FAILED_GAMES_PER_RUN = 20
POOL_CONFIG = {"levels": LEVELS, "seed": 20261005, "k": 32.0, "window": 100.0, "max_plies": 600}


def pair_game_state(store: PoolStore):
    completed = [0] * PAIR_COUNT
    failures = [0] * PAIR_COUNT
    pending = []
    next_ordinal = [0] * PAIR_COUNT
    for status, raw_plan in store.db.execute(
        "SELECT status,plan FROM games WHERE status IN ('pending','completed','failed','censored')"
    ):
        plan = json.loads(raw_plan)
        if plan.get("experimentId") != EXPERIMENT_ID:
            continue
        edge = plan["pairIndex"]
        next_ordinal[edge] = max(next_ordinal[edge], plan["pairOrdinal"] + 1)
        if status == "pending":
            pending.append(plan)
        elif status == "completed":
            completed[edge] += 1
        else:
            failures[edge] += 1
    return completed, failures, pending, next_ordinal


def fixed_profiles(store: PoolStore, games_per_pair: int) -> dict:
    row = store.db.execute("SELECT value FROM metadata WHERE key=?", (EXPERIMENT_KEY,)).fetchone()
    if row:
        saved = json.loads(row[0])
        if saved["profiles"] != [bot.row() for bot in PROFILES]:
            raise ValueError("Saved experiment has unexpected engine profiles")
        if saved["gamesPerPair"] != games_per_pair:
            raise ValueError("--games-per-pair must match the saved experiment")
        return saved

    saved = {
        "experiment": EXPERIMENT_ID,
        "profiles": [bot.row() for bot in PROFILES],
        "startingRatings": {bot.id: bot.elo for bot in PROFILES},
        "gamesPerPair": games_per_pair,
        "pairs": [f"{LEVELS[i]}-{LEVELS[i + 1]}" for i in range(PAIR_COUNT)],
    }
    with store.db:
        if store.db.execute("SELECT count(*) FROM games").fetchone()[0]:
            raise ValueError("Cannot initialize the production levels after games have begun")
        store.db.execute("DELETE FROM bots")
        for bot in PROFILES:
            store.db.execute("INSERT INTO bots(id,data) VALUES (?,?)", (bot.id, json.dumps(bot.row())))
        store.db.execute("INSERT INTO metadata(key,value) VALUES (?,?)", (EXPERIMENT_KEY, json.dumps(saved)))
    store.bots = {bot.id: bot for bot in PROFILES}
    return saved


def game_plan(store: PoolStore, edge: int, ordinal: int) -> dict:
    left, right = LEVELS[edge], LEVELS[edge + 1]
    seed = hashlib.sha256(f"{EXPERIMENT_ID}|20261005|{edge}|{ordinal}".encode()).hexdigest()
    red, black = (BOT_IDS[left], BOT_IDS[right]) if ordinal % 2 == 0 else (BOT_IDS[right], BOT_IDS[left])
    return {
        "sequence": store.sequence + 1,
        "gameId": seed[:32],
        "rngSeed": seed,
        "experimentId": EXPERIMENT_ID,
        "pairIndex": edge,
        "pairOrdinal": ordinal,
        "red": red,
        "black": black,
    }


def outcome_summary(store: PoolStore) -> dict[str, dict[str, int]]:
    summary = {
        "pairs": {
            f"{LEVELS[i]}-{LEVELS[i + 1]}": {
                LEVELS[i]: {"points": 0.0, "games": 0},
                LEVELS[i + 1]: {"points": 0.0, "games": 0},
            }
            for i in range(PAIR_COUNT)
        }
    }
    for raw_plan, blob in store.db.execute(
        "SELECT plan,record FROM games WHERE status='completed' AND record IS NOT NULL"
    ):
        plan = json.loads(raw_plan)
        if plan.get("experimentId") != EXPERIMENT_ID:
            continue
        result = json.loads(zlib.decompress(blob))["result"]
        record_score(summary, plan["pairIndex"], plan["red"], plan["black"], result)
    return summary


def record_score(summary: dict, edge: int, red: str, black: str, result: str) -> None:
    left, right = LEVELS[edge : edge + 2]
    pair = summary["pairs"][f"{left}-{right}"]
    pair[left]["games"] += 1
    pair[right]["games"] += 1
    if result == "1/2-1/2":
        pair[left]["points"] += 0.5
        pair[right]["points"] += 0.5
    else:
        winner = red if result == "1-0" else black
        pair[BOT_LEVELS[winner]]["points"] += 1


def render_summary(summary: dict[str, dict[str, int]], *, initial: bool = False) -> None:
    lines = []
    for index, level in enumerate(LEVELS):
        reports = []
        if index:
            neighbor = LEVELS[index - 1]
            record = summary["pairs"][f"{neighbor}-{level}"][level]
            score = record["points"] / record["games"] if record["games"] else 0
            reports.append(f"{100 * score:.1f}% vs Level {neighbor} ({record['games']} games)")
        if index < len(LEVELS) - 1:
            neighbor = LEVELS[index + 1]
            record = summary["pairs"][f"{level}-{neighbor}"][level]
            score = record["points"] / record["games"] if record["games"] else 0
            reports.append(f"{100 * score:.1f}% vs Level {neighbor} ({record['games']} games)")
        lines.append(f"Level {level}: " + " | ".join(reports))
    if initial:
        sys.stdout.write("\n" * len(LEVELS))
    for line in lines:
        sys.stdout.write("\r\033[2K" + line + "\n")
    sys.stdout.write(f"\033[{len(LEVELS)}A\r")
    sys.stdout.flush()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pool", type=Path, default=EXPERIMENT_POOL)
    parser.add_argument("--games-per-pair", type=int, default=GAMES_PER_PAIR)
    parser.add_argument("--concurrency", type=int, default=CONCURRENCY)
    args = parser.parse_args(argv)
    if args.games_per_pair < 2 or args.games_per_pair % 2 or not 1 <= args.concurrency <= 16:
        parser.error("Require an even --games-per-pair of at least 2 and --concurrency between 1 and 16")
    if not catalog_is_readable():
        raise ValueError("A readable local master games catalog is required")

    runtime = GameRuntime()
    store = None
    stop = threading.Event()
    previous_signal = signal.signal(signal.SIGINT, lambda *_: stop.set())
    try:
        evidence = provenance(runtime)
        script_path = str(Path(__file__).resolve().relative_to(Path.cwd().resolve()))
        evidence["sourceHashes"].pop(script_path, None)
        args.pool.parent.mkdir(parents=True, exist_ok=True)
        store = PoolStore(
            args.pool,
            config={**POOL_CONFIG, "games_per_pair": args.games_per_pair},
            provenance=evidence,
            resume=args.pool.exists(),
            initial_bots=PROFILES,
        )
        fixed_profiles(store, args.games_per_pair)
        if set(store.bots) != {bot.id for bot in PROFILES}:
            raise ValueError("Experiment database has unexpected bot IDs")
        for profile in PROFILES:
            bot = store.bots[profile.id]
            if (bot.nodes, bot.MultiPV, bot.expectedRank, bot.maxCandidateLoss) != (
                profile.nodes, profile.MultiPV, profile.expectedRank, profile.maxCandidateLoss
            ):
                raise ValueError(f"Unexpected settings for {profile.id}")

        completed, failures, pending, next_ordinal = pair_game_state(store)
        if any(completed[i] + sum(plan["pairIndex"] == i for plan in pending) > args.games_per_pair for i in range(PAIR_COUNT)):
            raise ValueError("--games-per-pair must cover completed and pending games")
        other_pending = [plan for plan in store.pending() if plan.get("experimentId") != EXPERIMENT_ID]
        if other_pending:
            raise RuntimeError("The experiment database has unrelated pending games")

        summary = outcome_summary(store)
        render_summary(summary, initial=True)
        local = threading.local()
        runtimes = []
        runtime_lock = threading.Lock()

        def play(plan, red, black):
            if not hasattr(local, "runtime"):
                local.runtime = GameRuntime()
                with runtime_lock:
                    runtimes.append(local.runtime)
            return local.runtime.play(plan, red, black, store.config["max_plies"], stop=stop)

        executor = ThreadPoolExecutor(max_workers=args.concurrency, thread_name_prefix="adjacent-bot")
        active = {}
        active_by_pair = [0] * PAIR_COUNT
        next_edge = 0
        failed_this_run = 0
        try:
            while (pending or active or any(n < args.games_per_pair for n in completed)) and not stop.is_set():
                while len(active) < args.concurrency and not stop.is_set():
                    if pending:
                        plan = pending.pop(0)
                    else:
                        available = next(
                            (edge for offset in range(PAIR_COUNT)
                             if completed[edge := (next_edge + offset) % PAIR_COUNT] + active_by_pair[edge] < args.games_per_pair),
                            None,
                        )
                        if available is None:
                            break
                        edge = available
                        next_edge = (edge + 1) % PAIR_COUNT
                        plan = game_plan(store, edge, next_ordinal[edge])
                        next_ordinal[edge] += 1
                        store.reserve(plan)
                    edge = plan["pairIndex"]
                    active_by_pair[edge] += 1
                    red = Bot(**store.bots[plan["red"]].row())
                    black = Bot(**store.bots[plan["black"]].row())
                    active[executor.submit(play, plan, red, black)] = plan

                if not active:
                    break
                done, _ = wait(active, timeout=0.5, return_when=FIRST_COMPLETED)
                for future in done:
                    plan = active.pop(future)
                    edge = plan["pairIndex"]
                    active_by_pair[edge] -= 1
                    try:
                        record = future.result()
                    except Exception as error:  # noqa: BLE001 - infrastructure failures do not count as losses
                        record = {**plan, "status": "failed", "result": None,
                                  "failure": {"stage": "worker", "type": type(error).__name__, "message": str(error)}}
                    if record["status"] == "interrupted":
                        continue
                    store.finish(record)
                    if record["status"] == "completed":
                        completed[edge] += 1
                        record_score(summary, edge, plan["red"], plan["black"], record["result"])
                    else:
                        failures[edge] += 1
                        failed_this_run += 1
                    render_summary(summary)
                    if failed_this_run >= MAX_FAILED_GAMES_PER_RUN:
                        stop.set()

            sys.stdout.write(f"\033[{len(LEVELS)}B\n")
            sys.stdout.flush()
            return 0 if all(n >= args.games_per_pair for n in completed) else 2
        finally:
            stop.set()
            executor.shutdown(wait=True)
            for worker_runtime in runtimes:
                worker_runtime.close()
    finally:
        runtime.close()
        if store:
            store.close()
        signal.signal(signal.SIGINT, previous_signal)


if __name__ == "__main__":
    raise SystemExit(main())
