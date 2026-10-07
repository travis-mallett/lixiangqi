"""Small completion-driven scheduler; the coordinator alone writes Elo."""

import hashlib
import json
import platform
import random
import threading
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path

from .model import match


def file_hash(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def provenance(runtime):
    root = Path(__file__).resolve().parents[3]
    parent = Path(__file__).resolve().parents[1]
    files = list(Path(__file__).parent.glob("*.py"))
    files += [
        parent / name
        for name in ("runtime.py", "native_rules.py", "NativeRules.java", "profiles.py")
    ]
    files += list((root / "external/pikafish_worker").glob("*.py"))
    files += list((root / "external/xiangqi_explorer").glob("*.py"))
    files.append(root / "tools/xiangqi_data/pikafish_rules.py")
    executable = runtime.engine.executable
    return {
        "version": 1,
        "python": platform.python_version(),
        "platform": platform.platform(),
        "sourceHashes": {str(p.relative_to(root)): file_hash(p) for p in sorted(files)},
        "engine": {
            "path": str(executable),
            "sha256": file_hash(executable),
            "nnueSha256": file_hash(executable.parents[1] / "pikafish.nnue"),
        },
        "rules": {
            "ruleset": "tiantian-v1",
            "java": runtime.rules.java,
            "javaSha256": file_hash(runtime.rules.java),
            "jarHashes": {str(p): file_hash(p) for p in runtime.rules.artifacts()},
        },
        "threadsPerEngine": 1,
        "hashMiBPerEngine": 128,
        "rng": "Production SHA256 gameId/profile identity/history; separate production opening RNG",
    }


def run(
    store,
    target,
    concurrency,
    factory,
    *,
    full_logs=False,
    max_failures=20,
    stop=None,
    emit=print,
):
    stop = stop or threading.Event()
    pending = store.pending()
    if store.completed + len(pending) > target:
        raise ValueError("--games must cover already completed and pending games")
    local = threading.local()
    runtimes = []
    lock = threading.Lock()

    def play(plan):
        if not hasattr(local, "runtime"):
            local.runtime = factory()
            with lock:
                runtimes.append(local.runtime)
        return local.runtime.play(
            plan,
            store.bots[plan["red"]],
            store.bots[plan["black"]],
            store.config["max_plies"],
            full_logs,
            stop=stop,
        )

    active = {}
    busy = set()
    # Reserve the identities in saved pending games before scheduling any new games.
    for plan in pending:
        busy.update((plan["red"], plan["black"]))
    failures = 0
    executor = ThreadPoolExecutor(
        max_workers=concurrency, thread_name_prefix="bot-pool"
    )
    try:
        while pending or active or store.completed < target:
            while not stop.is_set() and len(active) < concurrency:
                if pending:
                    plan = pending.pop(0)
                elif store.completed + len(active) < target:
                    sequence = store.sequence + 1
                    seed = hashlib.sha256(
                        f"pool|{store.config['seed']}|{sequence}".encode()
                    ).hexdigest()
                    pairing = match(
                        store.bots, busy, random.Random(seed), store.config["window"]
                    )
                    if pairing is None:
                        break
                    red, black = pairing
                    plan = {
                        "sequence": sequence,
                        "gameId": seed[:32],
                        "rngSeed": seed,
                        "red": red.id,
                        "black": black.id,
                    }
                    store.reserve(plan)
                    busy.update((red.id, black.id))
                else:
                    break
                active[executor.submit(play, plan)] = plan
            if not active:
                break
            done, _ = wait(active, timeout=0.5, return_when=FIRST_COMPLETED)
            for future in done:
                plan = active.pop(future)
                try:
                    record = future.result()
                except Exception as error:  # noqa: BLE001 - worker setup failures also remain unscored
                    record = {
                        **plan,
                        "status": "failed",
                        "result": None,
                        "failure": {
                            "stage": "worker",
                            "type": type(error).__name__,
                            "message": str(error),
                        },
                    }
                busy.difference_update((plan["red"], plan["black"]))
                if record["status"] != "interrupted":
                    store.finish(record)
                    failures += record["status"] != "completed"
                    emit(
                        json.dumps(
                            {
                                "sequence": plan["sequence"],
                                "status": record["status"],
                                "result": record["result"],
                                "completed": store.completed,
                                "excludedThisRun": failures,
                            },
                            allow_nan=False,
                        )
                    )
                if failures >= max_failures:
                    stop.set()
            if stop.is_set() and not active:
                break
    finally:
        stop.set()
        executor.shutdown(wait=True)
        for runtime in runtimes:
            runtime.close()
    return {
        "completed": store.completed,
        "target": target,
        "excludedThisRun": failures,
        "status": "complete"
        if store.completed >= target
        else "failure_limit"
        if failures >= max_failures
        else "interrupted",
    }
