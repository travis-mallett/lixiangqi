#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Build the pinned Pikafish release with Lichess's threaded web-engine pattern."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

REPOSITORY = "https://github.com/official-pikafish/Pikafish.git"

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
RELEASE = json.loads((SCRIPT_DIR.parent / "pikafish" / "release.json").read_text())
TAG = RELEASE["tag"]
COMMIT = RELEASE["commit"]
DEFAULT_BUILD_DIR = REPO_ROOT / ".tools" / "pikafish-web-build"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "public" / "pikafish-web"


def run(*command: str | Path, cwd: Path | None = None) -> None:
    print("+", " ".join(map(str, command)), flush=True)
    subprocess.check_call([str(part) for part in command], cwd=cwd)


def output(*command: str | Path, cwd: Path | None = None) -> str:
    return subprocess.check_output(
        [str(part) for part in command], cwd=cwd, text=True
    ).strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--build-dir", type=Path, default=DEFAULT_BUILD_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--em++", dest="emxx", default="em++")
    parser.add_argument(
        "--source-dir",
        type=Path,
        help="Build the already-patched source from the distributed source bundle",
    )
    parser.add_argument(
        "--nnue",
        type=Path,
        default=REPO_ROOT / ".tools" / "pikafish" / "pikafish.nnue",
        help="The exact pikafish.nnue file shipped with the pinned native release.",
    )
    args = parser.parse_args()
    args.build_dir = args.build_dir.resolve()
    args.output_dir = args.output_dir.resolve()
    args.nnue = args.nnue.resolve()

    source = (
        args.source_dir.resolve() if args.source_dir else args.build_dir / "Pikafish"
    )
    args.build_dir.mkdir(parents=True, exist_ok=True)
    if args.source_dir:
        if not (source / "src/main.cpp").is_file():
            raise RuntimeError(
                "Source directory must contain the patched Pikafish sources"
            )
    elif not source.exists():
        args.build_dir.mkdir(parents=True, exist_ok=True)
        run("git", "clone", "--depth", "1", "--branch", TAG, REPOSITORY, source)
        if output("git", "rev-parse", "HEAD", cwd=source) != COMMIT:
            raise RuntimeError(
                "The Pikafish tag no longer resolves to the pinned commit"
            )
        run("git", "apply", "--recount", SCRIPT_DIR / "pikafish-web.patch", cwd=source)
        shutil.copy2(SCRIPT_DIR / "glue.cpp", source / "src" / "glue.cpp")
        shutil.copy2(SCRIPT_DIR / "glue.hpp", source / "src" / "glue.hpp")
    elif output("git", "rev-parse", "HEAD", cwd=source) != COMMIT:
        raise RuntimeError(f"Unexpected source revision in {source}")

    # Never silently rebuild against an older version of the native bridge.
    if not args.source_dir:
        run(
            "git",
            "apply",
            "--reverse",
            "--check",
            "--recount",
            SCRIPT_DIR / "pikafish-web.patch",
            cwd=source,
        )

    with args.nnue.open("rb") as stream:
        if (
            hashlib.file_digest(stream, "sha256").hexdigest()
            != RELEASE["files"]["pikafish.nnue"]["sha256"]
        ):
            raise RuntimeError("NNUE does not match the pinned official release")

    # Keep rebuilds in an existing checkout synchronized with the maintained
    # web bridge. Previously these files were refreshed only on the first clone.
    shutil.copy2(SCRIPT_DIR / "glue.cpp", source / "src" / "glue.cpp")
    shutil.copy2(SCRIPT_DIR / "glue.hpp", source / "src" / "glue.hpp")

    src = source / "src"
    sources = sorted(
        path.relative_to(src).as_posix()
        for path in src.rglob("*.cpp")
        if "universal" not in path.parts
        and path.name not in {"pyffish.cpp", "ffishjs.cpp"}
    )
    response_file = args.build_dir / "pikafish-web.rsp"
    output_js = args.build_dir / "pikafish.js"
    args.output_dir.mkdir(parents=True, exist_ok=True)

    flags = [
        "-O3",
        "-std=c++17",
        "-DNDEBUG",
        "-DIS_64BIT",
        "-pthread",
        "-msimd128",
        "-msse4.1",
        "-flto",
        "-fno-exceptions",
        "-DUSE_POPCNT",
        "-DUSE_SLOPPY_ATOMICS",
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
    response_file.write_text(
        "\n".join(f'"{item}"' if " " in item else item for item in flags),
        encoding="utf-8",
    )
    run(args.emxx, f"@{response_file}", cwd=src)

    for name in ("pikafish.js", "pikafish.wasm"):
        publish(args.build_dir / name, args.output_dir / name)
    publish(args.nnue, args.output_dir / "pikafish.nnue")
    publish(source / "Copying.txt", args.output_dir / "COPYING.txt")
    publish(source / "AUTHORS", args.output_dir / "AUTHORS")
    publish(source / "README.md", args.output_dir / "UPSTREAM-README.md")
    publish(
        SCRIPT_DIR.parent / "pikafish/NNUE-License.md",
        args.output_dir / "NNUE-License.md",
    )
    notice = REPO_ROOT / "public/pikafish-web/NOTICE.html"
    if notice.resolve() != (args.output_dir / "NOTICE.html").resolve():
        publish(notice, args.output_dir / "NOTICE.html")
    package_source(source, args.build_dir / "pikafish-source.tar.gz")
    publish(
        args.build_dir / "pikafish-source.tar.gz",
        args.output_dir / "pikafish-source.tar.gz",
    )
    (args.build_dir / "SOURCE.txt").write_text(
        f"Pikafish source: {REPOSITORY}\nTag: {TAG}\nCommit: {COMMIT}\n"
        "Modified by LiXiangQi contributors on 2026-11-01 for browser execution.\n"
        "Full corresponding source, patch and build instructions: pikafish-source.tar.gz (beside this file).\n"
        "Engine and browser modifications: GPL-3.0-or-later; see COPYING.txt and AUTHORS.\n"
        "Network: separate terms in NNUE-License.md; commercial use requires permission.\n",
        encoding="utf-8",
    )
    publish(args.build_dir / "SOURCE.txt", args.output_dir / "SOURCE.txt")
    print(f"Built browser Pikafish assets in {args.output_dir}")


def publish(source: Path, destination: Path) -> None:
    """Replace an asset without modifying prior content-hashed hard links or mapped files."""
    with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as stream:
        temporary = Path(stream.name)
    try:
        shutil.copy2(source, temporary)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def package_source(source: Path, destination: Path) -> None:
    """Publish exact patched sources and build inputs alongside the WASM, without Git metadata."""
    if (source / ".git").exists():
        names = output("git", "ls-files", cwd=source).splitlines()
        files = [(source / name, f"Pikafish/{name}") for name in names]
    else:
        files = [
            (p, f"Pikafish/{p.relative_to(source).as_posix()}")
            for p in source.rglob("*")
            if p.is_file()
        ]
    files.extend(
        (source / "src" / name, f"Pikafish/src/{name}")
        for name in ("glue.cpp", "glue.hpp")
    )
    files.extend(
        (SCRIPT_DIR / name, f"scripts/pikafish-web/{name}")
        for name in (
            "build.py",
            "glue.cpp",
            "glue.hpp",
            "initModule.js",
            "pikafish-web.patch",
            "README.md",
            "smoke.mjs",
            "tests/test_build.py",
        )
    )
    files.extend(
        (SCRIPT_DIR.parent / "pikafish" / name, f"scripts/pikafish/{name}")
        for name in (
            "release.json",
            "NNUE-License.md",
            "install.py",
            "tests/test_install.py",
        )
    )
    files.append(
        (
            REPO_ROOT / "public/pikafish-web/NOTICE.html",
            "public/pikafish-web/NOTICE.html",
        )
    )
    # Stable metadata keeps unchanged builds from generating new download hashes.
    with destination.open("wb") as raw, gzip.GzipFile(
        filename="", mode="wb", fileobj=raw, mtime=0
    ) as compressed:
        with tarfile.open(fileobj=compressed, mode="w") as archive:
            for name, path in sorted({name: path for path, name in files}.items()):
                data = path.read_bytes()
                info = tarfile.TarInfo(name)
                info.size = len(data)
                info.mode = 0o644
                archive.addfile(info, io.BytesIO(data))


if __name__ == "__main__":
    try:
        main()
    except (OSError, subprocess.CalledProcessError, RuntimeError) as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from error
