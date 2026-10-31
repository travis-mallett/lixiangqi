# Browser tournament rehearsal

This operator tool creates ten temporary accounts, creates a private **20-minute Standard Xiangqi tournament**, joins all ten players, and plays complete games using ten local Pikafish processes. Each account has its own Chromium process and browser context. The tournament uses a 2+1 clock, Tiantian rules, a two-minute lobby, a random entry code, and an allow-list containing exactly the ten accounts.

Registration, tournament creation, joining, pausing, navigation, reconnecting, berserking, and moves use browser controls. The runner reads rendered DOM text, piece classes and board geometry. It does not call application APIs, inspect application state, inject moves, read WebSocket messages, or provision accounts through the database. Browser-generated requests are the site's normal requests. Pikafish runs on the operator's computer, not the server.

The separate cleanup command is an explicitly authorized operator database operation. It backs up and removes the exact run's accounts, tournament, games and related records. No special backend endpoint, testing mode or backend modification is required by the runner or cleanup tool.

## Prerequisites

- Use the repository's Node 24 and pnpm 11 environment. Run `pnpm install` and `pnpm exec playwright install chromium`, or set `browserExecutable` to an installed Chrome/Chromium executable.
- Install a compatible native Pikafish executable and its matching NNUE file. Point `enginePath` to the executable and `engineCwd` to its working directory. The executable must identify itself as Pikafish over UCI.
- Allow enough memory for ten browsers and ten engines. Each engine uses one thread and a 32 MiB hash table. Strengths use increasing search budgets from 100 to 40,000 nodes; these are deliberately different search strengths, not calibrated human ratings.
- For a live rehearsal, use a deliverable catch-all email domain and visible browsers. Complete any email confirmations or CAPTCHA challenges in the corresponding account's browser when prompted. The script does not bypass registration protections.
- Arrange a maintenance window for cleanup. The application, WebSocket server and other database writers must be stopped before deleting the test records and restarted afterward to clear caches.

The event itself lasts 20 minutes. Default live registration spacing adds approximately 20 minutes before the lobby, plus any manual verification. Last games may finish after the event closes and do not count toward its standings, following the site's normal tournament rules.

## Run

Copy `config.example.json` to a private local file and set the origin, engine paths and email template. `{username}` is replaced with each generated username. Optional settings are `browserExecutable`, `registrationSpacingSeconds` and `registrationTimeoutSeconds`. The local origin must be `localhost`, a `.localhost` hostname or a loopback address; otherwise the explicit live flag is required.

```sh
# Local rehearsal against an already deployed local site
node tools/tournament_rehearsal/run.mjs .tools/rehearsal-local.json

# Operator command for a future live rehearsal; not executed during this audit
node tools/tournament_rehearsal/run.mjs .tools/rehearsal-live.json --allow-live
```

The runner refuses non-local HTTP and headless execution. Visible browsers are required even locally because the site can classify headless Chromium as a crawler and serve spectator pages. It defaults to 130 seconds between live registrations. It never changes server registration settings. Use the site's current registration process and resolve any rejection before retrying.

Every attempt gets a unique directory under `.tools/tournament-rehearsal/`, or a new directory supplied with `--output`. A recovery manifest is written **before** the first account registration. Keep this directory even when a run fails:

- `run.json`: exact account identities, tournament ID, games, move histories, results, final standings, and pass/failure status.
- `credentials.json`: temporary passwords and private entry code. Keep this file private; do not commit it or publish it with test results.
- `events.jsonl`: timestamped browser actions and progress.
- `results-desktop.png`, `results-tablet.png`, `results-mobile.png`: final standings at three widths; failures instead capture each player page.

The runner verifies opponents belong to this run, waits for each move to appear on the other player's board, exercises a page reload, pause/rejoin and berserk, checks that every account completes at least two games, and checks the final ten-player standings. It independently recomputes score sheets from the observed results and berserk actions, checks both players agree on which games counted, and fails on uncaught browser JavaScript errors or missing scenarios. It closes its own browsers and engines on normal completion, error or Ctrl+C. An abrupt machine/process termination still requires operator cleanup using the manifest.

## Back up and remove a run

Use Python with the existing `pymongo` dependency installed. Run this on a trusted operator machine with access to the correct MongoDB database. Supply credentials through `LIXIANGQI_REHEARSAL_MONGO_URI`, not command-line arguments or checked-in configuration.

```powershell
$env:LIXIANGQI_REHEARSAL_MONGO_URI = 'mongodb://127.0.0.1:27017'
python tools/tournament_rehearsal/cleanup.py --manifest .tools/tournament-rehearsal/RUN_ID/run.json --database YOUR_DATABASE
```

The first command is a dry run. Review the database, exact run ID and collection counts. After stopping application, WebSocket and worker writers, apply the same plan with a **new** backup directory whose parent exists:

```powershell
python tools/tournament_rehearsal/cleanup.py --manifest .tools/tournament-rehearsal/RUN_ID/run.json --database YOUR_DATABASE --backup /private/offline-backups/RUN_ID --apply --quiesced
```

The tool validates account creation dates, tournament ownership, memberships, game participants and unrated status. It refuses to remove games involving outsiders or to interpret a username prefix as permission to delete accounts. It finds games even if the browser run failed before recording their IDs. The backup stores complete original BSON documents, checksums and counts, verifies round-trip decoding, and checks that documents have not changed before deleting exact IDs. It then checks for remaining records and writes `cleanup-receipt.json` into the backup directory.

Restart the services after cleanup to discard cached sessions, identities and games. Keep the archive offline for recovery. A passed browser run still requires this cleanup step; the receipt proves cleanup completed. Server access logs and aggregate traffic metrics are operational records and are not rewritten by this tool.

If an interrupted cleanup needs recovery, stop writers and restore the verified archive first:

```powershell
python tools/tournament_rehearsal/cleanup.py --database YOUR_DATABASE --restore /private/offline-backups/RUN_ID --quiesced
```

Restore verifies checksums and refuses to overwrite changed documents. It is idempotent. After reviewing the restored data, rerun cleanup with a new backup directory. Restoring intentionally reinstates the temporary accounts and games until cleanup is applied again.

## Checks and scope

```sh
node --test tools/tournament_rehearsal/test.mjs
```

The cleanup integration tests require an isolated local MongoDB and create/drop only uniquely named fixture databases:

```powershell
$env:REHEARSAL_TEST_MONGO_URI = 'mongodb://127.0.0.1:27017'
python -m unittest tools.tournament_rehearsal.test_cleanup -v
```

This rehearsal exercises the released browser tournament lifecycle with Standard Xiangqi. Jieqi and Mini Xiangqi are covered by variant/form/domain checks, not by this Pikafish Standard Xiangqi driver. It is a ten-player functional rehearsal, not a production load test or a guarantee against network, infrastructure or operational failures. See [AUDIT.md](AUDIT.md) for the findings, fixes and local verification evidence.
