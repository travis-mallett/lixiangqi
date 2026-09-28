"""Unattended generation, certification and diversity selection; exports only."""

import argparse
import hashlib
import json
import math
import random
import time
from collections import Counter
from dataclasses import asdict
from pathlib import Path

from ..pikafish_rules import default_executable
from ..puzzle_mining.engine import (
    ConstructionTimeout,
    EngineProtocolError,
    IncompleteSearchError,
    OfflinePikafish,
    construction_budget,
)
from ..puzzle_mining.solver import SolutionRejected, SolutionReview
from .board import play
from .diversity import DiversityIndex, fingerprints
from .kernels import seeds
from .oracle import Oracle
from .search import Candidate, SearchConfig, beam_order, extend
from .verification import Rejected, certify


def preview(candidate, oracle, tail_plies):
    fens = [candidate.fen]
    for move in candidate.moves:
        fens.append(play(fens[-1], move))
    return {
        "diversity": fingerprints(
            fens, candidate.moves, oracle.checkers(fens[-1]), tail_plies
        )
    }


def atomic_json(path, data):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def source_digest():
    digest = hashlib.sha256()
    for path in sorted(Path(__file__).parent.glob("*.py")):
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--output",
        type=Path,
        required=True,
        help="New output directory; never writes to a puzzle database",
    )
    p.add_argument(
        "--mates", default="2,3,4", help="Comma-separated requested mate lengths, 1..15"
    )
    p.add_argument("--per-length", type=int, default=1)
    p.add_argument("--seed", type=int, default=20260922)
    p.add_argument("--seconds", type=float, default=900)
    p.add_argument("--seed-seconds", type=float, default=40)
    p.add_argument("--max-seeds", type=int, default=1000)
    p.add_argument("--beam", type=int, default=5)
    p.add_argument("--screen-nodes", type=int, default=4000)
    p.add_argument(
        "--depth",
        type=int,
        default=20,
        help="Canonical final verification depth (minimum 20)",
    )
    p.add_argument(
        "--exact-through",
        type=int,
        choices=range(4),
        default=2,
        help="Also require exhaustive proof through this mate length; maximum 3",
    )
    p.add_argument("--verification-seconds", type=float, default=300)
    p.add_argument(
        "--tail-plies",
        type=int,
        default=5,
        help="Odd number of ending plies compared across puzzles",
    )
    p.add_argument(
        "--exclude",
        type=Path,
        action="append",
        default=[],
        help="Earlier puzzles.json to include in diversity checks",
    )
    p.add_argument("--engine", type=Path, default=default_executable())
    return p


def main(argv=None):
    p = parser()
    args = p.parse_args(argv)
    try:
        lengths = sorted({int(n) for n in args.mates.split(",")})
    except ValueError:
        p.error("--mates must contain integers")
    if not lengths or min(lengths) < 1 or max(lengths) > 15:
        p.error("--mates must be between 1 and 15")
    if (
        min(
            args.per_length,
            args.seconds,
            args.seed_seconds,
            args.max_seeds,
            args.beam,
            args.screen_nodes,
            args.verification_seconds,
        )
        <= 0
    ):
        p.error("counts and time limits must be positive")
    if not all(
        math.isfinite(n)
        for n in (args.seconds, args.seed_seconds, args.verification_seconds)
    ):
        p.error("time limits must be finite")
    if args.depth < 20 or args.tail_plies < 3 or args.tail_plies % 2 == 0:
        p.error("depth must be >=20 and tail-plies must be odd and >=3")
    args.output = args.output.resolve()
    if args.output.exists() and (
        not args.output.is_dir() or any(args.output.iterdir())
    ):
        p.error(
            "output contains a prior run; choose a new directory and use --exclude for its puzzles.json"
        )
    excluded = []
    for path in args.exclude:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("schema_version") != 1:
            p.error(f"unsupported composition export: {path}")
        for record in data["puzzles"]:
            # Recompute at this run's suffix length, including records from a different policy.
            record["diversity"] = fingerprints(
                record["fens"],
                record["moves"],
                record["terminal_checkers"],
                args.tail_plies,
            )
            excluded.append(record)
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    rng = random.Random(args.seed)
    stats = Counter()
    counts = Counter()
    accepted = []
    diversity = DiversityIndex(excluded, args.tail_plies)
    config = SearchConfig(beam=args.beam, screen_nodes=args.screen_nodes)
    engine = OfflinePikafish(args.engine, threads=1, hash_mb=64)
    oracle = Oracle(engine)
    manifest = {
        "schema_version": 1,
        "generator_sha256": source_digest(),
        "configuration": {
            k: str(v)
            if isinstance(v, Path)
            else [str(x) for x in v]
            if k == "exclude"
            else v
            for k, v in vars(args).items()
        },
        "search": asdict(config),
        "status": "running",
        "excluded_puzzles": len(excluded),
    }

    def emit(event, **data):
        row = {"seconds": round(time.monotonic() - started, 2), "event": event, **data}
        with (args.output / "events.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(row) + "\n")
        print(json.dumps(row), flush=True)

    def save():
        manifest.update(
            counts={str(k): counts[k] for k in lengths},
            statistics=dict(stats),
            seconds=round(time.monotonic() - started, 3),
            inspections=oracle.inspections,
            checker_inspections=oracle.checker_inspections,
        )
        atomic_json(
            args.output / "puzzles.json", {"schema_version": 1, "puzzles": accepted}
        )
        atomic_json(args.output / "run.json", manifest)

    save()
    try:
        with construction_budget(engine, args.seconds):
            engine.start()
            manifest.update(engine=engine.engine_version, nnue=engine.nnue)
            for seed_number, kernel in enumerate(seeds(oracle, rng, max_variants=3)):
                if seed_number >= args.max_seeds:
                    break
                if all(counts[n] >= args.per_length for n in lengths):
                    break
                root = Candidate(kernel.fen, (kernel.move,), kernel.family)
                seed_key = preview(root, oracle, args.tail_plies)["diversity"][
                    "geometry"
                ]
                if any(
                    r["diversity"]["geometry"] == seed_key for r in diversity.records
                ):
                    stats["seed_geometry_duplicates"] += 1
                    continue
                stats["seeds"] += 1
                emit("seed", number=seed_number, family=kernel.family)
                candidates = [root] if 1 in lengths else []
                frontier = [root]
                wanted = max(n for n in lengths if counts[n] < args.per_length)
                try:
                    with construction_budget(engine, args.seed_seconds):
                        for mate in range(2, wanted + 1):
                            children = []
                            for parent in frontier:
                                children.extend(
                                    extend(parent, oracle, rng, config, stats)
                                )
                            frontier = beam_order(children, rng, config.beam)
                            emit(
                                "generation",
                                seed=seed_number,
                                mate=mate,
                                candidates=len(frontier),
                            )
                            if mate in lengths:
                                candidates.extend(frontier)
                            if not frontier:
                                break
                except ConstructionTimeout:
                    stats["seed_timeouts"] += 1
                    emit("seed_budget", seed=seed_number)
                candidates.sort(key=lambda c: (-c.mate, len(c.fen)))
                for candidate in candidates:
                    if counts[candidate.mate] >= args.per_length:
                        continue
                    conflict = diversity.conflict(
                        preview(candidate, oracle, args.tail_plies)
                    )
                    if conflict:
                        stats[conflict] += 1
                        continue
                    emit("verifying", mate=candidate.mate, family=candidate.family)
                    try:
                        record = certify(
                            candidate,
                            oracle,
                            depth=args.depth,
                            exact_through=args.exact_through,
                            seconds=args.verification_seconds,
                            tail_plies=args.tail_plies,
                        )
                    except (
                        Rejected,
                        SolutionRejected,
                        SolutionReview,
                        IncompleteSearchError,
                        ConstructionTimeout,
                    ) as exc:
                        stats["verification_rejected"] += 1
                        emit("rejected", reason=str(exc), mate=candidate.mate)
                        continue
                    conflict = diversity.conflict(record)
                    if conflict:
                        stats[conflict] += 1
                        continue
                    accepted.append(record)
                    diversity.add(record)
                    counts[candidate.mate] += 1
                    emit(
                        "accepted",
                        id=record["id"],
                        mate=candidate.mate,
                        family=candidate.family,
                        fen=candidate.fen,
                        moves=list(candidate.moves),
                        proof=record["verification"]["method"],
                    )
                    save()
                    break  # One export per ending geometry, regardless of depth.
                save()
                if all(counts[n] >= args.per_length for n in lengths):
                    break
            manifest["status"] = (
                "complete"
                if all(counts[n] >= args.per_length for n in lengths)
                else "search_exhausted"
            )
    except ConstructionTimeout:
        manifest["status"] = "time_limit"
        emit("time_limit")
    except KeyboardInterrupt:
        manifest["status"] = "interrupted"
        emit("interrupted")
    except (EngineProtocolError, OSError) as exc:
        manifest["status"] = "failed"
        manifest["error"] = str(exc)
        emit("failed", reason=str(exc))
    except Exception as exc:
        manifest["status"] = "failed"
        manifest["error"] = f"{type(exc).__name__}: {exc}"
        raise
    finally:
        engine.close()
        save()
    emit(
        "finished",
        status=manifest["status"],
        counts=manifest["counts"],
        statistics=dict(stats),
    )
    return 0 if manifest["status"] == "complete" else 2


if __name__ == "__main__":
    raise SystemExit(main())
