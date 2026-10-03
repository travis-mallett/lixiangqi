# Native Xiangqi study conversion

Status: Study release fixes implemented and verified against the staged local
application on 2026-10-03. Manual chapter analysis now runs browser Pikafish;
server workers are not required for the Study analysis button.

The implemented contracts are documented in [native study data](native-study-data.md)
and [deployment and recovery](xiangqi-study-operations.md). The original broad
acceptance ledger below records the full conversion surface; the dated evidence
section identifies precisely what has been exercised. Live deployment and manual
screen-reader acceptance are not claimed by local automated checks.

## Permanent architecture

The study domain must use the native `lila.xiangqi` coordinates, sides, moves,
results, and versioned adjudication policy. The immutable coordinate move is the
identity of an edge. English WXF and Chinese notation are presentation derived
from the parent position; neither is an identifier. All 90 intersections,
including `i10`, must have their literal native coordinates at domain boundaries.

`modules/tree` owns one ordered, annotated Xiangqi tree used by study,
analysis, practice, and broadcast. The former `Root`/`NewRoot` runtime pair is removed.
The first eligible child is the mainline, other children are variations, and
forced variations retain their explicit status. The root owns the initial
position and ruleset. A node's position is obtained from its entire ancestor
line under that ruleset. A snapshot FEN does not reset adjudication history.
Derived notation and position caches must be checked against their inputs and
must never replace coordinate history as the source of truth.

Paths are sequences of native move identities, with a single codec shared by
domain, storage, HTTP, sockets, and frontend. Callers must use path operations
rather than slice strings or assume two characters per move. The Mongo codec
must produce safe field names directly, without dummy squares or rank-ten
substitutions. A malformed path is an error, not the root or a valid prefix.

Keep the inherited flat chapter document and targeted updates. They avoid
rewriting a potentially large tree for each collaborative annotation or move.
Keep the per-study sequencer, room versions, contributor checks, resynchronization,
bounded chapter/node sizes, fetch caches, and debounced search updates. Tree
conversion must not turn a per-node edit into a full-document write or add a
rules replay of every chapter on every request.

The shared native notation boundary owns tokenization, header escaping,
recursive variations, move resolution, annotations, and import errors. Native
coordinate history is retained while parsing each branch. Unknown metadata and
comments must survive; supported structured annotations must have one parser
and renderer. External PGN-style headers and engine UCI conventions belong at
their respective format boundaries. Internal participants are Red and Black.
Import is atomic: invalid input, limits, malformed annotations, and illegal
variations must return a useful error before any chapter is created or replaced.

Use the existing native board, viewer, notation preference, theme hierarchy,
explorer, Pikafish browser worker, and server worker. Study views must not
reimplement rules, translate squares, or manufacture chess positions for those
components. Engine and explorer requests must carry initial position, ancestor
moves, and the applicable ruleset. Teaching and completion must use the same
rules state as ordinary analysis.

## Source audit and inherited constraints

The initial audit found a clean working tree. Important existing defects:

- `GameToRoot` replaces `10` with `:` and drops moves rejected by chess UCI parsing.
- `AnaMove` takes chess squares and checks a fresh FEN, losing branch history.
- `StudyPgnImport` uses chess replay, drops invalid branches, and has a second
  implementation in `StudyPgnImportNew`.
- `tree.scala` and `newTree.scala` both own trees containing chess moves,
  variants, squares, and crazyhouse data.
- `JsonView.xiangqiTree` decorates already-serialized chess trees and computes
  rules from individual FENs. Its recursive array walk also treats siblings as
  a sequence when choosing the parent FEN for notation.
- `CommentParser` assumes fixed-width chess squares; frontend `boardMarks`
  substitutes rank ten. `nodePGN` strips those substitutions again.
- `ChapterMaker` can replace an invalid supplied position with the start position
  and can ignore an invalid notation supplement to a game.
- `ServerEval` reconstructs coordinate moves with the chess notation parser,
  substituting an empty move list on error. Its PV merger uses chess replay.
- Study image export still targets a chess renderer with chess piece defaults.
- Chapter setup, broadcast participants, practice, accessible analysis, and
  several frontend tree operations still depend on chess types and behavior.

These are owning-layer defects. No row below may be marked complete on the
basis of the current board display alone.

## Feature and verification ledger

Each row covers its browser, application, persistence/transport, and service
dependencies. Status is **pending** unless explicit evidence is recorded.

| Feature                                    | Owners and dependencies                                                                | Required verification                                                                                         | Status                                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Blank chapters, custom setups, orientation | `ChapterMaker`, `StudyMaker`, `StudyForm`, `chapterNewForm`, native editor             | Start position; Black to move; nonzero starting ply; invalid FEN rejected; file i/rank 10                     | Pending                                                                                       |
| Native notation and multiple chapters      | shared `XiangqiNotation`, `StudyPgnImport`, `MultiPgn`, controller imports             | WXF/Chinese/coordinates; nested variations; duplicate branches; limits; atomic errors; no truncation          | Pending                                                                                       |
| Existing games and source analysis         | `GameToRoot`, `ChapterAnalysis`, `ChapterMaker`, game repository                       | Complete move identity/clocks/outcome/ruleset; source analysis only for matching history                      | Pending                                                                                       |
| Explorer game creation/insertion           | `ExplorerGame`, `StudyApi.explorerGame`, `explorerCtrl`, catalog service               | Complete game and variations; insertion at branch; invalid IDs and divergence                                 | Pending                                                                                       |
| Move creation and legal destinations       | `AnaMove`, `StudyApi.addNode`, `StudySocket`, `lila-ws`, analysis controller           | Every intersection; illegal moves; terminal states; native origin/destination transport                       | Pending                                                                                       |
| Tree operations                            | canonical tree, `StudyFlatTree`, `ChapterRepo`, frontend tree/path                     | Add/delete/promote/force variation; order; duplicate identity; 600-ply and 3,000-node limits                  | Pending                                                                                       |
| Save/reload/restart/clone                  | BSON handlers, chapter repository, study clone path                                    | Whole-tree semantic equality with annotations and metadata through all four operations                        | Pending                                                                                       |
| Comments and attribution                   | `StudyApi`, `CommentParser`, `studyComments`, `commentForm`                            | Root/move/variation comments; author edits/deletes; escaping; multiple annotations                            | Pending                                                                                       |
| Glyphs, circles, arrows                    | tree annotations, BSON/JSON/socket readers, board, `studyGlyph`                        | Root and branches; all 90 intersections; socket and notation round trips                                      | Pending                                                                                       |
| Clock annotations                          | `StudyPgnImport`, `ChapterRepo`, `studyCtrl`, player clocks                            | Both sides, custom ply, elapsed-time import, centisecond preservation                                         | Pending                                                                                       |
| Chapter metadata and results               | chapter tags/setup, `StudyPgnTags`, `studyTags`, player bars                           | Red/Black names, ratings, titles, event/date/site, custom tags, results and export                            | Pending                                                                                       |
| Import/export and downloads                | shared notation boundary, `PgnDump`, `pgnImport`, `pgnExport`, `nodePGN`               | Nested tree + all annotations + metadata + outcome reimport without loss; native filenames                    | Pending                                                                                       |
| Board legality and endings                 | native rules and adjudication, tree branch replay                                      | Check; mate; stalemate loss; repetition/chase; divergent branches with same FEN                               | Pending                                                                                       |
| Browser analysis                           | Pikafish web worker, shared evaluation controller, analysis board                      | Real worker starts; legal PV; branch history; score perspective; stop/restart                                 | Pending                                                                                       |
| Requested chapter analysis                 | `localAnalysis`, browser Pikafish, `LocalAnalysis`, study sequencer                    | Local worker; progress/cancel; native history; safe persistence; no server job                                | Verified in Chrome and staged API; see dated evidence                                         |
| Evaluation graph and engine lines          | evaluation cache, graph, `ServerEval.Merger`, tree                                     | Red perspective, root ply, PV insertion, mate/stalemate scoring, history-sensitive cache keys                 | Pending                                                                                       |
| Explorer and cloud evaluation              | explorer API/client, `multiCloudEval`, eval cache/services                             | Native position/history; results/PV; errors; availability; resource limits                                    | Pending                                                                                       |
| Interactive lessons                        | `gamebookPlayCtrl`, edit/view/buttons, stored gamebook                                 | Learner side; alternatives; hints; deviation feedback; completion and restart                                 | Pending                                                                                       |
| Practice with computer                     | `practiceCtrl`, practice module, Pikafish and native rules                             | Legal replies; hints; mate/stalemate; adjudication; analysis availability                                     | Pending                                                                                       |
| Concealed moves                            | chapter conceal, `StudyApi`, study controller/tree views                               | Reveal order, contributor behavior, alternate lines, branch transitions                                       | Pending                                                                                       |
| Collaborative editing                      | study sequencer/API/socket, room versions, gateway                                     | Two contributors edit concurrently; deterministic tree; ordered notifications                                 | Pending                                                                                       |
| Presenter synchronization and reconnect    | `setPath`, chapter selection, socket version recovery, sticky state                    | Two clients; browsing isolation; resync after missing events; chapter deletion                                | Pending                                                                                       |
| Access control                             | controller, study settings/membership, API/socket contributor gate                     | Owner/contributor/member/anonymous; private/unlisted/public; forbidden writes and reads                       | Pending                                                                                       |
| Invitations, membership, ownership         | invite API/form, members controller, study edit routes                                 | Invite/accept/decline/kick/leave/roles/ownership; locked accounts; rate limits                                | Pending                                                                                       |
| Chat and moderation                        | study socket, room chat, chat service                                                  | Permissions; members/public chat; reconnect; moderation; retained limits                                      | Pending                                                                                       |
| Chapter management                         | study API/repository, chapters/edit form                                               | Add/name/reorder/delete/description/mode; current chapter fallback; maximum count                             | Pending                                                                                       |
| Study management and cloning               | study API/repository/form/pager                                                        | Name/description/settings/delete/clone and all visibility combinations                                        | Pending                                                                                       |
| Search, topics, likes, lists               | native `StudySearch`/Mongo text index, topic repos, pager, activity/timeline           | Index updates/deletes; permissions; counts; user topics; pagination and hot ranking                           | Query unit tests and Mongo text/access tests pass; live management verification pending       |
| Sharing, embed, deep links                 | controller embed, share panel, analysis embed, viewer                                  | Readonly/public/private rules; chapter/ply link; responsive embedded board                                    | Pending                                                                                       |
| Previews and multiboards                   | chapter preview/denorm, list UI, `multiBoard`, player bars                             | Last position/move/check/result/clocks; native themes; lazy-load and live update                              | Pending                                                                                       |
| Image and animated export                  | `GifExport`, gif dialog, shared board renderer/export service                          | Real PNG/GIF downloads; all positions; annotations; orientation; final delay                                  | Pending                                                                                       |
| Broadcast ingestion and synchronization    | relay fetch/push/sync/delay, format adapters, PGN streams, study propagation           | Native external input; game matching; clock/tag changes; delayed rounds; source history                       | Pending                                                                                       |
| Broadcast management and spectators        | relay repositories/forms, player/team pages, streams, pinned board                     | Round/tour lifecycle; participants; results/standings; stream/embed links; synchronization                    | Pending                                                                                       |
| Keyboard and accessibility                 | analyse NVUI/util, study keyboard, board and voice/keyboard move support               | File i/rank 10 input; move text/labels; focus; screen-reader operation; no chess commands                     | Pending                                                                                       |
| Responsive presentation and translations   | shared themes, analyse/study/relay CSS, translation sources                            | Desktop/intermediate/mobile; touch marks; every changed string translated; native terminology                 | Pending                                                                                       |
| Schema reset and deployment                | versioned migration, neighboring `push-local-live.ps1` and `push_transport.py`         | Quiescence; verified restore; collection scoping; interrupted retry; completion guard                         | Isolated Mongo and orchestration tests pass; real activation pending                          |
| Cross-system reset references              | relay, analysis/jobs, chat, activity/timeline, coach, search, caches, external engines | Exact ownership filters; unrelated shared records survive; no old writers or dangling records                 | Scoped BSON backup/restore and retained-analysis tests pass; live database acceptance pending |
| Release checks                             | repository GitHub workflows and AGENTS.md                                              | Frontend formatting/lint/assets/tests; Scala formatting/test/stage; gateway; integration and deployment tests | Pending                                                                                       |

## Deployment design and release gate

The actual deployment entry point is
`Z:\Work\Scripts\lixiangqi-beta-deployment\push-local-live.ps1`; it delegates
transport and activation to the adjacent `push_transport.py`. These are outside
this repository. The activation sequence already stops writers and runs
versioned migrations, but its rollback compatibility contract must also include
the study schema. Merely copying a migration file is insufficient.

Before activation, enumerate collection ownership from the actual repositories
and reference writers. Do not issue blanket deletes against shared analysis,
job, chat, activity, notification, or user collections. Determine broadcast
round/tour and curated-practice dependencies before defining the reset scope.

The one-time reset must capture an immutable manifest of affected study/chapter
IDs and scoped related records while writers are stopped. Verify a recoverable
backup by restoring it into an isolated namespace and comparing document counts,
identities, and indexes. Retain its checksum and recovery instructions. A failed
backup, reset, index install, or validation must leave writers stopped. A retry
must use the original backup and immutable manifest; it must not snapshot a
partially reset database or broaden the selection. A durable completion marker
prevents all later deployments from deleting newly created studies.

Invalidate only affected cache/search namespaces and cancel affected analysis
work before restarting. Clear or reconstruct broadcast and other dependent
references according to the audited scope. Install the canonical chapter schema
and required indexes before new application writers start. Verify real create,
edit, collaboration, save/reload, export/reimport, and worker operations after
activation. No production reset is safe until every ledger row and migration
failure/retry test is complete.

## Verification evidence

### Study release verification, 2026-10-03

- Fixed private chapter-configuration access, late chapter-editor responses,
  delayed chapter-description and lesson writes, rapid glyph/tag edits, stale
  lesson timers, and losing-position practice feedback. Comment drafts retain
  their selected chapter/move across tab changes. Study loading states use text.
- The computer-analysis button uses browser Pikafish with progress, cancellation,
  bounded searches and retryable saves. The server validates contributor access,
  source history, score bounds and legal PVs before merging chapter annotations.
  Client scores never populate trusted analysis storage or enqueue server work.
- Formatting, code/style lint, format verification, production assets and all
  444 frontend tests passed. Scala formatting, full repository `test`, focused
  real-Mongo persistence/local-analysis tests and `stage` passed. The gateway
  rebuilt successfully. Windows used the repository's Node entry points and JDK
  selector patch, as documented below.
- The staged HTTP/WebSocket suite passed creation, rank-ten moves, invitations,
  reader/contributor permissions, concurrent comments, glyphs/drawings, presenter
  synchronization, reconnect, illegal-move errors, annotated import/export,
  cloning, atomic import rejection, embed ownership and privacy revocation.
- Chrome exercised comment tab switching, rapid glyph clicks, real browser
  Pikafish, saved scores, lesson hint persistence, preview feedback and completion.
  Unauthorized/stale analysis uploads fail; the analysis queue remains unchanged.
  Layouts at 1440, 900 and 390 pixels have a visible board and no horizontal
  overflow. Evaluation charts have bounded height.
- A real Study GIF download produced a valid 205,115-byte animation. Both an
  analyzed chapter and the collaboration fixture survived application restart.
- Reusable acceptance commands are in
  [study verification](../tools/study_verification/README.md). Local evidence is
  `.tmp/study-release-{ui-tests,final-backend,engine-final,integration-final3}.log`.
  These checks used an isolated disposable database, not production data.

Lichess reference behavior was checked in its
[glyph editor](https://github.com/lichess-org/lila/blob/master/ui/analyse/src/study/studyGlyph.ts)
and [comment editor](https://github.com/lichess-org/lila/blob/master/ui/analyse/src/study/commentForm.ts):
glyphs annotate the selected node and typed comments are saved automatically.

The earlier evidence below remains historical. Its pending list is not a claim
that the newly verified operations are still untested. Deployment, live external
services and manual assistive-technology acceptance still require their target
environment.

### Frontend architecture and verified boundary

The frontend consumes one recursive `tree` object. The former partitioned `treeParts` transport and reconstructor are removed; sibling order and the first non-forced mainline survive loading unchanged. Every node carries the native rules state. A root owns its ruleset, and native coordinate move identities form slash-separated paths, including file `i` and rank `10`. The study, standalone analysis, puzzle analysis, viewer, charts, and server analysis consumers use this shared tree.

Native notation import/export uses structured annotations and typed comment authors. `%comment` records retain comment identity, text, and user/external/site/unknown attribution; `%study` records retain teaching and variation metadata. Engine requests retain root FEN, full branch moves, and ruleset. Browser Pikafish searches are restricted to native legal root moves and complete principal variations are verified against the same history before publication. Native book/endgame queries expose their AXF provider rules without replacing chapter adjudication. The reference panel links annotated native source records and explicitly reports missing references.

The frontend verification batch passed formatting (`pnpm format`), code/style lint (`pnpm run lint`), format verification (`pnpm run check-format`), the complete production asset pipeline, and 412 frontend tests with no skips. Logs are `.tools/frontend-{format,lint,check-format,assets,all-tests}.log`. On this Windows checkout, the Bash wrapper could not find `pnpm`, and `ui/test` is a symlink text file; the production pipeline and test runner were executed through their identical Node entry points (`node --no-warnings ui/.build/src/main.ts --no-install -p` and `node ui/.test/runner.mjs`).

Following the user's request to conserve credits, exhaustive browser acceptance remains pending: simultaneous clients/reconnect, teaching completion, desktop/intermediate/mobile layouts, screen-reader and keyboard operation, native explorer/source references with live data, local Pikafish in a real browser, server analysis with a live worker, share/embed/image interactions, and save/restart/clone/notation round trips through a deployed service. Passing build and unit/integration tests does not mark these operations or the original feature-completeness definition as complete.

- Native reset, retained-analysis migration, real Mongo search, deployment recovery, image packaging/process ownership and optional analysis-worker startup: 25 tests passed. Logs: `.tools/native-study-migrations-tests.log` and `.tools/native-study-deployment-tests.log`.
- Neighboring deployment regression suite: 54 tests passed in `.tools/native-study-external-deployment-tests.log`.
- Native search query unit tests: 3 passed. Broadcast Scala sources compile; final full relay suite rerun remains in the backend verification batch.
- [Operational architecture and recovery scope](xiangqi-study-operations.md) records exact reset ownership, immutable backups, schema/indices, image service and worker lifecycle. No unavailable worker or undeployed operation is counted as verified.
