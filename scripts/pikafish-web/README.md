# Pikafish web build

This produces the browser engine used for live Xiangqi analysis. It pins official
Pikafish release `Pikafish-2026-01-02` at commit
`ce0679e00ee196f7ba17f6ec18941b9a5036f8cf` and follows the architecture of
[`lichess-org/lila-stockfish-web`](https://github.com/lichess-org/lila-stockfish-web):
an Emscripten ES module, shared WebAssembly memory, pthread workers, a blocking
UCI command queue, and an NNUE buffer supplied by JavaScript. The bridge
decompresses Pikafish's Zstandard-distributed network before loading it into
the evaluator.

Install and activate Emscripten 5.0.7, place the matching `pikafish.nnue` at
`.tools/pikafish/pikafish.nnue`, then run:

```console
python scripts/pikafish-web/build.py
```

The generated GPLv3 engine, license, exact-source pointer, and NNUE network are
written to `public/pikafish-web/`. The application caches the large NNUE file in
the browser's OPFS or IndexedDB after the first download.

The release archive and extracted network are verified against pinned SHA-256
digests by `scripts/windows/Install-Pikafish.ps1`. Pikafish engine code is
GPL-3.0, while the official Pikafish NNUE weights carry the separate usage terms
published by the [official Networks repository](https://github.com/official-pikafish/Networks#nnue-license).
