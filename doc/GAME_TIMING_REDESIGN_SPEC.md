# Canonical game timing and recorded-game playback

Status: implementation specification. This document describes the intended end state; it is not a record of completed work.

## 1. Background and problem statement

LiXiangQi currently inherits several timing representations that answer different historical Lichess needs:

- `c` is the current or final real-time clock snapshot used to operate a game.
- `cw` and `cb` are compressed per-color real-time clock histories.
- `mt` is a coarse, four-bit-per-ply move-duration history for games without a real-time clock.
- `ca` is the game creation time.
- `ua` is the last game activity time and also participates in correspondence-clock and operational queries.

This arrangement is not simply careless duplication. Lichess added compact move times and precise clock history at different stages, optimized the two clock sides separately for compression, and retained hot scalar fields because reconstructing operational state from a history on every game read would be expensive. Those are useful lessons: game records are high-volume, clocks are on hot paths, and a clean conceptual model must not require replaying an event journal merely to resume a game or find recently active games.

The inherited historical model is nevertheless a poor fit for LiXiangQi's desired behavior:

- Each player's first think time is not present in `cw`/`cb`. `computeClockMoveTimes` inserts zero, so the first two plies replay immediately.
- `mt` records only one of 16 approximate buckets and caps a duration at 60 seconds. It cannot support exact research or faithful playback.
- Clock start, pause/resume, added time, correspondence deadlines, takebacks, and game-end timing are not represented coherently in one durable history.
- Some clock-affecting events exist only as transient round/socket events and are discarded before persistence.
- The move path steps the authoritative clock and passes the stepped clock into the updated game, while the legacy history is captured through a different path. This makes it too easy for increment, lag compensation, and the persisted history to describe different states.
- Viewer code has had to infer playback from incomplete clock histories. That produces clocks that tick on a static completed position, clocks that do not match the selected move, and replay controls that appear on the wrong surface or disappear on the right one.
- The front-page LiXiangQiTV currently couples board replay eligibility to the existence of valid `cw`/`cb`. A finished, imported, untimed, malformed, or too-early game can therefore remain frozen at its final FEN even when its move list is available.

The objective is to create one canonical historical timing model for every game, capture complete server-authoritative timing for all new native games, migrate the small existing collection into that model without pretending missing data is exact, and expose stable projections that all recorded-game viewers can share.

“One timing field” does **not** mean putting every operational timestamp into a journal. Keep `c`, `ca`, and `ua`: they own current clock operation, creation time, correspondence/last-activity behavior, sorting, and indexed queries. Replace the three competing **historical** fields `cw`, `cb`, and `mt` with one historical model.

Useful background on the inherited tradeoffs:

- [Lichess: A better game clock history](https://lichess.org/@/lichess/blog/a-better-game-clock-history/WOEVrjAA)
- [Lichess: Improved game compression](https://lichess.org/@/lichess/blog/developer-update-275-improved-game-compression/Wqa7GiAA)

## 2. Product outcome

After this work:

1. Every `game5` document conforms to one game schema and contains one canonical timing history, even when its provenance says that historical timing is unavailable.
2. Every newly created native game records the authoritative sequence from game/clock start through accepted moves and termination. The first move is not a special case.
3. Real-time, correspondence, and unlimited games use the same domain model. Their timing modes differ, but their move acceptance times are recorded consistently.
4. A completed-game viewer loads with stopped clocks matching the displayed ply. Selecting another mainline ply immediately shows its authoritative clock state.
5. Recorded real-time games can be played and stopped from a shared playback controller. Board moves and clocks advance from the same server projection and snap to authoritative values at event boundaries.
6. The Analysis Board has no recorded-game Play control. A finished-game viewer may use the analysis application internally, but it receives an explicit viewer capability rather than inferring playback from “finished game data exists.”
7. Full LiXiangQiTV exposes the Play/Stop control when recorded playback is available, including when initially positioned at the latest ply.
8. Front-page LiXiangQiTV replays the moves of a non-live featured game instead of freezing at the final position. Exact real-time cadence is used when available; a clearly defined presentation cadence may be used for a record that has moves but no usable timing.

## 3. Scope and non-goals

This change includes the game domain, `game5` persistence, conversion tooling, deployment orchestration, timing-derived APIs/analytics, the shared browser playback component, and the recorded-game/TV surfaces named below.

It does not require:

- changing game-status or abandonment policy for corrupted playable games;
- event-sourcing the entire game domain or deriving the current board from timing history;
- reproducing packet latency, animation frames, or exactly what one player's browser rendered;
- offering real-time Play for correspondence or unlimited games merely because their timestamps are recorded;
- adding playback to studies, analysis variations, generic mini boards, or every deferred Lila feature;
- zero-downtime or dual-format deployment;
- preserving permanent runtime readers for `cw`, `cb`, or `mt`.

“Indistinguishable from live” means a server-authoritative simulation: the same ordered accepted moves, the same wall-time spacing captured by the server, the same active clock, and authoritative clock snapshots at boundaries. Network transit and client rendering delays were never common across spectators and cannot be reconstructed.

## 4. Architectural decision

Use a domain type tentatively named `GameTiming`, stored in a compact field tentatively named `th`. These names are recommendations, not a requirement if an engineer finds a clearer established convention.

```text
authoritative game transition
          |
          v
 GameTiming domain update -----> current Game / c / ua
          |
          v
 compact th persistence (same Mongo update as the game transition)
          |
          +----> move-time / clock-state projections ----> API, PGN, analytics
          |
          +----> playback projection --------------------> game viewer, full TV, mini TV
```

### 4.1 Permanent field responsibilities

Keep:

- `c`: hot current/final real-time clock snapshot. Resuming a game, timeout checks, and live socket state must not decode and replay all of `th`.
- `ca`: creation timestamp and the natural epoch for compact history offsets when practical.
- `ua`: last activity/correspondence anchor and indexed operational value.
- `cd`, `ml`, `mp`, and other current configuration fields whose operational ownership remains valid.

Replace and remove after migration:

- `cw`;
- `cb`;
- `mt`;
- ordinary runtime legacy codecs, queries, branches, and tests that interpret those fields.

The new game schema should require `th`. The existing strict XiangQi schema marker (`xv`) can be advanced during the migration so the new binary cannot load a legacy or partially migrated document. If the binary container needs a small codec framing version, that is acceptable, but it must not become an excuse to support multiple business formats indefinitely. A future incompatible codec change should migrate controlled data again.

### 4.2 Logical timing model

The in-memory model should be typed and readable even if the stored representation is highly compact. It should contain:

- provenance/data quality;
- a time mode and initial timing state;
- an ordered, monotonic sequence of timing events;
- enough authoritative post-event state to project clocks without reverse-engineering the clock algorithm;
- enough move association to correlate events with the recorded game and to handle takebacks correctly;
- explicit bounds and validation.

Recommended provenance values are:

- `NativeExact`: captured by LiXiangQi at the authoritative transition;
- `ImportedDeclared`: timing supplied by an external record, not observed by this server;
- `MigratedApproximate`: converted from `cw`/`cb` or bucketed `mt`;
- `Unavailable`: the game exists but no honest timing history can be constructed.

Provenance is part of research integrity and UI capability decisions. It is not a legacy fallback mechanism.

Timing modes should cover at least:

- real-time clock;
- correspondence clock/deadline;
- untimed/unlimited;
- external/imported timing or unavailable timing.

### 4.3 Required events and semantics

The exact class names and binary tags may change, but the model must be able to represent:

- game started;
- real-time clock started, including delayed starts and move-time-limit pause/resume behavior;
- accepted move;
- clock adjustment, including player-added time, system correction, and berserk where applicable;
- clock paused or resumed when the product can cause it;
- takeback applied;
- game ended, with the actual authoritative end time, reason/status association, and stopped final clock state.

For every accepted native move, capture at least:

- authoritative server occurrence time, preferably a delta from `ca` or the prior event;
- resulting ply and mover;
- sufficient move identity to keep a full-session audit unambiguous when later moves are taken back;
- raw wall elapsed time;
- time charged by the clock;
- lag compensation or an equivalent value from which the distinction remains explicit;
- authoritative post-step timing state.

For real-time clocks, post-state means both displayed remaining times, active color/running state, and any state needed to reproduce a boundary exactly. The compact encoder may store only the changed side plus deltas/checkpoints; the typed decoder must expose an unambiguous full state.

For correspondence games, record exact accepted-move timestamps and resulting deadline/active-side state. For unlimited games, record exact accepted-move timestamps even though no clock frame exists. Long correspondence deltas must not overflow or be clamped to an arbitrary playback-oriented maximum.

Use millisecond event offsets if that matches authoritative server timestamps and centiseconds for clock amounts if that matches the clock engine. Mixed units are acceptable when strongly typed and documented. Do not silently label wall time, charged time, and displayed clock loss as the same quantity.

### 4.4 Takebacks and session history

The canonical design should preserve the timing of accepted moves that are later rewound, because the current destructive history is why the reported AI/takeback session cannot be researched after the fact. A `TakebackApplied` event plus compact move identity allows a full-session projection to reconstruct the interaction.

The ordinary game record remains authoritative for the current mainline. `th` must not become a second board-state source that can disagree silently. Provide two explicit projections:

- **final-mainline projection**, used by normal review, APIs, PGN, and analytics where existing semantics mean the retained line;
- **full-session timing projection**, available to trusted research/diagnostic consumers and capable of showing taken-back activity.

The first UI iteration need not animate takeback branches. The final-mainline playback projection should associate the replacement moves with the timing after the rewind rather than charging them for time spent on a discarded branch. The implementation must document and test that projection rule.

If preserving rewound move identity proves to require a disproportionate redesign, the engineer may propose a narrower final-mainline-only v1 before coding. That departure must be explicit because it sacrifices research data and cannot be repaired later.

### 4.5 Compact storage without opaque domain code

Do not store a verbose BSON object per event. Use one compact, bounded binary container or one `th` subdocument containing compact binary streams. Separate internal streams for event offsets, move metadata, and each clock side are compatible with “one canonical field” and may retain Lichess's compression advantage.

Consumers must never decode the storage layout directly. The game module should own:

- encoder/decoder;
- validation and bounds;
- lazy loading;
- timing mutations;
- stable projections.

Benchmark before choosing one rewritten blob versus independently updateable `th` substreams. A full-blob `$set` is acceptable only if measured write amplification and allocations remain reasonable. The conceptual model stays singular either way.

The decoder must reject an unknown codec, truncated data, non-monotonic offsets, impossible event order, excessive counts, and oversized values before large allocation. Corrupt timing should be observable and should disable historical projections; it must not make unrelated list pages repeatedly do expensive work.

### 4.6 Bounds and abuse resistance

The game currently caps its retained mainline at 600 plies, but repeated takebacks can create unbounded accepted session moves while current ply stays low. Define and test:

- a maximum encoded size;
- a maximum auxiliary-event count;
- a cumulative accepted-move/takeback policy;
- decoder allocation limits;
- capacity reserved for finishing an otherwise legal maximum-length mainline and writing its terminal event.

Optional history-expanding actions such as additional takebacks or more-time events should become unavailable before they can consume the reserve. Do not silently truncate the journal, drop the final event, or prevent an ordinary legal move because optional events exhausted storage. Final numeric limits should be based on representative codec and Mongo write benchmarks rather than guessed in this document.

## 5. Capture timing at the owning transitions

Initialize `GameTiming` in the central new-game construction path so every native, AI, correspondence, unlimited, and imported game receives a valid value. Imported records must map declared annotations or use `Unavailable`; they must never masquerade as server-observed play.

For a move, sample authoritative time once around the clock step and build one rich transition result. Pass that same result to:

- the updated `Game.clock`;
- `GameTiming`;
- `movedAt` where appropriate;
- the socket event sent to clients.

This removes the current parallel calculation in which `MovePlayer` owns the stepped clock while `GameExt.applyMove` records history from the older game clock. The post-state in `th` and `c` must be identical after every timing-affecting transition.

Apply the same ownership rule to:

- `Game.start` and `startClock`/`StartClock` actor handling;
- berserk;
- player-added time and system restart compensation;
- correspondence time changes;
- pause/resume;
- one- and two-ply takebacks;
- timeout, resignation, draw, abort, mate, and other finish paths;
- AI/fishnet moves, without treating their delay as zero merely because the actor differs.

Transient `Progress.events` remain transport events. They are not durable timing history and must not be used as its source after they are dropped.

Persist the timing mutation in the same atomic Mongo game update as the move/current-clock mutation. Preserve the existing batching policy unless a separate durability decision is made: embedding `th` prevents persisted move/timing disagreement, but it does **not** guarantee that an accepted move survives a process crash before `GameProxy` flushes its batch. Changing that durability window is outside this feature and should not be smuggled into it.

## 6. Stable server projections and affected consumers

Expose domain projections rather than the raw event codec. At minimum provide:

- per-color move times;
- interleaved final-mainline move times;
- authoritative clock state at a selected mainline ply;
- clock states suitable for existing PGN/API output;
- final-mainline playback timeline;
- full-session timing events for explicitly authorized research/diagnostic use;
- provenance and availability.

The playback projection should include an initial/root frame and ordered transitions. A transition should carry a board action reference, wall delay, active/running clock state, authoritative boundary clock state, and terminal or non-move clock events as required. The browser should not infer delays by subtracting adjacent clock values.

Preserve existing public API and PGN shapes where they remain semantically sound, deriving them from `GameTiming`. Any intentional external contract change needs separate documentation. Review all direct consumers, including:

- game BSON handlers, diffing, queries, repository projections, rewind, and environment exports;
- `GameApi`, `GameApiV2`, PGN dump, API move stream, GIF export, tree/study conversion;
- insights, evaluation/statistics, player assessment, playban, and Irwin;
- the current `RecordedClockTimeline` server projection.

Evaluation currently assumes the first move time is always zero and drops it. Recalibrate that logic and its tests when the first move becomes real data; otherwise an apparently correct persistence change can silently alter assessment thresholds.

List, search, and hot operational reads that do not request timing should not decode `th`. Replace legacy “has `cw`” queries with an inexpensive availability/provenance query supported by the chosen storage shape; add an index only if an actual query requires one.

## 7. Frontend playback architecture

Keep one surface-neutral state machine under the shared game replay library. The current `RecordedClockPlayback` is a useful starting point, but its contract should evolve from a clock-history approximation to the canonical playback projection.

The shared controller owns:

- play/stop state;
- scheduling from server-provided wall delays;
- interpolation of the active real-time clock between boundaries;
- snapping to authoritative clock values at every event boundary;
- event catch-up after browser timer throttling;
- selection of a starting mainline ply;
- completion and cancellation;
- visibility/background-tab policy;
- cleanup of timers and listeners.

Small adapters own surface-specific behavior:

- finished-game viewer: select a mainline node, move the board, render recorded clocks;
- full TV: select round steps, coordinate with live socket state, render the standard replay controls;
- front-page mini TV: apply moves to Chessground, autoplay according to the mini-TV policy, loop or settle according to an explicit accessible design.

Do not duplicate clock math or scheduling in those adapters.

### 7.1 Common interaction behavior

For an eligible recorded real-time game:

- Loading a position is paused. Both clocks display the authoritative state associated with that position and do not tick.
- Selecting any mainline move stops playback and immediately snaps the board and clocks to that move's state.
- Selecting an analysis variation has no timing; hide or disable recorded playback and do not reuse a mainline clock frame misleadingly.
- Activating the icon-only Play button begins at the selected position. If already at the final position, the shared behavior should rewind to the root and play; this is the current controller behavior and avoids a visible button that appears inert.
- While running, the triangle changes to a square Stop icon. `aria-label`, `title`, and `aria-pressed` change with it.
- Activating Stop freezes the current board and interpolated clock display without advancing further. A later Play resumes from that position using a well-defined boundary rule.
- At normal completion, the final board and stopped final clocks remain displayed and the icon returns to Play.
- Zero-duration transitions advance safely without recursive overflow; long delays and background timer throttling catch up correctly.

Historical clock playback must never send moves, timeout messages, or socket clock mutations. In live TV, preserve the newest socket-authoritative clock separately. While replay owns the historical view, suppress live-clock flag side effects; when playback catches up or the user returns to the newest ply, restore socket state exactly.

### 7.2 Surface capability matrix and related bug fixes

| Surface                           | Recorded clocks                                           | Play/Stop                          | Required behavior                                                                                   |
| --------------------------------- | --------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| Free Analysis Board `/analysis`   | No                                                        | **No**                             | Exploratory/editing surface only. Do not render or bootstrap playback capability.                   |
| Game analysis `/$id/.../analysis` | May retain ordinary annotations, but no playback clock UI | **No**                             | Engine/tree analysis only, even for a finished timed game.                                          |
| Finished-game viewer `/$id`       | Yes when a usable real-time projection exists             | Yes                                | Static clock at selected mainline ply; shared real-time playback.                                   |
| Full `/tv`                        | Yes for the selected real-time game                       | Yes after at least one transition  | Available at latest/final and earlier plies; works at desktop, intermediate, and mobile widths.     |
| Front-page LiXiangQiTV            | Yes when timing is usable                                 | No full move-list control required | Live games remain socket-driven; non-live games automatically show and replay their move history.   |
| Generic mini boards/history cards | No new behavior by default                                | No                                 | Replay is an explicit surface capability, not a side effect of `tv=true` or of using `gameUi.mini`. |

Fix these three bugs as part of the implementation, not as unrelated page patches:

1. **Analysis Board wrongly has Play.** The same XiangQi analysis template/bootstrap is used by finished-game replay and by analysis routes, and playback is inferred from the presence of finished-game timing. Introduce an explicit server page purpose/capability such as `RecordedGameViewer` versus `Analysis`. Only the finished-game replay controller may receive/render playback controls and a playback timeline.
2. **Full LiXiangQiTV is missing Play.** Current availability additionally requires the user already to be replaying an earlier step, so the button is absent at the latest/final position. Availability should depend on TV spectator mode, a valid timeline, and at least one replayable transition—not on already being behind. Ensure the control is present in the actual mobile replay layout; the current normal button row is hidden in one column/mobile presentation. Preserve the unrelated Analysis action rather than replacing it accidentally.
3. **Front-page LiXiangQiTV freezes recorded games.** Board replay is currently enabled only when a valid legacy recorded clock exists. Decouple board move replay from clock availability. Prefer selecting a finished native real-time game with usable timing for recorded TV. If the chosen record has moves but no usable timing, animate the board with a documented presentation cadence while keeping recorded clocks absent/static and provenance honest. Do not fabricate timing in the database.

Full TV also needs to support a game opened before enough events exist. Initialize a valid zero-transition playback session at game/clock start, append canonical projected transitions as socket moves arrive, and expose Play only after there is something to replay. Do not require a controller that could not be created from the early bootstrap.

When a currently featured live mini-TV game finishes, the browser must receive or fetch a refreshed finished projection/markup before trying to replay it. The current finish handler only changes the result display. Put this refresh in the TV ownership layer (actor/broadcast or one canonical endpoint), reinitialize the mini safely, and dispose the previous controller and timers.

### 7.3 Untimed, correspondence, imported, and migrated records

Persistence and presentation have different requirements:

- Store exact native move occurrence times for new correspondence and unlimited games for research.
- Do not make the full recorded-game real-time clock Play feature claim that a correspondence or untimed game is real-time.
- A mini-TV board may use a compressed/default presentation cadence for extremely long gaps or unavailable timing; this is an explicit UI policy, not stored “fake” history.
- Migrated approximate records may be replayed if the product accepts their known limitations. The client contract must carry quality so they are never labeled exact. Missing first moves should remain unknown, not be converted to false zero facts inside `th`.
- Imported timing is shown only to the confidence justified by its source. `Unavailable` means no clock playback control.

### 7.4 Accessibility, localization, and responsive behavior

Use the shared button/icon/theme infrastructure. The triangle and square are visual state, while changing localized text supplies `title` and `aria-label`. Add proper translation keys for “Play real-time replay” and “Stop real-time replay”; do not leave the existing hardcoded English scattered across Scala and TypeScript.

Use a native `button type="button"`, visible focus, `aria-pressed`, and icon content hidden from assistive technology. Verify keyboard and touch activation, right-to-left layout, and desktop/intermediate/mobile placement.

For auto-playing mini TV, choose and document one accessible motion policy. At minimum honor `prefers-reduced-motion`; a user who asks for reduced motion should receive a static final board or a user-started replay rather than an unavoidable loop. If mini replay loops, it needs a reachable pause mechanism and must dispose timers when replaced or removed. Autoplay-once followed by the final position is an acceptable simpler design.

## 8. Data migration

Create a production migration package under a sortable path such as:

```text
tools/data_migration/YYYY-MM-DD_01_game_timing_history/
  README.md
  migration entry point
  legacy cw/cb/mt decoder
  target encoder integration
  validator/reporting
  fixtures/tests
```

Use the implementation date, not the example date. Historical format knowledge belongs here after cutover. Prefer a small migration-only JVM executable built against the canonical target encoder so JavaScript and production code cannot implement different `th` encodings. Another packaging choice is acceptable if it still has one target encoder and no legacy runtime reader.

### 8.1 Conversion rules

Process `game5` through a streaming cursor and bounded batches, in a deterministic order. For every document:

1. Validate its expected source schema and capture the raw fields needed for comparison.
2. Decode `cw`/`cb` with the old clock configuration and flagged-game rules when present.
3. Decode `mt` buckets when present.
4. Construct a valid target `th`:
   - `cw`/`cb` becomes `MigratedApproximate`; the two initial think times, transient adjustments, lag detail, exact event timestamps, and removed takeback moves are not recoverable.
   - `mt` becomes `MigratedApproximate`; values are bucketed and capped, so retain their uncertainty.
   - genuinely declared import annotations become `ImportedDeclared`.
   - missing, corrupt, or insufficient history becomes `Unavailable`, not invented zero-duration events.
5. Reconcile any representable final clock checkpoint with `c` without relabeling the record exact.
6. Atomically set `th` and the new strict game schema marker, and unset `cw`, `cb`, and `mt`.
7. Leave `_id`, moves, players, status, source, `c`, `ca`, `ua`, relationships, and every unrelated field unchanged.

Every document must end in the target schema, including unavailable histories. The new application therefore needs no missing-field compatibility branch.

Use a guarded update filter containing `_id` and expected source/target state. An unexpected concurrent or partially converted document should fail with an actionable report rather than be overwritten or silently skipped.

### 8.2 Tool modes and interruption behavior

The tool should expose real modes that share decoding and validation code:

- `inspect`/`dry-run`: scan and encode all selected records, calculate provenance and projected sizes, write nothing;
- `apply`: convert in bounded batches with progress and checkpoints;
- `validate`: scan the final collection with the target decoder and enforce collection-wide invariants.

Track a migration identity and explicit states in the existing migration metadata mechanism, for example `backed_up`, `converting`, and `complete`. Exact labels may follow existing conventions. Requirements:

- unknown state halts activation;
- `complete` reruns validation and exits successfully;
- interruption is either resumable from a tested checkpoint or requires restore from the intact source archive;
- mixed state is never exposed to the new application;
- completion is recorded only after final validation passes;
- a filesystem pending guard remains until activation is committed.

Report selected, converted, resumed, approximate, unavailable, corrupt/failed, and byte-size totals without printing game contents or secrets.

### 8.3 Mandatory backup

Before the first modifying operation:

1. Prevent public game mutations and stop `lila`, `lila-ws`, the Pikafish worker, and every other game writer.
2. Verify Mongo health and free disk capacity.
3. Create a full gzip `mongodump` archive of `lichess.game5`, not merely the three fields being changed.
4. Write to a temporary `.next` path, require non-empty output, run gzip integrity validation, and calculate SHA-256.
5. Record a manifest containing migration/build identity, timestamp, document count, source-field/target-field counts, schema counts, and index definitions or equivalent restore evidence.
6. Atomically move the archive, checksum, and manifest to retained recovery paths outside swappable release directories.
7. Restore the archive into an isolated temporary database/namespace and verify count and indexes, then delete only that verified temporary namespace.
8. Retain the original archive and evidence after success. Do not invent an expiration policy. Prefer an additional checksum-verified operator-controlled copy outside the live Mongo volume.

An undo script or an archive taken after partial conversion is not a substitute for intact source data.

### 8.4 Final validation

Before activation, require:

- identical document count and `_id` set;
- every document has a decodable target `th` and target schema marker;
- no document contains `cw`, `cb`, or `mt`;
- `c`, `ca`, and `ua` remain value-equivalent to the source manifest/snapshot;
- moves, players, status, source, and unrelated fields are unchanged;
- event/move associations obey target invariants;
- offsets are ordered and non-negative where required;
- final timing state is consistent with `c` for representable records;
- approximate/unavailable data is not labeled exact;
- codec/event/BSON bounds hold;
- the new BSON reader can load every game;
- representative API, PGN, analytics, finished-viewer, and TV projections work.

Counts alone are insufficient; include semantic fixture and sampled projection checks.

## 9. `push-local-live` integration and recovery

The canonical deployment entry point is the sibling workspace's `lixiangqi-beta-deployment/push-local-live.cmd`, which invokes `push-local-live.ps1` and `push_transport.py`. It already packages native-rank/video migrations, stops writers, creates checked targeted archives, tracks pending guards, rolls back in reverse order, recovers interrupted activations, and retains migration evidence. Extend that machinery; do not introduce a second deployment path or a manual production step.

Required integration:

- Make `push-local-live.ps1` require, build, fingerprint, package, and hash-validate the timing migration artifact. `-SkipBuild` must reject an incompatible cached binary/codec.
- Package the migration under the release's `migrations/` directory.
- Add timing migration apply, rollback, recovery, validation, and commit/finalize handling to `push_transport.py` following existing conventions.
- Run it automatically when its completion marker is absent; it is unrelated to `-UploadGamesDatabases`.
- Update the deployment manifest to describe this operational-data migration and retained recovery artifacts.

Do **not** add `game5` to `DEPLOYED_MONGO_COLLECTIONS`. That whitelist owns replaceable puzzle projections and deliberately rejects operational game data. The local Mongo snapshot/export step is not a backup of live games. Convert the preserved live collection through the guarded migration.

### 9.1 Required activation ordering

The existing deployment can restart public services before the outer HTTPS readiness loop finishes. If readiness then fails and the pre-migration `game5` archive is restored, games or moves accepted during that interval would be erased.

Therefore public game mutations must remain impossible from backup start until activation commitment:

1. Enable the smallest reliable public maintenance/write gate.
2. Stop all application writers.
3. Create and verify the backup.
4. Inspect, convert, and validate `game5`.
5. Start the new services behind the gate.
6. Run database, internal application, asset, proxy, and TLS readiness checks without accepting game mutations.
7. Commit the new release/database pairing.
8. Open normal traffic.
9. Remove the pending guard only after successful commitment.

The engineer may implement the gate with Caddy maintenance routing, services bound only to internal readiness, or an application read-only mode, whichever is smallest and reliable in the actual topology.

Automatic full-collection rollback is safe only while the deployment can prove no post-backup writes were accepted. Otherwise remain in maintenance and require deliberate reconciliation.

### 9.2 Immediate rollback while quiesced

Verify the archive checksum; stop new writers; replace only `lichess.game5` from the checked archive with restore errors fatal; verify count, fields, schema, and indexes; remove only this migration's marker; restore the previous application; verify it; then remove the guard. Preserve the archive.

Because the runtime schema is strict, restore `game5` **before** starting the prior binary. Do not roll back code alone against the new schema.

### 9.3 Defect discovered after traffic reopened

Never blindly restore the old archive over newer live games. Close writes, back up current state, restore the original archive into an isolated recovery database, correct the converter/codec, reconvert, reconcile games and changes created after cutover, validate the combined target state, and only then replace live data. Recovery should end in the new canonical format, not revive a permanent legacy runtime.

## 10. Verification plan

### Backend and codec

- codec round trips and property tests;
- unknown version, truncation, corruption, non-monotonic offsets, excessive events, oversized values, and huge correspondence gaps;
- exact first move and alternating moves;
- zero and nonzero increment, lag compensation, and raw-versus-charged time;
- delayed clock start, move-time-limit pause/start, berserk, added time, and restart correction;
- timeout, resignation, draw, abort, mate, and terminal delay;
- correspondence, unlimited, AI/fishnet, and imported games;
- one- and two-ply takebacks, replacement lines, full-session projection, and abuse limits;
- insert, diff update, batch flush, BSON reload, lazy decode, and `c`/last-event consistency.

### Migration and deployment

- real-time `cw`/`cb`, flagged clocks, odd/even `mt`, absent and corrupt fields, imports, takebacks, and maximum games;
- dry-run equivalence to apply logic;
- repeat and interrupted runs at every checkpoint;
- backup, gzip/checksum, isolated restore verification, and manifest comparison;
- failures in backup, conversion, validation, restore, or guard handling prevent startup;
- rollback order is the reverse of apply order;
- finalization retains the timing archive;
- deployment payload validation continues to reject `game5` as replaceable content;
- the public mutation gate stays active through commitment.

### Consumers and UI

- API, PGN, tree/study, GIF, insight, evaluation, playban, and Irwin contracts;
- first-move analytics behavior and recalibrated thresholds;
- `/analysis` and `/$id/.../analysis` receive no playback capability/control;
- `/$id` finished viewer loads at final clocks without ticking, shows exact frames at every mainline ply, handles variations, Play, Stop, manual navigation, and completion;
- full TV exposes Play at latest/final and earlier plies, works when opened before two moves, appends live events, and restores socket clock after catch-up;
- full TV control is reachable/focusable at desktop, intermediate, and mobile widths;
- mini TV animates a finished fallback game, uses exact timing when available, uses explicit presentation cadence when unavailable, handles live-to-finished refresh, dynamic featured replacement, cleanup, and malformed input;
- scheduler tests cover zero/long delay, stop mid-segment, resume boundary, background visibility, timer overrun, non-move events, terminal events, and start from final;
- localization, screen-reader names, keyboard/touch interaction, right-to-left layout, and reduced-motion policy.

## 11. Current code landmarks

Use these as starting points, then follow callers rather than assuming the list is exhaustive:

- Game domain fields and current-clock behavior: `modules/core/src/main/game/Game.scala`.
- Central constructors: `modules/core/src/main/game/NewGame.scala`.
- Legacy timing derivation, move mutation, clock start, berserk, and finish helpers: `modules/game/src/main/Game.scala`.
- Legacy binary codecs: `modules/game/src/main/BinaryFormat.scala`.
- Mongo read/write and diffs: `modules/game/src/main/BSONHandlers.scala` and `modules/game/src/main/GameDiff.scala`.
- Repository/query projections: `modules/game/src/main/GameRepo.scala` and `modules/game/src/main/Query.scala`.
- Authoritative move step: `modules/round/src/main/MovePlayer.scala`.
- Durable batching boundary: `modules/round/src/main/GameProxy.scala`.
- Add-time and correspondence adjustment: `modules/round/src/main/Moretimer.scala`.
- Start/restart actor paths: `modules/round/src/main/RoundAsyncActor.scala`.
- Takebacks and termination: `modules/game/src/main/Rewind.scala`, `modules/round/src/main/Takebacker.scala`, and `modules/round/src/main/Finisher.scala`.
- Interim server playback projection: `modules/game/src/main/RecordedClockTimeline.scala`.
- Interim shared scheduler: `ui/lib/src/game/replay/recordedClockPlayback.ts`.
- Finished-viewer adapter/template: `ui/xiangqi/src/xiangqi.analysis.ts`, `app/controllers/Analyse.scala`, `app/controllers/UserAnalysis.scala`, and `app/views/xiangqi.scala`.
- Full TV adapter/control: `modules/api/src/main/RoundApi.scala`, `ui/round/src/ctrl.ts`, and `ui/round/src/view/replay.ts`.
- Mini-TV data and playback: `modules/game/src/main/ui/GameUi.scala`, `modules/tv/src/main/Tv.scala`, `modules/tv/src/main/TvSyncActor.scala`, and `ui/lib/src/view/miniBoard.ts`.
- Deployment entry point and remote activation: `../lixiangqi-beta-deployment/push-local-live.ps1` and `../lixiangqi-beta-deployment/push_transport.py`.

The interim [Recorded clock replay](RECORDED_CLOCK_REPLAY.md) document describes the current `cw`/`cb` implementation. Replace or remove it when this design lands so it cannot remain a competing architecture description.

## 12. Suggested implementation sequence

1. Define semantic invariants, provenance, projections, event bounds, and benchmarks before fixing the byte layout.
2. Implement and test the `GameTiming` domain/codec in isolation.
3. Integrate authoritative capture through every owning transition and persistence diff; prove `c` consistency.
4. Move all server consumers to projections from `GameTiming`.
5. Build the migration-only legacy decoder/converter and fixture suite.
6. Replace the viewer JSON contract and shared browser controller, then add the three adapters/capabilities.
7. Fix Analysis Board, full TV, and front-page TV behavior together and add responsive/accessibility tests.
8. Integrate migration/backup/write-gate/recovery into `push-local-live` and its transport safety tests.
9. Run the complete migration in an isolated production-like copy, collect size/CPU/write-amplification evidence, and adjust encoding/bounds if needed.
10. Remove `cw`/`cb`/`mt`, legacy runtime codecs and queries, obsolete projector logic, zero-first-move assumptions, and the superseded interim replay documentation.
11. Perform a fresh architectural and migration-safety review before any separately authorized production deployment.

## 13. Engineer latitude and completion criteria

This specification fixes responsibilities, data integrity, product behavior, and deployment safety. It intentionally does not freeze exact Scala names, binary tags, byte widths, UI file boundaries, numeric caps, or maintenance-gate mechanism. Depart from a suggested detail when repository evidence or measurement supports a cleaner solution, but preserve these outcomes:

- one canonical historical timing model;
- exact server capture for all new native games;
- honest provenance for converted/imported data;
- hot operational fields remain hot;
- no permanent legacy runtime format;
- atomic game/timing persistence and bounded resource use;
- shared projections and one browser scheduler;
- explicit viewer capabilities;
- the three related UI bugs fixed;
- recoverable migration integrated into the real deployment flow;
- no period in which automatic rollback can erase accepted post-backup games.

The implementation is complete only when the old fields and paths are removed, the migration and rollback are tested, relevant consumers use the new projections, and the observable viewer/TV acceptance cases pass.
