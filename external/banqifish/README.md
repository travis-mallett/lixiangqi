# BanqiFish

BanqiFish is LiXiangQi’s classical Taiwanese Banqi engine for browser play and analysis. The single-threaded WASM module takes a public position and its reversible history. Only the Scala referee knows the shuffled deal and resolves a played flip. The engine requires no network weights, shared memory, server search or runtime dependencies.

## Evaluation of the temporary engine

The comparison used the modified **shipped** MistyBanqi binary, SHA-256 `85d8adb23ad76d8ef4139d33c67d7b5e2e0085a87eef177e89063979e05600c3`, and its worker, SHA-256 `7ca03ddfdb43e804918b0c12a699b0a6e90007f40e495adf3709dd1d4a322f9c`. The modified Rust core was `43058c9a6090347a256ddd5b8ec139042ba4357dc9938ce30dd35ed21f3bdeb7`. Brian Liou’s original provided probability-weighted flip search, capture extensions and an evaluator that accounted for the remaining inventory. The website adapter had already added the correct adjudication order and repetition history. [Original MistyBanqi revision](https://github.com/brianhliou/misty-banqi/tree/ad8f20262017fe7774fffdda4b5bec6ecac01fb4)

| Cost in the shipped search | BanqiFish implementation |
| --- | --- |
| The root used a full search window for every move at every depth, including every covered square. A new depth was usable only after finishing all actions. | All legal actions receive a bounded first evaluation. Capture search refines those scores. Later iterations shortlist reveals, screen ordinary moves against the requested number of principal lines, and publish completed iterations. |
| The same placement can be a second occurrence or a draw. The adapter disabled the position-only transposition table, along with its move-ordering hint. | Incremental hashes cover board, inventory and mover. A 4,096-entry table also keys the quiet clock, the multiset of reversible ancestors, search ply and remaining reveal allowance. Captures and flips start a fresh history. |
| Per-node move vectors, repeated whole-board scans, floating-point evaluation and general-purpose session machinery consumed much of the browser budget. | The freestanding C++ search uses 32-bit occupancy and role masks, precomputed adjacency and cannon rays, fixed move lists, incremental material and integer evaluation. The evaluator considers surviving hunters and prey, mobility, threats, and pursuit in sparse positions. |
| Endings were searched to a fixed maximum depth, even when only two pieces remained. | A 4 KiB retrograde table covers every open one-against-one position. It records distance to capture and respects the remaining quiet clock. If a decisive table line could encounter a twice-seen ancestor, the engine searches the supplied history. |
| The beginner used a 1,600-node search and could spend another 100,000 nodes trying to complete its first iteration. In one test game the retry still returned no move. | The beginner evaluates every legal action in at most 600 visits, then usually plays a uniformly chosen legal move. All ten levels have hard ceilings. A completed search worker can serve the next move, and releases its memory after 30 idle seconds. |

### What a flip score measures

For an expanded flip, each distinct remaining identity is searched once, with its actual multiplicity. The next player can choose a reply after seeing the identity. The opening shares results between reflected squares. Decisions deeper in a covered position consider one promising flip, or all remaining squares when at most three are covered. A line can expand two reveals at the opening or with at most three covers, and one elsewhere. Once that allowance is spent, another flip ends the tactical line at a static estimate. Captures and quiet moves still compete. Selective reveal search is especially important in this game because the number of possible outcomes multiplies the branching factor. [Chen, Shen and Hsu, *Chinese Dark Chess*](https://homes.cs.washington.edu/~armin/ICGA2010.pdf)

Analysis returns up to five principal actions. Each line carries its completed search depth. The score is from the mover’s perspective and the UI converts it to the first seat’s perspective. A soldier is worth roughly 85 score units before positional adjustments. Exact reveal probabilities come from the remaining public inventory. Search scores have no calibrated win-probability interpretation.

## Playing strength

Each shuffled deal was played twice with seats swapped. Both engines ran their shipping bot policies, with a common per-ply seed stream. The independent referee called production `Banqi.play` on the private deal. The arena compared every returned legal action with the referee’s complete list. Games ran to adjudication. A missing baseline move counts as a separately recorded forfeit.

| BanqiFish opponent | Games | Wins | Draws | Losses | Score | 95% interval |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Level 10 vs MistyBanqi 10 | 256 | 107 | 117 | 32 | 64.6% | 60.7–68.6% |
| Level 1 vs MistyBanqi 1 | 192 | 1 | 56 | 135 | 15.1% | 12.0–18.2% |

Score counts a draw as half a point. Intervals use 10,000 bootstrap resamples of **whole deal pairs**. The beginner’s one win was the retired engine’s missing-action forfeit. All 256 strongest-level games ended under the board rules. Qualification used 128 deals starting at seed 735000 for the strongest matchup and 96 starting at 831000 for the beginner. Development deals were separate. The complete run covered 1,600 games and 225,106 played plies. [Machine-readable scores, pair distributions, terminations and timings](bench/qualification.json)

### Ten bot levels

Each row compares the higher level against its immediate predecessor on 64 deals from seed 950000, played from both seats. The same deals were used across rows. Levels also vary capture extension, search depth and the score window for near-best choices. The intervals apply to individual matchups. These are computer matches. Human beginner win rates have not been measured.

| Level | Node ceiling | Uniform legal move | Wins | Draws | Losses | Higher-level score | 95% interval |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 600 | 96% | — | — | — | — | — |
| 2 | 800 | 78% | 40 | 86 | 2 | 64.8% | 60.9–69.1% |
| 3 | 1,200 | 60% | 69 | 58 | 1 | 76.6% | 72.7–80.5% |
| 4 | 1,800 | 43% | 85 | 42 | 1 | 83.2% | 78.9–86.3% |
| 5 | 2,800 | 29% | 87 | 34 | 7 | 81.3% | 76.2–86.3% |
| 6 | 4,500 | 18% | 74 | 37 | 17 | 72.3% | 66.0–78.1% |
| 7 | 7,000 | 10% | 76 | 38 | 14 | 74.2% | 68.4–79.7% |
| 8 | 11,000 | 5% | 60 | 48 | 20 | 65.6% | 59.8–71.5% |
| 9 | 17,000 | 2% | 53 | 53 | 22 | 62.1% | 56.3–68.0% |
| 10 | 27,000 | 0% | 43 | 62 | 23 | 57.8% | 52.7–62.9% |

## Speed and resources

The same 35 public positions covered the opening, early reveals, middlegame, final three covers, open play and endings. A seeded capture-first referee driver generated them independently of both engines. Each engine warmed up on the corpus and then searched every position 12 times at its shipping level 10. The order of the two engines alternated between passes. These are single-threaded Node 24.15.0 WASM measurements on a Windows x64 Core i9-13900HX. They exclude referee time, disk access and rendering. Corpus SHA-256 is `f5e6612087b1cb6301d42fc4da69d11ffa83a0344b55e5e2eaa008c3fdc4d5a1`.

| Measurement | Modified MistyBanqi | BanqiFish |
| --- | ---: | ---: |
| Median decision, 420 decisions per engine | 44.33 ms | 3.34 ms |
| 95th percentile | 74.67 ms | 6.98 ms |
| Mean process CPU per decision | 37.24 ms | 2.68 ms |
| WASM linear memory after the run | 1,152 KiB | 192 KiB fixed |
| WASM download, before HTTP compression | 97,191 bytes | 19,749 bytes |

The median decision was **13.3× faster**, CPU use per decision fell **92.8%**, and the WASM instance occupied **one sixth** of the previous linear memory. The memory measurement covers the module, including its table and stack. Browser-process memory and device energy were outside the measurement.

Edge 158 also measured real worker round trips on one mixed position with two covers. With cached HTTP assets, the median first decision on 16 newly created workers fell from **57.8 to 10.2 ms**. On 80 subsequent decisions in those workers, the median fell from **45.7 to 3.2 ms**. This measures the browser’s module loading, worker messaging and search on the verification machine.

| Median decision by phase | Modified MistyBanqi | BanqiFish |
| --- | ---: | ---: |
| Opening | 17.88 ms | 1.81 ms |
| Early | 27.53 ms | 0.17 ms |
| Mixed | 50.63 ms | 3.68 ms |
| Three covers | 59.60 ms | 4.59 ms |
| Fully revealed | 49.04 ms | 3.61 ms |
| Ending | 32.01 ms | 1.86 ms |

## Build and reproduce

Build with Clang and a matching `wasm-ld` on PATH. Set `CXX` to select a compiler. The shipped build used LLVM revision `7b58716d96c3ae4c0c4e6f72e29b16137bb6224b` from the prepared Emscripten toolchain. The normal asset build fingerprints the checked-in module, worker and licence. The C++ implementation and browser integration follow the repository’s AGPL-3.0-or-later licence.

```sh
node external/banqifish/build.mjs
node --test external/banqifish/engine.test.mjs
```

The regression suite checks the capture lattice for both first-seat colours, cannon screens, deadline precedence, repetitions, engine reuse, all level budgets, malformed inputs and opening symmetry. An independent finite-horizon minimax oracle checks the optimal two-piece score for all 3,968 ordered placements and capture-right combinations at fresh and near-deadline clocks.

All seven engine regression tests passed against both the shipped module and a byte-identical source rebuild. The production web asset build, 801 UI tests and the Windows server test and stage passed. In Edge, a level-10 bot opened a game, replied after a reload and appeared by name in the exported game. Browser tests also exercised the analysis controls, reveal probabilities and capture rails.

The benchmark requires Node 24, Java 21 and the website’s staged rules JARs (`sbt stage`). Set `JAVA` if Java is outside PATH. To compare the earlier engine, set `BANQI_BASELINE` to its archived `public/banqi-engine` directory. The referee and engine run in separate processes or workers, and search receives only public FENs. The final argument sets parallel game workers. The speed test runs the two engines sequentially on the same positions.

```sh
node external/banqifish/bench/arena.mjs fish:10 baseline:10 128 735000 8
node external/banqifish/bench/arena.mjs fish:1 baseline:1 96 831000 8
for level in $(seq 2 10); do
  node external/banqifish/bench/arena.mjs fish:$level fish:$((level-1)) 64 950000 6
done
node external/banqifish/bench/speed.mjs 12
CHROMIUM_CHANNEL=msedge node external/banqifish/bench/browser.mjs
```
