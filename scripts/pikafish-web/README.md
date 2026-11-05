# Pikafish web build

This produces the browser engine used for live Xiangqi analysis. It pins official
Pikafish release `Pikafish-2026-09-06` at commit
`4c17cee11f888ae1d48a9494f2e2239f019f0a1f` and follows the architecture of
[`lichess-org/lila-stockfish-web`](https://github.com/lichess-org/lila-stockfish-web):
an Emscripten ES module, shared WebAssembly memory, pthread workers, a blocking
UCI command queue, and an NNUE buffer supplied by JavaScript. The bridge streams
Pikafish's Zstandard-distributed network directly into the evaluator using bounded
decompression windows. It supports the replication API's rewind operation and
rejects incomplete frames, without retaining a full decompressed intermediate.
This reduced the observed WASM heap from approximately 461 MiB to 320 MiB with the
pinned full network. That measures WASM allocation, not total browser memory.
The standalone bot uses one search thread and a 16 MiB hash table; the full
network remains a substantial mobile cost.

Install and activate Emscripten 5.0.7, place the matching `pikafish.nnue` at
`.tools/pikafish/pikafish.nnue`, then run:

```console
python scripts/pikafish-web/build.py
```

The generated GPLv3 engine, license, exact-source pointer, and NNUE network are
written to `public/pikafish-web/`. The application caches the large NNUE file in
the browser's OPFS or IndexedDB after the first download.

The canonical release and checksums are in `scripts/pikafish/release.json`.
Run `python scripts/pikafish/install.py` to install or update both native engines
and their matching network. Run it with `--check` to verify without changing files.
The browser network is an ignored build artifact, not a Git LFS object. Before
an asset build in a fresh checkout, prepare it from that same verified installation:

```console
python scripts/pikafish/install.py --browser-dir public/pikafish-web
```

This downloads and checks the official release when needed, then publishes its
network atomically. Existing current installations need no download. Add `--check`
to verify both the installation and browser copy without modifying them. CI,
the Windows installer, and `push-local-live.ps1` perform this step before hashing
or packaging assets. Keep the WASM, JavaScript, source archive, manifest and notices
in Git; do not add the generated network or upload it to GitHub LFS.
The universal native binaries select the available CPU instruction set themselves.
Stop running engine workers before updating their executable and network.

The browser build retains the full official evaluator and search, using the
upstream WASM/SSE4.1 SIMD configuration and pthreads. The patch only adapts the
UCI input queue, in-memory network loading and version identification. Unlike
the previous integration, upstream network verification remains enabled. Invalid
FEN/UCI commands in this release terminate the engine; callers must supply full
six-field FENs and legal history, and surface engine errors.

## Redistribution

Every browser build publishes `pikafish-source.tar.gz` beside the executable.
It contains the exact patched upstream tree, bridge, patch, release manifest and
build scripts. `AUTHORS`, `COPYING.txt`, `UPSTREAM-README.md`, `NNUE-License.md`,
`SOURCE.txt` and `NOTICE.html` accompany the executable and network. The analysis
engine name links to the notices. Preserve these files when deploying or mirroring.
The engine and browser modifications are GPL-3.0-or-later. The NNUE weights have
separate terms: legal use only, and commercial use requires permission. The site
operator must obtain that permission before commercial use; attribution alone
does not grant it. Upstream also acknowledges Px0 training data under ODbL.

To rebuild from the downloadable source bundle, extract it, activate Emscripten
5.0.7 and use Python 3.11 or newer. Obtain `pikafish.nnue` from beside the source
download (the build verifies its SHA-256 against the manifest), then run from the
extracted bundle root:

```console
python scripts/pikafish-web/build.py --source-dir Pikafish --nnue pikafish.nnue
node scripts/pikafish-web/smoke.mjs
```

Browser bridge files and modifications were updated by LiXiangQi contributors
on 2026-11-03. No playing-strength reduction or smaller network is applied.

The loader uses the asset manifest's content hashes, so server restarts do not
invalidate unchanged networks. Native network loading reports invalid data as an
error; the browser evicts those cached bytes before offering a retry. Preparation
completes only after the configured native engine acknowledges `isready`.

If the maintained patch changes, use a new `--build-dir` when rebuilding. Existing
checkouts are checked against the patch rather than silently compiling stale code.
Deployment packages the generated assets and rebuilds their hashed manifest. The
adjacent `lixiangqi-beta-deployment/push-local-live.ps1` verifies the pinned native
release and prepares the browser network before packaging, and includes its licenses and source pointer. Asset
publishing preserves the canonical browser directory so notice and source links
remain accessible. No server-side data migration is needed for this engine update.

The release archive and extracted network are verified against pinned SHA-256
digests by `scripts/windows/Install-Pikafish.ps1`. Pikafish engine code is
GPL-3.0-or-later, while the official Pikafish NNUE weights carry the separate usage terms
published by the [official Networks repository](https://github.com/official-pikafish/Networks#nnue-license).
