#!/usr/bin/env python3
"""Build the GPLv3 AB-JChess 20261031 release for browser and Node (Emscripten 5.0.7)."""
import argparse
import hashlib
from pathlib import Path
import shutil
import subprocess
import urllib.request
import zipfile

from build_jqe import browser_uci

ROOT = Path(__file__).resolve().parents[2]
REVISION = "efc83867230a26bbcd4a6c4cf644b69e154b452e"
RELEASE = "https://github.com/lxsgx23/AB-JChess/releases/download/AB-JChess-20261031/AB-JChess-20261031.zip"
RELEASE_SHA = "f62831437df87b6878f07e6dcbe54c30456502248353adca7503f033a0edc974"
NETWORK = "abjchess-20261030.nnue"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--emxx", default="em++")
    parser.add_argument("--source", type=Path, default=ROOT / ".tools/ab-jchess")
    parser.add_argument("--release", type=Path, default=ROOT / ".tools/ab-jchess-release.zip")
    args = parser.parse_args()
    source = args.source.resolve()
    if not source.exists():
        subprocess.run(["git", "clone", "https://github.com/lxsgx23/AB-JChess.git", str(source)], check=True)
        subprocess.run(["git", "checkout", REVISION], cwd=source, check=True)
    if subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip() != REVISION:
        raise RuntimeError("Unexpected AB-JChess source revision")
    if not args.release.exists():
        urllib.request.urlretrieve(RELEASE, args.release)
    if hashlib.sha256(args.release.read_bytes()).hexdigest() != RELEASE_SHA:
        raise RuntimeError("AB-JChess release checksum mismatch")
    out = ROOT / "public/jieqi-engine/abjchess"
    out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.release) as release:
        names = [n for n in release.namelist() if Path(n).name == NETWORK]
        if len(names) != 1:
            raise RuntimeError("Expected exactly one release network")
        (out / NETWORK).write_bytes(release.read(names[0]))
    src = source / "abjchess/src"
    # Modified by LiXiangQi, 2026-11-01: asynchronous browser command entry points.
    bridge = browser_uci((src / "uci.cpp").read_text(encoding="utf-8"))
    bridge = bridge.replace("jqe_initialize", "abjchess_initialize").replace("jqe_command", "abjchess_command")
    bridge = bridge.replace("/it014.jqn", "/" + NETWORK)
    (src / "browser.cpp").write_text("// Modified by LiXiangQi, 2026-11-01: browser command bridge.\n" + bridge, encoding="utf-8")
    search = subprocess.check_output(["git", "show", f"{REVISION}:abjchess/src/search.cpp"], cwd=source, text=True)
    search = search.replace("const int nLegal = root.gen_legal(legal);", "int nLegal = root.gen_legal(legal);\n    if (!limits.searchMoves.empty())\n        nLegal = int(std::remove_if(legal, legal + nLegal, [&](Move m) {\n            return std::find(limits.searchMoves.begin(), limits.searchMoves.end(), m) == limits.searchMoves.end();\n        }) - legal);")
    (src / "search.cpp").write_text("// Modified by LiXiangQi, 2026-11-01: restrict immediate-stop fallback to searchmoves.\n" + search, encoding="utf-8")
    files = "tables position eval nnue_small hnnue search selfplay bitboard position_ref browser".split()
    flags = ["-std=c++20", "-O3", "-DNDEBUG", "-ffp-contract=off", "-pthread", "-msimd128", "-I.", "-include", "nobmi.h"]
    flags += [f + ".cpp" for f in files]
    flags += ["--no-entry", "-sMODULARIZE", "-sEXPORT_ES6", "-sEXPORT_NAME=Abjchess",
              "-sENVIRONMENT=web,worker,node", "-sEXPORTED_FUNCTIONS=_abjchess_initialize,_abjchess_command",
              "-sEXPORTED_RUNTIME_METHODS=cwrap,PThread,FS", "-sINITIAL_MEMORY=64MB",
              "-sALLOW_MEMORY_GROWTH=1", "-sSTACK_SIZE=3MB", "-sDEFAULT_PTHREAD_STACK_SIZE=4MB",
              "-sPTHREAD_POOL_SIZE=4", "-sNO_EXIT_RUNTIME=1", "-Wno-pthreads-mem-growth",
              "-o", (out / "abjchess.js").as_posix()]
    rsp = source / "browser-build.rsp"
    rsp.write_text("\n".join('"' + s + '"' if ' ' in s else s for s in flags))
    subprocess.run([args.emxx, "@" + str(rsp)], cwd=src, check=True)
    for name, dest in [("LICENSE", "LICENSE.txt"), ("THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"),
                       ("abjchess/AUTHORS", "AUTHORS"), ("abjchess/LICENSE-jqe-MIT.txt", "LICENSE-jqe-MIT.txt")]:
        shutil.copy2(source / name, out / dest)
    (out / "SOURCE.txt").write_text(
        f"AB-JChess 20261031 by Huorongrong and Laoxu (Kouza)\nhttps://github.com/lxsgx23/AB-JChess\n"
        f"Revision: {REVISION}\nRelease: {RELEASE}\nRelease SHA256: {RELEASE_SHA}\n"
        "Project including release network: GPLv3, as stated in the release notes.\n"
        "Modified by LiXiangQi on 2026-11-01: browser command bridge; searchmoves enforced for immediate-stop fallback; trained weights unchanged.\n"
        "Corresponding source, trainer, network and build scripts: source.zip (same directory).\n"
        "Build: install Emscripten 5.0.7; python scripts/jieqi-engine/build_abjchess.py --emxx /path/to/em++\n"
        "No warranty. See LICENSE.txt and THIRD_PARTY_NOTICES.md.\n", encoding="utf-8")
    with zipfile.ZipFile(out / "source.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for name in subprocess.check_output(["git", "-c", "core.quotepath=false", "ls-files"], cwd=source, text=True, encoding="utf-8").splitlines():
            archive.write(source / name, name)
        archive.write(src / "browser.cpp", "abjchess/src/browser.cpp")
        archive.write(out / NETWORK, "abjchess/" + NETWORK)
        archive.write(out / "SOURCE.txt", "LIXIANGQI-MODIFICATIONS.txt")
        for name in ["build_abjchess.py", "build_jqe.py"]:
            archive.write(Path(__file__).with_name(name), "scripts/jieqi-engine/" + name)


if __name__ == "__main__":
    main()
