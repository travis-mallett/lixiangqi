# Native Xiangqi ranking

LiXiangQi keeps independent live and correspondence accounts for Xiangqi, Jieqi, Banqi, Mini Xiangqi,
Manchu+ and Game of the Three Kingdoms. Both accounts for a variant use the same native rank
catalogue, initial score, settlement rules and score floor. Puzzle rating uses Glicko.

## Product contract

- Live ranking uses each variant’s canonical pool clock and same-group or adjacent-group pairing.
  Eligible live friend invitations use the same clock and pairing rules.
- A human correspondence game with an explicit days-per-turn deadline and an ordinary starting
  position automatically uses its variant’s correspondence account. This includes both official
  Standard Xiangqi adjudication choices and the oldest games recorded before ruleset selection.
  Eligibility is independent of a historical casual/rated flag. Unlimited games, custom positions,
  imports, games with guest or computer seats, and invalid finishes do not earn correspondence points.
- Game-start ranks determine what a result is worth. Each completion applies the change to the
  player's current balance. Correspondence allows any rank gap and uses the variant's existing
  favourite and upset values. Three Kingdoms uses all three placements.
- Full profiles show established correspondence titles, scores and a graph of UTC daily closing
  scores. On the main leaderboard, one Live / Correspondence selector controls all six lists.
  The homepage and username hover cards continue to show live ranks.
- Standard Xiangqi starts at −160 (学1-3). A rank is established by the first settled result.

Banqi accounts use the keys `banqi` and `banqiCorrespondence`. Both start at zero, use a −30 floor and the 暗 titles. The first accepted flip commits a ranked game, including when the opening player draws Black. Results and starting rank snapshots belong to the two original seats.

## Settlement policy v1

The score floor is -250. A loss at the floor has an applied change of zero. Rank titles cap at
`专3-3`; a score above 7000 retains that title.

| Match                                     | Winner | Loser |
| ----------------------------------------- | -----: | ----: |
| Same rank                                 |    +10 |   -10 |
| Adjacent ranks, lower-ranked player wins  |    +15 |   -15 |
| Adjacent ranks, higher-ranked player wins |     +5 |    -5 |
| Draw                                      |      0 |     0 |

The complete catalog is:

| Rank  | Score | Rank  | Score | Rank  | Score |
| ----- | ----: | ----- | ----: | ----- | ----: |
| 学1-1 |  -250 | 学1-2 |  -200 | 学1-3 |  -160 |
| 学2-1 |  -120 | 学2-2 |   -80 | 学2-3 |   -50 |
| 学3-1 |   -30 | 学3-2 |   -20 | 学3-3 |   -10 |
| 业1-1 |     0 | 业1-2 |    10 | 业1-3 |    20 |
| 业2-1 |    30 | 业2-2 |    40 | 业2-3 |    60 |
| 业3-1 |    80 | 业3-2 |   100 | 业3-3 |   120 |
| 业4-1 |   150 | 业4-2 |   180 | 业4-3 |   210 |
| 业5-1 |   240 | 业5-2 |   290 | 业5-3 |   340 |
| 业6-1 |   400 | 业6-2 |   460 | 业6-3 |   530 |
| 业7-1 |   600 | 业7-2 |   680 | 业7-3 |   760 |
| 业8-1 |   850 | 业8-2 |   960 | 业8-3 |  1080 |
| 业9-1 |  1200 | 业9-2 |  1500 | 业9-3 |  1800 |
| 专1-1 |  2100 | 专1-2 |  2500 | 专1-3 |  3000 |
| 专2-1 |  3500 | 专2-2 |  4000 | 专2-3 |  4500 |
| 专3-1 |  5000 | 专3-2 |  6000 | 专3-3 |  7000 |

## Architecture

`RankTrackId` identifies an independently scored discipline. `RankPerf` is the authoritative user
account. `RankSnapshot` is an immutable copy captured on a game or tournament participant. Both
the catalog and settlement policy are versioned independently so a future variant can add its own
title catalog and policy without adding variant-specific fields to users, games, or UI contracts.
Missing version fields on pre-release snapshots are interpreted explicitly as v1, never as the
then-current policy.

The Xiangqi account is stored under `user_perf.ranks.xiangqi`. Missing means unranked. The account
contains score, W/D/L and game counts, recent scores, last activity, catalog/policy versions, and a
bounded list of settled and fair-play-restored game IDs for retry idempotency. Puzzle fields remain
in the same collection but are otherwise unrelated. Puzzle Glicko calculation and persistence remain intact; the former
chess-rating comparison used by puzzle anti-abuse logic is disabled because native rank and puzzle
Glicko are deliberately incomparable scales.

The game constructor checks the variant, initial position, time control, source, distinct users and
matching account snapshots before assigning a rank track. Settlement uses only the two game-start snapshots. Rank
accounts are updated with optimistic compare-and-set retries, and the game ID makes retries
idempotent. The actual applied change is persisted on the game, including a zero change when the -250 floor is
reached, together with the exact post-game title so promotions and a player's first completed rank
remain historically stable across catalog revisions.

Leaderboards query established `user_perf.ranks.xiangqi` accounts directly through a partial
index. Ranked-game history uses a dedicated user/track/date index. The retired speed-specific
ranking projection is read/write disabled.

Two persisted names remain solely as live-data compatibility seams: old games can still deserialize
their historical `rated` bit, and `user4.count.rated` is exposed internally as `count.ranked` so the
identity document does not need a risky rewrite. Neither value decides whether a game affects rank;
`rankTrack` is the only authority. Old rank-refund notifications are also readable but never
created. These compatibility readers do not constitute a second competitive system.

## Future variants

A future variant adds a new `RankTrackId`, catalog, and policy implementation, then authorizes the
appropriate entry point to assign that track. It may use authentic titles such as `揭…` or `迷…`
and a different threshold scale. The shared persistence, snapshots, settlement orchestration,
profile popover, and leaderboard projection do not assume that all tracks share Xiangqi's score
scale or title prefix. Do not normalize a future Tiantian variant into the Xiangqi catalog merely
to reuse thresholds; reuse the infrastructure and preserve the variant's independently researched
rules.

## Live deployment

The supported live upgrade path is `push-local-live.cmd` in the adjacent deployment workspace.
Do not run this migration manually before that deployment. The release builder copies the exact
versioned migration into the payload, and the remote rollout performs these operations as one
guarded activation:

1. Recover any deployment interrupted after a prior migration attempt.
2. Stop Lila, lila-ws, the explorer, and the Pikafish worker so no application can write during
   the schema transition.
3. Create a compressed Mongo archive and exact collection-state manifest for every affected
   collection, verify the gzip stream, and checksum both files before changing the database.
4. Run `migrations/native-xiangqi-rank-v1.js` inside the live Mongo container and require the
   `native_xiangqi_rank_v1` marker to reach `state: complete`.
5. Activate the new services and require both container health checks and external HTTPS readiness.
6. Only then commit the deployment. The prior release directory and temporary puzzle snapshots are
   removed, while the native-rank Mongo archive and every `*_pre_native_xiangqi_v1` collection are
   retained for the rollback window.

If migration, container activation, or external readiness fails, the deployer stops application
writers, checksum-verifies the archive, restores the affected collections and their indexes,
removes migration-only indexes and rollback collections, restores any puzzle snapshot changed by
the same deployment, and restarts the previous release. A failed database restore deliberately
leaves the applications stopped instead of risking an old binary against a new schema.

The migration is idempotent and checkpoints backups before mutation. It backs up and converts
`user_perf`, Arena participants, and Arena definitions; archives and drops the retired ranking
projection and ephemeral seek documents, and creates the native leaderboard and ranked-game
indexes. It refuses ambiguous pre-existing backup collections or missing checkpoint backups rather
than guessing, and it refuses to proceed if the live-data assumption of zero legacy rated-game
counts is false. It never updates `user4`, authentication, preferences, games, puzzle Glicko, or
puzzle run data. Existing competitive Glicko fields and any pre-release Xiangqi test rank are
removed rather than mapped, so all existing accounts start cleanly as unranked. Existing games
remain readable and are treated as casual because they have no native `rankTrack`.

For a later manual rollback after a successful release, stop all application writers and restore
the retained `*-native-xiangqi-rank-v1.archive.gz` through the deployment tooling before activating
the prior application. Do not drop that archive, its checksum, or the in-database rollback copies
until product validation and the agreed retention window are complete.

## Correspondence rollout

The deployment writer gate runs the staged application's replay against both game collections.
Preview reports eligibility and exclusions. Before applying any score changes the deployment saves
checksummed recovery archives for the affected game, account, counter and migration collections.
Replay orders creation and completion events by UTC time, records start snapshots for ongoing games,
and evaluates completed results using the application’s versioned variant policies and fair-play checks.
It writes the game snapshots, accounts, daily history, and ranked game counts in a single verified
MongoDB transaction. Its completion marker makes later deployments skip replay. An interrupted
initial rollout resumes with the new release. The deployment manager checks the migration contract
before allowing code rollback. Recovery archives contain the original collections plus an inventory
of collections that were absent before replay. Verify the checksums before restoring an archive.
