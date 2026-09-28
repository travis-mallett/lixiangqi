# Xiangqi puzzle mining

Puzzle mining runs engine analysis and candidate processing locally. Discovery
uploads completed game analyses to the website; puzzle publication remains a
separate reviewed step. The mining tools do not

serve puzzle pages or calculate puzzle ratings. Published rows use Lila's

native `puzzle2_puzzle` conventions and `/training` workflow.

## Responsibilities

### 1. Candidate discovery

```powershell

.venv\Scripts\python.exe scripts\discover-puzzle-candidates.py --max-games 10

```

Discovery uses the configured `--publication-origin` (default `https://lixiangqi.com`)
and a `puzzle:publish` token from `LIXIANGQI_PUZZLE_TOKEN` or a hidden terminal prompt.
Puzzle Studio prompts for this credential before Discovery starts. Each worker
uploads its saved analysis independently, preserving concurrent uploads and the
strictly-greater-depth replacement rule. Interrupted uploads remain queued and
are retried on the next run without repeating analysis. See
[completed game analysis publication](PUZZLE_OPERATIONS.md#completed-game-analysis-publication).

Discovery work is versioned. Re-running the same `--version` (currently `4`)

resumes only unfinished or retryable game jobs, including work whose claim

lease expired after an interrupted process. When the discovery algorithm

changes, run it with a new version, for example `--version 4`; every catalog

game is queued once for that revision while completed work for older revisions

is retained as history.

Discovery queues stable catalog references and lets workers atomically claim

them. A worker loads a source game, asks Pikafish to evaluate every position,

and compares each played move from the mover's fixed perspective:

```text

loss = expected(best from pre-move position)

     - expected(actual move's post-move position, negated back to the mover)

```

The normalized expected score is `(wins - losses) / 1000` from Pikafish's

`UCI_ShowWDL`; forced mates are the endpoints `+1` and `-1`. Pikafish fits its

WDL model to Xiangqi engine-test results and adjusts it for Xiangqi material.

The miner therefore does not reuse the chess-specific centipawn sigmoid or

chess centipawn thresholds. Lichess's current generator is still the

architectural precedent: compare winning chances, explicitly recognize mate

transitions, then require clear continuations.

The configurable defaults are:

| Setting | Default | Reason |

| -------------------------- | ------------: | ------------------------------------------------------------------------ |

| Discovery search | Depth 20, no node or time budget | Evaluates every position before candidate selection; saves complete game analysis. |

| Required loss | 0.50 | Requires a puzzle-sized 25 percentage-point swing. |

| Post-move tactic advantage | 0.55 | Ensures the solver has a clear non-mating advantage. |

| Maximum reported mate | 31 plies | Bounds later proof work while allowing substantial Xiangqi combinations. |

A transition from "not forcibly mated" to a forced mate is retained regardless

of its numeric WDL loss. If the mover's best pre-move search already reports

forced mate against them, the move is not treated as the originating blunder.

Discovery persists either `checkmate_candidate` or `tactic_candidate`.

Tactical candidates use the independent tactic verifier and double-attack categorizer described below.

Discovery shows explicit download and catalog-queueing stages, followed by a

terminal dashboard shared by live and offline runs:

```text

Puzzle discovery | Stage 3/3: evaluating games | revision 2

Input preparation complete

[################] Site games 269/269

  complete 269 | rejected 0 | failed 0

  left 0 | queued 0 | active 0 | retry 0

[----------------] Local catalogs 2,174/175,124

  complete 2,174 | rejected 0 | failed 0

  left 172,950 | queued 172,942 | active 8 | retry 0

This run: 20 completed | 34 candidates stored | elapsed 00:04:12

Bars count resolved games, including prior runs; position counters show current engine work.

Worker 1 xiangqi-games: evaluating 37/83 | g:0302...

```

These are illustrative counts. Bars use persistent terminal job states, so

starting a game or scheduling a retry never counts it as completed. The

separate run count shows successful completions since this invocation.

Each worker shows its source, game, and current position.

Queue counts refresh every five seconds. Terminals redraw in place; redirected

logs receive snapshots every 15 seconds and a final snapshot. Elapsed time is

shown instead of a speculative ETA: discovery work varies greatly by game.

### 2. Checkmate categorization

```powershell

.venv\Scripts\python.exe scripts\categorize-checkmate-puzzles.py

```

To categorize alongside a running miner, keep checking for new candidates:

```powershell

.venv\Scripts\python.exe scripts\categorize-checkmate-puzzles.py --continuous

```

Workers wait five seconds when the queue is empty, including at startup.

Use `--poll-interval 10` to change that interval (1–3600 seconds). Ctrl+C

stops the workers and their engines. Without `--continuous`, the command

exits after draining the queue.

Publication is handled separately by the authored catalog.

The terminal dashboard lists every implemented checkmate category, including

categories with zero matches. Each row shows its saved puzzle count, net change

since startup, and the split between live-site games and the local games database.

Totals include previous runs and count only current canonical matches; a puzzle

may appear in multiple categories but counts once in the overall total. The

session's checked-candidate count is separate from the collection size.

The dashboard refreshes in place, uses a compact layout in narrow terminals, and

checks collection changes at most every five seconds. Redirected output and

terminals without cursor support receive plain snapshots once per minute, plus

the final summary. Worker errors appear as individual messages. Ctrl+C leaves

the final collection summary visible after stopping the workers.

Checkmate detection is versioned independently. The same `--version` resumes

unfinished candidate work. A new version, such as `--version 2`, requeues

non-published checkmate candidates whose categorization revision is stale,

including rejected, reviewed, and untagged rows, and stores the new

verification result. Candidates remain permanent queue records. Active

published, rejected, reviewed, and untagged candidates are eligible when

their verifier revision or any per-theme logic version is stale. Complete

published evidence is classified from the stored verification ledger without

engine work. Local schema upgrades use atomic steps without automatic database

copies. Legacy generator-1 corpus databases must be rediscovered into

the current staging schema; do not pass them directly as `--database` inputs.

The categorizer atomically claims only `checkmate_candidate` rows. It reloads

the source game and verifies the recorded ply and FEN for provenance. Discovery
compares independently analyzed standalone positions before and after each move.
Both discovery and verification reset the root no-progress counter to zero and
move number to one; no source moves enter the engine search context. Verification
then appends only moves played along the current puzzle solution branch to that
fixed root, preserving the puzzle's own repetition, checking, and chasing history.
Source FENs, move numbers, game references, and publication output retain their
existing formats. Playback code is not changed by this policy.

Final verification uses one thread and depth 20 without a node budget. It
constructs one solution independently of classification. On player turns it
requests MultiPV 2 (1 for a forced move), rejecting equal best mate scores as
`ambiguous_attacking_mate`. On defender turns it requests MultiPV 1 and follows
the best move; defender ties neither reject the puzzle nor create branches.
There is no widening or branch enumeration. Mate-distance changes do not stop
construction. Previously completed solutions, including multi-branch solutions,
remain preserved and eligible for categorization.

Configurable defaults (verifier CLI):

| Setting                     | Default                                     |
| --------------------------- | ------------------------------------------- |
| `--depth`                   | 20 for every call and retry; no node budget |
| `--max-positions`           | 4,096 nonterminal positions                 |
| `--max-solution-plies`      | 31                                          |
| `--max-uncertainty-retries` | 1, at the same depth                        |

At the start of each puzzle verification and discovery game analysis, the worker
sends `ucinewgame` and waits for readiness. Searches and retries within that work
item retain the transposition table and search history. Each search still sets
its complete position context. Independent motif-removal searches reset separately. Completed results are cached under matching puzzle
root and branch history, engine/NNUE identity, and search settings.

Parent/child mate-distance disagreements remain incomplete at the fixed budget.
Limits also make coverage incomplete; partial traces cannot approve a puzzle.
Classification receives the completed verification evidence separately.

This reduced-budget traversal leaves the current verifier version (3) unchanged.
Normal verification continues to skip prior complete or conclusively invalid
assessments, regardless of their settings. Explicit reconstruction or forced
re-verification remains an operator action.

Verifier version 7 uses `isolated-root-v1` evidence. Reclassification of older
history-dependent evidence waits for new verification instead of reusing it.
Discovery version 3 requeues completed games from older revisions automatically;
older jobs and evidence remain recoverable. No database schema migration or
server deployment step is needed for this offline search-policy change.

The verifier distinguishes deterministic uncertainty (`review`) from
transient execution failure (`retry`, then `failed`). Review does not create a
negative assessment, retire a publication, or retry identical clean searches.
A new verifier/discovery/theme revision makes it eligible again. Changing only
the node setting does not itself requeue already assessed or reviewed candidates;
use a distinct `--version` for an intentional new assessment pass.
Mate scores without a terminal board are reported explicitly: Pikafish can also
encode repetition/check/chase rule wins as mate scores. Those scores alone do
not prove a basic kill. Search metadata changes alone do not rerun classifiers
when the selected move and mate distance remain unchanged.

See [the September 2026 performance investigation](PUZZLE_VERIFICATION_PERFORMANCE.md)
for measured costs, failure reproduction, and the distinction between saved
Studio budgets and CLI defaults.

`solver.py` owns search orchestration. Classifiers own terminal or sequence

recognition and any necessary piece-role proof. Persisted traces retain full

contexts, legal and selected moves, complete search results and actual budgets.

Reclassification reads them directly, including role-removal evidence; missing

role proofs can be searched separately without reconstructing a solution.

A selected-theme request still produces a complete replacement category set.

Candidates have one current verification pointer and one current classification

pointer. Later completed work is authoritative regardless of depth or nodes.

An unchanged solve keeps its publication ID; categories and verification evidence

advance on that ID. Changed solves retire the old ID and use a distinct ID, reusing
an earlier ID if that exact solve returns. Ineligible results retire without

replacement. Historical assessments remain recovery/diagnostic records only.

Timeouts, cancellation, unresolved searches, and unavailable source databases

leave current authority intact and use retry/failure scheduling.

## Checkmate matchers

Theme-specific logic versions and the automatic published-puzzle

reclassification workflow are documented in

[`XIANGQI_PUZZLE_CLASSIFICATION.md`](XIANGQI_PUZZLE_CLASSIFICATION.md).

Matchers are independent functions in `patterns.py`. Discovery and solution

generation have no knowledge of individual mating themes.

The tactic verification and classification entry points are separate:

```powershell
.venv\Scripts\python.exe -m tools.xiangqi_data.puzzle_mining.tactic_verification
.venv\Scripts\python.exe scripts/categorize-tactic-puzzles.py
```

The verifier follows PV1 from MultiPV 2 searches against best defense while
solver-turn WDL uniqueness holds. It retains the official line and endpoint evidence.
**Winning Material by Double Attack (捉双得子)** requires a newly created fork paying
off at that endpoint. **Exchanging to Win Material** requires a net gain of at least
three points measured from before the defender's setup move, then checks that at
least 75% of that gain survives five additional plies, allowing up to seven
when recovery or an unresolved exchange needs another reply. These searches use
the shared solver depth and remain category evidence. Classification never extends
or truncates the published solution. Puzzle Studio exposes
independent Start/Stop and repeat controls for each tactic and checkmate stage.

See [the pipeline specification](../tools/xiangqi_data/puzzle_mining/README.md)
for exact thresholds, endpoint rules, attack qualification, and schema v17's
removal of category-controlled endpoints.

The Centroid Pawn Attack geometry candidate requires:

1. an actual terminal checkmate or stalemate;

2. the losing general on a palace corner of its own back rank (`d1` or `f1`

   for Red, `d10` or `f10` for Black); the centered back-rank square is not a

   match because the pawn restriction is absent there;

3. a winning soldier on the exact center of that palace (`e2` against Red,

   `e9` against Black);

4. removing that soldier must open an inward general move and eliminate the

   engine-verified forced terminal win. If a forced mate remains, the soldier

   is incidental and the puzzle does not receive the theme. Centipawn results

   mean no mate was found at the configured budget. This proof is stored with

   each verified branch; older ledgers are reverified rather than reclassified

   from geometry alone.

The Octagonal Horse geometry candidate recognizes a winning horse on the

diagonally opposite palace corner from the defending general. Physical horse

removal and canonical legal move generation establish the exclusive escape

contribution; no duplicate attack implementation is used. Its current logic

version is `octagonalHorse@1.1`.

Eligible basic-kill puzzles also receive `mate` and the exact `mateIn1` through

`mateIn8` tag when applicable. These derived tags cannot independently qualify

a new checkmate candidate.

## Persistence and recovery

Mining SQLite stores source provenance, resumable jobs, candidate revisions, immutable verification assessments and derived taxonomy assessments. Its active/withdrawn proof status is local eligibility, not production publication.

Native source rows must belong to a verified production snapshot. Discovery never downloads live games itself and never reads preview MongoDB. Pass `--snapshot <directory>` to import completed production source records before discovery. Source history changes fail import instead of silently replacing proof inputs.

Local schema upgrades use atomic steps and retain completed candidate/proof records; routine initialization does not create full database copies. A failed step can resume from the last committed schema version. Legacy native rows without snapshot provenance remain quarantined until reconciled with a verified production export.

Publication is owned by the shared server puzzle module. See [Puzzle operations](PUZZLE_OPERATIONS.md) for local discovery and review, authenticated incremental publication, reconciliation, and crash recovery. Website deployment does not publish puzzle content.

Schema 11 removes strength-ranking fields and the unused candidate-level trace

copy, adds current assessment pointers, and allows multiple retired publications

per candidate with at most one active publication. The script database opener

runs the migration transactionally; the Studio viewer performs no schema work.

`tools/data_migration/20260910_puzzle_assessment_v11.py` applies the latest completed

historical result and checks referential integrity. Studio release preparation

runs the migration and reconciles retirements before admitting replacements.

Studio publishes authored additions and retirements through the live publication API.
Website deployment never transfers a puzzle inventory or mining database.
See `doc/PUZZLE_OPERATIONS.md` for the separate first-deployment metadata migration.
