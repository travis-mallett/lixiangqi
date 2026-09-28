# Puzzle generation stages

The offline checkmate and tactic pipelines have independent stages. None changes the
LiXiangQi playback implementation or the published puzzle database schema.

## Tactic construction and double attack

Studio has separate Start/Stop, reconstruction, and category recheck controls
for checkmates and tactics. Auto Start launches discovery and both pipelines.
Worker settings apply **per type**; the resource estimate includes both types.

```powershell
.venv/Scripts/python.exe -m tools.xiangqi_data.puzzle_mining.tactic_verification --database <mining.sqlite3> --engine <pikafish> --source-db <games.sqlite3>
.venv/Scripts/python.exe -m tools.xiangqi_data.puzzle_mining.tactic --database <mining.sqlite3> --engine <pikafish> --catalog-db <catalog.sqlite3>
```

`scripts/categorize-tactic-puzzles.py` is also an entry point for the tactic
category worker. Add `--continuous` for polling; `--force-reclassify-same-version`
runs a finite category pass. The verifier supports the existing reconstruction
and force options, scoped to tactic candidates. Neither category command solves
or extends a line.

### Construction policy (`tactic-1`)

Use Pikafish `E=(wins-losses)/1000`, from the solver's perspective. Each search
uses MultiPV 2 (1 if only one legal move exists) and depth 20 (no node budget). Default
CLI settings are `--advantage 0.55`, `--uniqueness-gap 0.50`, and
`--max-solution-plies 31`.

- At every searched decision, `E(best) < advantage` rejects the candidate.
- Defender turns follow their engine-ranked best move; no gap test applies.
- Solver turns continue when `E(best)-E(second) >= uniqueness_gap`, or when
  exactly one legal move exists.
- A smaller gap ends construction only if `E(second) >= advantage`. At the
  root this rejects an ambiguous starting position; later it is a successful
  endpoint. A smaller gap with an inadequate second move rejects the candidate.
- Missing WDL, bounded/incomplete scores, incoherent boards, repetitions, and
  exhausted search/length limits are incomplete evidence. Repetition is held
  for review, never converted into a fabricated draw or win. Pikafish searches
  receive the complete history from the isolated puzzle root.
- Mate and stalemate are actual terminal wins. The final allowed solver move
  can receive one defender response and one unplayed solver analysis to prove
  an endpoint; those do not extend the playable solution beyond the limit.

The immutable trace stores the playable raw line, all decisions, and a typed
endpoint containing its reason, thresholds, final defense and unplayed analysis.

### Double attack (`winningMaterialByDoubleAttack`, version 3)

The site's existing category is **Winning Material by Double Attack (捉双得子)**.
Inspect the final solver capture by piece P of target Y, using
the board **before the preceding defense**, requiring meaningful attacks by P
on Y and another target X. Compare with the board after the defense: X must no
longer be meaningfully threatened, while Y must remain so. Follow X's identity
if it moves. This covers escapes, horse-leg blocks, cannon-screen changes,
line blocks, newly adequate protection, and check evasions.

A target qualifies when the attack is legal and either the target is worth
more than P, or no legal recapture of P would exist after its capture. Values:
pawn 1; advisor/elephant 2; horse/cannon 4; chariot 9; general infinity. General
attacks are checks. Geometry is a cheap filter; Pikafish checking and legal-move
inspections establish general safety and possible recaptures. Categorization
does not run evaluation searches. The preceding solver move must create the
material opportunity; a fork already present at the opening does not qualify.

The saved best-defense score must retain the advantage, or the capture must end
the game. Earlier incidental forks do not qualify. This category never changes
the solution's endpoint, and its evidence supplies no publication length.

### Exchange material (`exchangingToWinMaterial`, version 3)

The opening must capture an approximately equal-valued piece (horse/cannon for
horse/cannon, or chariot for chariot), followed by its immediate recapture on the
same square. The official endpoint must gain at least three material points,
relative to the balance **before the defender's setup move**. The setup move is
included in material accounting; the exchange test still starts with the first
player move. Chariots count 9; horses/cannons 4;
advisors/elephants 2; pawns 1 before crossing the river and 2 afterward.

Only qualifying openings incur continuation searches. Search the endpoint for
the defender's best move (MultiPV 1), then search the solver reply with up to four
alternatives. Every search and retry uses the shared solver depth setting
(currently 20), with its complete isolated puzzle history. Solver alternatives
must meet the verifier's winning threshold; returning material voluntarily does
not disqualify another winning continuation that keeps it.

Replay those principal variations for five extra plies, ending after a defender
reply. Require at least 75% of the official endpoint gain, always measured from
before the setup move. Intermediate losses and recaptures are allowed; a gain of four
may settle at three. If the fifth ply falls short, leaves check, or the next PV
move is a capture, inspect two more plies. At seven, a settled shortfall is a
non-match; unresolved check/capture sequences, repetitions, short nonterminal PVs,
missing WDL and incomplete searches are inconclusive. Actual terminal wins need
no further replies. This is a bounded retention test against engine best defense,
not an exhaustive proof against every defense or a test of motif centrality.

The two searches, with same-depth retries, share the existing 300-second engine
deadline. Board inspections are cached within the category invocation. Persisted
evidence includes both search results and inspected continuations, bound to the
exact verified trace and category version. Reuse replays the material calculation
without engine searches. This analysis belongs to the exchange category only.

All categories are independent, read-only detectors. Publication always uses the
full verified solution. Schema v17 removes `taxonomy_assessments.solution_plies`
and invalidates shortened projections for republication from retained canonical
evidence. Historical published lines and verification evidence remain intact.
Opening Studio does not migrate storage; restart workers/Studio after updating
and use the existing publication controls. No production schema or website
deployment change is required.

## Discover

The discovery command queues games without sufficient completed analysis depth under any discovery
version. `--rescan` respects the same depth rule. Interrupted jobs resume through
leases and transient failures through bounded retries. Native snapshot sources
and installed game catalogs follow the same rules.

Rediscovery retains the candidate identity, existing solution authority, and
publication. New engine scores and discovery revisions are not new puzzle inputs.

Engine search state resets once at the start of each puzzle verification and
each discovery game analysis, not between positions or retries. Each search
still supplies its position context. Engine identity records this reset policy
so old per-position-reset cache entries are not reused.

## Checkmate verification and construction

Checkmate verifier revision 6 explores player alternatives and follows only one
engine-selected defender reply (MultiPV 1). Every search and retry uses `--depth`
(20 by default, no node budget). Player searches start at MultiPV 2 and widen
until all shortest reported mating alternatives are visible. A wider search
replaces the entire ranking; scores from different snapshots are never combined.

Constructed continuations are resolved bottom-up. At each player fork only the
shortest completed paths survive, including every equal-length alternative. If
an observed length differs from the score used to select a move, a fresh search
at that fork reconsiders previously excluded moves whose predicted distance is
no greater than the best constructed distance. Newly admitted moves are also
constructed and reconciled. Already completed continuations are evidence, not
replaced by a fresh estimate of their length. This is shortest within the
finite-search exploration and selected defenses, not a proof of global optimality.

There are no branch-count, final-solution-count, or total-position limits for
checkmates. One 300-second monotonic deadline covers reset, setup, inspections,
searches, widening, retries, and reconciliation for the entire puzzle. Engine
reads enforce it during active searches. Cleanup/persistence can take a little
longer. An interrupted search never supplies completed depth-20 evidence.
Timeouts persist partial paths as incomplete diagnostics and are not retried
under the same settings. The existing 31-ply line safety limit still applies.
Tactic construction retains its existing position limit and behavior.

Normal Studio **Verify/Construct Start** revisits old rejected and incomplete
checkmate candidates under the new verifier signature. It skips any candidate
with a prior completed/accepted verification or a puzzle record, irrespective of
categorization or branch count. Do **not** use **Reconstruct old puzzles…** to
retry rejections only: that deliberately includes completed solutions. Restart
workers after updating; already running workers retain their loaded code.

Every final branch goes to the unchanged categorizer. A completed search that
no longer reproduces the required mate still rejects the candidate; unsuccessful
alternatives are not silently dropped to manufacture a complete tree. A timeout
or incomplete reconstruction never replaces existing completed authority. Each
persisted result includes construction timing, searched positions, completed
paths, search batches, MultiPV width and reconsideration counts in diagnostics.

The one-off `tools/data_migration/20260913_discard_legacy_nonmates.py` cleanup
discards only the 626 legacy candidates audited in the September 13 run. It
validates the targets, creates a full SQLite recovery backup, and applies the
changes atomically without engine work. It is local authoring maintenance, not
a website deployment migration.

Run from the repository root, using the configured Python environment:

```powershell
.venv/Scripts/python.exe -m tools.xiangqi_data.puzzle_mining.verification --database <mining.sqlite3> --engine <pikafish> --source-db <games.sqlite3>
```

The default fills missing complete verification evidence. Candidates with a
previous complete verification are skipped regardless of the installed verifier
or category versions. Old checkmate rejections are eligible under new signatures;
tactic rejection eligibility is unchanged. Partial traces are
not complete solutions. Deterministically incomplete and exhausted failed jobs
are held for review rather than retried indefinitely with identical settings.

`--reconstruct-old-puzzles` includes previously verified, staged, published,
uncategorized, and category-rejected candidates. Requests already evaluated under
the same verifier/engine/settings signature are skipped, making interrupted bulk
runs resumable. `--force-reverify` explicitly repeats that signature, including
held failures. Stop verification workers before forcing a repeat. `--continuous`
watches for new candidates; it does not repeatedly reconstruct old solutions.

The unified games catalog resolves retained `dpxq`, `gdchess`, and `xqdao`
references through its source provenance. Separate historical databases are not
required. Missing configured source coverage stops startup before workers consume
retry attempts. Verifier revision 3 retries missing proofs affected by the former
source-routing defect while retaining prior job records and completed evidence.

Published-puzzle priority is preserved. Within each priority group, shorter
discovered mates run first; candidates without a discovered mate distance remain
eligible after those with a known distance. This ordering improves time to usable
solutions without reducing engine budgets or required branch coverage.

The dashboard reports finished **attempts** separately from verified, incomplete,
invalid, retry, and failed outcomes. Only complete verification can add a solution
to the categorizer pool; retries do not count as newly verified puzzles.

Studio's checkmate progress bar counts completed attempts under the most recently
selected verification signature, including invalid, incomplete, and failed results.
Remaining work includes queued/retry/processing jobs and eligible candidates not
yet seeded. Historical rejected candidates are included; saved solutions are
reported separately. Queue selection uses a covering assessment index so it does
not read large branch payloads while holding SQLite's writer lock. Workers wait
through transient writer contention with cancellation support rather than losing
their claim loop or completed construction evidence.

The signature includes the independent verifier logic version, Pikafish identity,
NNUE identity, search budgets, exploration limits, and isolated-root history
policy. Category versions are not part of the signature.

The solver owns player-branch exploration, shortest-path reconciliation, and
the engine-selected defensive replies. It never receives category callbacks. Each immutable assessment
stores the mainline, branch traces, terminal boards, decision/search evidence,
coverage, and diagnostics. Reaching an exploration cap is incomplete coverage,
not approval that all required paths agree.

A complete replacement invalidates classification tied to the earlier
assessment. Incomplete work retains the previous authoritative evidence and
publication. Conclusive invalidity retires the local publication; it does not
delete historical puzzle content. Changed valid solutions are projected only
after classification completes.

## Checkmate categorization

```powershell
.venv/Scripts/python.exe -m tools.xiangqi_data.puzzle_mining.checkmate --database <mining.sqlite3> --engine <pikafish>
```

Categorization selects only accepted, complete canonical solutions with the
current isolated-root history policy across collection states. Missing,
legacy, incomplete, rejected, or incompatible verification stays out of the
categorizer queue, including forced reclassification passes. New complete
verification makes a candidate eligible on the next poll. Studio's awaiting
category count uses the same readiness condition. Full branch ledgers remain
defensively validated after selection, without decoding them on every idle poll.
It never invokes the solver or extends branches. Freshness is keyed by the exact
verification assessment and the complete theme/consensus-policy version set.
Current assessments are skipped before loading their potentially large traces.
`--force-reclassify-same-version` explicitly repeats classification.

Consensus policy: retain every basic kill category shared by all required
solution branches. A single solution may match multiple categories. Extra tags
on an alternative do not disqualify shared categories. No mainline category is
`uncategorized`; no shared category across alternatives is `category_conflict`.
Consensus revision 2 reconsiders older classifications using stored verification.
Both retain their solutions and can be reconsidered under new category logic.
Conflicts are excluded from release. Verified uncategorized output is included
only through the existing “include uncategorized” release option.

Octagonal Horse needs piece-removal engine searches. Centroid Pawn instead
inspects both possible inward general steps, respecting friendly occupancy and
enemy captures, and requires the pawn to be the sole attacker of at least one
destination. White-Faced General also uses attack inspection. Neither pawn nor
general classification searches continuations. Those are classification
evidence, cached separately by verification assessment, branch, theme and theme
version. Missing or inconclusive evidence requests category work, not a re-solve.
Identical terminal tests are shared across branches within one candidate.

Puzzle Studio has independent Discover, checkmate and tactic Verify & construct,
and checkmate and tactic Categorize controls. “Reconstruct old puzzles”
runs the optional verification pass, claiming reconciled live positions before unpublished candidates.
Studio imports inherited live checkmates from their validated source snapshots before
starting either evidence stage. This is transactional and idempotent; the master
site is the source, so this import does not back up the local database. Existing local
duplicates retain their history but yield to the live public identity. Imported lines
are historical content, not complete verification evidence.

Mining schema 20 supports only checkmate and tactic candidates. Its one-time
migration archives unsupported candidates and dependent evidence in local
`__retired_v20_*` recovery tables before removing them from active work. The
catalog similarly archives unsupported playback objectives once. These archives
are never read by discovery, construction, publication, or playback; routine
startup does not copy the entire database.

Deployment runs the supported-objectives migration with application writers
stopped, before the publication/playback migrations. It retains complete original
Mongo puzzle documents in a recovery collection before removing unsupported
content. Player rounds, accounts and games are untouched. Deploy before reconciling
Studio against a server that still contains unsupported objectives.
