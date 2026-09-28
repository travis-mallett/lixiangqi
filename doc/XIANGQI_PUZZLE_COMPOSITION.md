# Automatic quadruple-checkmate composition

`scripts/compose-quadruple-puzzles.py` constructs puzzles without supplied puzzle
positions or human decisions. It generates checking geometries, searches backward,
restores captured pieces, closes defensive escapes, and certifies the results with
the existing native Pikafish rules, puzzle solver, and theme classifier.

This is an offline composer. It exports explicitly composed puzzles and never
writes to the game corpus, puzzle database, or publication queue. No deployment
or data migration is involved.

## Run

From the repository root, with the existing Python environment and native Pikafish:

```powershell
.venv\Scripts\python.exe -X utf8 scripts/compose-quadruple-puzzles.py --output .tools/quadruple-composer/batch-01 --mates 2,3,4 --per-length 1 --seconds 900
```

Generate another batch while excluding earlier endings:

```powershell
.venv\Scripts\python.exe -X utf8 scripts/compose-quadruple-puzzles.py --output .tools/quadruple-composer/batch-02 --mates 2,3,4,5 --per-length 2 --seed 9173 --seconds 1800 --exclude .tools/quadruple-composer/batch-01/puzzles.json
```

An output directory must be new or empty. `--exclude` can be repeated; use it for
every earlier collection whose endings should remain distinct. Seeds select
procedural search order, not stored example positions. Engine version and time
budgets can affect the resulting batch even with the same seed.

Mate in N means N moves by Red, ending on ply `2N-1`. Exported moves use LiXiangQi's
`a1` through `i10` coordinates, not native UCI ranks 0 through 9.

| Option                   | Default            | Meaning                                                |
| ------------------------ | ------------------ | ------------------------------------------------------ |
| `--mates`                | `2,3,4`            | Requested lengths, each between 1 and 15               |
| `--per-length`           | `1`                | Desired count at each requested length                 |
| `--seed`                 | `20260922`         | Reproducible procedural search order                   |
| `--seconds`              | `900`              | Overall time budget, including verification            |
| `--seed-seconds`         | `40`               | Backward extension budget per seed                     |
| `--max-seeds`            | `1000`             | Maximum yielded seed variants considered               |
| `--beam`                 | `5`                | Number of competing backward continuations retained    |
| `--screen-nodes`         | `4000`             | Cheap candidate search; never the final certificate    |
| `--depth`                | `20`               | Existing canonical verifier's search depth; minimum 20 |
| `--exact-through`        | `2`                | Also exhaustively prove mates up to this length, 0–3   |
| `--verification-seconds` | `300`              | Per-candidate verification budget                      |
| `--tail-plies`           | `5`                | Odd ending-window length, at least 3                   |
| `--engine`               | installed Pikafish | Native engine executable                               |

The native engine uses one thread and 64 MiB of hash. Caches are bounded. Wider
beams improve coverage at a higher cost. Longer targets may require much larger
budgets; accepting a requested length is not a promise to find it.

## Construction and acceptance

1. Enumerate two horses sharing a blocked leg, a moving rook or crossed pawn,
   and a cannon. Move the blocker to give a direct check and provide a cannon
   screen while uncovering both horses. Vary palace square, directions, checker
   material, and supporting placement. There are no hardcoded example FENs or
   solution sequences in the generator.
2. Use native legal moves to retain unique mate-in-one seeds. Search ordinary
   defending material to block any remaining general escapes.
3. Extend backward by a defender move and an attacker move. Reverse captures can
   restore missing enemy pieces within material and territory limits. Added
   blockers must survive the entire known continuation without disrupting it.
4. Screen for the requested mate distance and an untied best move, retain a bounded
   beam, and repeat until the requested length or search budget is reached.
5. Run the existing history-aware puzzle solver at depth 20 or higher. Require a
   complete result with exactly one shortest constructed solution, exactly the
   proposed sequence, and **one legal defender reply at every defensive turn**.
6. Replay the full history with the native rules authority. Require actual
   checkmate, no legal final reply, and the canonical `quadrupleCheckMate`
   classifier's four distinct checking pieces. Reject incomplete verification.

The final policy permits slower winning attacker moves. It requires one best
attacker move and no defensive branching along the accepted shortest line.

### Proof strength

Every result carries its verification method. `canonical_engine_verifier` uses
the project's finite-depth engine policy for attacker optimality and uniqueness;
it is **not an exhaustive mathematical proof** of those properties. The legal
solution, forced defensive replies, and four-check terminal are directly checked.

By default, mate-in-one and mate-in-two results additionally receive
`exhaustive_bounded_minimax`: all legal attacker alternatives and defender replies
are searched through the target horizon, including quiet moves and stalemate wins.
`--exact-through 3` requires this stronger proof for mate in three as well. It can
take substantially longer. The exhaustive option is deliberately limited to five
plies from a fresh root; longer positions use the history-aware canonical verifier.

### Diversity

Acceptance compares all selected puzzles and all `--exclude` collections:

- Normalize file reflection and winning color.
- Allow only one puzzle per checking-piece geometry and general palace square.
  Cannon distance on the same ray and unrelated extra pieces do not create a new
  geometry. This is deliberately stricter than treating different close defenders
  as enough variety.
- Compare the final five plies, or the entire shorter puzzle if it has fewer.
  Tokens include moving/captured piece types and squares relative to the final
  general. Thus a longer prefix, board translation, reflection, or remote added
  piece cannot disguise a reused ending.

The composer may use several lengths internally from one seed, but exports only
one of them, prioritizing the longest still-needed length. This excludes a mate in
ten that simply contains an already exported mate-in-three ending. Because the
geometry policy is strict and the search family is finite, quotas can become
unattainable after enough batches; the tool reports that rather than weakening
the diversity criteria.

## Files and failure behavior

- `puzzles.json`: accepted FENs, moves, every replay position, checkers, defense
  counts, diversity keys, construction events, canonical analysis, and verification
  method. Provenance is `algorithmically_composed`.
- `run.json`: configuration, composer source digest, native engine/network
  fingerprints, requested/achieved counts, elapsed time, counters, and run status.
- `events.jsonl`: progress, acceptance/rejection reasons, and budget events.

JSON snapshots are atomically replaced after acceptance. Completed results survive
a later timeout or interruption. Exit 0 means all requested quotas were filled;
exit 2 means partial/exhausted, timed out, interrupted, or a handled engine failure.
An unexpected exception records `failed` and then propagates. Engine cleanup runs
in either case. Engine shutdown also releases its pipes and output reader so
repeated timed work does not accumulate handles.

## Scope and limits

This version searches a useful subset: Red attacks throughout with checks;
escape repair adds static defenders on otherwise empty general destinations;
material and territory are legal; every accepted forward move is native-validated.
It does not enumerate all possible quadruple-check compositions, optimize beauty,
or prove that the initial position is reachable from the ordinary starting array.
Exports explicitly mark `opening_reachability_proved: false`. These are composed
puzzles, never claimed to be historical games.

The first unattended batch generated distinct mates in two, three, and four in
36 seconds on the development machine. A second run excluding that entire batch
produced three further distinct puzzles at those lengths. Its requested mate in
five remained unfilled at five minutes. These are observed results, not performance
or long-mate guarantees.

The final six-puzzle run (`--mates 2,3,4 --per-length 2 --seed 9173 --beam 4`)
filled all quotas in 202 seconds, screened 4,722 candidates, and rejected four
candidates during final verification. All six have different accepted geometries
and ending sequences; each has only one legal reply at every defensive turn.

A separate ten-minute search for mate in five (`--beam 10 --seed 80817`, excluding
the first two trial batches) screened 12,326 candidates. Ten reached final
verification, but none met the single complete shortest-solution requirement.
These runs have therefore not yet demonstrated accepted puzzles at mate in five
or longer.

## Verification

```powershell
.venv\Scripts\ruff.exe check tools/xiangqi_data/puzzle_composition scripts/compose-quadruple-puzzles.py tools/xiangqi_data/tests/test_puzzle_composition.py
.venv\Scripts\python.exe -X utf8 -W error::ResourceWarning -m unittest tools.xiangqi_data.tests.test_puzzle_composition tools.xiangqi_data.tests.test_puzzle_mining_engine_discovery tools.xiangqi_data.tests.test_puzzle_mining tools.xiangqi_data.tests.test_puzzle_check_count tools.xiangqi_data.tests.test_puzzle_equal_mates tools.xiangqi_data.tests.test_puzzle_isolated_history
```

Native integration tests construct a seed and reverse captures from scratch and
certify a resulting mate in two. Regression tests cover material restrictions,
obstructed reverse captures, reflected/color-swapped duplicates, a shorter solution
embedded in a longer one, equal mates and quiet stalemates, partial output,
argument validation, and engine process/pipe cleanup.
