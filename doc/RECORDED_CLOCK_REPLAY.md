# Recorded clock replay

Historical real-time replay is built from the native game clock (`c`) and both
compressed clock histories (`cw` and `cb`). The `mt` field is deliberately not
accepted: it stores move durations for games without a real-time clock and
cannot reconstruct what both clocks displayed.

`lila.game.RecordedClockTimeline` is the single server-side projection. It
validates the stored history and exposes:

- `startPly`, the ply of the root position;
- `positions`, both clocks at the root and after every recorded move;
- `delays`, the server-accounted time before each move.

The invariant is `positions.length == delays.length + 1`. If the clock or either
history side is missing, or the history cannot cover the recorded mainline, the
timeline is omitted and viewers must not offer real-time playback.

The browser uses `RecordedClockPlayback` for scheduling and interpolation.
Board navigation, sounds, animations, and page layout are supplied by small
surface-specific adapters. Every move boundary snaps to the authoritative
stored position so browser timer drift cannot accumulate.

The clock-history format does not preserve either player's first think time.
The replay therefore advances each player's first move immediately, matching
the existing server `moveTimes` convention, and uses recorded timing from the
third ply onward. The root snapshot comes from each clock player's configured
starting limit; all move snapshots come from `cw`/`cb`.

Completed game viewers display recorded clocks only on the original mainline.
Analysis variations have no clock data. The live TV round viewer uses recorded
clocks only while reviewing earlier moves and restores its socket-driven clock
at the newest move. Mini-TV replay uses the same controller in auto-starting,
looping mode.

This feature does not repair game statuses, infer missing clock history, replay
removed takeback branches, or reconstruct the precise timing of non-move events
such as resignation and adding time.
