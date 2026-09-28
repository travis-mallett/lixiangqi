# Deployment incident — September 12, 2026

## Service restoration

The failed release left the operation journal in `gated`, with application services
stopped. The previous application release and rollback images remained intact.
The puzzle migration marker was absent: validation failed before any puzzle writes.
Inspection found 108 puzzles, zero migrated source snapshots, and 308 native games.

The previous September 9 release was restored using the guarded rollback path.
No database snapshot was restored. MongoDB's completed replica-set conversion was
retained, as were the stable server data directory and all existing game/user data.
Public homepage, training, video, explorer, and compiled stylesheet checks passed.
The corrected release was prepared locally, not deployed during incident recovery.

## Causes

1. Catalog verification could leave an empty WAL sidecar. Puzzle migration rejected
   any WAL filename, and deployment had no explicit SQLite checkpoint handoff before
   opening the catalog as immutable. The prior read-only rehearsal skipped that
   preceding deployment step and therefore did not reproduce the failure.
2. Failed activation had no automatic recovery handler. On the next invocation,
   recovery ran only after building; after restoring service it returned ordinary
   success, allowing the same invocation to deploy the failing release again.
3. Public readiness checks ran outside guarded remote activation. Startup errors
   after writers resumed lacked a compatible code-only recovery path.

## Changes

- Catalog preparation now calls SQLite `wal_checkpoint(TRUNCATE)` while writers
  are stopped and checks the result. It never deletes a WAL manually. Puzzle
  migration permits empty sidecars but still rejects uncheckpointed frames.
- Remote activation has an exit/signal recovery handler. A failed migration triggers
  guarded rollback immediately. The original deployment still reports failure;
  successful recovery is reported separately and does not retry activation.
- Recovery runs before building. It returns a distinct result that makes the
  PowerShell entry point stop. Automatic recovery records an acknowledgment flag
  while keeping the site's phase `open`; the next invocation checks health,
  acknowledges recovery, and stops without deployment.
- Public readiness is verified within guarded activation. `open` is recorded only
  after homepage, training, video, explorer, and stylesheet checks pass.
- After writers start, recovery may restore compatible previous application code
  while preserving all current databases. It verifies the previous rank/video/game
  migration contracts first. Incompatible contracts fail closed rather than restore
  stale user data. Code rollback has a durable phase and resumes interrupted renames.
- Rank/video scripts run with `mongosh --file /dev/stdin`, avoiding interactive
  prompts and preserving script failure exit codes.

## Verification

35 transport/recovery tests and 13 migration tests passed. Coverage includes actual
PowerShell recovery exit behavior, activation failure, no implicit retry, failed
recovery, post-start code recovery without database restoration, both rename
interruption points, committed WAL preservation, busy checkpoints, empty sidecars,
and the combined real catalog-preparation/puzzle-migration handoff.

The public health probe passed against the restored live release. The previous and
failed release's rank/video/game migration contracts matched. Noninteractive
`mongosh` was checked using read-only success and intentional-error probes; the
error correctly returned a nonzero status.

Recovery cannot safely restore incompatible data after new writes. Future breaking
migrations must explicitly extend the code compatibility gate and recovery design.
Lost processes or machine failure remain recoverable through the durable journal;
the next invocation must recover before attempting another release.
