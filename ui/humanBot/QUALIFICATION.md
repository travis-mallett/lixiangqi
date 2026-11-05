# Qualification record

## Current revision: engine-deliberation-3 / xiangqi-authored-2

The previous engine-free implementation failed the user's strength tests. Its
homemade search has been removed. This revision uses live Pikafish search and
evaluation, with bounded human attention, candidate admission, preferences and
time management around that evidence. All 48 controls remain configurable.

The reported opening failures are repaired in the regression fixtures. This is
**not an Elo qualification or a claim of human indistinguishability**. The advanced
reference is a strong-search configuration; the nominal reference is an authored
prior, not a measured average human. Testing below was performed on a Windows
desktop on 3 November 2026, using Node 24.15.0 and the same WASM engine as browsers.

## Reported failures and broader opening probe

Canonical rules confirm that the complete reported sequence
`h3e3 a7a6 e3e7 b8g8 b3b6 g8f8 b6e6` is checkmate. The integration suite tests the
threat before mate, including enumeration of the opponent's legal mate-in-one
replies after the replacement bot's defense. It also tests the earlier cannon
sacrifice after `h3e3`. There are no move blacklists or opening-specific overrides.

The 15+0 advanced probe covers eight histories and eight seeds each:

| History before the bot's decision | Selected move in all eight seeds |
| --------------------------------- | -------------------------------- |
| Start position                    | `b3e3`                           |
| `h3e3`                            | `h10g8`                          |
| `b3e3`                            | `b10c8`                          |
| `h1g3`                            | `g7g6`                           |
| `c1e3`                            | `h8f8`                           |
| `h3e3 b8b1 a1b1`                  | `b10c8`                          |
| `h3e3 a7a6 e3e7`                  | `h10g8`                          |
| `h3e3 a7a6 e3e7 b8g8 b3b6`        | `c7c6`                           |

Across these **64 decisions**, elapsed computation was **488–720 ms** (median
648 ms). Modeled thinking time was **2.46–3.29 seconds** (median 2.90 seconds).
The policy/rules work outside the timed engine calls had median **49.6 ms** and
maximum **79.1 ms**. Engine timings themselves include conversion and canonical
PV validation, so these are boundary measurements, not an isolated profiler of
personality code. Engine time and modeled thought overlap; they are not added
together before submitting a move.

A separate native Pikafish process evaluated unrestricted and selected roots at
100,000 nodes. The nonnegative difference between those reported scores had
median **1.5 cp**, maximum **12 cp**, and **0/64** gaps above 100 cp. These are
diagnostic estimates: restricted/unrestricted searches allocate their nodes
differently, can return different scores for the same move, and share the same
underlying evaluator as the bot. They are not independent human-strength evidence
or exact losses. No coefficients were fitted to these labels.

The identical moves across seeds also limit what this probe establishes: a
maximum-skill, mostly neutral profile is consistent here. This does not establish
human-like diversity. Credible alternatives, style variation at matched strength,
opening frequencies and response-time/error distributions need separate testing.

## Longer runs and control interventions

The completed laboratory run recorded **778 decisions**:

| Elapsed computation | Milliseconds |
| ------------------- | -----------: |
| Median              |       179.17 |
| 95th percentile     |       671.75 |
| 99th percentile     |       828.13 |
| Maximum             |       966.98 |

This mixture includes 13 fixtures, 64 advanced probes, 72 opening samples, 405
scalar interventions and 224 bot decisions in two diagnostic games. Timings are
wall elapsed time on this desktop, not process CPU accounting or a mobile claim.

- An attacker-family self-play game ended with Black resigning at recorded ply 144. Neither side exhausted its 15-minute clock.
- Advanced Red versus native 100,000-node Pikafish reached the **160-ply diagnostic
  limit** without a runtime failure. This unfinished game is not a draw or a
  win/loss strength result. It supplies no Elo estimate.
- The 72 opening samples at C01 = .25/.5/.75 all selected development moves,
  with zero immediate captures. This small sample has no human reference rate.

All 45 scalar controls were varied at three values across three fresh positions;
the three structured controls have separate compiler/population tests. **28/45**
scalars changed the recorded action, evidence, preference, effort or time. These
fresh-position probes did not exhibit changes for:

`A04`, `C06`, `S08`, `P01`, `P02`, `T01`, `T04`, `X03`, `X04`, `X06`, `X07`, `X08`,
`E01`, `E03`, `E04`, `E05`, `E07`.

Many require a specific opportunity: earlier focus, a setback, fatigue, urgency,
an actual draw, an anticipated reply or a rare slip. Targeted tests cover selected
opportunities, including preparation, forcing familiarity, clock urgency and
temporary-state recovery. Neither an unchanged sweep nor a changed trace proves
human validity or identifies a parameter causally. Engine node polling and device
deadlines can also affect completed search depth.

## Runtime and evidence integrity

The adapter uses pinned `Pikafish-2026-09-06`, WASM digest prefix `8f1b7bfea842`,
and NNUE digest prefix `7d13d73569a9`. It runs one search thread and a 16 MiB hash
table. C01 proposes 2,048–131,072 nodes per decision, shared across at most three
calls; the default scheduling ceiling is two seconds. Native node polling can
overshoot slightly. Stop acknowledgement and canonical validation can extend
elapsed work beyond that scheduling target; the authoritative clock is still
enforced. No engine call is made for each individual cognitive event.

Two protocol defects exposed by longer testing now have focused regressions:

1. A same-depth MultiPV update must not combine a promoted first move with stale
   slots from the previous batch. The shared parser now publishes coherent,
   distinct-root batches.
2. A bounded search may report a new best move before publishing its score. The
   adapter keeps the last completed scored set when necessary, marks
   `unscoredBest`, and raises uncertainty. It never invents that missing score or
   combines incomparable iterations to create extra style choices.

Engine errors, missing scored evidence, illegal variations and missed deadlines
remain explicit failures. They do not activate the deleted handmade evaluator.
Async session tests cover duplicate proposals, cancellation, no late commits,
exact receipts, serialization and engine-version-pinned pending recovery.

Streaming NNUE decompression reduced measured WASM allocation from approximately
**460.69 MiB to 319.88 MiB**, without changing the evaluator, search or weights.
The smoke test checks two-thread initialization/search as well as early and late
truncated network rejection. The compressed network is **50,706,378 bytes**.
Browser/JS/rules memory and the downloaded buffer add to WASM allocation.

**Low-memory mobile qualification remains outstanding.** A desktop browser at a
390-pixel viewport is not a phone. Main-page CPU emulation does not reliably
throttle engine workers. Physical Android/iOS testing must cover memory pressure,
background suspension, battery, sustained play and startup/download behavior.
The current build requires cross-origin isolation, shared memory and WASM SIMD.
It fails explicitly when those requirements are missing.

## Browser checks

Chromium, Firefox and WebKit each passed at widths 1440, 768 and 390. The checks
cover initialization before clocks, the opening regression, the mating threat,
pending retry and recovery, exact acceptance, maximum-capacity work, cancellation,
and an explicit failure when isolation is absent. A main-thread heartbeat
continued in all nine contexts. Each run closed its workers, browser and server.

| Browser  | Startup, ms | Advanced opening computation, ms | Stress computation, ms |
| -------- | ----------: | -------------------------------: | ---------------------: |
| Chromium | 1,636–1,692 |                          666–696 |                672–705 |
| Firefox  | 2,332–2,448 |                      2,404–2,453 |            2,069–2,468 |
| WebKit   | 2,240–2,454 |                      2,234–2,332 |            2,280–2,321 |

These browser runs were sequential. Firefox/WebKit reached time stops and
completed less search than Chromium; their legal opening choices consequently
varied. Thus a shared profile/node target does not guarantee identical strength
across devices. Startup was measured from a local server and is not a cold
internet download measurement. All runs reported 319.875 MiB of WASM allocation.

The worker bundle is 61,930 bytes (22,582 gzip), plus canonical rules of 1,100,139
bytes (169,681 gzip), engine JS/WASM and the full NNUE. Serialized state in these
examples is roughly 23 KiB; this is not a heap measurement. Raw reports are
`.tools/human-bot-v3-{chromium,firefox,webkit}.json`.

## Verification and reproduction

| Scope                    | Command / result                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Formatting and lint      | `pnpm format`, `pnpm run lint`, `pnpm run check-format`: passed                                                     |
| Standalone build         | `node tools/human-bot/build.mjs`: Scala formatting, canonical rules linking and TypeScript passed                   |
| Core and shared protocol | `node ui/.test/runner.mjs humanBot lib`: 199 passed                                                                 |
| Real-engine integration  | `node --import tsx --test tools/human-bot/integration.test.ts`: 27 passed                                           |
| Engine rebuild           | Emscripten 5.0.7 build with exact corresponding source archive: passed                                              |
| Engine runtime           | `node scripts/pikafish-web/smoke.mjs`: passed                                                                       |
| Asset publication        | Python unittest discovery in `scripts/pikafish-web/tests`: 2 passed                                                 |
| Pinned installation      | Python unittest discovery in `scripts/pikafish/tests`: 9 passed                                                     |
| Laboratory               | `node --import tsx tools/human-bot/lab.ts --oracle --sweep --games 2 --out .tools/human-bot-v3-lab.json`: completed |
| Production assets        | `bash -lc './ui/build --no-install -p'`: passed                                                                     |
| Full frontend suite      | `node ui/.test/runner.mjs` (Windows equivalent of `./ui/test`): 694 passed                                          |
| Browser worker           | Chromium, Firefox, WebKit; three viewport widths each: passed                                                       |
| Desktop player           | Four Python GUI/protocol tests passed; both version-3 JSON profiles regenerated and validated                       |

The raw local lab report is `.tools/human-bot-v3-lab.json`; command logs use the
same prefix. The source archive is checked against its current build inputs.
Dependency/cache and localhost checks requiring access outside the desktop
sandbox were rerun with that access; sandbox permission failures were not counted
as passing tests.

Hosted Linux CI/CodeQL, container publication, physical-device testing, deployment
and population rating were not run. The existing Scala rules remain canonical;
this revision adds no backend runtime or data migration. The deployment asset
pipeline already includes verified engine assets, licenses and corresponding
source. No matchmaking, accounts, production integration or training was added.

See [README.md](README.md) for contracts and reproduction, and
[CONTROLS.md](CONTROLS.md) for each control's implemented mechanism and limits.
