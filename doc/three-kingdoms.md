# Game of the Three Kingdoms

LiXiangQi's `threeKingdoms` variant is a three-player, 48-piece game on the existing
135-point board. It implements elimination, appropriation of armies, and a final
duel. The release has rated matchmaking, two computer opponents, invitations to
two friends, analysis, history, spectating, and native tournament and TV support.
There are no coins, rewards, bannermen, or promotions.

## Published rules

The authoritative implementation is `modules/threeKingdomsCore`. The same source
is compiled for the server and browser. `/variant/threeKingdoms` presents the rules
to players through the translation system.

| Army | Color | General | Elephant | Cannon | Soldier |
| ---- | ----- | ------- | -------- | ------ | ------- |
| Shu  | Red   | 蜀      | 相       | 炮     | 兵      |
| Wu   | Green | 吳      | 向       | 礮     | 勇      |
| Wei  | Black | 魏      | 象       | 砲     | 卒      |

Each army starts with the usual sixteen xiangqi pieces. Shu moves first, followed
by Wu and Wei. Seats never change, even when an army changes hands. Existing board
artwork, all four board themes, and all five piece sets are supported. Green
pieces and kingdom generals belong to the shared piece catalog.

### Movement

The board consists of three nine-file, five-rank territories, with no central
intersection. `Topology` defines explicit neighbors, rays, horse legs, elephant
eyes, and palace diagonals. Screen coordinates never determine legal movement.

- Chariots follow the logical ranks and files through their bends. Cannons use
  the same lines and require exactly one intervening piece to capture.
- Horses cannot jump over a blocked leg. Elephants cannot jump over a blocked
  eye and stay in their original territory. Advisors remain in their palace.
- Generals move one orthogonal step within a palace. An unobstructed general
  may capture another general along a logical file, including either branch of
  the center file. It then occupies the captured general's palace.
- Soldiers advance toward their river. After crossing they may move sideways or
  toward the entered territory's home edge. They cannot return to their original
  territory or cross into the third territory. Appropriation preserves their
  original army and direction.

### Elimination and the final duel

Keep your general safe whenever a safe move exists. A checked player must resolve
check if possible. With three active players only, a player already in check
with no safe response may make another mechanically valid move and remains in
the game until capture or another loss. Capturing an active general is permitted
only if the complete capture and army transfer leave the captor's general safe.
Checks never interrupt Shu–Wu–Wei turn order. There is no grace period: the third
player may rescue a checked opponent or capture its exposed general.

Capturing a general immediately awards every army its owner controlled to the
captor. All pieces retain original colors, lettering, palace/territory limits,
and soldier directions. No extra move or clock award is granted.

A checked player who resigns or times out awards their armies to the checker.
With two checkers, choose the first checker due in normal turn order, starting
with the current player for an off-turn resignation. An unchecked withdrawal
removes that player's armies. An uncaptured general in an awarded army stays as
a visibly inactive **fallen general**: an owned blocker and cannon screen, with
no moves, attacks or flying-general restriction. Its later capture is ordinary
material capture, with no new elimination or transfer.

Stalemate is judged when a player's turn arrives: no check and no safe move is a
loss. Award its armies to the opponent whose move removed the last safe move,
provided that condition remained continuous. An unrelated intervening move does
not steal credit; restoring any escape clears it. Without an eligible cause
(e.g. an imported setup or withdrawal), remove the armies. A checked player with
no mechanically valid continuation also loses, using the checked-withdrawal
allocation. There are no passes.

Once two players remain, ordinary general safety is compulsory. First complete
all transfers/removals, then adjudicate only the player whose turn begins.
Checkmate and stalemate immediately lose to the other survivor. The last active
general wins; a drawn duel preserves third place and shares first and second.
Eliminated players retain their seat as spectators and may leave without affecting
the survivors. Spectator chat is separate from active-player chat.

Draw requires all active players' agreement, threefold repetition, 180 quiet plies
with three players, 120 in the duel, or 1,500 total plies. Captures, soldier moves,
eliminations and transfers reset repetition and quiet counts. Repetition includes
piece placement/original armies, controllers, active generals, turn and causal
stalemate credit, but not clocks or counters.

There is one exception to the threefold draw: if exactly one player checked the
same opposing general after **every own move in both repetition intervals** (at
least one own move per interval), that perpetual checker loses. The continuously
checked player receives its armies; multiple eligible victims use next-turn
order. Two or more offending checkers draw. Repeated chasing draws normally;
this variant does not use Tiantian's check/chase classifier. A recurring checking
cycle shows a warning before another move. Decisive results precede move-limit
draws; the perpetual-check penalty precedes a repetition draw.

### Time and ranking

Rated games use 15 minutes per player, a 60-second move deadline, and no
increment. Only the current player's main clock runs. Casual games offer 7, 10,
or 15 minutes and 15-, 30-, or 60-second move deadlines. Off-turn resignation
does not extend the current player's deadline.

Rated play uses the separate `threeKingdoms` rank track and compares each player
with both opponents once. For equal ranks the changes are +20, 0, and -20 before
the rank floor; a tied final duel gives +10, +10, and -20. Friend and computer
games are casual. Settlement is idempotent, with independent rank receipts and
a transaction committing all three profile counters together with the game's
accounting receipt.

Tournaments use the existing `/tournament` surface. Three-player pairings balance
seats and avoid recent repeated opponents where possible. Team battles require
three different teams. First, second, and third place score 4, 2, and 0;
ties share points. Streak and berserk bonuses do not apply. Games may finish after
the event ends, but only results before the persisted cutoff count.

## Sources and rule identity

The release rules are an explicit LiXiangQi convention, not a claim that all
historical or online three-player games use identical mechanics. Chinese
descriptions and modern 三人象戏 gameplay informed the selected family:

- [CN86209844U Chinese three-player chess patent](https://patents.google.com/patent/CN86209844U/zh)
- [CN1074386A Chinese three-player chess patent](https://patents.google.com/patent/CN1074386A/zh)
- [CN87205572U Chinese three-player chess patent](https://patents.google.com/patent/CN87205572U/zh)
- [三人象戏 gameplay](https://www.bilibili.com/video/BV19i6TBGEHL/)
- [Additional gameplay](https://www.bilibili.com/video/BV1SwDBYXELr/)
- [Additional gameplay](https://www.bilibili.com/video/BV1kgUWYPEYs/)

The safe-response exception, withdrawal allocation, fallen generals, causal
stalemate credit and exact repetition policy are explicit LiXiangQi conventions
completing the observed modern gameplay. There is one canonical rules implementation;
trial games are retired at deployment rather than supported by a legacy rules engine.

## Architecture

| Owner                       | Responsibility                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `modules/threeKingdomsCore` | Rules, topology, clocks, position codec, search                                    |
| `modules/threeKingdomsJs`   | Scala.js bridge to the canonical core                                              |
| `modules/threeKingdoms`     | Three-seat game aggregate, storage, invitations, pool, events, settlement          |
| `ui/board`                  | Shared graph renderer, assets, input, ownership markers, river-localized feedback  |
| `ui/threeKingdoms`          | Actor-tagged records, browser engine, history, previews, TV embed                  |
| `ui/xiangqi`                | Shared analysis workspace, variation tree, tabs, settings and three-player adapter |
| `ui/lobby`                  | Shared computer and friend setup dialogs, including three-player clocks and seats  |
| `ui/round`                  | Shared play room, controls, replay, matchmaking, and variant play adapters         |
| `modules/tournament`        | Three-player pairings and scores in native tournaments                             |
| `modules/tv`                | Shared selection cache, TV history and broadcasts                                  |

A three-player match has one identity and one `three_kingdoms_game` document;
it is never represented as two fabricated two-player games. Seats identify the
humans or bots. Positions identify army controllers. Compare-and-set revisions
reject stale writes; server clocks and rules validate every submitted action.
SSE publishes changed game state, while the shared WebSocket connection carries
normal site notifications and presence.

Homepage totals include both game stores. Shared caches supply three-player
counts, and the live WebSocket counter receives an authoritative snapshot every
15 seconds. That contribution expires after 45 seconds without a refresh.

Invitations require exactly two distinct opponents. All three accounts' blocking
and challenge preferences are checked, both invitees must accept, and pending
invitations expire after ten minutes. Durable notification receipts allow retry
after failure without duplicating the game. Rated pool reservations cooperate
with the ordinary two-player pool and are released on elimination.

Histories, bookmarks, profile filters and counters, activity, recap, personal
data exports, account closure, moderation links, live listings, TV, and native
tournament records use the real three-seat aggregate. Export is JSON or NDJSON,
since ordinary two-player PGN cannot preserve three seats and army ownership.

### Functional engine

The engine uses bounded Max-n search with three evaluation scores and a legal
principal variation. Five computer levels use different
node budgets. It is a functional initial engine with no Pikafish-level strength
claim. Search runs in a browser Web Worker, with cancellation and a timeout; it
does not consume Fishnet capacity.

The browser hosts both bots, with a two-second minimum response time per turn
including engine calculation. Computer play ends when the human is eliminated
or leaves: their loss is preserved and the surviving bots share the remaining
places. No server engine continues their duel. Guest losses are archived through
the rate-limited, idempotent completion endpoint. Existing unattended duels are
closed by the normal sweep using a recorded draw event, preserving their history.
The normal application deployment rebuild and restart activates this behavior;
no schema migration or additional deployment step is required.
Analysis supports variations, comments, arrows, position editing, local saves,
game-record import/export, position links, and standalone SVG board images.
The engine is available in analysis; it is not exposed during a live rated game.

All variants enter the shared analysis workspace at `/analysis/:variant`, with
Three Kingdoms available in its variant selector. Homepage computer and friend
actions open the shared setup dialog (`/?variant=threeKingdoms#ai` and `#friend`).
Rated play uses `/play/room/threeKingdoms-v1-ranked-15+0-m60`; entering the room
does not join the queue until Start is pressed. Matching hands off to the shared `round` module without leaving the room. Local
computer games, persisted games, spectating, and TV use that same round page.
The three-player adapter owns its rules, clocks, engine and SSE transport; room
mounting, layout, action buttons and replay navigation are shared with two-player
games. The separate three-seat game aggregate remains responsible for matching three people and validating play.

The shared analysis tabs preserve three-player events and ownership. When first
loading an older browser draft, the workspace copies its original value to
`threeKingdoms.analysis.v1.backup` before migrating to
`threeKingdoms.analysis.tabs.v1`. Invalid saved records are left intact.

### Position and record formats

`TK1` encodes pieces, active players, controllers, side to move, eliminations,
adjudication state, move counters, causal stalemate credit, repetition hashes and checking history. Decoding validates
bounds and invariants. Army ordinals are Wei 0, Wu 1, and Shu 2; turn order is
Shu, Wu, Wei. Locations use `wei:file:rank`, `wu:file:rank`, and `shu:file:rank`.

Game JSON declares `rules: threeKingdoms-v1`, `formatVersion: 1`, an initial
position, actor-tagged events, clocks, seats, and the final position. Replay
validates each event's actor against the rules. Analysis uses the same events and
positions, so appropriation and eliminations survive export and reimport.

## Build and deployment

The SBT browser-engine build generates the JavaScript bundle and source hash
manifest under `public/three-kingdoms-engine`. The asset build rejects a stale
engine manifest. Run the engine build before frontend production assets when
changing the core. The Windows startup workflow and deployment pipeline enforce
that order. The WebSocket build includes both xiangqi cores because variant
metadata exposes their initial positions.

`tools/data_migration/20261030_three_kingdoms_indexes.js` adds the game, invitation,
and TV indexes, and performs the one-time trial reset while writers are stopped.
It verifies full copies in collections prefixed
`20261030_three_kingdoms_trial_reset_`, then transactionally deletes trial games,
challenges and related references, reverses their accounted profile counters, and
clears only the affected Three Kingdoms rank. Unexpected formats, tournament
games, mixed trial/new accounting or mismatched backups abort the reset. A marker
makes repeated deployment idempotent. To recover, stop writers, restore the saved
documents by their original IDs (including full user/performance originals), remove
the reset marker, and correct the migration before rerunning. Preserve these backup
collections until the release is verified. Browser trial records are likewise
copied verbatim under `threeKingdoms.trialBackup.20261030.*` before being cleared.
Local preview and deployment already execute this entry point. MongoDB must run
as a replica set because result accounting uses transactions.

Core and service tests cover movement, blocked legs and eyes, river routes,
ownership, elimination, final-duel legality, clocks, draw rules, replay, engine
legality, authorization, and tournament scoring. Board tests cover all 135 hit
targets in all three perspectives and feedback anchors. To run the real MongoDB
accounting regression, set `LIXIANGQI_THREE_KINGDOMS_TEST_URI` to a replica-set
server URI without a database path and run `threeKingdoms/test`. That test creates
and removes its own randomly named database and verifies concurrent settlement
and recovery count each player only once.

## Shared animation choreography

`ui/board` owns feedback timing and layout; round, replay and analysis supply
semantic transitions. The original board artwork and hit coordinates are unchanged.
Capture/check use the river between the **original armies** involved, including
inherited pieces. One check per affected active general is shown. Capture is the
inner member of a simultaneous river pair; check is the outer member. Different
rivers retain separate effects. Defeat is halfway from the losing seat's palace
to the central junction; final victory uses the winning seat's territory. A
capture and elimination remain simultaneously visible in their separate regions.
All points rotate with the board, while glyphs remain upright. Normal check is
omitted for an already defeated general; withdrawals never fabricate captures.

The shared component waits for piece arrival, displays the event as one group,
scales/clamps peak bounds to avoid overlap, and clears stale events on navigation.
Reduced motion displays brief static indicators at the same anchors. Effects do
not intercept input. Video references for these placements: BV1CWD9Y9EFk 11:47
(capture + check); BV1SwDBYXELr 11:29 (capture + defeat) and 14:22
(capture + final defeat + victory). The previous research audit contains the
reference frames; the exact anchor formulas and collision rules are our UI contract.
