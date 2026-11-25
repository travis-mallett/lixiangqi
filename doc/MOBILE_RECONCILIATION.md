# Website and mobile reconciliation

The website owns shared game semantics, API contracts, engine release pins and original
board artwork. Each Flutter app owns its navigation, responsive layout and product scope.
Reconciliation means preserving the applicable behavior, not reproducing web screens.

## Homepage games in play

The lobby counts each started, hosted realtime game across all variants. A
correspondence or unlimited game contributes while a participant has the player
board open. For Three Kingdoms, the seat must still be active. TV, spectator
streams and lobby previews contribute no attendance. Connected guest Three
Kingdoms computer boards use their browser-local game ID until play ends.

LiXiangQi Mobile opens the participant NDJSON stream for Standard realtime,
correspondence and unlimited play. Xiangqi Kids uses the same participant
stream for its Standard games and has no correspondence lobby. Both inherit
the server fix. Neither native interface displays this homepage statistic.
Deploy the website, round assets, socket gateway and additive MongoDB indexes
together. Neither app needs a release or a checkpoint advance.

Reviewed website base `0b80c22905`, native query blob `7fd8af4f79`, Three
Kingdoms repository blob `a3c3380b00` and combined gateway patch `fb8d3b7750`.
The server and gateway stage builds, production assets, 803 UI tests and 39
gateway tests passed. Server regressions exercised stream teardown, snapshot
parsing, game lifecycles, time controls and seat elimination against MongoDB.
On the staged homepage, one realtime game and one idle correspondence game
showed **1**. Opening TV and a spectator board kept it at **1**. Opening two
player tabs raised it to **2** until the last player tab closed. Opening the
native mobile player stream raised it to **2** again. Overlapping the stream
with a player tab and closing both returned the counter to **1**.

## Leaderboard online population

Websocket patch blob `ecc1f58d10` supplies the homepage total, registered account
count and up to 50 account IDs from the same presence snapshot. The website
renders the registered total and the anonymous remainder. Adult mobile reads
the localized breakdown from the leaderboard on load and refresh. Kids has no
community leaderboard and continues to contribute its existing socket presence.
Deploy the website and websocket service together. The adult app update can
follow. Gateway presence, server snapshot parsing and native leaderboard tests
cover this change. No data migration or reconciliation checkpoint advance.

## Windows deployment preflight

Gateway preparation helper blob `f11c0aec26` passes Git's reverse-check option
as a single argument in Windows PowerShell 5.1. The open-input regression test
covers a fresh checkout, an already applied patch and an upgrade. The interactive
deployment command passed preflight. This local build-tool fix needs no server
migration or mobile release. Neither LiXiangQi Mobile nor Xiangqi Kids runs the
Windows helper or receives a protocol change from this fix.

## Website account menu picture

Header blob `f001a97ba5` uses the signed-in account's existing picture URL.
The adult and Kids apps have independent native navigation and do not render
this header. The change requires only the website server and stylesheets.
The Sass build passed. Browser component checks covered the picture and icon
fallback at 390, 820 and 1280 pixels in light and dark themes.

## Challenge creation and rematches

Website base `0b80c22905`, rematch maker blob `7ab6f7adfd`, variant contract
blob `32500a65e2`. Friend challenges, rematches, lobby offers, API defaults
and ranked-room re-entry are covered in the [variant audit](CHALLENGE_VARIANT_AUDIT.md).
Deploy the website server and assets together. No data migration is required.

LiXiangQi Mobile sends Standard friend challenges through the shared server
and checks the board and rules when reading an invitation. Its challenge and
supported-game suites passed all 12 tests. Xiangqi Kids offers the Standard
rated room and has no player invitation flow. Its 16 rated-room tests passed.
Both apps use native navigation for finding another opponent. These changes
require no Flutter release. The deferred native variant work and both review
checkpoints retain their existing disposition.

The lobby pavilion, correspondence bamboo slips and player-challenge jiàn use
website SVG blobs `af9f794142`, `68bf0eeda5` and `5da2b61b29` respectively
(working tree based on `b2fd2f7fe1`). Adult mobile uses the same jiàn artwork
in its player-profile challenge button. Its play screen uses text controls for
lobby, correspondence and challenges. Xiangqi Kids' garden and rated room have
no equivalent challenge button or offer tabs. The web build and all 793 UI
tests passed. Browser captures cover both themes at 390, 900 and 1480 pixels,
and the native profile widget capture verifies the jiàn. Deploy the web server
and assets together. The adult app can ship independently.

## Three Kingdoms public correspondence

The web lobby controller (blob `60ad7a784a46`) keeps public posts and partial joins in the correspondence tab. All viewers see the listing, the creator can cancel, and only the final join opens the game. Pending carousel cards and existing participant links lead back to that lobby. Verified with creator, joining player and final player browser sessions, a signed-out read of the production listing, the production asset build, 79 lobby and Three Kingdoms tests, and the server compile. Deploy the website server and assets together. Adult Mobile and Xiangqi Kids do not use this web flow and native variants remain deferred in both.

Carousel card blob `ed8b41b2413a` uses the Three Kingdoms miniature board for pending and active games. Browser previews at 390, 900 and 1280 pixels verified the opening board and all 48 pieces. This website carousel change has no native counterpart in Adult Mobile or Xiangqi Kids. Deploy the lobby page and assets together.

Website base `b2fd2f7fe1`, challenge implementation blob `209273a83cfa`. Adult Mobile and Xiangqi Kids continue to use their existing lobby contracts. Public Three Kingdoms offers use a separate endpoint and require the deferred native three-player board in either app. The existing MOBILE-VARIANTS and KIDS-VARIANTS decisions cover these offers. Neither checkpoint advances. The website requires matching lobby assets, server routes and the pending-offer index in the existing Three Kingdoms deployment migration. Verification covers the one- and two-seat setup, pending and started seat transitions, participant visibility, public listing clicks and the displayed bot level.

## Products and receipts

### Homepage games played today

The web counter counts games created in the preceding 24 hours on each one-minute
cache refresh. Game and Three Kingdoms cache blobs are `209ae96787` and
`4b2ee243f7`. Reviewed both count queries and checked the diff for whitespace.
Neither LiXiangQi Mobile nor Xiangqi Kids consumes the homepage statistic in
its native UI. Only the website server needs deployment.

### Homepage variant shortcuts

The web homepage groups its variant rows and links to the existing rated rooms,
bot and friend setups, analysis boards and variant directory. The variant-name
menus retain rules, game history and live player counts. Website base
`0b80c22905`, view blob `9317b98426`, stylesheet blob `628a048051`.
The gateway (patch blob `d4d9baebfd`) counts distinct people per variant
across rated, bot and friend activities. Rated matchmaking and active rated
games share the same mode counter, including the Three Kingdoms pool without
an opening clock phase. Rated friend invitations retain their friend activity.
Deploy the patched gateway, website server, translations and web assets together.

LiXiangQi Mobile owns a native Standard play screen with deferred variant
entries. Xiangqi Kids has a Standard-only garden and rated room. Neither app
renders these rows or needs an API or artwork update. Both existing variant
deferrals and review checkpoints still apply.

The Scala build and stage, production assets and all 797 UI tests passed.
Edge verified both themes at 320, 390, 900 and 1480 pixels, including 44-pixel
phone controls. Browser checks exercised the four variant menus, bot and friend
setups, guest rated redirects and the directory link. All 35 gateway tests
passed, including coverage of multi-tab overlap, activity changes and disconnects
for all four variants. Browser checks with sample counter snapshots verified the
mode breakdowns, zero updates, an 8 px gap between adjacent cards in both themes,
and counter alignment beneath wrapped names.

### Chat notification sounds

Reviewed website base `51a15034ab`. Working-tree SHA-256 prefixes are
`31b47d327003` for sound playback and `cfeb4e5574b4` for the Sound settings
panel. The browser preference mutes the shared incoming-chat cue, including
tournament chat, independently of board sounds. The setting defaults to on.

- **LiXiangQi Mobile (not applicable).** Native chat does not play the web
  chat cue. Native board audio has no separate Voice Sound Effects setting.
- **Xiangqi Kids (not applicable).** Its board audio has no chat cue or
  separate Voice Sound Effects setting.

The production asset build and UI test suite passed, including the chat
mute regression test. Deploy the website translations and web assets
together. Neither app needs a release or a checkpoint change.

### Global Chat registration welcomes

Reviewed website base `b2fd2f7fe1`. Working-tree SHA-256 prefixes are
`b898093512b8` for the global chat writer and `260a330b96c6` for the web
announcement row. Successful account creation queues a public welcome entry
for eligible adult accounts. The server publishes the optional `welcomeUser`
field with existing global chat history, preview and live updates.

- **LiXiangQi Mobile** renders the announcement in its existing Global Chat
  using its shared player profile widget. Cached messages preserve the field.
  Deploy the website backend to start sending greetings. Older app builds
  can display the plain-text message.
- **Xiangqi Kids** has no public inbox or Global Chat. The website excludes
  registrations from the Kids app from the public announcement.

The chat asset build and 795 UI tests passed. Browser fixtures cover
signed-in and signed-out chat at 390, 900 and 1440 pixels across light and
dark themes. The adult Flutter suite passed with two skips, and a focused
widget test captured the welcome entry in the native inbox. Analysis reported
three existing informational findings outside the inbox. Both apps retain
their existing reconciliation checkpoints.

### Three Kingdoms friend challenges

Reviewed website base `b2fd2f7fe1a21e529675b4b2fe3d056d4feeea46`. Working-tree SHA-256 prefixes
are `3f9d30ec0124` for the shared lobby modal and `8428ecb87c3a` for the
Three Kingdoms clock. The web challenge creator and round now share real-time,
correspondence and unlimited settings. The invitation retains the creator's
requested side and supports a bot as the third player.

- **LiXiangQi Mobile (not applicable).** No native Three Kingdoms challenge,
  round or clock consumes the changed API. The inbox recognizes Three Kingdoms
  links and continues to open the website for unsupported boards.
- **Xiangqi Kids (not applicable).** Its native gameplay is Standard-only and
  does not consume the Three Kingdoms challenge or round APIs.

Both native variant projects remain deferred. No checkpoints advanced. The
existing website deployment builds the shared rules bundle and packages the
server and web assets together. Existing clock and invitation records read the
new optional fields without a data migration. No mobile release is needed.
The production asset build, Scala compile, scoped clock and invitation tests,
and all 795 UI tests passed. Chromium fixtures exercised the modal at 390, 900
and 1440 pixels and verified correspondence in the invitation and round.

### Open game indicators

Reviewed website base `1ab0406b31882ea4444879ef1f068dcc10ba440a`.
Working-tree SHA-256 prefixes are `94b1445dc5fc` for the lobby controller,
`a78470d69dc4` for the lobby socket, `7d2cb65bb2c4` for the tab view,
and `eb39063d017e` for its stylesheet.

- **LiXiangQi Mobile (ported).** The native Play screen shows a dot on each
  offer tab with an open game from another player. Its existing lobby
  subscription and filtered offer lists supply the state. The Play screen
  SHA-256 prefix is `5cc5be292d14`. Flutter analysis and the full suite
  passed with 566 tests and two skips. The widget test covers offers arriving
  and leaving in the app's dark theme.
- **Xiangqi Kids (not applicable).** Its online Play flow exposes a rated
  matchmaking room and has no public Lobby or Correspondence offer tabs.

The production web asset build and all 793 UI tests passed. Chromium verified
both themes at 390, 900, and 1480 pixels with simulated lobby events and seeks.
Ship the web translation and browser assets together. The native update can
ship independently because it uses the existing API. Neither app's
reconciliation checkpoint advanced.

The janggi editorial article (`nZliOV3S`) has English, Simplified Chinese and
Vietnamese editions with two static diagrams. The localized FAQ links to the
article and PyChess. Reviewed website base `1ab0406b31882ea4444879ef1f068dcc10ba440a`,
with SHA-256 prefixes `d1cd1d287062` for `modules/web/src/main/ui/FaqUi.scala`
and `26d8ee281753` for `translation/source/faq.xml`.

- **LiXiangQi Mobile (server inherited).** `BlogRepository` consumes the existing
  published article/display contract, including edition URLs, paragraphs and
  static images. All 22 blog and edition tests passed. This content introduces no
  native gameplay or rules changes. The website FAQ has no native duplicated
  question list to update.
- **Xiangqi Kids (not applicable).** Its product has no blog reader, community
  article feed or FAQ content consumer. Its Standard gameplay is unaffected.

The article is published through the existing content system. The FAQ requires
the next website backend/translation deployment; neither app needs a release.
Scala formatting and compilation, generated translation checks and XML
validation passed. The broad frontend checks found existing inbox stylesheet and
TypeScript formatting issues outside this change. Both apps' review checkpoints
and deferred variant decisions remain unchanged. No physical-device or iOS check
was performed for this content-only update.

Tournament opening deadlines and the final board were reviewed against website
base `1ab0406b31`. The round server judges each move at receipt, and the web board
restores the last accepted position when a result arrives. Clock history uses
the saved bank balance when a per-move limit expires. Working-tree SHA-256
prefixes are `67edd150d443` for TimedMove, `7e2f1ba5d7ae` for the round
controller and `9c46ca1916ae` for clock history.

LiXiangQi Mobile and Xiangqi Kids both use the server result for online games.
Both now check the opening deadline, active bank and per-move limit before
sending, and both restore an unaccepted move when a result arrives on the same
ply. The native result screens identify a missed first move alongside the
winner. Their play controller SHA-256 prefixes are `a7df65bf5e51` and
`1442c6c097fe`, respectively. Flutter analysis, both full test suites and both
Android debug builds passed. Verification covered 94 server tests, the Scala
application compile, the production web build and all 793 UI tests. The opening
cannon regression passed in Chromium, Firefox and WebKit. iOS builds and
physical-device gameplay remain unverified. Deploy the server and web assets
together and release both apps. Existing games use the same storage format.

The shared web renderer reveals each board after its board artwork, pieces, backs,
shadows and coordinates are ready. Appearance changes keep the previous complete
theme visible during loading. Website base `1ab0406b31`, working-tree SHA-256
prefixes `3c060e46b5dd` (appearance loader) and `a74a0d6f4eac` (board CSS).
Delayed-image browser checks cover Standard, Mini, Jieqi, Manchu+ and Three
Kingdoms on refresh and scroll in Chromium, Firefox and WebKit. Chromium also
recorded compositor frames. The production asset build and web UI suite passed.

LiXiangQi Mobile and Xiangqi Kids now reveal their entire shared Flutter board
after the selected artwork and pieces are ready. This covers the existing native
Standard boards, including bots and puzzles in both products. The respective
board widget SHA-256 prefixes are `22704bb83582` and `2c8e1b580b95`. Both apps
passed Flutter analysis, their full test suites including first-paint checks, and
Android debug builds. iOS builds and physical-device testing remain unverified.
Deploy the rebuilt website assets and release each Flutter app to deliver its fix.
This scoped review leaves the existing variant decisions and review checkpoints in place.

The server-rendered homepage rated Xiangqi card displays `15 min` on first paint
(`preload.scala` blob `215f4fcd7e`). LiXiangQi Mobile's home card and Xiangqi Kids'
rated room use native localized descriptions, so this web markup fix is inapplicable
to both apps. Scala formatting and compilation passed. Deploy the rebuilt website
backend. Neither app requires a release.

Jieqi players can resize throughout a game unless they selected Never (round
board blob `6bccd673b5`). Rectangular grips use the artwork corner (renderer
`977bc59226`, styles `522ee1475d`). The shared grip (`0083b38663`) sits 4px
farther inside the rectangular corner along its bisector. Three Kingdoms draws
the strokes 6px closer to the wood while keeping the hit area outside the hexagon
(graph renderer `9a5d1cc025`, styles `1e5118a97d`). Edge verified the move-14
Jieqi player position, Standard, Mini Xiangqi, Manchu+ and all three hexagon
perspectives, including an occupied corner with coordinates on and off. The checks covered
390, 900 and 1440 pixels. The production asset build and all 796 UI tests passed.
Deploy rebuilt web scripts and styles together. LiXiangQi Mobile and Xiangqi Kids
size their native boards through Flutter layout and have no web resize grip.

Three Kingdoms friend challenges support a second human or a level 1–5 bot, and
computer setup aligns the kingdom selector with the clock controls (website
`1ab0406b31`, working-tree blobs `f79e385b19` for lobby setup, `a065ea75a60`
for invitations, and `5a161a34d8` for setup styles). LiXiangQi Mobile and
Xiangqi Kids filter game feeds to their supported variants and have no native
Three Kingdoms invitation or computer setup. Both changes are inapplicable under
the existing variant deferral. The Three Kingdoms Scala suite, all 793 web UI
tests, production asset build, and Edge spacing checks at 320, 768, and 1280
pixels passed. Deploy the website backend and web assets together. Existing
invitations require no migration, and neither app needs a release.

Blog article mentions omit presence dots and vertically center patron wings (website
`1ab0406b31`, working-tree blobs `20f0a71967` for the blog stylesheet,
`41c5b2dcaa` for the blog opt-in, and `4249fda1e5` for profile expansion).
LiXiangQi Mobile renders article links through Flutter's native markup component
without the website's profile expansion. Xiangqi Kids has no blog reader. The
change is inapplicable to both apps. The profile-link tests and production asset
build passed. Deploy the rebuilt website JavaScript and CSS.

Three Kingdoms TV game cards place players beside their board sides using the homepage
widget's layout (website `1ab0406b31`, working-tree blobs `9a124a3998` for the
Scala view and `83fdc2eba9` for the shared stylesheet). This is inapplicable to
LiXiangQi Mobile and Xiangqi Kids because their native game feeds exclude Three Kingdoms
and they do not render the website cards. Scala formatting and compilation, the
production asset build, all 791 UI tests, and Edge layout checks at 320, 768, and
1280 pixels passed. Deploy the website server and rebuilt assets together.

Chat board previews (MsgBoards.scala blob `7c478b485a`) now carry optional title
and source text. Adult mobile preserves these fields in its inbox cache and opens
supported replays full screen at the selected move. Its existing variant scope
continues to apply. Xiangqi Kids has no messaging inbox. Verification included
Chromium and Firefox replay tests, the Flutter full-screen widget regression,
static analysis and the full Flutter suite. Deploy the web assets and backend
together and release the adult app. Existing messages require no migration.

The website Lobby and Correspondence offer tables show each variant's localized
name and TV icon (website `2eb026d70d`, working-tree blobs `2772cf0b72` for
`home.scala`, `3296ff5672` for `util.ts` and `72eb8326b0` for `_hook-list.scss`).
Adult mobile's offer lists accept only Standard Xiangqi through
`supportsNativeGame`. Xiangqi Kids has no offer list and applies the same
Standard-only filter at the lobby data boundary. The column is inapplicable
to both apps. All 791 web UI tests passed, and Edge verified the circled icons
and table widths from 320 to 1440 pixels. Deploy the website server and rebuilt
web assets together. Neither app requires a release or checkpoint change.

Friend challenge setup now uses default Tiantian rules (website `2eb026d70d`,
working-tree blobs `b527414884` for `setupCtrl.ts` and `b5e7da5995` for `modal.ts`).
Adult mobile removes its corresponding challenge selector and uses its existing
Tiantian default. Xiangqi Kids has no friend challenge setup screen. The web lobby
suite passed all 55 tests, including switching from computer setup with unrestricted
rules. Adult Flutter analysis and all nine challenge tests passed. Deploy rebuilt
web assets and release adult mobile independently.

The Manchu+ variant badge uses the shared website circle styling (`_data-icon.scss`
blob `9efa6f654a`). The production Sass build passed and the compiled rules match
Mini Xiangqi. Neither Flutter app renders the Manchu+ badge or consumes website
CSS. Deploy the rebuilt web stylesheets. Neither app requires a release.

Analysis move navigation retains the displayed evaluation while the next score is
pending (website analysisSuggestions.ts blob `6e788adc6c`). Adult mobile ports
the same behavior in its engine summary while clearing position-specific lines.
Regression coverage lives in the website Xiangqi contract and Flutter analysis
tests. Deploy the web assets and release the adult app independently. Xiangqi
Kids has no analysis board.

The CI repairs against website commit `7b97edceee` affect the HTTP test client,
the sender-only group deletion assertion, generated website translation types, and
the standalone bot build command. The staged publication and inbox HTTP suite
passed on Windows. Neither Flutter app consumes these test or build paths, and
neither requires a release. There is no deployment dependency.

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

## User-uploaded profile pictures

- **LiXiangQi Mobile (ported).** Native email and Google registration accept an optional photo. The owner can replace it from the profile. The native profile, inbox contacts and chat identities read the published picture. Moderation, the 8 MiB limit and 512-pixel WebP normalization belong to the server.
- **Xiangqi Kids (excluded by product decision).** The Kids app never uploads or displays user-provided pictures. Its signup, player identity and board widgets keep their existing presentation. Game chat on both apps keeps its existing identities.

Reviewed website base `b2fd2f7fe1a21e529675b4b2fe3d056d4feeea46` with working-tree SHA-256 prefixes `536c93cba895` (signup), `9d3444fcff64` (account controller), `38a3fae3eab4` (scanner) and `41357472f03b` (Flutter profile widget). Verification passed for the 11 scanner tests on a MongoDB replica, multipart registration over HTTP, a browser profile edit through moderation to publication, the production web asset build and 796 web UI tests. Flutter analysis and 572 host tests passed, with two existing skips. Deploy the scanner, backend and web assets before releasing the updated adult app. No data migration is required. Both broad reconciliation checkpoints retain their previous positions.

## TV channels and Three Kingdoms replays

Reviewed website base `2eb026d70d`, TV view blob `50dc56588073`, and game repository
blob `f3cb19d9d899`. The website lists Xiangqi once, removes Bot from its channel menu,
and shows the eight most recently completed Three Kingdoms games alongside current games.

- **LiXiangQi Mobile** watches individual games through `/api/stream/game/$id`. Its
  watch screen does not consume the website channel list or the Three Kingdoms grid.
- **Xiangqi Kids** has no TV channel browser. Its gameplay and puzzle contracts are unaffected.

Both apps require no release. The website deployment packages the completed-game index
with its existing Three Kingdoms index migration. Verification covered TV selector and
grid tests, the MongoDB index migration, and Chrome layout fixtures at 390, 900, and 1440 pixels.

## Rated friend challenges

Members can send rated invitations on each website variant's existing rank track.
Casual remains the initial mode. Rated play uses the pool's clock, move limits,
opening position and rules, with random sides and eligible human players.
Three Kingdoms requires two named opponents and applies its repeated-opponent limit.

- **LiXiangQi Mobile** uses the authenticated play bootstrap to discover the
  Standard pool and rated challenge capability. Both profile challenges and
  shareable invitations use the same native form. Incoming invitations show
  their rating mode. Native variant games remain deferred.
- **Xiangqi Kids** has no friend invitation flow. Its existing Standard rated
  room continues to use matchmaking. No Kids release is required.

Deploy the server and web assets together. The adult app exposes Rated when the
deployed server advertises support. Existing invitations need no data migration.
Neither reconciliation checkpoint advances. Reviewed against website base
`51a15034ab`, with challenge joiner blob `8731dac648`, Three Kingdoms challenge
blob `aa29cf0b3f`, lobby setup blob `b8b9d6b3c5` and native form blob
`6c0d3cadda`. Verification covered game creation on all four two-player tracks,
three-player accounting on a MongoDB replica set, pool settings, the web UI
suite, responsive browser captures, Flutter analysis and the native widget suite.

## November 23, 2026 · Correspondence ranking

The web and server changes add separate correspondence accounts for all five variants.
LiXiangQi Mobile displays live and correspondence standings for all five variants.
Full player profiles offer a dated correspondence rank and score graph for each
played variant. Native Standard Xiangqi play supports days per move and game
history omits the mode tag for correspondence. For other variants, play links
open the website under the existing deferred native-board project. Xiangqi Kids
has no correspondence setup, public leaderboard or player-profile graph.

Reviewed against website base `51a15034ab`, replay blob `6820c0c589`, chart blob
`c2f24efdf2`, adult player repository blob `e4ca59617f` and native graph blob
`ce207fb5ed`. Server verification covered the staged server and assets, the
five-variant fixture, a cached production snapshot on a local replica, repeat
deployment and deployment recovery. Browser checks covered the graph, mode selector
and history cards at 390, 900 and 1440 pixels in light and dark themes. Mobile
verification covered fatal-info analysis, the full Flutter suite (579 passed, two
skipped), a local Android arm64/x64 debug build, and phone and tablet renders of
the leaderboard and graph. Release the
migrated server before the adult app update. The app consumes the server’s profile
and leaderboard responses. Both broad checkpoints retain their reviewed revisions.

### Full profile rating tabs

The website and the adult Flutter app show Live, Correspondence and Puzzles.
The two game tabs include all five variant tracks and show an empty graph when
a player is unranked. The adult app uses a swipeable chart with arrow controls.
Xiangqi Kids has no public player profile. Its private learning and puzzle
screens use separate progress views. Release the web assets and server together
before distributing the adult app. The deployment writer gate also fills missing
live history days using historical game and account observations. Existing
scores, correspondence history and puzzle history are preserved.

Reviewed against website base `51a15034ab`. Working-tree SHA-256 prefixes are
`67f819c63555` for the profile markup, `cfaea4172987` for the chart, and
`326ace3738b5` for the native chart. Browser captures cover 390, 800, and 1300
pixels. The Flutter suite passed 579 tests with two skips. The website UI suite
passed 796 tests. The five-variant historical replay was exercised twice against
isolated MongoDB and verified against known scores.

## Banqi website launch

### BanqiFish browser engine

Reviewed against website base `0b80c22905e3` and BanqiFish WASM SHA-256
`6cac80c6ce994e2b2ea2849d88673f286d44242ece1efca651d1f1df3db3cbe3`.
LiXiangQi Mobile opens Banqi in its in-app browser, where the new opponent,
ten levels and analysis take effect with the web release. Its native
Standard engine and the MOBILE-VARIANTS deferral still apply. Xiangqi Kids
offers Standard bots and excludes Banqi at the gameplay boundary under
KIDS-VARIANTS. Neither app needs a binary release or checkpoint change.
The release packages the matching web bundles, worker, WASM, licence,
sources and server-generated bot names. Engine verification uses the
production Scala referee and both shipped WASM opponents. The adult home and
supported-game suites passed 16 tests. Both Kids variant-isolation tests passed.

### Variant launch

The adult app shows Banqi in live and correspondence standings and in public profile rank history. Its Home entry and watch links open the website. Mixed invitations, game history and watch streams keep Banqi positions outside native Standard play. Native Banqi gameplay, bots and analysis remain in MOBILE-VARIANTS. Xiangqi Kids continues to offer Standard only. Its mixed-game and bootstrap tests now exercise Banqi. KIDS-VARIANTS retains its existing scope.

The launch receipts in both apps record website base `0b80c22905e3`, working-tree hashes and verification. The web server, assets, ranks and gateway must ship before the adult app exposes the web entry. Both aggregate checkpoints retain their earlier positions.

Banqi capture-rail spacing was reviewed at stylesheet SHA-256 726599ff73da926970d4ceb78ed5833f86cb75b8129bda18548d4394bf7c3d56. The lower rail is anchored inside the web board on either orientation. Adult mobile opens this board on the website. Kids offers Standard only. Shipping the website CSS delivers the fix.

The empty Banqi capture slots now use the ring and character paths from the default-wood SVGs. The adult app receives these assets through web play. Kids offers Standard only. Release the web assets together. Rail view SHA-256 5637ed9ccefccde796a77099f8fe47168717f586e6d31cbb46c937139921b416.

Banqi’s Default Wood, Paper and Tournament boards restore their stepped rim and four fret corners. The adult app opens web Banqi and receives these assets with the web release. Kids offers Standard only. Verified with the board-theme suite and responsive browser captures. Default Wood SVG SHA-256 f7a9cdb89e72d29b8ba720dd1ac5919d33d65f059cdd0af4b342ec54622b905d.

### Banqi integration audit, 2026-11-25

The adult inbox recognizes pasted Banqi positions and server-generated board attachments. It preserves the public position and opens a linked game or analysis in the web viewer. Native variant boards remain deferred under MOBILE-VARIANTS. Five adult inbox tests passed. Ship the adult inbox change in the next app build.

The website supplies the adult app's Banqi play, study, editor, replay and watch boards. The new study paths require the website and the socket gateway built from the same sources. The deployment script fingerprints the shared rules sources when rebuilding the gateway. Existing study paths retain their stored identities. Xiangqi Kids offers Standard play and has no inbox, public standings or study viewer. Its two variant-isolation tests passed. KIDS-VARIANTS and both aggregate checkpoints retain their existing scope and positions.

Website base `0b80c22905`. Working-tree Git blobs include study path codec `ba659ee15120`, study engine `ac4efd65835e`, miniature replay `f99c99fb4e37` and editor `ccaee3716f8a`. The adult inbox parser and attachment view have blobs `09415f6b115c` and `930bdfc8870b`.

## Homepage leaderboard title link — 2026-11-25

The website leaderboard card title now links to the same `/leaderboard` destination as its More link. This only changes the server-rendered homepage heading without changing its appearance.

- **LiXiangQi Mobile — not applicable.** The native app has a separate Community entry and leaderboard route, but no homepage leaderboard card or Updates card.
- **Xiangqi Kids — not applicable.** The Kids garden has no homepage leaderboard card or community leaderboard.

No mobile feature or API contract is affected. No queue item was added and neither reconciliation checkpoint advances. Website base `0b80c22905e3111db34dcccfc040c23e9f809247`; working-tree SHA-256 prefixes are `4b307a497818` for `app/views/lobby/bits.scala` and `dde016263a31` for `ui/lobby/css/_lobby.scss` (both files also contain unrelated pre-existing Banqi/variant edits). No data migration is needed. Deploy the website server-rendered view and web assets together. The production asset build passed, and the UI suite passed all 803 tests. Git Bash could not initialize in this Windows session, so the same `ui/.test/runner.mjs` entry point was run directly with Node.
