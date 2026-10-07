"""python -m tools.bot_levels_optimization --help"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from .calibration import Config, calibrate, manifest
from .native_rules import NativeRules
from .openings import export_suite, load_suite
from .profiles import SEED_COORDINATES, validate_coordinates, validate_endpoints
from .runtime import CalibrationEngine, local_url
from .storage import RunStore


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Offline nine-level paired self-play calibration; never deploys profiles"
    )
    parser.add_argument(
        "--prepare-suite",
        type=Path,
        help="Export a fixed master-position suite, then exit",
    )
    parser.add_argument("--suite-size", type=int, default=64)
    parser.add_argument("--min-ply", type=int, default=20)
    parser.add_argument("--max-ply", type=int, default=28)
    parser.add_argument("--suite", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("tools/bot_levels_optimization/runs/calibration"),
    )
    parser.add_argument("--resume", action="store_true")
    parser.add_argument(
        "--profiles",
        type=Path,
        help="A previous result.json supplying initial coordinates",
    )
    parser.add_argument("--java", help="Java 21 executable (bundled JDK by default)")
    parser.add_argument(
        "--class-path",
        help="Native staged JAR classpath (target/universal/stage/lib/* by default)",
    )
    parser.add_argument("--explorer-url", default="http://127.0.0.1:9002")
    for name in (
        "seed",
        "games_per_pair",
        "refinement_games",
        "final_games",
        "exploratory_iterations",
        "max_iterations",
        "patience",
        "max_plies",
        "max_failed_pairs",
    ):
        parser.add_argument(
            "--" + name.replace("_", "-"), type=int, default=getattr(Config(), name)
        )
    parser.add_argument("--tolerance", type=float, default=0.05)
    parser.add_argument("--damping", type=float, default=0.5)
    parser.add_argument(
        "--mode", choices=("calibrate", "validate"), default="calibrate"
    )
    args = parser.parse_args(argv)
    validate_endpoints()
    if args.prepare_suite:
        suite = export_suite(
            args.prepare_suite, args.suite_size, args.seed, args.min_ply, args.max_ply
        )
        print(
            json.dumps(
                {"suite": str(args.prepare_suite), "openings": len(suite["openings"])}
            )
        )
        return 0
    if not args.suite:
        parser.error("--suite is required; first export one with --prepare-suite PATH")
    config = Config(
        **{name: getattr(args, name) for name in Config.__dataclass_fields__}
    )
    config.validate()
    suite = load_suite(args.suite)
    coordinates = SEED_COORDINATES
    if args.profiles:
        coordinates = validate_coordinates(
            [
                v["strengthCoordinate"]
                for v in json.loads(args.profiles.read_text())["levels"]
            ]
        )
    rules = NativeRules(args.java, args.class_path)
    explorer_url = local_url(args.explorer_url)
    engine = CalibrationEngine()
    store = None
    previous_url = os.environ.get("LIXIANGQI_EXPLORER_URL")
    os.environ["LIXIANGQI_EXPLORER_URL"] = explorer_url
    try:
        provenance = manifest(
            config, suite, coordinates, engine.executable, rules, explorer_url
        )
        store = RunStore(args.output, provenance, args.resume)
        emit = lambda event: print(json.dumps(event, allow_nan=False), flush=True)
        outcome = calibrate(config, suite, coordinates, store, engine, rules, emit)
        emit({"event": "finished", **outcome})
        return (
            0
            if outcome["converged"] or outcome["status"] == "validation_complete"
            else 2
        )
    finally:
        engine.close()
        rules.close()
        if store:
            store.close()
        if previous_url is None:
            os.environ.pop("LIXIANGQI_EXPLORER_URL", None)
        else:
            os.environ["LIXIANGQI_EXPLORER_URL"] = previous_url


if __name__ == "__main__":
    raise SystemExit(main())
