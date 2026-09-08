# Data and migrations

Read this guide before changing persisted representations or writing a production data
migration. [Architecture](architecture.md) defines the clean-state policy;
[deployment](deployment.md) owns release sequencing and service cleanup.

## 1. One current runtime model

Choose the best permanent representation first, then migrate controlled data and callers to
it. Do not add parallel fields, old/new runtime readers, dual writes, or fallback calculations
merely to avoid converting historical records.

After the transition, application code should use only the canonical representation. Remove
obsolete fields and runtime paths. Keep the knowledge needed to read historical formats in
migration tools, not ordinary request, game-loading, or rendering paths.

Temporary migration staging is acceptable when it improves safety, provided it is explicit,
is not a second permanent source of truth, and has a defined cleanup step. Recoverable backups
and historical migration tools are intentional exceptions to removing superseded material.

Compatibility required by an external consumer is a separate constraint; see
[architecture](architecture.md#4-canonical-ownership-and-necessary-compatibility).

## 2. User-data backup is a prerequisite, not an optional enhancement

Every migration that modifies persistent user data must create or verify a recoverable
pre-migration backup before its first modifying operation. This includes games and game
history, accounts, registration and authentication records, profiles, preferences, settings,
user-created content, and related records needed to preserve them. A supposedly simple or
additive transformation is not exempt merely because it appears low risk.

A read-only inspection does not itself require a migration backup. Purely rebuildable caches
may use a rebuild procedure instead, but establish that they contain no unique user information.
When a dataset mixes derived and irreplaceable information, protect the irreplaceable source.

The backup must preserve enough original information to correct a faulty migration or new
implementation and rerun the conversion later. An undo script, successful exit code, or backup
of already-transformed data is not a substitute for intact pre-migration source data.

### Required backup properties

- **Adequate scope:** capture affected source records and any related information needed for a
  coherent recovery. Use a full snapshot or a deliberately scoped backup based on the change;
  do not assume a few exported fields are sufficient.
- **Consistent capture:** stop relevant writes or use an established consistent snapshot method.
  Include workers and other writers, not only web requests. Current policy permits downtime.
- **Identifiable contents:** record the migration ID, source format or code revision where useful,
  capture time, affected datasets, and backup location without exposing secrets.
- **Recoverability:** check that the backup is readable and that the documented restore/recovery
  procedure works at an appropriate level. File existence alone does not establish this.
- **Independent retention:** do not overwrite the only original backup on a retry or remove it
  because deployment succeeded. Keep it outside disposable build/release directories and source
  control, with access appropriate to the user and authentication data it contains.

The project has not adopted a blanket retention period. Do not invent one or silently expire
recovery data. Backup disposal needs an explicit retention decision after recovery needs are
understood. Retaining a backup does not require keeping the old application runnable.

## 3. Establish the transformation before writing it

Inspect the actual schema, readers, writers, indexes, representative data shapes, and important
consumers. Do not infer production fields or conversion rules from a conceptual example.

Define the source state, target state, affected records, and invariants that must survive.
Identify unchanged information that must not be lost, including identifiers and relationships.
Record how malformed, incomplete, or partially converted records are handled.

For a `game5` clock redesign, determine exactly what the old clock data contains and whether
it is sufficient to construct the desired representation. Do not fabricate exact timing values
that were never stored. Surface information loss or ambiguous conversion as a design decision
rather than silently guessing, discarding records, or adding permanent legacy readers.

Prefer transformation of existing data into the chosen model over schema accumulation. This
does not require normalization for its own sake or prohibit a justified compact encoding or
derived field. [Performance](performance.md) covers server and storage tradeoffs.

## 4. Tool organization and execution identity

Keep production data migration tooling under `tools/data_migration/`. Use sortable date- or
version-prefixed identifiers with a descriptive purpose. A suitable convention is
`YYYY-MM-DD_NN_short_description`, where the sequence distinguishes migrations on the same day.
Follow an already established sortable convention rather than creating a competing one.

A migration may be a script or a small directory of related code, tests, and instructions.
Document enough to establish:

- Source and target representations, scope, prerequisites, and required ordering.
- Invocation, execution environment, dependencies, and any preview mode actually supported.
- Backup requirements and where execution records identify the original backup.
- Validation, repeat-run behavior, partial-failure recovery, and deployment integration.

Keep code and operational instructions together. Do not scatter one-off production scripts
through unrelated folders. Retain or deliberately archive historical tools needed for recovery;
a passed deployment is not grounds for deleting them. Long-term archival policy remains a
separate decision, not a requirement to preserve every script forever.

Prefer existing migration execution/tracking mechanisms. If none exists, add the smallest
reliable completion guard or tracking needed by this change; do not automatically introduce
a migration framework or new service. Completion metadata belongs in tooling or operational
state, not in permanent application branches interpreting old formats.

## 5. Failure, reruns, and resource use

Make execution state explicit. A migration must not blindly run on every deployment or apply
the same transformation twice to already-converted data.

Choose and document a safe strategy: idempotent processing, reliable checkpoints, or a guarded
one-time conversion that can be retried from a restored source. Do not claim idempotency without
testing repeated and interrupted execution. Never overwrite the original backup while retrying.

For substantial datasets, use bounded batches or streaming rather than loading the whole
collection into memory. Report useful progress and non-sensitive counts. Unexpected records,
write failures, or broken invariants must produce an actionable failure or an explicit
unresolved-record report, not a silent skip followed by a success status.

A partial migration must not be treated as deployable merely because some records succeeded.
Prevent the new application from being exposed to an unvalidated mixed state. Do not solve
partial failure by adding a runtime legacy fallback.

## 6. Validation and local testing

Test conversion against representative fixtures, including valid historical shapes, boundary
values, missing or malformed input, and the partial/repeated execution states the tool claims
to handle. Use synthetic or appropriately sanitized fixtures; never commit production user
records or credentials.

Validate both preservation and intended change. Depending on the transformation, check:

- Record identities, counts, relationships, and unaffected fields.
- New schema and domain invariants, including meaningful sample values.
- Removal of obsolete fields without loss of required information.
- Readability through the new application's relevant code paths.
- The recovery procedure from an intact original backup.

Counts alone do not prove a semantically correct conversion. Conversely, successful loading of
one sample game does not prove collection-wide completion. Choose evidence proportionate to
the transformation and report what was actually verified.

A preview or dry-run mode is useful when it exercises the real selection and conversion logic.
It is not a replacement for backup, validation, or a recovery test. Do not add misleading flags
that only simulate a small, unrelated part of the operation.

## 7. Integration with deployment

A migration is incomplete until `push-local-live` accounts for backup, write quiescence,
conversion, validation, and startup ordering as appropriate. Inspect the actual script and
its called helpers rather than inventing a deployment command or assuming existing support.

A failed backup or migration must stop the relevant release transition. Do not start code
requiring the new representation against incomplete data, or automatically restart old code
against transformed data. Planned downtime is preferable to avoidable user-data corruption.

Preparing tools and deployment integration does not authorize an agent to access production
data, deploy, migrate, or restore the live server. Follow the execution boundary in
[deployment](deployment.md#authority-and-current-operating-model).

## 8. Recovery when a defect is discovered later

Recovery must account for a migration bug found after the new system has been serving users,
not only a failure caught during deployment.

Preserve the original backup. Before a corrective restore or replacement, protect the current
live state and stop relevant writes as needed. Determine whether new games, registrations,
settings changes, or other user writes have occurred since the original capture.

Do not blindly restore an older whole-database snapshot and erase those later writes. Where
necessary, restore the original source into an isolated recovery dataset, fix the converter or
new implementation, rerun the conversion, and validate it. Reconcile affected records with
post-deployment changes using a deliberate, tested procedure that preserves identities and
relationships. Surface any genuinely conflicting edits for resolution rather than overwriting
them silently.

The result should still be the new canonical format. Recovery is not a requirement to revive
the old runtime or permanently retain both representations.
