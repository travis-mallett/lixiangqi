# Native study operations

## Data ownership and search

Studies keep their inherited permissions, member records, likes, topics, ranking and targeted flat chapter updates. Chapter keys contain slash-separated native UCI moves, including file `i` and rank `10`. The root key is `_`. No legacy chapter reader remains.

Broadcast rounds own studies and use the same tree, rules, annotations, import and export. Broadcast delay snapshots preserve nested variations and annotations. DGT's external `white` field maps to native Red at ingestion. Foreign federation identifiers remain uninterpreted source metadata. Numeric tournament scoring remains an external library boundary.

The canonical `playerDirectory` module uses namespaced string identities such as `wxf:IGM0012`. Its provider discovers the official PDF linked by the [WXF titled-player directory](https://www.wxf-xiangqi.org/index.php?Itemid=320&id=223&lang=en&option=com_content&view=article), validates the entire bounded publication before writing, and preserves the publication URL and date. The current linked publication is dated 2022-12-09 and contains titles, not numerical ratings. English and Chinese names are searchable aliases of the same official identity. Unique native-directory matches can enrich broadcasts; ambiguous names do not select an arbitrary player. Broadcast headers and manual overrides take precedence. Native ratings and K factors require sourced values; no chess data or cross-category fallback fills absent ratings. New deployments seed an empty directory after startup, and production refreshes it daily. Failures are logged and preserve existing records.

Manual overrides accept `name / native player ID / title / rating / replacement name / federation`. A `-` ID explicitly prevents directory lookup. Invalid IDs, titles, ratings, duplicate names and inputs exceeding 1000 lines produce validation errors. Supported native title identifiers are IGM, IM, IFM, GM and NM. Player profiles, following, photos, federation pages and rating-history presentation use the same directory model.

Incoming broadcast annotations merge through the same tree operation used by the sequenced study API, preserving contributor annotations and deduplicating repeated source comments. Unchanged annotations cause no database calls. Source errors leave the last persisted broadcast intact and appear in its sync log; they never replace it with empty moves. Resource-limit errors explicitly ask for a smaller source selection instead of silently truncating boards. Delayed snapshots are stored before being queried, and their native `hasMoves` marker works with custom initial positions and starting plies.

Study search is MongoDB-native. `StudySearch` parses the inherited `owner:` and `member:` filters, phrases and excluded words. Access always queries the current source study document: public studies plus the viewer's memberships. All study ordering modes, pagination and controller rate limits remain in place. The weighted `native_study_search` text index searches study names, topics, descriptions, owners, members and chapter metadata with no chess synonyms or external search service. Chapter metadata is an ordinary derived search-index projection, refreshed by its owning repository after metadata changes. It contains names, descriptions and tag values; no positions or move trees. Source permissions are never copied into a delayed index. Moves still use targeted writes without rebuilding the search projection.

The native text index uses MongoDB's language-neutral tokenizer. Multiple terms are required, quoted phrases remain phrases, and relevance weights study names above topics and other text. The search request retains its 100-character limit and bounded result page; MongoDB slice queries have a three-second deadline.

## One-time deployment transition

The actual entry point is the sibling checkout's `push-local-live.ps1`, with remote orchestration in `push_transport.py`. Both migrations are packaged and SHA-256 checked against the source checkout. Gateway builds include the same `modules/xiangqi/src/main` sources using `-Dlixiangqi.source`; those sources participate in the build fingerprint.

After gating public traffic, activation stops `lila`, `lila-ws`, `explorer` and `pikafish-worker`. This stops study sockets, HTTP writers, broadcasts, scheduled jobs, analysis queues and cloud-evaluation writers. Existing earlier deployment migrations finish before the native-study transition. The reset runs before retained analysis conversion, the activation commit, or service restart.

The native image service is packaged at `runtime/image-export`. Its Node bundle imports the shared board compositor and catalog; packaging includes only catalog-listed boards, pieces and shadows and verifies their hashes. The internal Docker service listens on port 6175, with one CPU and 512 MiB memory, and the application uses `game.gifUrl = "http://image-export:6175"`. Health is checked before public traffic reopens. Image-service changes participate in build/recreate planning and compatible code rollback image tracking.

`Start-Lixiangqi.ps1` builds and runs the same exporter with the declared Node major version, loopback port 6175 and the checkout's public assets. Cleanup matches both the resolved Node executable and the exact absolute server module argument. After the launcher's existing verified disposable-preview refresh and application staging, it applies these same native migrations before starting any writers. Preview migration archives live under that refresh's immutable backup identity, verified against its snapshot ID. Repeated restores of an older snapshot therefore create independent recoverable archives; a restored native completion record remains a no-op. The existing preview refresh retains its own pre-refresh backup of local preview content.

The optional `pikafish-analysis` Compose service uses the existing worker image and the shared `tools.xiangqi_data.pikafish` bridge. Its release payload includes only the bridge and package initializers, not the offline corpus tooling. It starts when the server's private `.env` supplies `LIXIANGQI_FISHNET_KEY`; deployment reads only the configured/unconfigured result without printing credentials. It uses one thread, 128 MiB hash, one CPU and a 512 MiB container limit. Every activation and recovery stops it before database changes, even if the key has since been removed. Local preview follows the same environment-variable opt-in and owns cleanup of the analysis process. Missing credentials produce an explicit unconfigured status, never a passed server-analysis verification. End-to-end verification requires acquiring and completing actual native work.

`20260929_native_study_v1.py` uses the durable `schema_migration/native-study-v1` record. Its original backup directory is `<RemoteDir>-native-study-v1-backup`, outside all replaceable release directories. It freezes the selected identities, collection options and ordered index definitions in `manifest.json`; each collection has a full BSON archive and checksum. Before mutation, it restores every archive to a unique disposable MongoDB database and verifies all documents, counts, indexes and validators. A restore or checksum failure prevents deletion. Retries use the same frozen manifest and original archives.

The reset's complete ownership inventory is:

| Collection                                                                                         | Reset scope                                                                                                                                     |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `study`, `study_chapter_flat`, `study_topic`                                                       | All existing studies, chapters and derived global topics                                                                                        |
| `study_chapter`, `study_chapter_backup`, `study_chapter_castling_diagnostic`                       | Obsolete historical chapter storage and diagnostics, if present; archived before removal                                                        |
| `relay`, `relay_tour`, `relay_group`, `relay_stats`, `relay_delay`                                 | Broadcast dependencies, including delayed snapshots                                                                                             |
| `eval_cache2`                                                                                      | Derived cloud evaluations, whose identity now includes complete native history and ruleset                                                      |
| `analysis2`                                                                                        | Only records with an explicit reset `studyId`                                                                                                   |
| `fishnet_analysis`                                                                                 | Only jobs with an explicit reset `game.studyId`; a coincident game/chapter ID is insufficient                                                   |
| `chat`, `chat_timeout`                                                                             | Reset study/round identities; ambiguous game/study chat collisions abort                                                                        |
| `activity2`                                                                                        | Remove matching study references, preserve the rest of each activity document                                                                   |
| `timeline_entry`                                                                                   | Matching typed `study-like` entries                                                                                                             |
| `notify`                                                                                           | Matching study invitations and broadcast-round notifications                                                                                    |
| `coach`                                                                                            | Remove matching controlled public-study links, preserve descriptions and other profile fields                                                   |
| `flag/studyFeatured`                                                                               | Remove reset IDs from the featured-study setting; preserve unrelated settings                                                                   |
| `external_engine`                                                                                  | Back up and preserve native registrations; install the native protocol validator and provider/user indexes                                      |
| `fide_player`, `fide_player_rating`, `fide_federation`, `fide_player_follower`                     | Archive all original records, including user photos and follows, then retire the obsolete chess directory collections                           |
| `directory_player`, `directory_player_rating`, `directory_federation`, `directory_player_follower` | Preserve existing native records and install native lookup/search indexes                                                                       |
| `user4`                                                                                            | Back up only accounts with `ROLE_FIDE_PLAYER`; replace that directory-edit privilege with `ROLE_DIRECTORY_PLAYER`, preserving every other field |
| `title_request`                                                                                    | Preserve requests and their original foreign-ID metadata; install the new native player-ID lookup index                                         |

Accounts, authentication, games, personal topic preferences (`study_user_topic`), unrelated chats/notifications/activity, and game/catalog analysis are retained. The only account mutation is the explicitly scoped directory-editor role rename above. No shared collection is cleared wholesale. The beta deployment places study and gateway evaluation collections in the same configured `lichess` database; a deployment splitting those databases must explicitly update this invocation before applying the reset.

External-engine registrations are never inferred to be Xiangqi from an arbitrary name or relabelled from Stockfish. Before any reset, a preflight rejects incompatible registrations while leaving every setting and study intact. The inspected pre-release snapshot has no `external_engine` collection; deployment repeats the check against the stopped live database. Native registrations use `protocol = "xiangqi-v1"` and `officialPikafish`, with no stored chess variants or Stockfish flag.

The reset installs native chapter and cloud-evaluation validators, retained study/chapter indexes, and the native study text index. Clearing source studies clears their embedded search projection. Process restarts invalidate room, preview, export, delay and other process caches. Redis pub/sub carries transient messages; no global Redis flush is performed.

## Retained game and catalog analysis

`20260929_native_analysis_moves_v1.py` backs up all affected nonstudy analysis and queued work into a separate `<RemoteDir>-native-analysis-moves-v1-backup`. Its preparation phase freezes the source game initial position, complete native moves and ruleset together with the original analysis. Catalog references resolve against the authoritative SQLite catalog. It fails explicitly if a required source is unavailable.

Deployment runs preparation in the Python explorer image, invokes the staged application's `lila.tree.NativeAnalysisMigration` using `/lila/lib/*` in the JVM image, then applies the verified output in Python. Java replays the exact branch history through the canonical Xiangqi rules and converts notation PVs to native coordinates. It writes a new partial output, renamed only after success. The apply phase preserves unrelated fields, adds the canonical position and move format, and verifies stored records. Pending game analysis work retains its identity and priority, replacing its obsolete variant field with the game's native ruleset.

Legacy pawn notation can name several legal moves. The converter uses the stored coordinate best move and the complete recorded variation to resolve these cases. It accepts only a unique legal interpretation, with a bounded search; unresolved ambiguity remains a hard failure. It never chooses the first candidate or truncates a variation to make the migration pass. The interactive notation importer continues to reject ambiguous individual moves.

For an already-gated release whose bundled converter needs repair, recovery can load a corrected offline helper from `native-analysis-replay.jar` in the analysis backup directory. Its adjacent `.sha256` file is required and checked before replay. This helper affects only the offline converter classpath; it does not replace application jars or alter the original backup. Stage repairs under the deployment lock. A normal new release uses its newly built converter.

## Failure, retry and recovery

The native transition creates a durable `<RemoteDir>-native-study-v1.pending` guard before either migration can alter the schema. An interrupted gated activation resumes the new release's migrations while all writers remain stopped. It cannot roll back to incompatible legacy writers. A failure retains original backups, manifests, replay output and the pending guard. Once both migrations and readiness checks succeed, finalization removes the pending guard. Durable database completion records make later deployments a no-op for the destructive reset, including when new studies have since been created.

Post-start code rollback requires identical migration source contracts between releases. A first native activation cannot switch back to an older study schema by rolling back only application files.

Original recovery data is BSON rather than a lossy export. For operator recovery, first stop writers and preserve a separate snapshot of any data created after activation. Load `manifest.json` with BSON Extended JSON, verify every checksum, and use the migration's `restore_collection` routine to restore archives to an isolated recovery database with their saved options and indexes. The verified records can then be restored to their original scopes while using the corresponding pre-migration application version. Restore only the frozen IDs in shared collections; do not replace entire shared collections. Preserve post-reset content separately rather than overwriting it. Clear or rewind migration completion records only as part of that deliberate, verified recovery operation. Routine retries must never change or delete a completion record.

## Local chapter analysis

The Study **Request a computer analysis** action runs the existing browser Pikafish worker, with one thread, 32 MiB hash and a bounded search per mainline position. It retains the chapter root, ruleset and full move history. Progress, cancellation, download failures and save retries are visible as translated text. There is no manual Study socket request for Fishnet analysis.

The authenticated local-analysis endpoint checks contribution rights and an unchanged mainline, validates scores and every returned variation against native rules, and merges annotations through the study sequencer. Browser scores remain chapter annotations and never enter trusted game analysis or the shared evaluation cache. This change uses the existing native chapter schema and packaged browser engine assets; it requires no additional migration or server worker. Official broadcast and game analysis infrastructure remains independent.

## Verification

The release operator first prepares the payload without contacting or changing the live application:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "Z:\Work\Scripts\lixiangqi-beta-deployment\push-local-live.ps1" -Domain lixiangqi.com -Server YOUR_DEPLOYMENT_HOST -RemoteDir /opt/lixiangqi-beta -PrepareOnly
```

Preparation requires the declared Java 21, Node 24 and pnpm 11 runtimes, the patched gateway checkout, the verified puzzle catalog, Linux Pikafish and its network, and the sibling Xiangqipedia checkout. It stages application and assets but does not replace the full repository test, formatting and lint workflow. The local deployment credential file must exist; its contents must never be included in logs or release artifacts. The prepared payload is `.release-next-v2` in the deployment checkout. Source fingerprints cover the Scala application, frontend, gateway's shared native domain, migration scripts and all packaged runtime services; a source change requires preparation again.

After the complete checks and local real-study acceptance tests pass, deploy that unchanged prepared source with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "Z:\Work\Scripts\lixiangqi-beta-deployment\push-local-live.ps1" -Domain lixiangqi.com -Server YOUR_DEPLOYMENT_HOST -RemoteDir /opt/lixiangqi-beta -SkipBuild
```

`-SkipBuild` requires matching successful build stamps. The server must have Docker Compose, Python, `flock`, the existing private environment, the canonical game catalog, and enough free space for independently recoverable backups plus the new images. Configure a registered native worker key in the private environment to enable server-analysis acceptance. Never bypass the normal entry point to skip its lock, Wiki deployment, migration or recovery steps. A recovery-only invocation can finish an interrupted activation without deploying the newly prepared release; rerun the entry point after recovery succeeds.

Public readiness and healthy image rendering do not prove study acceptance. Following deployment, exercise study creation, rank-ten edits, branching, annotated export/import, reload, collaboration/reconnect, permissions, search, broadcast ingestion, image/GIF sharing and browser Pikafish chapter analysis against the deployed release, and record each result in the feature checklist.

Disposable MongoDB integration tests exercise full backup restoration, index order, exact shared-collection scope, corruption rejection, failures before/after destructive work, rerun preservation, old-path rejection and native rank-ten paths. Native search tests cover all-term matching, phrases, Chinese text, chapter metadata and immediate visibility changes. Deployment tests execute generated shell recovery paths with inert service commands and validate migration ordering, failure gates, packaging and schema rollback restrictions.

These tests do not claim a live deployment, real server-analysis worker, or interactive multi-client browser verification. Those operations remain part of the release acceptance checklist in `xiangqi-study-conversion.md`.
