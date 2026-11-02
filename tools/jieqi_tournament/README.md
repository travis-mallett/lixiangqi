# Jieqi engine tournament

This runner measures the **shipped WebAssembly builds** of AB-JChess, jqe and PikaJieQi in Node.js 24. It uses LiXiangQi's staged native Jieqi rules as the referee. It does not start the website, contact production, or use a database.

From the repository root on Windows:

```powershell
.\tools\jieqi_tournament\run.cmd
```

The default is **100 independent hidden-piece deals, 600 games total, 1 second per move, 16 simultaneous games**. Each engine plays 400 games, equally divided between its two opponents and between colors. For example, 150 plies per game would require 25 hours of serial search, or about 94 minutes with 16 fully utilized workers, plus startup/referee overhead. An 80-ply average would be about 50 minutes. Progress includes elapsed time and an estimated time remaining, which fluctuates especially near startup and completion.

Use a quiet computer on AC power. Close CPU-heavy applications and deployment/build jobs. Sixteen workers mean at most 16 engines thinking at once, each with one search thread. Each worker keeps three engine processes and one referee available, so memory use also rises with concurrency. Reduce `--workers` if this competes with other work; simultaneous games and thermal throttling still affect wall-clock comparisons.

For a shorter, separate experiment:

```powershell
.\tools\jieqi_tournament\run.cmd --quick --workers 16
```

This uses **30 deals, 180 games, 250 ms per move** and writes to `.tools/jieqi-tournament/quick/`. At an 80-ply average, the idealized search time is about four minutes with 16 workers; startup, slow games and hardware contention add to that. This measures a faster time control and is kept separate from the one-second results. Resume it with `--quick --resume`. The engines may rank differently at different thinking-time budgets.

## Requirements and settings

- Node 24, Python 3.11 or later, Java 21, and the repository's installed pnpm dependencies (for PNG rendering).
- Built engines/networks in `public/jieqi-engine/`.
- A current `target/universal/stage/lib/` from SBT `stage`. The runner refuses a rules JAR older than its Scala sources. The repository's bundled Java is discovered automatically.
- The Windows launcher prefers `.venv\Scripts\python.exe`. Other platforms can run `python -m tools.jieqi_tournament.run` from the root.

Example with explicit settings and a named output directory:

```powershell
.\tools\jieqi_tournament\run.cmd --deals 100 --movetime 1000 --workers 16 --seed 20261102 --out .tools/jieqi-tournament/main
```

`--movetime` is milliseconds **per move**, not a total game clock. All engines receive the same budget, 64 MiB hash, one thread and MultiPV 1. Optional flags include `--hash-mb`, `--max-plies`, `--node` and `--java`. Engine time-management/clock-check granularity can cause small deviations; every measured elapsed time and UCI search report is saved.

## Fairness and rules

For each seed-derived deal, all three unordered engine matchups play twice with colors exchanged. The hidden arrangement stays fixed between those games. Matchup order is deterministically shuffled to reduce systematic time/order effects. The engine receives only the public board and remaining inventory, plus the referee's legal root moves. The secret deal goes only to the native referee.

The native rules decide reveals, concealed captures, checking/chasing restrictions, repetition, no-capture draws, checkmate and stalemate. Captured concealed identities remain unknown to both engines. No copied Python rules, score-based resignations, or evaluation-based draw adjudication are used. Search below the root still uses each engine's own rule model, as in the site's engine integration.

Each engine gets ten 100 ms warmup searches outside the measurement. All workers finish initialization and warmup before any measured game starts. `ucinewgame` is sent before every game. Equal time measures the combined search/evaluation implementation, including its WebAssembly performance. It is not a comparison at equal nodes or search depth and is not a native-executable ranking.

The default hard guard is 1,000 plies. A game that reaches it is **censored, never called a draw**. Crashes, missing moves and illegal moves stop the run and save a diagnostic attempt; they are never scored as losses. The aggregate chart only includes complete six-game deals, preserving equal opposition even during a partial run.

## Stopping and resuming

For an unlimited run with 16 workers:

```powershell
.\tools\jieqi_tournament\run.cmd --continuous --workers 16
```

This saves records in `.tools/jieqi-tournament/continuous/`. Press Ctrl+C once to stop and preserve completed games. No report or chart is calculated automatically. Resume with `--continuous --resume`. Each new deal still contains all six color matchups; incomplete deals are excluded from the later aggregate report.

Calculate results afterward:

```powershell
.\tools\jieqi_tournament\run.cmd --continuous --report
node tools/jieqi_tournament/render.mjs .tools/jieqi-tournament/continuous
```

Press Ctrl+C once. The runner stops its own engine/referee children and preserves completed games and the interrupted attempt. Repeat the original command with `--resume`:

```powershell
.\tools\jieqi_tournament\run.cmd --resume
```

Resume loads the saved experiment settings automatically; specify `--out` for a custom folder. Worker count defaults to 16 and can be changed with `--workers`; every invocation records its concurrency in `manifest.json` under `sessions`. The initial config's worker count describes the original run. Engine time, hash size, number of deals and seed cannot change within an experiment. The runner verifies Node/Python versions and SHA-256 hashes of engines, networks, runner, native sources and staged dependencies. A failed attempt is retained separately when its game is retried.

After a referee or tooling fix, audit the existing games before resuming:

```powershell
.\tools\jieqi_tournament\run.cmd --revalidate
.\tools\jieqi_tournament\run.cmd --resume --workers 16
```

Revalidation plays no new games. It first saves a checked ZIP of the original directory in a sibling `main-backups/` folder, then replays every saved game through the current referee and compares every public state, legal-move set, engine input, result and termination. Only a successful audit updates the manifest, retaining the original manifest in the backup and recording the audit. It refuses changed engines, weights, runtimes or experimental settings. If game semantics changed, use a new experiment; do not discard old results or force them into the new one.

An exclusive `run.lock` prevents two instances from writing to the same folder. Normal exit removes it. After a forced shutdown, verify the PID recorded in that file is no longer running before removing the stale lock.

Exit code 0 means every planned deal completed; 2 means interrupted/incomplete/censored; 1 means an error. A resumed run retains games already recorded as censored; choose a higher ply guard in a new experiment if necessary.

## Results and chart

The default folder is `.tools/jieqi-tournament/main/`:

- `manifest.json`: settings, runtime/host information and exact artifact hashes.
- `games/*.json`: hidden deal, colors, full move history, public states, UCI requests/responses, timing and native result.
- `attempts/*.json`: interrupted or failed games, excluded from statistics.
- `summary.json`: aggregate and pairwise wins/draws/losses, score, win rate and uncertainty.
- `results.svg` and `results.png`: chart generated entirely from the recorded results. No chart is created without a complete six-game deal.

**Score percentage** is `(wins + 0.5 × draws) / games`; **win rate** is `wins / games`. The chart labels score percentage and prints the separate W/D/L counts. It uses a zero-to-100% axis. Its 95% percentile-bootstrap intervals resample whole independent deals, keeping all six correlated games together, with 10,000 deterministic resamples. Small samples and uniformly identical results can make bootstrap intervals unreliable. Fewer than 30 deals, or any unfinished plan, is marked preliminary. Marginal intervals alone do not establish statistically significant differences between engines.

Recompute the statistics and SVG without playing games:

```powershell
.\tools\jieqi_tournament\run.cmd --report
node tools/jieqi_tournament/render.mjs .tools/jieqi-tournament/main
```

The second command refreshes the PNG. Preserve the complete result directory if using its chart in a blog. Report the time control, runtime, number of deals/games, engine/network hashes, and any exclusions. Do not call these human Elo ratings or claim universal strength. Do not change the test budget or keep rerunning seeds to obtain a preferred winner.

## Verification

```powershell
python -m unittest tools.jieqi_tournament.test_tournament
.\tools\jieqi_tournament\run.cmd --deals 2 --movetime 20 --workers 2 --out .tools/jieqi-tournament/smoke
```

The second command exercises all ordered engine matchups, complete games, native adjudication and chart output with a deliberately tiny time budget. Keep that **smoke-test directory separate** from measurements intended for publication. No tournament runs automatically when the module is imported or the website is built.
