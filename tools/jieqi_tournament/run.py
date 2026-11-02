"""Matched-deal tournament of the three engines actually shipped by LiXiangQi."""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import ExitStack, contextmanager
from datetime import datetime, timezone
import hashlib
import itertools
import json
import os
from pathlib import Path
import platform
import random
import shutil
import subprocess
import sys
import threading
import time

from .processes import Cancelled, Engine, Referee
from .report import ENGINES, NAMES, write_report
from .revalidate import revalidate

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
ROLES = ("chariot", "horse", "elephant", "advisor", "advisor", "elephant", "horse", "chariot",
         "cannon", "cannon", "soldier", "soldier", "soldier", "soldier", "soldier")
SLOTS = ("a1", "b1", "c1", "d1", "f1", "g1", "h1", "i1", "b3", "h3", "a4", "c4", "e4", "g4", "i4")


def utc():
    return datetime.now(timezone.utc).isoformat()


def make_deal(seed, index):
    rng = random.Random(f"lixiangqi-jieqi:{seed}:{index}")
    deal = {}
    for black in (False, True):
        roles = list(ROLES)
        rng.shuffle(roles)
        slots = [s[0] + str(11 - int(s[1:])) for s in SLOTS] if black else SLOTS
        deal.update(zip(slots, roles))
    return deal


def plans(seed, index):
    games = [(a, b) for a, b in itertools.permutations(ENGINES, 2)]
    random.Random(f"schedule:{seed}:{index}").shuffle(games)
    return games


def atomic_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)


@contextmanager
def run_lock(directory):
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "run.lock"
    try:
        with path.open("x", encoding="utf-8") as stream:
            stream.write(str(os.getpid()) + "\n")
    except FileExistsError:
        raise ValueError(f"A run already owns {path}. After a forced shutdown, verify its PID has stopped before removing this lock") from None
    try:
        yield
    finally:
        path.unlink()


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def discover(args):
    node = args.node or shutil.which("node")
    if not node and os.name == "nt":
        candidate = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "nodejs/node.exe"
        if candidate.is_file():
            node = str(candidate)
    java = args.java
    if not java:
        bundled = sorted((ROOT / ".tools/jdk-21").glob("*/bin/java.exe"))
        java = str(bundled[-1]) if bundled else shutil.which("java")
    if not node or not java:
        raise ValueError("Node 24 and Java 21 are required; use --node and --java for explicit paths")
    version = subprocess.check_output([node, "--version"], text=True).strip()
    if not version.startswith("v24."):
        raise ValueError(f"Use the repository's Node 24, found {version}")
    jars = sorted((ROOT / "target/universal/stage/lib").glob("*.jar"))
    rules = [p for p in jars if ".xiangqi-" in p.name]
    if len(rules) != 1:
        raise ValueError("Run SBT stage first; expected one staged xiangqi rules JAR")
    sources = list((ROOT / "modules/xiangqi/src/main").rglob("*.scala"))
    if any(p.stat().st_mtime > rules[0].stat().st_mtime for p in sources):
        raise ValueError("The staged rules are older than their sources. Run SBT stage before measuring")
    files = list(HERE.glob("*.py")) + list(HERE.glob("*.java")) + list(HERE.glob("*.mjs"))
    files += list((ROOT / "public/jieqi-engine").rglob("*.wasm"))
    files += list((ROOT / "public/jieqi-engine").rglob("*.js"))
    files += list((ROOT / "public/jieqi-engine").rglob("*.nnue"))
    files += list((ROOT / "public/jieqi-engine").rglob("*.jqn"))
    files += [ROOT / "scripts/jieqi-engine/uci.mjs"] + sources + jars
    hashes = {str(p.relative_to(ROOT)).replace("\\", "/"): sha(p) for p in sorted(files)}
    return node, java, version, hashes


def play(referee, engines, deal, red, black, index, config, stop):
    record = {"dealIndex": index, "deal": deal, "red": red, "black": black,
              "started": utc(), "status": "interrupted", "result": None, "moves": []}
    try:
        state = referee.request({"deal": deal})
        for engine in (red, black):
            engines[engine].new_game()
        for _ in range(config["maxPlies"]):
            if stop.is_set():
                raise Cancelled()
            engine = red if state["turn"] == "red" else black
            move = engines[engine].choose(state, config["movetime"])
            record["pendingMove"] = {"engine": engine, **move}
            state = referee.request({"move": move["move"]})
            record["moves"].append({"engine": engine, **move, "after": state})
            record.pop("pendingMove")
            if state["result"] != "*":
                record.update(status="completed", result=state["result"], termination=state["termination"])
                break
        else:
            record.update(status="censored", termination="maximum_plies")
        record["finalFen"] = state["fen"]
    except Cancelled:
        record["failure"] = "Interrupted; not included in results"
    except Exception as error:
        record.update(status="failed", failure=str(error))
    record["finished"] = utc()
    return record


def worker(indices, config, directory, node, java, stop, progress, ready):
    with ExitStack() as stack:
        command = [java, "-Xmx512m", "-XX:ActiveProcessorCount=1", "--class-path",
                   str(ROOT / "target/universal/stage/lib/*"), str(HERE / "JieqiReferee.java")]
        referee = Referee(command, stop, ROOT)
        stack.callback(referee.close)
        initial = referee.request({"deal": make_deal(config["seed"], 0)})
        engines = {}
        identities = {}
        for name in ENGINES:
            engine = Engine([node, str(ROOT / "scripts/jieqi-engine/uci.mjs"), name], stop, ROOT)
            stack.callback(engine.close)
            identities[name] = engine.initialize(config["hashMb"])
            engines[name] = engine
            # Fixed, result-independent warmup; reset caches before every measured game.
            for _ in range(10):
                engine.choose(initial, 100)
        # Keep timed games clear of other workers compiling their referee or warming JITs.
        ready.wait(timeout=120)
        while not stop.is_set():
            try:
                index = next(indices)
            except StopIteration:
                return
            deal = make_deal(config["seed"], index)
            for red, black in plans(config["seed"], index):
                path = directory / "games" / f"{index:05d}-{red}-{black}.json"
                if path.exists():
                    continue
                record = play(referee, engines, deal, red, black, index, config, stop)
                record["uciIdentities"] = {red: identities[red], black: identities[black]}
                if record["status"] in {"failed", "interrupted"}:
                    attempted = directory / "attempts" / f"{path.stem}-{time.time_ns()}.json"
                    atomic_json(attempted, record)
                    stop.set()
                    if record["status"] == "failed":
                        raise RuntimeError(f"{path.stem}: {record['failure']}; saved in {attempted}")
                    return
                atomic_json(path, record)
                progress(record)


def print_report(directory):
    summary = write_report(directory)
    print(f"\nIncluded {summary['includedGames']} games from {summary['completeDeals']} complete matched deals.")
    print(f"Saved games outside complete deals: {summary['excludedGames']} (excluded from chart).")
    for name, row in summary["engines"].items():
        if row["games"]:
            print(f"{NAMES[name]:12} {row['wins']} W / {row['draws']} D / {row['losses']} L; "
                  f"score {row['score']:.1%}; win rate {row['winRate']:.1%}")
    print(f"Report: {directory / 'summary.json'}")
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--deals", type=int, help="Six games per deal; default 600 games")
    parser.add_argument("--movetime", type=int, help="Milliseconds per move for every engine")
    parser.add_argument("--workers", type=int, default=16, help="Simultaneous games, one thinking engine per worker (default 16)")
    parser.add_argument("--hash-mb", type=int)
    parser.add_argument("--max-plies", type=int)
    parser.add_argument("--seed", type=int)
    parser.add_argument("--node")
    parser.add_argument("--java")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--continuous", action="store_true", help="Run until Ctrl+C; calculate results later with --report")
    parser.add_argument("--quick", action="store_true", help="Separate 180-game, 250 ms/move experiment")
    parser.add_argument("--revalidate", action="store_true", help="Back up and replay saved games after referee/tooling fixes; play no new games")
    parser.add_argument("--report", action="store_true", help="Recompute report from saved games; run no engines")
    args = parser.parse_args(argv)
    args.out = args.out or ROOT / ".tools/jieqi-tournament" / (
        "continuous" if args.continuous else "quick" if args.quick else "main"
    )
    directory = args.out.resolve()
    if args.report:
        print_report(directory)
        return 0
    defaults = {"deals": 30 if args.quick else 100, "movetime": 250 if args.quick else 1000,
                "workers": 16,
                "hashMb": 64, "maxPlies": 1000, "seed": 20261102}
    if args.resume or args.revalidate:
        defaults = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))["config"]
    for attr, key in (("deals", "deals"), ("movetime", "movetime"), ("workers", "workers"),
                      ("hash_mb", "hashMb"), ("max_plies", "maxPlies"), ("seed", "seed")):
        if getattr(args, attr) is None:
            setattr(args, attr, defaults[key])
    if args.deals is None:
        args.continuous = True
    if min(args.deals or 1, args.movetime, args.workers, args.hash_mb, args.max_plies) < 1:
        parser.error("All size/time arguments must be positive")
    if args.continuous:
        args.deals = None
    with run_lock(directory):
        return run(args, directory)


def run(args, directory):
    node, java, node_version, hashes = discover(args)
    config = {"deals": args.deals, "movetime": args.movetime, "workers": args.workers,
              "hashMb": args.hash_mb, "maxPlies": args.max_plies, "seed": args.seed}
    signature = {"config": config, "sha256": hashes, "nodeVersion": node_version,
                 "pythonVersion": platform.python_version(), "ruleset": "jieqi-v1"}
    manifest_file = directory / "manifest.json"
    if args.revalidate:
        saved = json.loads(manifest_file.read_text(encoding="utf-8"))
        verified = revalidate(directory, saved, signature, node, java, ROOT, make_deal)
        atomic_json(manifest_file, verified)
        print("Revalidation passed. Resume this experiment with --resume; no new games were played.")
        return 0
    if args.resume:
        saved = json.loads(manifest_file.read_text(encoding="utf-8"))
        if any(saved[key] != value for key, value in signature.items() if key != "config") or any(
            saved["config"][key] != value for key, value in config.items() if key != "workers"
        ):
            raise ValueError("Builds/settings changed. After a referee/tooling-only fix, use --revalidate to audit saved games; otherwise use a new --out folder")
    else:
        if any(p.name != "run.lock" for p in directory.iterdir()):
            raise ValueError("Output folder is not empty. Use --resume or a different --out folder")
        directory.mkdir(parents=True, exist_ok=True)
        atomic_json(manifest_file, {**signature, "started": utc(), "os": platform.system(),
                                   "osVersion": platform.release(), "machine": platform.machine(),
                                   "processor": platform.processor(), "logicalCpus": os.cpu_count(),
                                   "protocol": "same deal, all ordered engine pairs, no resignations, no eval adjudication",
                                   "warmup": "10 searches of 100 ms per engine, outside measurements"})
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    manifest.setdefault("sessions", []).append({"started": utc(), "workers": args.workers, "resume": args.resume})
    atomic_json(manifest_file, manifest)
    for folder in ("games", "attempts"):
        (directory / folder).mkdir(exist_ok=True)
    saved_indices = {json.loads(p.read_text(encoding="utf-8"))["dealIndex"]
                     for p in (directory / "games").glob("*.json")}
    limit = args.deals if args.deals is not None else max(saved_indices, default=-1) + 1
    pending = [i for i in range(limit) if any(
        not (directory / "games" / f"{i:05d}-{a}-{b}.json").exists() for a, b in plans(args.seed, i))]
    worker_count = args.workers if args.continuous else min(args.workers, len(pending))
    print(f"{'Continuous run' if args.continuous else str(len(pending)) + ' deals remaining'}; {args.movetime} ms/move; "
          f"{args.workers} workers. Press Ctrl+C to stop safely; rerun with --resume.", flush=True)
    # Iterating a range/list iterator is atomic under CPython's GIL; use an explicit lock
    # to preserve this guarantee on other runtimes too.
    iterator = itertools.chain(pending, itertools.count(limit)) if args.continuous else iter(pending)
    lock = threading.Lock()
    progress_lock = threading.Lock()
    already_saved = len(list((directory / "games").glob("*.json")))
    new_games = 0
    started = time.monotonic()

    def progress(record):
        nonlocal new_games
        with progress_lock:
            new_games += 1
            done = already_saved + new_games
            elapsed = time.monotonic() - started
            if args.continuous:
                print(f"{done} saved games | deal {record['dealIndex'] + 1} | "
                      f"{NAMES[record['red']]} - {NAMES[record['black']]} | "
                      f"{record['result'] or record['status']} | elapsed {elapsed / 60:.1f} min", flush=True)
                return
            remaining_minutes = elapsed / new_games * (args.deals * 6 - done) / 60
            print(f"{done}/{args.deals * 6} games | deal {record['dealIndex'] + 1} | "
                  f"{NAMES[record['red']]} - {NAMES[record['black']]} | "
                  f"{record['result'] or record['status']} | {len(record['moves'])} plies | "
                  f"elapsed {elapsed / 60:.1f} min, estimated remaining {remaining_minutes:.1f} min", flush=True)

    class SharedIndices:
        def __next__(self):
            with lock:
                return next(iterator)

    stop = threading.Event()
    failures = []
    ready = threading.Barrier(max(1, worker_count))
    pool = ThreadPoolExecutor(max_workers=args.workers)
    try:
        futures = [pool.submit(worker, SharedIndices(), config, directory, node, java, stop, progress, ready)
                   for _ in range(worker_count)]
        for future in as_completed(futures):
            try:
                future.result()
            except Cancelled:
                pass
            except Exception as error:
                stop.set()
                ready.abort()
                failures.append(str(error))
    except KeyboardInterrupt:
        print("\nStopping tournament children; completed games are preserved.", flush=True)
        stop.set()
        ready.abort()
    finally:
        pool.shutdown(wait=True, cancel_futures=True)
    if args.continuous:
        if failures:
            raise RuntimeError("\n".join(failures))
        print(f"Records saved in {directory}. Calculate results later with --continuous --report.")
        return 0
    summary = print_report(directory)
    if summary["includedGames"]:
        subprocess.run([node, str(HERE / "render.mjs"), str(directory)], check=True)
    if failures:
        raise RuntimeError("\n".join(failures))
    return 0 if summary["complete"] else 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"Tournament stopped: {error}", file=sys.stderr)
        sys.exit(1)
