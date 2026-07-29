#!/usr/bin/env python3
"""Build the pinned Pikafish release with Lichess's threaded web-engine pattern."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


REPOSITORY = "https://github.com/official-pikafish/Pikafish.git"
TAG = "Pikafish-2026-01-02"
COMMIT = "ce0679e00ee196f7ba17f6ec18941b9a5036f8cf"

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
DEFAULT_BUILD_DIR = REPO_ROOT / ".tools" / "pikafish-web-build"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "public" / "pikafish-web"


def run(*command: str | Path, cwd: Path | None = None) -> None:
    print("+", " ".join(map(str, command)), flush=True)
    subprocess.check_call([str(part) for part in command], cwd=cwd)


def output(*command: str | Path, cwd: Path | None = None) -> str:
    return subprocess.check_output([str(part) for part in command], cwd=cwd, text=True).strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--build-dir", type=Path, default=DEFAULT_BUILD_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--em++", dest="emxx", default="em++")
    parser.add_argument(
        "--nnue",
        type=Path,
        default=REPO_ROOT / ".tools" / "pikafish" / "pikafish.nnue",
        help="The exact pikafish.nnue file shipped with the pinned native release.",
    )
    args = parser.parse_args()

    source = args.build_dir / "Pikafish"
    if not source.exists():
        args.build_dir.mkdir(parents=True, exist_ok=True)
        run("git", "clone", "--depth", "1", "--branch", TAG, REPOSITORY, source)
        if output("git", "rev-parse", "HEAD", cwd=source) != COMMIT:
            raise RuntimeError("The Pikafish tag no longer resolves to the pinned commit")
        run("git", "apply", "--recount", SCRIPT_DIR / "pikafish-web.patch", cwd=source)
        shutil.copy2(SCRIPT_DIR / "glue.cpp", source / "src" / "glue.cpp")
        shutil.copy2(SCRIPT_DIR / "glue.hpp", source / "src" / "glue.hpp")
    elif output("git", "rev-parse", "HEAD", cwd=source) != COMMIT:
        raise RuntimeError(f"Unexpected source revision in {source}")

    # Keep rebuilds in an existing checkout synchronized with the maintained
    # web bridge. Previously these files were refreshed only on the first clone.
    shutil.copy2(SCRIPT_DIR / "glue.cpp", source / "src" / "glue.cpp")
    shutil.copy2(SCRIPT_DIR / "glue.hpp", source / "src" / "glue.hpp")

    src = source / "src"
    sources = sorted(
        path.relative_to(src).as_posix()
        for path in src.rglob("*.cpp")
        if path.name not in {"pyffish.cpp", "ffishjs.cpp"}
    )
    response_file = args.build_dir / "pikafish-web.rsp"
    output_js = args.output_dir / "pikafish.js"
    args.output_dir.mkdir(parents=True, exist_ok=True)

    flags = [
        "-O3",
        "-DNDEBUG",
        "-pthread",
        "-msimd128",
        "-mavx",
        "-flto",
        "-fno-exceptions",
        "-DUSE_POPCNT",
        "-DUSE_SSE2",
        "-DUSE_SSSE3",
        "-DUSE_SSE41",
        "-DNO_PREFETCH",
        "-I.",
        *sources,
        "--pre-js",
        (SCRIPT_DIR / "initModule.js").as_posix(),
        "-sENVIRONMENT=web,worker,node",
        "-sEXIT_RUNTIME",
        "-sEXPORT_ES6",
        "-sEXPORT_NAME=PikafishWeb",
        "-sEXPORTED_FUNCTIONS=[_malloc,_main]",
        "-sEXPORTED_RUNTIME_METHODS=[stringToUTF8,UTF8ToString,HEAPU8]",
        "-sINCOMING_MODULE_JS_API=[locateFile,print,printErr,wasmMemory,buffer,instantiateWasm,mainScriptUrlOrBlob,onExit]",
        "-sINITIAL_MEMORY=64MB",
        "-sALLOW_MEMORY_GROWTH",
        "-sSTACK_SIZE=3MB",
        "-sSTRICT",
        "-sPROXY_TO_PTHREAD",
        "-sALLOW_BLOCKING_ON_MAIN_THREAD=0",
        "-Wno-pthreads-mem-growth",
        "--closure=1",
        "-o",
        output_js.as_posix(),
    ]
    response_file.write_text("\n".join(f'\"{item}\"' if " " in item else item for item in flags), encoding="utf-8")
    run(args.emxx, f"@{response_file}", cwd=src)

    if not args.nnue.is_file():
        raise FileNotFoundError(f"Missing NNUE network: {args.nnue}")
    shutil.copy2(args.nnue, args.output_dir / "pikafish.nnue")
    shutil.copy2(source / "Copying.txt", args.output_dir / "COPYING.txt")
    (args.output_dir / "SOURCE.txt").write_text(
        f"Pikafish source: {REPOSITORY}\nTag: {TAG}\nCommit: {COMMIT}\n"
        "Web build sources and patch: scripts/pikafish-web/\n",
        encoding="utf-8",
    )
    print(f"Built browser Pikafish assets in {args.output_dir}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, subprocess.CalledProcessError, RuntimeError) as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from error
