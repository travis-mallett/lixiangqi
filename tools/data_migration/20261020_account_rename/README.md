# Rename `testing` to `ChineseChessOutLoud`

Prepared on 2026-10-20. The original preparation was read-only; the subsequent
user-run deployment applied the account rename and reached analytics verification.
See the UTC job-key repair below. This is a deliberately bounded,
one-account migration, not a general username-change feature.

The canonical ID becomes `chinesechessoutloud`; the display name becomes
`ChineseChessOutLoud`. Game IDs, ratings, results, passwords, linked external
identities, API token values, content IDs and uploads are preserved.

## Live evidence

[LIVE_MANIFEST.json](LIVE_MANIFEST.json) is the sanitized result of executing the
actual converter in **audit** mode against production over SSH stdin. No remote
file was uploaded, migration marker written, service restarted, or data changed.
The final scan completed at **2026-10-20 14:50:49 UTC**.

- **849 documents in 43 collections:** 592 in `lichess`, 257 in
  `lixiangqi_traffic`.
- Source account exists and is enabled; destination account and functional
  destination references were absent.
- MongoDB 8.0.28, replica set `lixiangqi`; analytics identity-key check passed.
- No active source games, unfinished puzzle publication, or pending analytics
  maintenance blocked the final audit.
- Redis contained zero keys in the separate read-only inventory.
- July, September and October 2026 analytics need rebuilding.
- Zero unclassified references or target-key conflicts.

This was an online observation, not a consistent backup. Counts can change.
Execution repeats the audit with writers stopped and freezes its own plan.
The manifest contains counts and field paths, never account documents, credentials,
message bodies, API tokens or traffic pseudonyms.

## Complete changed-collection accounting

All rows below are in `lichess`, except the final four traffic rows. Counts are
documents, not individual string occurrences. Rules are explicit in `rules.py`;
new unrecognized references stop execution instead of being guessed.

| Collection | Documents | Change |
| --- | ---: | --- |
| `activity2` | 12 | User/day key; followed-user lists |
| `ai_challenge_stats` | 9 | `user/testing/...` key |
| `analysis_requester` | 1 | Account key |
| `cache` | 1 | Imported-game cache key |
| `chat` | 5 | Serialized author prefix; retain flags, titles and message text |
| `crosstable2` | 5 | Sorted pair key; swap score sides and winner suffixes where order changes |
| `eval_cache2` | 11 | `evals.by` |
| `fishnet_analysis` | 3 | `sender.userId` |
| `game5` | 49 | Player/winner/importer identities; preserve color/player order |
| `history4` | 1 | Account key |
| `learn_progress` | 1 | Account key |
| `matchup` | 5 | Sorted pair key; preserve score ownership |
| `modlog` | 56 | Actor/subject identity |
| `msg_msg` | 77 | Author and sorted thread key |
| `msg_thread` | 5 | Key, participant order, deletion/mask/last-author fields |
| `notation_score` | 1 | Account key |
| `notify` | 43 | Recipient and typed content identity fields |
| `oauth2_access_token` | 4 | Owner; retain token IDs, scopes and expiry |
| `perf_stat` | 5 | Account/performance key; owner and opponent records |
| `picfit_image` | 7 | Owner; local profile URLs where present |
| `plan_patron` | 1 | Account key; granting identity if applicable |
| `playban` | 1 | Account key |
| `player_assessment` | 3 | `userId` |
| `pref` | 1 | Account key |
| `push_subscription` | 1 | `userId` |
| `puzzle2_puzzle` | 10 | Local native source-snapshot player identities; recompute authored `contentDigest` if present |
| `puzzle2_round` | 222 | Account/puzzle key and `u` |
| `relation` | 4 | Directed pair key and endpoints |
| `security` | 8 | Owner and `up=false` to close browser sessions |
| `shutup` | 1 | Account key |
| `study` | 2 | Owner, member-map keys, user and liker lists |
| `study_chapter_flat` | 2 | Owner and nested typed comment authors |
| `timeline_entry` | 9 | Recipient and typed event identities |
| `ublog_blog` | 1 | `user:...` key |
| `ublog_post` | 1 | Blog key; authors, moderation and liker identities |
| `user4` | 1 | Raw BSON account key and display name; preserve all other fields |
| `user_perf` | 1 | Account key |
| `video` | 14 | Creator/updater |
| `video_view` | 8 | User suffix in key and `u` |
| `lixiangqi_traffic.traffic_attempt` | 101 | HMAC account subject |
| `lixiangqi_traffic.traffic_event` | 135 | HMAC subject; registration event ID also rekeyed to avoid census duplication |
| `lixiangqi_traffic.traffic_subject` | 1 | HMAC account key |
| `lixiangqi_traffic.traffic_subject_day` | 20 | HMAC subject and compound key |

The analytics rebuild additionally replaces affected months' derived rollups and
subject-day facts, including other users' aggregate rows. Those writes are not
included in the 849 directly transformed documents. The full analytics database
is therefore backed up.

The manifest also lists every inspected collection with zero changes. The initial
inventory scanned over 1.1 million shared `puzzle2_path` records and found no
account references; subsequent audits skip that account-independent collection.
`analysis2` remains untouched because its records are keyed by unchanged game IDs.

## Deliberately preserved data

- Prior migration backups, plans and markers remain intact recovery evidence.
  The exact collection allowlist is in `rules.archived`; arbitrary new backup
  names are not silently exempted.
- `puzzle2_publication` is a historical publication journal with canonical
  request/plan bodies and digests. Completed records retain their original
  operator and content. Execution refuses unfinished submitted/applying
  operations. Current puzzle snapshots and their digests change together.
  Refresh any offline puzzle-authoring snapshot before publishing again.
- Prose remains unchanged: chat/message bodies, study names, moderation details,
  blog text, and similar explicitly classified fields. Historical mentions and
  links written into prose are not rewritten.
- `user4.externalLogins` are identities at external providers. A provider
  account named `testing` must remain linked under that provider's original ID.
  The existing YouTube URL containing the new display name is not an ID conflict.
- No global string replacement, Redis flush, media-file rename or game-ID change.
  Application/socket restarts clear in-memory identity caches.
- This does not add redirects for old profile URLs or a general rename feature.
  Reauthenticate browser/mobile sessions and use the new username afterward;
  existing API tokens remain owned by the renamed account.

## Prepared execution and recovery

The sibling deployment checkout's `push-local-live.ps1` and `push_transport.py`
now package these files and expose an explicit opt-in. **The following commands
are future operational instructions, not commands run during preparation.**

From `lixiangqi-beta-deployment`, after deployment is separately authorized:

```powershell
.\push-local-live.ps1 -RenameTestingAccount
```

This is a normal application deployment with the additional migration; it may
include other current checkout changes. Review/build the intended release first.
`-PrepareOnly -RenameTestingAccount` packages locally without accessing production.
An ordinary deployment without the rename switch does not run the migration.

The integrated sequence is:

1. Acquire the deployment lock; gate Caddy and stop application/socket/explorer/
   engine writers. Require Redis still empty. Complete the other schema migrations.
2. Write `/opt/lixiangqi-beta.account-rename.pending`. All ordinary deployment,
   automatic recovery and rollback paths refuse to cross this durable gate.
3. Recheck source/destination, active games, publication/analytics queues, identity
   secret, unknown references and document-key collisions. No account merge is allowed.
4. Create `/opt/lixiangqi-beta-account-rename-v1-backup`, outside release rotation.
   Store raw before/after BSON for every affected document, all traffic documents,
   collection options and indexes. Restore originals into temporary databases,
   recreate indexes and compare BSON hashes before declaring the backup valid.
   Temporary rehearsal databases are removed; originals are never overwritten.
5. Bind the migration marker to the finalized manifest and converter hashes.
   Apply with majority/journaled writes. MongoDB `_id` changes require deletion
   and reinsertion; the frozen plan handles interruption between those steps.
   Separate writes also avoid reusing the unique external-login index entry in
   the same transaction.
6. Verify exact postimages, absence of old keys and absence of unexplained
   functional old references. Queue the three months for the existing
   `TrafficErasure` worker and persist the `accountVerified` gate state.
7. Start application writers with Caddy still stopped. The existing worker clears
   and replays affected months, rebuilding HLL sketches from retained events.
   Wait for its queue to drain and reconcile monthly processed-event counts.
8. Mark complete, remove the pending gate, open Caddy and run deployment readiness.

Backup material contains authentication data and messages. Keep the directory
private, preserve it after success, and include it in the server's protected
backup retention. No production backup was created by this read-only preparation.

For a later interrupted application:

```powershell
.\push-local-live.ps1 -ResumeAccountRename
```

This uses the already installed converter and original backup under the existing
deployment lock. It stops writers again and resumes forward. It does not build
or upload another release. Analytics completion can wait up to 30 minutes per
invocation; timeout/error leaves public traffic closed.

If preparation stopped before `manifest.json` was finalized, the partial backup
directory is intentionally not reused automatically. Keep writers stopped,
confirm no account migration marker exists, preserve the incomplete directory
under a distinct recovery name, and retry preparation with the original converter.
Never delete a finalized backup or clear the pending gate to bypass an error.

If the converter itself is wrong, preserve the backup and investigate offline.
Before reopening traffic, an operator can restore each affected main document
from `changes.bson` (remove its new key, restore its original key/document), restore
the full traffic database with its recorded options/indexes, and verify against
the saved hashes. Coordinate the migration marker and gate only after validation.
After writers have resumed, restoring the entire old snapshot could lose new
work; prefer a corrective forward migration or reconcile intervening writes.
There is deliberately no automatic destructive rollback command.

## Validation and limits

- 23 migration/repair tests pass, including actual isolated MongoDB backup restoration,
  unique-index preservation, interruption recovery, corrupt-backup/source-drift
  rejection, publication gating and analytics reconciliation failure.
- 39 adapter/deployment safety tests pass, including existing recovery tests.
- PowerShell parser validation passes. No application code was changed by this
  work, and no full application build or release deployment was performed.
- The production converter audit passed. Its puzzle authored-digest calculation
  was checked against existing live digests before proposing replacements.
- Integration tests simulate the existing analytics worker completing its queue;
  they do not run the Scala worker or independently validate its HLL estimates.
  Production execution therefore retains the queue/count completion gate.
- The audit is bounded to current schemas and observed state. New references,
  collisions, nonempty Redis, pending publication, or changed source documents
  require a fresh review; the tool fails closed.

The CLI defaults to `audit`. Use the Compose adapter for all write modes; its
`--writers-stopped` argument is an assertion from the deployment gate, not an
independent database lock.

## UTC job-key repair (2026-10-20)

The first deployed converter decoded Extended JSON dates without timezone
information. Its rebuild IDs consequently omitted `Z`. The Scala worker computes
its update selector using `Instant.toString`, including `Z`, so it repeatedly
cleared July without ever updating the job to `replay`. This was a migration
defect, not normal rebuild latency.

The source fix loads the manifest with timezone-aware UTC dates and rejects naive
dates when constructing job IDs. Regression coverage now round-trips the actual
backup and updates the queued job using the Scala worker's expected ID format.

`repair_rebuild_keys.py` is a separate, tested forward repair. With the deployment
lock held and the analytics writer stopped, it validates the original backup and
migration marker, saves the malformed jobs, then corrects all affected keys in
one majority-committed transaction. It refuses unexpected job phases or target
collisions. A marker receipt makes repeats safe even after the worker has finished.

Live recovery material is kept separately at
`/opt/lixiangqi-beta-account-rename-key-repair/`. The original finalized backup,
manifest hash and installed converter must remain unchanged for this in-progress
migration. Do not upload the newly fixed converter over the frozen deployed one:
its code hash intentionally differs. Resume uses the existing converter; it will
not requeue jobs after the `awaitingAnalytics` stage.

After the repair, continue from the deployment checkout with
`.\push-local-live.ps1 -ResumeAccountRename`. Caddy remains gated until the existing
analytics worker finishes and the completion checks pass.
