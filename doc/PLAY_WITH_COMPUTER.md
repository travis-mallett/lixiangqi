# Play with the computer

LiXiangQi exposes 720 ordinal computer levels. The home-page computer action
opens a scrollable zigzag map in the center rail, centered on the next unbeaten
level each time it opens. Selecting an unlocked level starts a normal-position, unlimited-time game
with a random side. The back button restores the home rail. The fixed footer's
Challenge a Higher Level button opens the existing setup dialog with ten choices labeled
0–9. Those choices start the exact same bots as map levels 1, 9, 98, 187, 276,
364, 453, 542, 631, and 720, respectively. The dialog retains side selection,
position setup, and optional time controls.

Only level 1 is initially unlocked. A normal-start win at level N clears every
level through N and unlocks N+1. Cleared levels remain playable and display a
green check; higher levels show locks. All ten setup choices remain available,
so winning a higher-level challenge can skip a section of the map. After level
720 is cleared, all levels are playable and the map opens centered on 720.

Account progress is derived from the highest level with a personal win in the
existing server-maintained AI statistics. Existing recorded wins count, and
progress follows the account across browsers. Guest progress is a highest-win
value in browser storage, updated from normal-start AI game results while
playing. It stays separate from account progress and is lost if browser storage
is cleared. Draws, losses, aborted games, spectating and custom-position games
do not unlock levels. No new server collection or data migration is needed.

## Runtime policy

The server-side worker uses the same Pikafish binary and NNUE network, one
thread, 128 MB hash, pondering off, and clears search state for every move.

Level 1 retains 149 nodes, MultiPV 16, expected rank 9.5, and the 600 cp
candidate-loss safeguard. For levels 1–8, let `u = (level - 1) / 8`:

- requested nodes: `round(149 ** (1 - u))`;
- MultiPV: `round(16 - 15 * u)`;
- expected rank: `1 + 8.5 * (1 - u)`.

All eight use the existing guarded rank sampler, including exact-score
snapshots, mate handling, and the 600 cp safeguard. This fades both search work
and weaker-move selection toward the level 9 best-move profile. It is an
engineering progression, not a measured strength calibration.

For levels 9–720, MultiPV is 1 and the worker returns Pikafish's best move.
With `t = (level - 9) / 711` and `q = (701 / 5_000_700) ** 0.30`, requested
nodes are `round(701 * (1 - (1 - q) * t) ** (-1 / 0.30) - 700)`.
Endpoints are explicitly 1 and 5,000,000. All 712 budgets are distinct and
strictly increasing. The shifted inverse-power model is an estimated strength
curve; adjacent levels have not been calibrated through games. Requested nodes
are not a guarantee of exactly that much engine work, particularly at tiny budgets.

All 720 levels retain the exact shared opening-book fade. On the bot's own
moves 1–10, book probability is `(11 - botMoveNumber) / 10`; afterward there is
no lookup. Legal master continuations are weighted by their game counts.
A selected book branch without a legal continuation uses a 5,000,000-node,
MultiPV 1 search. Lookup errors and the normal engine branch use the level's
profile. The opening policy intentionally overrides level budgets and remains
independent of rank sampling. Transpositions can re-enter the book during the
fade window.

Public names are localized numeric Pikafish levels rather than the previous
nine rank titles. Existing games and stored level numbers are not rewritten.
Statistics describe results against those ordinal numbers, including earlier
profiles; they are not calibrated ratings for the new schedule.

## Standard-game result statistics

The AI setup statistics are materialized counters in the separate
`ai_challenge_stats` MongoDB collection. They never add fields to, rewrite, or
migrate user documents.

A result counts only when all of the following are true:

- the game finished and was not aborted;
- it is a normal-start-position Standard game created by the AI setup flow;
- the human player is a registered, non-bot account; and
- the public AI level is in the supported 1–720 range.

Wins, draws, and losses are always recorded from the human player's
perspective. “Pass rate” is the aggregate registered-player win rate:
`wins / (wins + draws + losses)`. Personal history uses the same denominator.

The finish-game listener performs two atomic upserts: one global level counter
and one user-and-level counter. This is constant work per completed game. The
setup endpoint reads all 720 levels with a single bounded `_id` query (at most
1,440 documents for a signed-in player), so opening the dialog never scans or
aggregates the game collection. Account deletion removes the personal counter
documents; aggregate counters contain no user identifiers and remain useful.

The counters intentionally begin empty when deployed. Existing games are not
backfilled, and existing accounts need no migration. The persisted game remains
the source of truth; counter-write failures are logged without interfering with
game completion and can be rebuilt offline if exact historical recovery is ever
required.

## Maintaining the levels

`STRENGTH_PROFILES` is the worker's canonical schedule; the tests verify the
beginner endpoint, transition, normalized curve, and full node-only range.
`AiLevel.levels` owns the server range; the shared UI `aiLevels` owns its mirror.
The deployment script packages the worker and application together and restarts
them. No stored-data migration is required for this range expansion.

Offline calibration tools remain experimental and do not automatically replace
production settings. Changes to engine versions or search settings can alter
actual playing strength even with the same requested budgets.

## Interactive move delivery

Computer turns use a versioned, retryable Redis protocol coordinated by the
round actor. Results are accepted only for the actor's current semantic turn and
an attempt ID it issued. This makes takebacks, duplicate delivery, lost Pub/Sub
messages, and worker restarts recoverable without moving gameplay authority out
of the normal round pipeline.

The invariants, failure behavior, rollout order, monitoring, and review
checklist are documented in
[`doc/AI_MOVE_DELIVERY.md`](AI_MOVE_DELIVERY.md).
