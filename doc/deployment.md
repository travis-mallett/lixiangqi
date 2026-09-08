# Deployment, updates, and local service hygiene

Read this guide for changes to runtime requirements, deployment tooling, data migrations, or
local service startup. [Data and migrations](data-and-migrations.md) owns backup and conversion
requirements; this guide explains how releases must account for them.

## Authority and current operating model

At the current project stage, planned service interruption is acceptable. The server is
restarted during updates. Prefer a controlled stop, upgrade, migration, and restart over
permanent dual-format readers, dual writes, rolling-release compatibility, or other complexity
introduced only to maintain uninterrupted service.

This is a current operational assumption, not an eternal requirement. Revisit it when the
project's user base and availability requirements change. Do not prebuild a zero-downtime
platform now or unnecessarily couple permanent domain behavior to this deployment model.

An ordinary coding task authorizes preparing and testing code, migration tools, and deployment
integration; it does not itself authorize deploying to production, reading live user data,
performing a live migration, or restoring production data. Perform those operational actions
only when the user explicitly requests or authorizes them. Do not mistake a request to update
`push-local-live` for a request to run it.

## Inspect `push-local-live` when operations may change

For substantial architectural, runtime, dependency, or data changes, inspect the actual
`push-local-live` entry point and relevant helpers. Determine whether the release process
already supports the change. Do not assume a particular filename extension, command line,
service manager, backup command, or remote path without checking the repository.

Typical deployment implications include a migration, index creation, build step, runtime
binary, configuration requirement, filesystem location, permissions change, or worker lifecycle
change. Integrate a required step into the existing process instead of leaving an undocumented
manual action that every future deployment must rediscover.

Do not modify deployment tooling for a change with no deployment-process implications. Use
existing conventions rather than adding a parallel release system. Identify new prerequisites
and how they are supplied without committing credentials or machine-specific secrets.

## Plan the transition explicitly

The safe order depends on which code and tooling can read each data representation. Do not
blindly prescribe migration before all deployment or after all startup. Distinguish staging
new artifacts from starting the new application against live data.

For a breaking internal data change, a typical transition is:

1. **Prepare:** build and test the target code and migration locally; establish required runtime
   dependencies, backup capacity, execution identity, and validation steps. Stage artifacts as
   appropriate without exposing new code to incompatible data.
2. **Quiesce writes:** stop or constrain the application and every relevant writer, including
   websocket services, workers, jobs, or administrative processes that affect the dataset.
3. **Capture source:** create or verify a consistent, recoverable pre-migration backup with
   identifiable scope. A previous arbitrary backup is not automatically adequate.
4. **Convert:** make the required migration tooling available and run applicable outstanding
   migrations in their defined order. Do not blindly rerun completed conversions.
5. **Validate:** confirm preservation and target-format invariants, not merely a zero exit code.
   Mark completion only when the required checks pass.
6. **Activate:** start the target application and required services only when their data and
   configuration prerequisites are satisfied; perform focused health and behavior checks.
7. **Retain recovery evidence:** preserve the original backup, migration identity, execution
   results, and recovery instructions after service resumes.

Adjust this sequence to the actual change. Installing tooling may precede the write freeze;
activating a reader that requires migrated data may not. Do not add compatibility branches to
avoid reasoning through the ordering.

## Fail safely; do not hide a partial release

Backup failure, conversion failure, or broken validation must halt the affected transition.
Keep relevant writes stopped or the service in an appropriate maintenance state rather than
exposing an unvalidated mixed representation. Make the failed step and recovery prerequisites
clear without leaking user data or credentials in output.

Check error propagation through the actual script and its subprocesses. Cleanup or `finally`
blocks must not unconditionally start code whose prerequisites failed. Separate releasing
local resources from declaring a production release ready.

Do not automatically roll back code alone after a schema change: the old program may not
understand transformed data. Recovery should follow the migration-specific plan. Preserve the
original backup through retries and do not replace it with a snapshot of partially migrated
records.

Use an existing migration runner or execution record when present. Otherwise add only the
smallest dependable guard or completion tracking needed; do not require a new framework merely
for bookkeeping. Verify the repeat-run behavior the deployment process actually relies on.

## Recovery after the site is back online

A backup must remain usable if a defect is discovered after deployment, not just during the
release window. Recovery means correcting the migration or new implementation and reconstructing
the intended new state from preserved information; it does not require keeping the old runtime.

Before restoring older data, preserve the current state and account for post-deployment writes.
New games, accounts, and settings must not disappear because an old whole-database backup was
restored indiscriminately. Use the detailed
[late-discovery recovery procedure](data-and-migrations.md#8-recovery-when-a-defect-is-discovered-later).

Do not automate destructive restoration or backup expiration merely to make rollback appear
simple. Production recovery still requires explicit operational authorization.

## Verify the deployment integration without deploying by default

Test changed orchestration at the safest appropriate level using the project's existing tools.
Check syntax, argument handling, prerequisite checks, failure propagation, ordering, and the
migration's local fixture tests as relevant. Simulate failures where practical, especially a
failed backup or migration, and confirm they cannot be followed by a normal startup.

Use a real dry-run or isolated test environment only when supported. Do not run a production
push command to "see what happens," invent an unsupported dry-run flag, or claim a deployment
was verified merely because the script was read.

In the task result, distinguish code and tooling prepared from operations actually executed.
State relevant checks, remaining prerequisites, and any untested remote behavior. Do not claim
that production backup, migration, or deployment has occurred when only integration was added.

## Local-service hygiene

Automated contributors must not leave task-started project development services or launchers
running after verification, including after failed startups or failed tests.

Before starting services, identify what is already running and track what the task starts.
This includes the LiXiangQi web application, `lila-ws`, SBT, the Xiangqi explorer, the Pikafish
worker, and their child processes. A failed startup or closed terminal does not by itself
establish that all launched processes have stopped.

After verification in the project's Windows workflow, run the designated cleanup command from
the repository root:

```powershell
.\scripts\windows\Start-Lixiangqi.ps1 -StopOnly
```

The designated script is `scripts/windows/Start-Lixiangqi.ps1`. Preserve its cleanup safeguards:
validate both executable path and command line before stopping processes. Do not replace this
with a broad process-name kill.

After a failed startup, proactively inspect for project-owned SBT and forked JVM processes
whose command lines reference this checkout or its local `lila-ws` configuration. Stop remaining
task-owned processes and check that cleanup succeeded. Account for launched workers and child
processes, not only the original launcher.

Never terminate unrelated Java, SBT, Python, Node, or other processes. A runtime name alone is
not evidence of project ownership. Respect pre-existing services; determine the intended
cleanup scope instead of treating every process on the machine as disposable.

On a platform where the Windows launcher cannot run, use the established platform-specific
procedure or stop only positively identified task-started processes. Do not claim the Windows
cleanup command ran when it was unavailable. Report unresolved leftovers rather than killing
unrelated processes in an attempt to guarantee an empty process list.

## Completion criteria

A deployment-affecting coding change is ready for review when required server steps are
integrated; backup, migration, validation, and startup ordering is explicit; failure leaves a
recoverable state; and task-started local services have been cleaned up. Production execution
remains a separate action unless explicitly included in the user's request.
