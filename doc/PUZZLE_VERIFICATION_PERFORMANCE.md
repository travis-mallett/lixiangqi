# Checkmate verification investigation — 2026-09-11

## Subsequent correction: standalone puzzle roots

Discovery version 3 and verifier version 7 now discard source-game history and
reset inherited FEN counters. Each solution search retains only the moves played
from the isolated puzzle root. The report below describes the earlier run with
source history; its reproduction contexts are intentionally historical.

The later reported game `g:00fd0c3527653f002dc4284017204e06` was checked at
600k nodes, one thread, 128 MiB hash, with a clean state before every search:

| Source ply | With source history | Isolated position | Legal replies after historical best move |
| ---------- | ------------------- | ----------------- | ---------------------------------------: |
| 140        | mate +1, `g6h8`     | cp −33, `g6f8`    |                                       34 |
| 176        | mate +1, `e1e2`     | cp −291, `e1e2`   |                                       49 |
| 178        | mate +1, `e2e1`     | cp −301, `e2e1`   |                                       49 |

Raw UCI output for ply 140 confirms Pikafish itself emits `score mate 1` and
`bestmove g5h7` (engine coordinates), finishing after only 8,839 nodes with
selective depth 2. The parser converts this to `g6h8` correctly. It is not
a 600k-node search overlooking 34 replies or a parser manufacturing a mate.
Pikafish's history-dependent rule adjudication uses mate-valued scores even
when geometric legal moves exist. Removing source history removes the mate
report in all three reproductions. Rule outcomes within the puzzle's own
subsequent history still apply, and a basic kill still needs a terminal board.

Source records and output formats are unchanged. No playback/site changes were
made. Old evidence is retained, but cannot be reused for standalone-root
classification without new verification.

The inspected Studio settings and all 261 version-5 assessments used **2M nodes**,
not the 20M CLI/default setting. Studio preserves saved settings. No running
categorizer or discovery engine was present when the investigation began.
The investigation read the mining/source databases without modifying them.

## Measured search costs

Windows AVX2 Pikafish 2026-01-02, one thread, 128 MiB hash, clean search state
before each call, full initial FEN and source move history, MultiPV 2:

| Candidate / source ply |      5M |      20M |      30M | Leading result at all three budgets   |
| ---------------------- | ------: | -------: | -------: | ------------------------------------- |
| 1167 / 50              | 5.389 s | 18.776 s | 30.816 s | `f2f10`, mate +7, identical 13-ply PV |
| 1302 / 169             | 3.344 s | 12.764 s | 19.631 s | `b2a2`, mate +1, nonterminal board    |

The first position reached depths 24/29/30; the second 33/40/42. These are
elapsed wall times, not guarantees for other positions or hardware. A node
budget is a limit, not a quota: Pikafish can finish much earlier in simple
mating positions. Complete MultiPV snapshots can also predate the final node
counter. Two positions do not establish equal reliability between budgets.

Reproduction inputs: mining database `data/local/xiangqi-puzzle-mining.sqlite3`,
source catalog `data/local/xiangqi-games.sqlite3`; load the candidate's source
game with `sources.load_game`, then construct
`SearchContext(game.initial_fen, tuple(game.moves[:candidate.ply]))`.
Call `OfflinePikafish.analyse(context, nodes=budget, multi_pv=2)` for each budget.
Always close the engine. Binary SHA-256:
`a230d4ff63923eb4bfc82d5c86957201b64290c8bc0d752226b4d780a80fa7eb`;
NNUE SHA-256:
`c4026370d7516d9b0f668447f9ca1931241538bdc689cde6fec6a991ac4d5f77`.

## Where time goes

Of 261 completed version-5 assessments, 255 were rejected and six published.
247 stopped after primary classification with no qualifying single basic kill.
Thus most assessed candidates never enumerated alternative paths. The six
published puzzles averaged nine solution plies and had 110, 9, 18, 52, 2, and 2
completed paths. Multiple equal paths are common in this small eligible sample.
Stored accepted assessments accounted for about 246M searched nodes; rejected
assessments about 1,207M. These totals exclude failed attempts and are not a
complete wall-time profile of the displayed run.

A qualifying single-line puzzle normally searches PV1 along the primary, then
PV2 at positions with multiple legal moves. It does not automatically search
PV3. Widening is needed only when every returned move ties; the configured
step is two, so the first widening is usually PV4. With saved 2M and the 10M
increment, PV4 requests 22M; with the 20M default, it requests 40M. Forced moves
reuse PV1. Nonqualifying primary traces stop before this second pass.

For a nine-ply qualifying puzzle with no forced moves, branches, retries, or
widening, there are about 18 calls. Applying the measured per-call range as a
rough cost model gives 60–97 seconds at 5M or 230–338 seconds at 20M. This is
not a measured whole-puzzle runtime: near-terminal PV1 calls often finish much
earlier, and branches or revisions add calls.

Playback does use a separate browser engine for deviations: depth 18, MultiPV 1,
one thread, 16 MiB hash, 60-second timeout (`ui/puzzle/src/xiangqiPuzzleEngine.ts`).
Its settings do not prove category consistency of unplayed alternatives.
Stored alternative traces are verification evidence, not extra published
solution lines. Lower branch budgets are a possible future tradeoff, but this
small benchmark does not justify asserting equivalent puzzle quality.

The existing configurable defaults remain 20M at PV1/2, +10M per extra slot,
160M cap, 32 PVs, 256 branches, 4,096 positions, 31 plies. Saved Studio settings
were left intact. Fixing repeat work comes before interpreting a budget change
as a quality-neutral optimization.

## Failure findings and repairs

There were 73 exhausted failures: 62 `mate_not_reproduced_inconclusive`, and
11 `inconsistent_mate_distance_at_node_cap`. These were incomplete attempts;
they did not replace current evidence or retire publications.

The three quoted candidates at source plies 169, 203, and 225 all reproduce
mate +1 at 2M. Their selected moves are `b2a2`, `b2a2`, and `a2c2`; the resulting
positions are unchecked and have 21, 21, and 30 legal moves respectively.
They therefore lack the required checkmate/stalemate terminal proof. Pikafish's
`Position::rule_judge` can encode repetition/check/chase results as mate scores;
search calls it below the root. This explains why a reported mate need not be
a terminal basic kill. We have not independently adjudicated the exact rule
outcome of every failed game or proven that all 62 failures share this cause.

A separate real defect affected distance reconciliation. Candidate 60 reported
mate +12 at its root and −12 after the selected move at 2M. The old verifier
repeatedly strengthened only the parent, retaining the stale child. Searching
the child at 4M resolves it to −11. The repaired solver, starting at 2M with an
8M cap, completed a verified 23-ply primary in 32.9 seconds, using approximately
38.2M nodes and one revision. This replay tested primary verification only;
it does not establish basic-kill eligibility of that candidate.

Version 6 strengthens the less-funded side of a disagreement, child first on
a tie, and rebuilds coherent evidence. It still treats unresolved contradictions
as incomplete. Search metadata changes no longer cause needless primary
reclassification. Nonterminal mate-in-one reports now have a specific diagnostic.
Deterministic uncertainty becomes `review` immediately, without three identical
clean attempts; transient errors retain retry handling. Review preserves current
publication authority and waits for an explicit new assessment revision.
Version 6 will make earlier-version candidates eligible on the next run.

No discovery algorithm, discovery threshold, publication format, playback code,
or database schema was changed by this investigation.
