#!/usr/bin/env python3
"""Build the pinned MIT-licensed jqe engine and network for browser and Node."""
import argparse
from pathlib import Path
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = "https://github.com/devinokeefe/jieqi.git"
REVISION = "331a6e612a038c4a04cf980f7b9482910fd50078"


def browser_uci(text):
    """Expose the existing command dispatcher without blocking on stdin/search."""
    start = text.index("int uci_loop(int argc, char** argv) {")
    body = text.index("        std::istringstream is(line);", start)
    end = text.index("        if (once) {", body)
    dispatch = text[body:end].replace('else if (cmd == "quit") break;',
                                      'else if (cmd == "quit") engine.wait();')
    dispatch = dispatch.replace('if (!nnue::loaded()) { out("info string no net"); continue; }',
                                'if (!nnue::loaded()) { out("info string no net"); return; }')
    return text[:start] + '''
static Engine& browser_engine() { static Engine engine; return engine; }
extern "C" int jqe_initialize() {
    browser_engine();
    std::string error;
    if (!nnue::load("/it014.jqn", &error)) {
        out("info string EvalFile load failed: " + error);
        return 0;
    }
    return 1;
}
extern "C" void jqe_command(const char* input) {
    Engine& engine = browser_engine();
    const std::string line(input);
''' + dispatch + '\n}\n} // namespace jq\n'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--emxx", default="em++")
    parser.add_argument("--source", type=Path, default=ROOT / ".tools/jqe")
    args = parser.parse_args()
    source = args.source.resolve()
    if not source.exists():
        subprocess.run(["git", "clone", REPOSITORY, str(source)], check=True)
        subprocess.run(["git", "checkout", REVISION], cwd=source, check=True)
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
    if revision != REVISION:
        raise RuntimeError("Unexpected jqe source revision")
    src = source / "engine/src"
    def original(name):
        return subprocess.check_output(["git", "show", f"{REVISION}:engine/src/{name}"], cwd=source, text=True)
    # Emscripten defines HUGE in math.h and has no x86 floating-point control register.
    mem = src / "mem.h"
    mem.write_text(original("mem.h").replace("HUGE", "HugePageBytes"))
    nnue = src / "nnue.cpp"
    nnue.write_text(original("nnue.cpp").replace("#include <xmmintrin.h>", "")
                    .replace("_mm_setcsr(_mm_getcsr() | 0x8040);", ""))
    # Even a search stopped before its first iteration must obey searchmoves.
    search = original("search.cpp").replace(
        "const int nLegal = root.gen_legal(legal);",
        "int nLegal = root.gen_legal(legal);\n"
        "    if (!limits.searchMoves.empty())\n"
        "        nLegal = int(std::remove_if(legal, legal + nLegal, [&](Move m) {\n"
        "            return std::find(limits.searchMoves.begin(), limits.searchMoves.end(), m) == limits.searchMoves.end();\n"
        "        }) - legal);")
    (src / "search.cpp").write_text(search)
    (src / "browser.cpp").write_text(browser_uci((src / "uci.cpp").read_text()), encoding="utf-8")
    out = ROOT / "public/jieqi-engine/jqe"
    out.mkdir(parents=True, exist_ok=True)
    flags = ["-std=c++20", "-O3", "-DNDEBUG", "-pthread", "-msimd128", "-I.",
             "tables.cpp", "position.cpp", "eval.cpp", "nnue.cpp", "search.cpp", "selfplay.cpp", "browser.cpp",
             "--no-entry", "-sMODULARIZE", "-sEXPORT_ES6", "-sEXPORT_NAME=Jqe",
             "-sENVIRONMENT=web,worker,node", "-sEXPORTED_FUNCTIONS=_jqe_initialize,_jqe_command",
             "-sEXPORTED_RUNTIME_METHODS=cwrap,PThread,FS", "-sINITIAL_MEMORY=64MB",
             "-sALLOW_MEMORY_GROWTH=1", "-sSTACK_SIZE=3MB", "-sDEFAULT_PTHREAD_STACK_SIZE=4MB",
             "-sPTHREAD_POOL_SIZE=4", "-sNO_EXIT_RUNTIME=1", "-Wno-pthreads-mem-growth",
             "-o", (out / "jqe.js").as_posix()]
    rsp = source / "browser-build.rsp"
    rsp.write_text("\n".join('"' + s + '"' if ' ' in s else s for s in flags))
    subprocess.run([args.emxx, "@" + str(rsp)], cwd=src, check=True)
    shutil.copy2(source / "engine/nets/it014.jqn", out / "it014.jqn")
    shutil.copy2(source / "LICENSE", out / "LICENSE.txt")
    (out / "SOURCE.txt").write_text(
        f"{REPOSITORY}\nRevision: {REVISION}\nCode and networks: MIT (README.md).\n"
        "Browser command bridge: scripts/jieqi-engine/build_jqe.py\nCorresponding source: source.zip\n")
    with zipfile.ZipFile(out / "source.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for name in subprocess.check_output(["git", "ls-files"], cwd=source, text=True).splitlines():
            if name.startswith("engine/") or name in ("LICENSE", "README.md", "THIRD_PARTY.md"):
                archive.write(source / name, name)
        archive.write(src / "browser.cpp", "engine/src/browser.cpp")
        archive.write(Path(__file__), "lixiangqi/build_jqe.py")


if __name__ == "__main__":
    main()
