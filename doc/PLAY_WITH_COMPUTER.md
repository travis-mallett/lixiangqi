# Play with the computer

Lixiangqi exposes nine ordinal computer levels. The setup UI, setup validation,
game-search filters, and Pikafish move worker must all support the same range,
1 through 9.

## Runtime policy

The current server-side worker in `external/pikafish_worker/ai.py` uses one
Pikafish thread, a 128 MB hash, a cleared search state for every move, and fixed
node budgets. The first four levels sample between the top two reported moves;
the remaining five always play Pikafish `bestmove`.

| Level |     Nodes | MultiPV | Expected rank |
| ----: | --------: | ------: | ------------: |
|     1 |       149 |       2 |  1.2109662691 |
|     2 |       149 |       2 |  1.1654821783 |
|     3 |       149 |       2 |  1.1217064774 |
|     4 |       149 |       2 |  1.0795749989 |
|     5 |       149 |       1 |           1.0 |
|     6 |     7,849 |       1 |           1.0 |
|     7 |    24,389 |       1 |           1.0 |
|     8 |   235,500 |       1 |           1.0 |
|     9 | 3,318,000 |       1 |           1.0 |

For a fractional expected rank `1 + p`, the worker chooses rank 2 with
probability `p` and rank 1 otherwise. The choice is deterministically seeded by
game ID, public level, and position history, making retries reproducible without
making separate games identical.

The interface intentionally presents only levels 1-9. Calibration provenance
and the external reference-level mapping belong in the offline tool's
`METHODOLOGY.md`, not in user-facing copy.

## Player-facing level names

The setup dialog keeps the source game's Chinese rank names visible alongside
careful English equivalents. These are labels for difficulty, not claims that
Pikafish holds a human title.

| Level | Display name           |
| ----: | ---------------------- |
|     1 | Newcomer (小白)        |
|     2 | Rookie (菜鸟)          |
|     3 | Initiate (入门)        |
|     4 | Elementary (初级)      |
|     5 | Intermediate (中级)    |
|     6 | Advanced (高级)        |
|     7 | Elite (精英)           |
|     8 | Master (大师)          |
|     9 | Grandmaster (特级大师) |

“Grandmaster” is the established English rendering of the Xiangqi title
特级大师. “Initiate” preserves the imagery of 入门—having entered the gate—while
remaining distinct from the adjacent beginner ranks.

## Standard-game result statistics

The AI setup statistics are materialized counters in the separate
`ai_challenge_stats` MongoDB collection. They never add fields to, rewrite, or
migrate user documents.

A result counts only when all of the following are true:

- the game finished and was not aborted;
- it is a normal-start-position Standard game created by the AI setup flow;
- the human player is a registered, non-bot account; and
- the public AI level is in the supported 1-9 range.

Wins, draws, and losses are always recorded from the human player's
perspective. “Pass rate” is the aggregate registered-player win rate:
`wins / (wins + draws + losses)`. Personal history uses the same denominator.

The finish-game listener performs two atomic upserts: one global level counter
and one user-and-level counter. This is constant work per completed game. The
setup endpoint reads all nine levels with a single bounded `_id` query (at most
18 documents for a signed-in player), so opening the dialog never scans or
aggregates the game collection. Account deletion removes the personal counter
documents; aggregate counters contain no user identifiers and remain useful.

The counters intentionally begin empty when deployed. Existing games are not
backfilled, and existing accounts need no migration. The persisted game remains
the source of truth; counter-write failures are logged without interfering with
game completion and can be rebuilt offline if exact historical recovery is ever
required.

## Maintaining the levels

- Treat `STRENGTH_PROFILES` as the production profile table and cover every
  value with worker tests.
- Keep `AiConfig.levels`, lobby level buttons, and game-search level filters in
  sync with the table length.
- Recalibrate after changing the Pikafish version, search options, thread count,
  node budgets, move sampling, or adding an opening book.
- A future browser/WASM worker must implement the same node and adjacent-rank
  semantics if it is expected to preserve these strengths. The profiles do not
  depend on Redis, but engine build differences can affect playing strength.

The research method and limitations are documented in
[`tools/bot_levels_optimization/METHODOLOGY.md`](../tools/bot_levels_optimization/METHODOLOGY.md).

## Interactive move delivery

Computer turns use a versioned, retryable Redis protocol coordinated by the
round actor. Results are accepted only for the actor's current semantic turn and
an attempt ID it issued. This makes takebacks, duplicate delivery, lost Pub/Sub
messages, and worker restarts recoverable without moving gameplay authority out
of the normal round pipeline.

The invariants, failure behavior, rollout order, monitoring, and review
checklist are documented in
[`doc/AI_MOVE_DELIVERY.md`](AI_MOVE_DELIVERY.md).
