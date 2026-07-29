# Xiangqi puzzle mining

Puzzle mining is an offline, two-stage data-production pipeline. It does not
serve puzzle pages or calculate puzzle ratings. Published rows use Lila's
native `puzzle2_puzzle` conventions and `/training` workflow.

## Responsibilities

### 1. Candidate discovery

```powershell
.venv\Scripts\python.exe scripts\discover-puzzle-candidates.py --max-games 10
```

Discovery work is versioned. Re-running the same `--version` (currently `1`)
resumes only unfinished or retryable game jobs, including work whose claim
lease expired after an interrupted process. When the discovery algorithm
changes, run it with a new version, for example `--version 2`; every catalog
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

| Setting                    |       Default | Reason                                                                   |
| -------------------------- | ------------: | ------------------------------------------------------------------------ |
| Fast screen                |  40,000 nodes | Cheap enough for full-game scanning; intended for recall.                |
| Screen loss                |          0.35 | Admits a 17.5 percentage-point win-minus-loss swing to deep validation.  |
| Deep validation            | 600,000 nodes | Rechecks both sides of the move independently before persistence.        |
| Validated loss             |          0.50 | Requires a puzzle-sized 25 percentage-point swing.                       |
| Post-move tactic advantage |          0.55 | Ensures the solver has a clear non-mating advantage.                     |
| Maximum reported mate      |      31 plies | Bounds later proof work while allowing substantial Xiangqi combinations. |

A transition from "not forcibly mated" to a forced mate is screened regardless
of its numeric WDL loss. If the mover's best pre-move search already reports
forced mate against them, the move is not treated as the originating blunder.

Deep validation persists either `checkmate_candidate` or `tactic_candidate`.
Tactical candidates intentionally have no categorizer yet.

The command continuously updates one terminal line while queueing and mining:

```text
[####--------------------] Checking game 41,203/232,195  checkmate: 318  tactic: 7,904  stored: 8,011  duplicate: 211  rejected: 3  retry/failed: 1  dpxq:42 screening position 37/83
```

When output is redirected to a log, it emits a fresh progress line at least
every five seconds instead of using carriage-return animation.

### 2. Checkmate categorization

```powershell
.venv\Scripts\python.exe scripts\categorize-checkmate-puzzles.py
```

Checkmate detection is versioned independently. The same `--version` resumes
unfinished candidate work. A new version, such as `--version 2`, scans every
checkmate candidate again—including previously published, rejected, reviewed,
and untagged rows—and stores the new verification result. Bump the relevant
script's default version when changing its detection algorithm so ordinary
runs automatically use the new revision.

The categorizer atomically claims only `checkmate_candidate` rows. It reloads
the source game, verifies the recorded ply and FEN, and sends Pikafish the
complete source prefix followed by a synthetic solution. Keeping that history
in the UCI `position ... moves ...` command preserves Pikafish repetition and
long-check handling; later moves from the recorded game are never used.

The default proof search is two million nodes per position, MultiPV 2 at
attacking nodes, and MultiPV 4 at defensive nodes. The first and subsequent
attacking moves must be a unique shortest mate or exceed the second choice by
`0.40` normalized expected score. Defensive nodes follow Pikafish's best
defense. Exact co-best mate defenses inside MultiPV are forked, up to eight
terminal branches.

This command likewise reports the current candidate, synthetic solution
branch and ply, plus cumulative `published`, `untagged`, `review`, `rejected`,
`retry`, and `failed` counts for the entire run.

Every branch must end in an actual checked position with no legal moves.
Solution length is stored from the generated coordinate line in plies; the
displayed `M<number>` is only an early bound. If deeper analysis no longer
reproduces mate, the candidate is rejected with a diagnostic. Transient engine
or database errors use the retry state and become diagnostic failures after
the configured attempt limit.

## Checkmate matchers

Matchers are independent functions in `patterns.py`. Discovery and solution
generation have no knowledge of individual mating themes.

The only current matcher, `is_centroid_pawn_mate`, requires:

1. an actual terminal checkmate;
2. the losing general on its own back rank (`rank 1` for Red, `rank 10` for
   Black);
3. a winning soldier on the exact center of that palace (`e2` against Red,
   `e9` against Black).

Every engine-verified mate is promoted with `mate` and exactly one normal,
capped length theme: `mateIn1`, `mateIn2`, `mateIn3`, `mateIn4`, or `mateIn5`
(five or more attacker moves). Any matching geometric theme, such as
`centroidPawnMate`, is added alongside those tags. If co-best defenses produce
different geometric matcher results, only their shared geometric themes are
kept; the generic mate-length themes remain valid.

## Persistence and recovery

The shared staging database is `data/local/xiangqi-puzzle-mining.sqlite3`.

- `game_jobs` stores catalog references, discovery version, and claim state.
- `analysis_cache` keys results by full history hash, engine/NNUE, and settings.
- `candidates` stores the source reference, ply, pre/post FEN, position hash,
  moves, fixed-perspective scores, classification, engine identity, settings,
  solution branches, diagnostics, and the checkmate categorization version.
- `puzzles` stores only promoted native puzzle rows.

Claims use `BEGIN IMMEDIATE`, opaque claim tokens, and expiring leases.
Candidate keys hash the normalized post-blunder position together with its
repetition-relevant source prefix, so reruns are idempotent without merging
positions that have different repetition or long-check histories. Source games
remain in their independently owned catalog databases; the staging database
never duplicates complete games.

On local startup, `puzzle_sync` promotes accepted staging rows into Lila's
MongoDB puzzle collections. Do not point public puzzle controllers at SQLite.

## References

- [Lichess accuracy and winning chances](https://lichess.org/page/accuracy)
- [Current Lichess puzzle generator](https://github.com/ornicar/lichess-puzzler/blob/master/generator/generator.py)
- [Pikafish WDL implementation](https://github.com/official-pikafish/Pikafish/blob/master/src/uci.cpp)
