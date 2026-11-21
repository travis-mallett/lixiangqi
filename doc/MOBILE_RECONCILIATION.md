# Website and mobile reconciliation

The website owns shared game semantics, API contracts, engine release pins and original
board artwork. Each Flutter app owns its navigation, responsive layout and product scope.
Reconciliation means preserving the applicable behavior, not reproducing web screens.

## Products and receipts

Variant chat previews (MsgBoards.scala blob `c2dcab1b76`) use the existing board
message endpoint and snapshot storage. Deploy the backend and web assets together.
The adult app needs a release to open linked variants or show the selected encoded
position without invoking its Standard-only renderer. Native mobile variant replay
and drawing remain in the adult app's MOBILE-VARIANTS queue. Kids has no inbox.
Verification covered native notation and rules, message snapshots, web replay,
Chromium and Firefox annotation submissions, and the Flutter inbox board tests.

Website and adult mobile inbox composers recognize twelve-character player links.
The shared board endpoint resolves the public eight-character game ID (MsgBoards.scala
working-tree blob `efaa86fc08`). Older website messages fetch the PGN export for
inline replay. The web messaging and Flutter inbox board tests passed. Deploy the
website backend and assets together and release the adult app for its composer change.
Xiangqi Kids has no messaging inbox.

The correspondence analysis change on `d7f7a5234b` (working-tree blobs
`f82ee2cf57` for UserAnalysis.scala and `8bf6534e0c` for analysisXiangqi.ts)
disables engine assistance until the game finishes. Adult mobile already exposes
its game analysis button only in the finished branch of `play/game_page.dart`.
Kids has no analysis workspace. Verification covered the website Xiangqi TypeScript
project and inspection of mobile feature coverage. Deploy the website backend and
UI assets together. Neither app requires a release.

| Product          | Checkout                   | Receipt and review queue                                             |
| ---------------- | -------------------------- | -------------------------------------------------------------------- |
| LiXiangQi Mobile | `../lixiangqi-mobile`      | `doc/WEBSITE_RECONCILIATION.md`, `doc/website-reconciliation.json`   |
| Xiangqi Kids     | `../lixiangqi-mobile-kids` | `docs/WEBSITE_RECONCILIATION.md`, `docs/website-reconciliation.json` |

Resolve the actual checkout before writing. Do not create a second kids app because its
product name was abbreviated to `lixiangqi-kids`. The scanner accepts `--mobile PATH`
and `--kids PATH` for other workspace layouts. A missing checkout is an outstanding
review, not evidence that a change is inapplicable. Record unavailable-checkout items here
temporarily with the product, source changes, behavior and completion criteria, then move
them into that app's queue when accessible.

## Routine workflow

1. Read the changed owning modules, callers and each app's actual feature coverage. Run
   `node scripts/mobile-reconciliation.mjs` before work and again before handoff. Include
   the outgoing commit range and uncommitted changes; dates alone are not checkpoints.
2. Classify each change for each app as **ported**, **already covered**, **server inherited**,
   **not applicable**, or **pending decision/implementation**. Record why and the concrete
   consumer. A shared filename is a review hint, not a verdict.
3. Port clear changes to existing features automatically. Read the app's AGENTS.md, use
   its pinned SDK, localization and shared components, and test the affected contracts.
4. For a new variant, major feature, different interaction design, profile graph redesign,
   new permission or significant scope question, ask whether to implement it concurrently.
   Honor decisions already made in the chat. Put a pending item in each affected app's
   queue while waiting; do not stop unrelated authorized work.
5. Validate shared APIs and fixtures, regenerate checked-in assets/pins, run each app's
   checks, build Android for native changes and verify iOS on macOS/Xcode. Name unrun
   checks. Do not equate emulator testing with physical-device or iOS testing.
6. Update the app's receipt only after reviewing every change through the recorded commit.
   Keep intentionally deferred work in `pending`, with a stable ID, reason, user decision,
   impacted features and acceptance criteria in the Markdown queue. Retain past decisions.
   A receipt records a completed review, not necessarily complete implementation.

`node scripts/mobile-reconciliation.mjs --json` produces machine-readable findings.
`--check` exits nonzero for new source changes, missing baselines/checkouts or items marked
`review-required`. Explicit user deferrals remain visible but do not block unrelated work.
The scanner is read-only: it never edits apps, approves changes, or advances checkpoints.

Receipt schema: `version: 1`, `websiteCommit` (full reviewed Git SHA, or null if unknown),
`reviewedWorkingTree` (map of repository-relative source paths to SHA-256 of reviewed
bytes; null means reviewed deletion), `report` (local report path), `pending` (items with
`id`, `state`, `summary`). Only add file hashes after inspecting those exact bytes. Remove
obsolete fingerprints when advancing the commit anchor. Concurrent edits that change
those bytes must appear as new work; never bless someone else's pending work wholesale.

## Applicability guide

| Website change                                            | Main app                                                                   | Kids                                                            |
| --------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Legal moves, repetition, results, clocks, game actions    | Check existing rules/API consumers; keep server authoritative              | Same for online and bot games                                   |
| Pikafish source, NNUE, analysis protocol                  | Port pin, network, bridge and cache identity together                      | Evaluate local puzzle/hint engine; bots may be server-owned     |
| Bot levels, identities, modes, progress                   | Existing main computer opponents                                           | Existing 26 kids opponents; preserve child-specific progression |
| Board/grid/piece geometry, shared art, sounds/icons       | Regenerate supported assets and align hit targets/overlays                 | Check shared board; preserve original garden/avatar art         |
| Analysis, notation, export, explorer                      | Existing native workspace and catalogue; preserve metadata and user drafts | No analysis board; inspect puzzle/replay import only            |
| Puzzles, solutions, attempts, hints                       | Port behavior; verify history and scoring                                  | Port applicable simplified puzzle behavior                      |
| Account/security/settings/profile contracts               | Verify native forms, auth/scopes and profiles                              | Only implemented account and child-appropriate settings         |
| Profile charts or significant new profile presentation    | Assess native counterpart; ask about substantial redesign                  | Usually inapplicable; do not introduce adult social surfaces    |
| Blog carousel, lobby footer, web CSS/browser focus/embeds | Usually no counterpart; preserve mobile navigation                         | Usually inapplicable                                            |
| New variant or other large feature                        | Ask/log; never silently enable via shared feeds                            | Separate product decision; usually omit                         |
| Operational jobs, migrations, backend-only fixes          | Confirm shared service effect and release dependency                       | Same where consumed; no duplicate client implementation         |

Variant deferral still requires protecting standard-only clients from mixed feed payloads.
Do not render a new variant on a 9×10 board, accept incompatible challenges, or offer its
matchmaking/tournament rules accidentally. Keep future unsupported keys closed by default.

## Asset and engine ownership

From the main app, use `node scripts/snapshot-board-assets.cjs ../lixiangqi` and its
`--check` mode. This snapshots Standard Xiangqi only, including generated board geometry.
Use `node scripts/snapshot-pikafish.cjs ../lixiangqi UPSTREAM_CHECKOUT` and `--check`.
It exports clean objects at `scripts/pikafish/release.json`'s commit, applies documented
mobile sandbox patches and verifies the website's network checksum. Do not copy a
browser-patched engine working tree or update the NNUE without its matching engine.

The 2026-11-05 main-app audit explains the reconstructed October baseline and the
explicitly deferred variant project. Kids has a review queue rather than a claim of parity.

## Unavailable-checkout queue

None. Both checkouts were located when establishing this workflow.

## GitHub Actions repairs, November 19, 2026

Reviewed website base `c4ba2fdf0180dd201c726a0682362d5751c22d14`.

- **LiXiangQi Mobile (not applicable).** The server and standalone browser bot workflow changes are confined to CI. The viewer outline uses web CSS. The Firebase refactor preserves recipient compatibility and the payload that the native inbox consumes.
- **Xiangqi Kids (not applicable).** The app uses neither the web viewer nor the standalone browser bot build. The Firebase refactor preserves the existing device routing and payload.

Verified the MongoDB 8.2 primary election, Scala formatting, frontend lint and formatting, the production asset build and 783 UI tests, and the standalone bot build and 55 unit and integration tests. No deployment dependency, migration, or mobile release is required. Both app checkpoints retain their prior positions.

| Source                                     | Working-tree SHA-256                                               |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `.github/workflows/human-bot.yml`          | `e6743f0e83404b4bc889aff6412ca384b4320a39ccd022a22d67b38a592e45d4` |
| `.github/workflows/server.yml`             | `1653fe606fc6b532f2c11d1604945ca25674dcfa948680c9fc41874bd9fd395a` |
| `modules/push/src/main/FirebasePush.scala` | `1cf2e992b0017631c49afa320d21f172fbb6d04ab94a91bf1b7ce3deb5528c6a` |
| `ui/viewer/css/_viewer.scss`               | `72b4b151f9c92678d2583122baf4888161f001a21b3739c2bbab213fb18d28be` |

## Inbox receipts and Global Chat, November 19, 2026

LiXiangQi Mobile implements the public room, its pinned position, text posting,
moderation and notification preferences. The main app and website use the same
receipt timestamps and the original mobile red for outgoing bubbles. The homepage
card is specific to the website. Xiangqi Kids has no community inbox or public-chat
surface. Its authentication scopes exclude the room.

Deploy the website backend and assets before the mobile release. The change uses
the existing inbox gateway. Server and client behavior, verification, and the
reviewed file hashes are recorded in [Messaging](MESSAGING.md#global-chat-and-message-alerts)
and the [messaging receipt](MESSAGING_RECONCILIATION.json#globalChat).
Both broader reconciliation checkpoints retain their previous positions.

## Mobile browser Inbox message options, November 18, 2026

Reviewed the responsive button placement and blank-space dismissal changes in
`ui/msg/css/_convoMsgs.scss`, `ui/msg/css/_messageActions.scss`, and
`ui/msg/src/view/messageActions.ts` on website HEAD
`731862cfe76613fccfb2b1f14117f4907fdb3112`.

- **LiXiangQi Mobile (not applicable).** The Flutter Inbox owns its message
  layout and uses a dismissible modal barrier in `message_actions.dart`.
- **Xiangqi Kids (not applicable).** The app has no private-message Inbox.

The website production asset build and the Inbox touch regression passed. The
fix ships with the website assets and requires no API change, data migration,
or native release. This review leaves both app checkpoints at their current baselines.

## Community blog listings

Reviewed website HEAD `cffca4bbfe5df809b8b303a7c08dbbafe7d68818` with
`modules/ublog/src/main/UblogPaginator.scala` at SHA-256
`14c0a9b4067a1331abc48068514fa34340461aa4a45be363783391f81a055490`.

- **LiXiangQi Mobile (server inherited).** The native blog screen loads
  `/blog/community` through `BlogRepository` and renders the returned post cards.
  The corrected list takes effect with the website backend deployment.
- **Xiangqi Kids (not applicable).** The app has no blog listing or feed consumer.

Verified the Community page and Atom feed call the same server paginator and
checked both app source trees for consumers. No native release or data migration
is required. This review does not advance either app's checkpoint.

## Public mobile reading, November 17, 2026

The main mobile app consumes the opt-in theme, feed, Blog and Forum display responses, conditional validators and separate visible article view endpoint. Token-bearing Forum requests use current website permissions. The main app's [public reading guide](../../lixiangqi-mobile/doc/PUBLIC_READING.md) records the deployment contract, integration pattern and verification. The app's focused receipt fingerprints the reviewed checkout at `cffca4bbfe5df809b8b303a7c08dbbafe7d68818`. Concurrent reviews retain their existing checkpoints.

The Kids app has no adult feeds, Forum or article reader. Its Lotus puzzle flow has no theme-catalog consumer and retains its existing server contracts.

## Player leaderboard flags

Reviewed website HEAD `731862cfe76613fccfb2b1f14117f4907fdb3112` with this
working-tree change in `app/controllers/User.scala`, `app/views/user/list.scala`,
and `modules/user/src/main/ui/UserList.scala`. The HTML leaderboard now loads
profile flags for ranked players, including the viewer's row outside the top 100.

- **LiXiangQi Mobile (server inherited).** `PlayerRepository.parseLeaderboard`
  already reads `img.flag` from each Xiangqi leaderboard row, and
  `LeaderboardPage` passes it to `PlayerName`. The existing
  `test/players/players_test.dart` fixture passed its parsed flag URL check.
  The website backend deployment supplies this markup to existing app builds.
- **Xiangqi Kids (not applicable).** The app has no player leaderboard or
  `/player` consumer.

Working-tree SHA-256 fingerprints:

- `app/controllers/User.scala`: `61b6eec32b84d01416190e06603ad21712d8c6603cfacf25f09695aa26639e4b`
- `app/views/user/list.scala`: `8dfad2091ebbb7b706fe66b976ef18739ec4b1f7041e043a01df24fe42e8315a`
- `modules/user/src/main/ui/UserList.scala`: `1ee62fe8283a474f25ca3762afc48bd861b91b3ea83f9a85ea0c7e78b19fded6`

This focused review leaves both app checkpoints at their previous positions.

## Official blog website entry point

Reviewed website HEAD `731862cfe76613fccfb2b1f14117f4907fdb3112` with working-tree
navigation changes in `modules/web/src/main/ui/TopNav.scala` and
`modules/ublog/src/main/ui/UblogUi.scala`. The Community > Blog top-menu link opens
the official blog, and the official section now leads the blog sidebar.

- **LiXiangQi Mobile (already covered).** The native `BlogPage` defaults to
  `/blog/official` and exposes Official and Community as its own feed choices. This
  change affects website navigation and sidebar ordering only; mobile navigation
  remains app-owned.
- **Xiangqi Kids (not applicable).** The app has no blog reader, listing or feed
  consumer.

Working-tree SHA-256 fingerprints:

- `modules/web/src/main/ui/TopNav.scala`: `03577ade64e0b2bc3c1afea8d84c8fb3331d142ca22a6faca0e24782d423d18f`
- `modules/ublog/src/main/ui/UblogUi.scala`: `aeef3d9eb3c5fbdcdb4edb9cb977979e0b1e3b0dc759a70d93f7b5fce612f8b2`

No mobile changes, migration or mobile release are required. Website deployment is
required for the navigation update. No tests were run for this presentation-only
change. This focused review leaves both app checkpoints at their previous positions.

## Signal inbox media, composer and links, November 18, 2026

The main app now creates and reads polls, shared LiXiangQi contacts and link previews, and plays approved private clips through the authenticated endpoint. The web viewer and four-item menu follow the pinned Signal Desktop source. Xiangqi Kids has no private inbox or inbox OAuth grant. Both broad review checkpoints retain their previous positions.

The website and its FFmpeg-enabled scanner must ship before the native client. Existing messages need no migration. The focused review records source hashes for both working trees against website base 731862cfe76613fccfb2b1f14117f4907fdb3112. [Source fingerprints](MESSAGING_RECONCILIATION.json#signalMediaMenuLinks)

## Inbox search focus spacing

Reviewed against website base `731862cfe76613fccfb2b1f14117f4907fdb3112` with `ui/msg/css/_side.scss` SHA-256 `da88911326dc51409d4231ccaedbb316bd0b316a2bed8ab6b196615c94982c0c`. The main app uses native Flutter search fields and shares no affected CSS. Xiangqi Kids has no private inbox. Both checkpoints retain their prior positions.

The production asset build and six Chromium and Firefox layout tests passed at 320, 768 and 1440 CSS pixels. This fix ships with the website assets.

## Signal link previews and composer

The main Flutter app adopts Signal Android’s inline emoji and attachment controls, compact thumbnail and landscape banner layouts. The website uses Signal Desktop’s square-image cutoff and three-line composer. Eligible links generate previews automatically on both clients, and composers can dismiss an individual snapshot. Xiangqi Kids has no private inbox. Both checkpoints retain their previous positions. The website and native app ship independently using the existing backend contract. [Pinned sources and working-tree fingerprints](MESSAGING_RECONCILIATION.json#signalPreviewComposerLayout)

## Puzzle solution review, November 18, 2026

The website now opens the primary answer from the puzzle's verified positions.
Each additional published line loads independently of the main answer. The
response includes move labels from the same rules replay as `solutionStates`.
Ship the server and browser assets through the normal website deployment.

- **LiXiangQi Mobile (already covered).** Its puzzle controller builds the replay
  from `solutionStates` and the first published line. Its puzzle screen uses
  board replay controls. All 15 native puzzle controller tests passed, including
  the check that Solution and Restart preserve the first result.
- **Xiangqi Kids (already covered).** Its puzzle controller also builds the answer
  from the loaded states. Its 15 controller tests passed, including the check
  that revealing earns no reward and practice preserves the original loss.

Both checks exercised the existing Flutter implementations. Neither app requires
a release or data migration. The broad reconciliation checkpoints remain at their
previous positions. Reviewed website base `65026cc5a8c2846458e874f8b480ff6b5f11c09e`
with the following working-tree SHA-256 fingerprints.

| Source                                   | SHA-256                                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `modules/puzzle/src/main/Puzzle.scala`   | `9a52b9c0728ec53ee030344b251cb22659ba52530ddcb976ba2b8d2ee6ca87a0` |
| `modules/puzzle/src/main/JsonView.scala` | `ec87cb5c2aeaf7fdf44ae0fd6ddd0d1ac0924bd22fb651c0c4453e30b67be323` |
| `ui/puzzle/src/xiangqi.ts`               | `52061e185101cf6178c2f6ce2335964426dd0bcea2331eb96977358864d32373` |
| `ui/puzzle/src/ctrl.ts`                  | `6839be14e3fcf1920f751b8cc40455e672b3ffdf938fd8de3289c9bd330f7a00` |

## November 19 Global Chat and group membership

The main app consumes the shared public-room media, group permissions and invitation APIs, and implements the Android picker, avatars, sender identities and message actions. Xiangqi Kids has no community inbox or Global Chat entry point. Deploy the website and assets before releasing the native update. The scoped working-tree review records source fingerprints and verification without advancing either checkpoint. [Messaging reconciliation receipt](MESSAGING_RECONCILIATION.json)

## Mid-desktop homepage spacing

Reviewed website HEAD `8f5db4bab2fdac94a51113958993aa5301e77792`. The browser
homepage now stacks Standard Xiangqi, Variants, the blog, and Global Chat
independently of the height of the TV and puzzle sidebar.

- **LiXiangQi Mobile (not applicable).** Its Global Chat lives in the native
  Flutter Inbox, which does not use the homepage markup or CSS.
- **Xiangqi Kids (not applicable).** It has no Global Chat surface and does not
  use the website homepage layout.

The production asset build, 783 UI tests, and Chrome layout checks at eight
widths passed. Deploy the website template and compiled assets together.
Neither app requires a release. Both reconciliation checkpoints retain their
prior positions.

| Source                       | Working-tree SHA-256                                               |
| ---------------------------- | ------------------------------------------------------------------ |
| `app/views/lobby/home.scala` | `de08181175de09bde4e0502d6545f5230ac7fd9e5782b81c0418323c64d60aad` |
| `ui/lobby/css/_layout.scss`  | `1fbe671cf9754b593ab2287076b87902334c5859aac7400ae7549bace673c417` |

## In-message Xiangqi boards

- **LiXiangQi Mobile (ported).** The native Inbox previews and sends boards
  from notation, files and links. It uses the shared native board and plays
  the server's stored positions with marks at the sender's chosen starting ply.
- **Xiangqi Kids (not applicable).** It has no messaging composer, conversation
  viewer or inbox scope. Its gameplay and puzzle APIs have no contract change.

Deploy the backend and web assets before the adult mobile release. See the
[messaging receipt](MESSAGING_RECONCILIATION.json#messageBoards) for source
fingerprints and verification. Both checkpoints retain their prior positions.

## Inbox moderator removal

Site chat moderators can remove other authors’ messages from Global Chat, groups they belong to, and their direct conversations. The main app and website consume the same capability and removal event. Authors retain their existing Delete message options. Xiangqi Kids has no Inbox or Global Chat, and its credentials exclude Inbox moderation. Deploy the backend and website assets before the adult app update.

The focused review leaves both checkpoints at their prior positions. [Messaging source fingerprints](MESSAGING_RECONCILIATION.json#moderatorRemoval)
