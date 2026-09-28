# Deployment readiness — September 12, 2026

**Subsequent incident:** the live deployment exposed a WAL handoff and recovery-flow
gap missed by this preparation. See [the incident report](DEPLOYMENT_INCIDENT_20260912.md)
for restoration, fixes, and the expanded integration checks.

The application release has been prepared and validated locally. No deployment,
production migration, production backup, or live data write was performed in this audit.

## Live comparison

The live release identifies itself as `e7fb85c83796`, built September 9. The checkout
has the same Git HEAD plus the current uncommitted changes, so Git revision alone
does not identify the release contents. The deployment now fingerprints complete
application build inputs before allowing cached builds.

| Dataset                                     | Read-only live observation                                               | Required deployment action                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Published puzzles                           | 108; all lack source snapshots, explicit retirement, and theme ownership | Add validated metadata from live sources, retaining full original documents                               |
| Native games                                | 308; no finished games missing completion timestamps                     | Existing completion migration checks and exits without backfilling                                        |
| Games catalog                               | 175,124; schema 9, projection 2, current                                 | Read-only verification; no conversion or replacement                                                      |
| Rank/video data                             | Existing migrations complete                                             | Existing idempotent migration checks                                                                      |
| Accounts, settings, authentication, history | No redesigned storage format identified                                  | Preserve existing collections, volumes, and server secrets                                                |
| MongoDB topology                            | Standalone                                                               | Existing deployment integration takes a full checked backup before single-node replica-set initialization |

All 108 puzzle targets validated against the server's catalog in a read-only
rehearsal. No puzzle cron writers were found in root crontab or system cron files.
The server had approximately 165 GiB free at inspection. These observations do not
replace the deployment-time write gate, backup, and validation steps.

## Prepared safeguards

- Application payloads reject server data. Neither rollout nor rollback installs
  local puzzle inventories, mining databases, or games databases.
- The live `data` directory moves once to a stable sibling directory. Release
  generations link to it; deleting old application releases cannot delete it.
- The puzzle migration validates all targets before writes, saves immutable
  originals and plans, preserves all original fields and user-history collections,
  and resumes safely after interruption. Later publication/activity is never
  overwritten by replaying the initial migration.
- Catalog projection upgrades create checked recovery copies only when required.
  Current catalogs receive no schema writes. The catalog helper also closes its
  SQLite connection deterministically.
- Required explorer identity code and migration dependencies are packaged.
  Native launchers retain executable permissions after upload, checksum failures
  propagate, and backup archives are retained through release cleanup.
- Pending additive puzzle migration finishes before recovery reopens old writers.
  No database rollback is allowed after writers resume. The restart helper refuses
  to bypass a pending deployment gate.

## Verification

- Frontend installation, formatting, lint, and format checks passed.
- Production asset build passed; all 376 frontend tests passed. On this Windows
  checkout, the symlink-backed test entry point was invoked as
  `node ui/.test/runner.mjs` after the Bash build.
- Scala formatting checks and `test;stage` passed. The live-Mongo publication
  integration suite passed all 3 tests against an isolated local database.
- 129 puzzle mining tests, 88 content/environment/publication tests, and 24 focused
  catalog/source tests passed.
- All 8 deployment migration tests and 25 transport safety tests passed, including
  interrupted migration, failed backup, preserved later activity, replica setup,
  and activation ordering. Game-completion migration tests also passed.
- PowerShell and shell syntax checks, packaged Python imports, and diff whitespace
  validation passed.
- A full `push-local-live.ps1 -PrepareOnly` build and subsequent cached preparation
  passed: 9,936 application files, approximately 0.58 GiB, with no remote commands.

Deployment scripts and their tests are in the sibling `lixiangqi-beta-deployment`
workspace. Its `DEPLOYMENT-MANIFEST.md` documents activation and recovery locations.
The prepared payload is `.release-next-v2` there. A normal `push-local-live` remains
a separate, explicitly authorized production action; this audit did not execute it.
