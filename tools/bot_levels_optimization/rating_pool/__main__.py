"""python -m tools.bot_levels_optimization.rating_pool --help"""

import argparse
import json
import signal
import sqlite3
import threading
from pathlib import Path

from external.xiangqi_explorer.catalog_databases import catalog_is_readable

from .game import GameRuntime
from .model import validate_settings
from .reports import export, levels
from .runner import provenance, run
from .store import PoolStore, game_record, snapshot


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Ordinary self-play Elo pool; never deploys profiles"
    )
    parser.add_argument(
        "--pool",
        type=Path,
        default=Path("tools/bot_levels_optimization/runs/pool.sqlite3"),
    )
    parser.add_argument("--bots", type=int, default=None)
    parser.add_argument(
        "--games",
        type=int,
        default=100000,
        help="Total completed-game target, including saved games",
    )
    parser.add_argument("--concurrency", type=int, default=16)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--k", type=float, default=None)
    parser.add_argument("--window", type=float, default=None)
    parser.add_argument("--max-plies", type=int, default=None)
    parser.add_argument(
        "--max-failures",
        type=int,
        default=20,
        help="Stop after this many excluded attempts in this invocation",
    )
    parser.add_argument("--resume", action="store_true")
    parser.add_argument(
        "--full-logs", action="store_true", help="Also retain complete move lists"
    )
    parser.add_argument("--java")
    parser.add_argument("--class-path")
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--export", type=Path, metavar="CSV")
    action.add_argument("--select-levels", type=Path, metavar="CSV")
    action.add_argument("--replay-game", type=int, metavar="SEQUENCE")
    parser.add_argument("--levels", type=int, default=720)
    parser.add_argument("--gap-threshold", type=float, default=25)
    args = parser.parse_args(argv)
    if args.export or args.select_levels:
        output = args.export or args.select_levels
        if output.resolve() == args.pool.resolve():
            parser.error("Report output must differ from the pool database")
        validate_settings(1, args.gap_threshold)
        result = (
            export(args.pool, output)
            if args.export
            else levels(args.pool, output, args.levels, args.gap_threshold)
        )
        print(json.dumps(result, indent=2))
        return 0
    if not 1 <= args.concurrency <= 16 or args.games < 1 or args.max_failures < 1:
        parser.error("Require concurrency 1–16 and positive game/failure limits")
    config = {
        "bots": 5000,
        "seed": 20261003,
        "k": 32.0,
        "window": 100.0,
        "max_plies": 600,
    }
    saved_provenance = None
    if args.resume or args.replay_game is not None:
        db = sqlite3.connect(args.pool.resolve().as_uri() + "?mode=ro", uri=True)
        try:
            config = json.loads(
                db.execute("SELECT value FROM metadata WHERE key='config'").fetchone()[
                    0
                ]
            )
            saved_provenance = json.loads(
                db.execute(
                    "SELECT value FROM metadata WHERE key='provenance'"
                ).fetchone()[0]
            )
        finally:
            db.close()
    for key in config:
        value = getattr(args, key)
        if value is not None:
            if (args.resume or args.replay_game is not None) and value != config[key]:
                parser.error(
                    f"Saved --{key.replace('_', '-')} cannot change on resume/replay"
                )
            config[key] = value
    validate_settings(config["k"], config["window"])
    if config["bots"] < 2 or config["max_plies"] < 1:
        parser.error("Require at least two bots and a positive move limit")
    if args.replay_game is None and not catalog_is_readable():
        parser.error(
            "A readable local master games catalog is required (LIXIANGQI_GAMES_DB)"
        )
    runtime = GameRuntime(args.java, args.class_path)
    store = None
    stop = threading.Event()
    previous_signal = signal.signal(signal.SIGINT, lambda *_: stop.set())
    try:
        evidence = provenance(runtime)
        if args.replay_game is not None:
            if evidence != saved_provenance:
                raise ValueError(
                    "Replay requires original source, engine and rules artifacts"
                )
            original = game_record(args.pool, args.replay_game)
            bots = {b.id: b for b in snapshot(args.pool)[0]}
            plan = {
                k: original[k]
                for k in ("sequence", "gameId", "rngSeed", "red", "black")
            }
            result = runtime.play(
                plan,
                bots[plan["red"]],
                bots[plan["black"]],
                config["max_plies"],
                True,
                replay_book=original.get("book", {}),
                stop=stop,
            )
            matches = all(
                result.get(key) == original.get(key)
                for key in ("status", "result", "finalFen", "plies")
            )
            print(json.dumps({"matchesOriginal": matches, "replay": result}, indent=2))
            return 0 if matches else 2
        store = PoolStore(
            args.pool, config=config, provenance=evidence, resume=args.resume
        )
        result = run(
            store,
            args.games,
            args.concurrency,
            lambda: GameRuntime(args.java, args.class_path),
            full_logs=args.full_logs,
            max_failures=args.max_failures,
            stop=stop,
            emit=lambda text: print(text, flush=True),
        )
        print(json.dumps(result))
        return 0 if result["status"] == "complete" else 2
    finally:
        runtime.close()
        if store:
            store.close()
        signal.signal(signal.SIGINT, previous_signal)


if __name__ == "__main__":
    raise SystemExit(main())
