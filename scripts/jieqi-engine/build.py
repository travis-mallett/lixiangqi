#!/usr/bin/env python3
"""Build the pinned, information-set Jieqi engine for browsers and the bot worker."""
from pathlib import Path
import argparse
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = "https://github.com/brianhliou/pikafish-jieqi-wasm.git"
REVISION = "bcc83f88ee18760e60903d1a3aaa61ef6f70f2c9"


def patch_position(contents):
    patches = [
        # Initialization addresses slots 0..6, beyond the original array.
        ("Key psqDark[PIECE_NB][5];", "Key psqDark[PIECE_NB][7];"),
        # Quiet move scoring and check generation also inspect concealed advisors.
        ("  si->checkSquares[KING] = 0;",
         "  si->checkSquares[KING] = 0;\n"
         "  si->checkSquares[ADVISOR_B] = attacks_bb<ADVISOR_B>(oksq);"),
        # Revealing an identity preserves the move and capture that led here.
        # These fields lie beyond the prefix copied by getDark's memcpy.
        ("    newSt.previousDark = st;",
         "    newSt.previousDark = st;\n"
         "    newSt.capturedPiece = st->capturedPiece;\n"
         "    newSt.move = st->move;"),
    ]
    for original, patched in patches:
        if contents.count(patched) == 1:
            continue
        if contents.count(original) != 1:
            raise RuntimeError(f"Jieqi position patch no longer applies: {original}")
        contents = contents.replace(original, patched)
    return contents


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--emxx", default="em++")
    parser.add_argument("--source", type=Path, default=ROOT / ".tools/jieqi/engine")
    args = parser.parse_args()
    source = args.source.resolve()
    if not source.exists():
        subprocess.run(["git", "clone", REPOSITORY, str(source)], check=True)
        subprocess.run(["git", "checkout", REVISION], cwd=source, check=True)
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
    if revision != REVISION:
        raise RuntimeError("Unexpected Jieqi engine source revision")
    position = source / "src/position.cpp"
    contents = patch_position(position.read_text(encoding="utf-8"))
    position.write_text(contents, encoding="utf-8")
    out = ROOT / "public/jieqi-engine"
    out.mkdir(parents=True, exist_ok=True)
    src = source / "src"
    sources = ["benchmark.cpp", "bitboard.cpp", "evaluate.cpp", "main.cpp", "material.cpp",
               "misc.cpp", "movegen.cpp", "movepick.cpp", "position.cpp", "psqt.cpp", "search.cpp",
               "thread.cpp", "timeman.cpp", "tt.cpp", "uci.cpp", "ucioption.cpp", "tune.cpp",
               "nnue/evaluate_nnue.cpp", "nnue/features/half_ka_v2_hm.cpp", "compression/zip.cpp"]
    flags = ["-std=c++17", "-O3", "-DNDEBUG", "-DIS_64BIT", "-DNO_PREFETCH", "-DUSE_PTHREADS",
             "-pthread", "-msimd128", "-fno-exceptions", "-I.", *sources,
             "-sMODULARIZE", "-sEXPORT_ES6", "-sEXPORT_NAME=PikaJieQi", "-sENVIRONMENT=web,worker,node",
             "-sEXPORTED_FUNCTIONS=_pikajieqi_initialize,_pikajieqi_command,_malloc,_free",
             "-sEXPORTED_RUNTIME_METHODS=cwrap,PThread", "-sINITIAL_MEMORY=64MB", "-sALLOW_MEMORY_GROWTH=1",
             "-sSTACK_SIZE=3MB", "-sPTHREAD_POOL_SIZE=4", "-sNO_EXIT_RUNTIME=1",
             "-Wno-pthreads-mem-growth", "-o", (out / "pikajieqi.js").as_posix()]
    rsp = source / "jieqi-build.rsp"
    rsp.write_text("\n".join('"' + s + '"' if ' ' in s else s for s in flags))
    subprocess.run([args.emxx, "@" + str(rsp)], cwd=src, check=True)
    shutil.copy2(source / "Copying.txt", out / "COPYING.txt")
    (out / "SOURCE.txt").write_text(f"{REPOSITORY}\nRevision: {REVISION}\n"
                                  "Build, hash-table sizing and position-state fixes: scripts/jieqi-engine/build.py\n"
                                  "Corresponding source, including the fixes: source.zip\n")
    archive_path = out / "source.zip.tmp"
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in subprocess.check_output(["git", "ls-files"], cwd=source, text=True).splitlines():
            archive.write(source / name, name)
        archive.write(Path(__file__), "lixiangqi/build.py")
    archive_path.replace(out / "source.zip")


if __name__ == "__main__":
    main()
