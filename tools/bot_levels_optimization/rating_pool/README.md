# Self-play Elo pool

## Compare adjacent production levels

To measure the current production bots directly, run the isolated adjacent-level
experiment. It uses the exact Level 1–9 worker profiles, including the MultiPV
and weaker-move sampling fade in Levels 1–8, plus the same opening-book fade as
live games. Each neighboring pair plays 1,000 games by default: 8 pairs and
8,000 games total. Colors alternate each game so every pair has an even number
of games with each level playing Red. Ratings and full game records are saved
separately from the ordinary pool and the previous A–I experiment.

```powershell
.venv/Scripts/python.exe -m tools.bot_levels_optimization.rating_pool.middle_neighbors
```

Resume the same experiment with the same game count. Use an even
`--games-per-pair` value of at least 2 and `--concurrency` from 1 through 16.
The default concurrency is 16; lower it on machines with limited memory.

```powershell
.venv/Scripts/python.exe -m tools.bot_levels_optimization.rating_pool.middle_neighbors --games-per-pair 1000 --concurrency 4
```

Results go to `runs/pool-adjacent-levels-1-9-v1.sqlite3`. The runner does not
start automatically; launch it when the local game catalog and staged native
rules are ready.

## Ordinary Elo self-play pool

This is a separate, ordinary player pool. It does not use the nine-level
calibrator, opening suites, paired games, fitted strengths, or rating anchors.
All bots begin at 1500. Endpoints participate and gain/lose Elo normally.
Ratings describe this pool only, not human xiangqi ratings.

## Run

From the repository root, use the existing Python environment, installed
Pikafish/NNUE, Java 21 and current staged native rules JARs. See the parent
README for the SBT `stage` command if those JARs are missing or stale.
The existing local master games catalog must be available (`LIXIANGQI_GAMES_DB`
can override its location). The pool calls the explorer's existing read-only
master-book query directly and passes its results into the unchanged production
book fade/selection algorithm. No explorer HTTP service, web app, MongoDB or Redis
is required. Start the pool:

```powershell
tools\bot_levels_optimization\bot-rating-pool.cmd --bots 5000 --games 100000 --concurrency 16
```

The equivalent portable entry point is
`python -m tools.bot_levels_optimization.rating_pool`. `--pool PATH` selects a
different SQLite file; default is `tools/bot_levels_optimization/runs/pool.sqlite3`.
It never writes production profiles or user games. Existing files require
`--resume`; a new run requires a new path.

```powershell
tools\bot_levels_optimization\bot-rating-pool.cmd --resume --games 100000 --concurrency 16
```

`--games` is the **total completed-game target**, including games already saved.
Increase it to keep the same pool playing. Failed/censored attempts do not count.
Ctrl+C stops scheduling and interrupts workers at their next move boundary;
in-progress searches finish or hit the existing search timeout first. Their
pending plans are retried with the same identities/seeds on resume.

Options: `--k 32`, `--window 100`, `--seed 20261003`, `--max-plies 600`,
`--max-failures 20`, `--full-logs`, `--java`, `--class-path`.
Pool size, seed, K, matchmaking window and move cap are saved and
cannot change on resume. Concurrency, target, failure limit and log verbosity can.

## Straightforward mechanics

- The two exact endpoint profiles are included. Other candidates independently
  sample nodes uniformly in log space from 149 to 3,318,000, MultiPV uniformly
  from 1 to 16, expected rank uniformly from 1 to min(9, MultiPV), and loss
  threshold as an integer from 0 to 600 cp. Duplicate setting tuples are rejected.
- This intentionally does not assume that any setting combination lies between
  the endpoint bots in measured strength. Candidates may rate outside that span.
- The least-played available bot seeks a random opponent within ±100 Elo.
  The window doubles until someone is available. Previous opponents are avoided
  when another nearby opponent exists. Colors are randomly assigned independently
  for every game. A bot plays at most one game at a time.
- All games start at the normal initial position. The production master-book
  fade and production probability selection run unchanged. In particular, the
  pool does not apply the calibrator's intermediate-candidate normalization.
  Rank 1 uses the existing best-move branch; MultiPV/loss settings have no effect
  in that branch. Both exact endpoints retain their original behavior.
- Completed native-rule results update both players immediately with standard
  Elo, divisor 400 and constant K. Only the coordinator updates ratings.
  Completion order is recorded because concurrent Elo updates are order-sensitive.

Each worker retains one private Pikafish and one private native-rules JVM,
reusing them sequentially. Pikafish searches use one thread, 128 MiB hash and
the production hash-clearing behavior. Concurrency is capped at 16; the JVM
heap is capped at 512 MiB per worker and its processor count at one. At 16 workers,
configured engine hashes plus maximum JVM heaps total **10 GiB**, with additional
NNUE, executable and JVM overhead. Reduce concurrency on smaller machines or
if load causes production search timeouts. There is no nested game executor.

## Persistence and reproducibility

The book query uses the same database, master-only eligibility, move counts and
ordering as the application explorer; no positions are preselected for testing.

SQLite commits each pending plan before dispatch and each result together with
both updated players in a single transaction. WAL permits concurrent read-only
reports; a separate SQLite lock prevents two writers. Do not copy only the main
database while it is running: use SQLite backup or stop the runner before copying.

Every attempt retains IDs, Red/Black profile references, game ID/seed, outcome,
status, ply count, final position and failures. Profiles are immutable and remain
in the same database. Full move lists are optional (`--full-logs`). Actual master
book responses used by each game are always retained as compressed metadata,
so later changes to the master database do not prevent replay. The manifest
records source, engine, NNUE, Java and native JAR hashes. Retain those artifacts;
hashes identify them but do not back up their contents. Resume and replay reject
changed runtime artifacts.

```powershell
tools\bot_levels_optimization\bot-rating-pool.cmd --replay-game 123
```

Replay prints the full move list and whether outcome, final position and ply
count match. It uses saved book responses without querying the explorer and
never updates Elo. Transient infrastructure failures need not reproduce.

Engine crashes, missing/illegal output, book failures and timeouts are excluded.
A game still ongoing at `--max-plies` is censored, not declared drawn. By default
20 excluded attempts in one invocation stop scheduling to avoid an endless
failure loop. Native draws, including repetition adjudication, count normally.

## Reports, available while running

```powershell
tools\bot_levels_optimization\bot-rating-pool.cmd --export tools/bot_levels_optimization/runs/ratings.csv
tools\bot_levels_optimization\bot-rating-pool.cmd --select-levels tools/bot_levels_optimization/runs/levels-720.csv
```

Export sorts highest Elo first and prints counts, range, games-per-bot statistics
and current lowest/highest rated profiles. Level selection fixes the two endpoint
identities at levels 1 and 720, divides their current Elo span into 719 equal
target intervals, and greedily chooses the nearest unused candidate for each
interior target, breaking ties by ID. It requires at least 720 candidates and a
positive endpoint span. `--levels` permits smaller evaluation reports.

The CSV includes actual Elo, target, signed error, games and all engine settings.
Its `.summary.json` explicitly reports gaps greater than `--gap-threshold 25`,
distant targets, selected bots with zero games, rating reversals and candidates
outside the endpoint span. Unique-candidate selection can produce reversals or
poor matches in sparse regions; these are reported rather than hidden or fitted
away. Ratings remain noisy, especially with few games. For example, 100,000 games
among 5,000 bots average only 40 games per bot. This is an evaluation proposal,
not an optimized or automatically deployed ladder.
