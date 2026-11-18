# Inbox and private chat

For file selection, screening, publication, media reads and reporting, see [Moderated forum and inbox attachments](MODERATED_ATTACHMENTS.md).

The website and LiXiangQi Mobile share `modules/msg` and `controllers.Msg` as the
authority for message permissions, state and timestamps. The browser keeps the
two-pane layout; Flutter keeps its native navigation. Both use rounded bubbles,
reply previews, an animated three-dot typing bubble, message actions, reactions,
pins and explicit delivery/read acknowledgements. Xiangqi Kids has no inbox or
private-chat scope and is not a consumer of these features.

## Interaction and policy

- A clock means sending, a faint check means accepted by the server, a solid
  check means downloaded by the recipient, and a colored double check means read.
  Downloading or prefetching never marks a message read. Clients acknowledge
  concrete message IDs, with read gated on visible content in the foreground.
  Receipt times are immutable server timestamps, synchronized to both participants.
- Desktop hover/focus shows react, reply and more controls beside the bubble, on
  the opposite side from its alignment. Right-click and Shift+F10 also open actions.
  Touch long press opens a reaction strip, message preview and action menu. The
  Flutter menu animates the selected message toward the center, respecting reduced
  motion and available height. Menus remain scrollable with enlarged text.
- Each participant can add one emoji reaction per message, replace it or remove
  it. The six shortcuts are heart, thumbs up/down, laughing, surprised and sad;
  More opens a searchable Unicode catalogue. Native uses a lazy grid; web adds
  batches as the grid scrolls. Search names come from Unicode in English; emoji
  themselves can also be pasted into search.
- Reply quotes preserve a short snapshot of the original message. Forwarding
  creates a separately permission-checked message marked Forwarded. Copy, multiple
  selection, exact sent/delivered/read details and up to three shared pins are
  available. Pins have no automatic expiry; either participant can unpin them.
- An author can edit up to ten times within 24 hours of sending. Both participants
  can open the Edited label to inspect previous versions and their timestamps.
- Delete for me hides a message only for the caller, including the inbox preview.
  Delete for everyone replaces the author's message with a tombstone within 24
  hours, **including after it has been read**. It does not erase MongoDB content,
  reactions or edit history. Ordinary APIs redact tombstone content and history;
  the privileged moderation communications view retains them. Existing replies and
  forwarded copies are independent snapshots, as with Signal. Separate moderator
  account-purge operations retain their existing explicit administrative behavior.

## Persistence and synchronization

`msg_msg` retains its existing IDs, `tid`, text, sender and date. Optional receipt,
quote, edit, pin, reaction and deletion metadata is additive. Old records have
revision zero; unknown historical delivery/read dates remain unknown rather than
being invented. No destructive data migration is needed.

`MsgStore` owns participant-bound selectors, compare-and-set content revisions,
and first-write receipt times. Receipt writes never overwrite a concurrent edit.
Deletion-for-me uses the existing `del` participant list. Thread previews are
updated when their matching message changes; per-participant preview overrides
prevent a locally hidden message leaking into the inbox. The existing team-message
masking, spam/troll isolation, rate limiting, reporting and blocking remain in use.

The existing date/thread index supports history reads. `MsgColls.pinnedIndex`
ensures the small partial `(tid, pinnedAt)` index before pin queries; it indexes
only pinned records. The same index is declared in `bin/mongodb/indexes.js`.

Sends include an account-scoped random nonce, allowing retry after a lost response
without duplicating content. Optimistic messages expose sending/failed states.
Snapshots are reconciled with edits, arrivals, removals and receipts that occurred
while the request was in flight. Older content revisions cannot replace newer
content or pins. Failed forwarding batches reuse their nonces when retried.

The shared socket emits `msgChanged`, `msgReceipt`, `msgRemoved`,
`msgThreadRemoved` and `msgTyping`. The native `/mobile/inbox` endpoint accepts only
`mobile:inbox` bearer authentication and ping commands. Incoming broadcasts are
restricted to inbox events, relevant relation events and connection control, so
that this token cannot access game/challenge/notification streams. Mutations stay
on authenticated HTTP routes with the existing security checks.

## Native cache and loading

One session controller and foreground socket live in the app shell, so navigating
into Community → Inbox does not start another messaging session. Cache is encrypted
using the existing secure-storage integration and isolated by server/account.
It stores 50 contact previews, at most 20 conversations of 100 messages each within
a 1 MiB conversation budget, and 20 bounded drafts. Cache writes are serialized;
sign-out/account changes clear private data after pending writes. The latest eight
threads are prefetched with at most two concurrent reads. Older messages load on
demand, with quiet refreshes preserving cached content.

Cached inboxes and threads render immediately. An empty initial load may show a
centered spinner; background refresh does not show a top progress bar. New content
is downloaded while the application is foregrounded, including outside the inbox.
On resume/reconnect the server snapshot reconciles missed events. This feature does
not add APNs/FCM delivery or promise downloads while the operating system suspends
the app; that requires the separate push-notification infrastructure.

## API and deployment

GET `/inbox/:user` is read-only. POST `/inbox/:user` accepts `text`, `nonce`, optional
`replyTo`, or `forwardId` plus `forwardUser`. POST `/inbox/:user/receipt` accepts up to
100 comma-separated `ids` and `read`; its response contains exact receipt times.
POST `/inbox/:user/typing` accepts `active`. POST
`/inbox/:user/messages/:id` accepts `action`, `value` and the expected `revision`.
The actions are `edit`, `react`, `pin`, `deleteMe` and `deleteEveryone`.

Deploy the backend/assets **and** socket gateway before distributing the updated
mobile app. `/api/mobile/auth/config` advertises `inboxSocketUrl`; existing scoped
native tokens remain valid. `push-local-live` already fingerprints app/modules and
`scripts/windows/lila-ws-xiangqi.patch`, rebuilds the gateway through
`Prepare-LilaWs`, and packs the hashed emoji catalogue with assets. No new secrets,
services, dependency installation or manual migration are required. Deployment was
not performed as part of this implementation.

## References and asset licensing

Signal was inspected for behavior and layout, including its desktop Message,
MessageContextMenu and ReactionPicker components and Android ReactionMenu and
ReactionOverlayPlacement. Signal's [Desktop license](https://github.com/signalapp/Signal-Desktop/blob/main/LICENSE)
and [Android license](https://github.com/signalapp/Signal-Android/blob/main/LICENSE)
are AGPL-3.0. No Signal implementation or icon assets were copied. Website outline
icons are original geometry; native icons use the existing Flutter Material set.

Official references: [reactions](https://support.signal.org/hc/en-us/articles/360039929972-Message-Reactions),
[typing indicators](https://support.signal.org/hc/en-us/articles/360020798451-Typing-Indicators),
[editing](https://support.signal.org/hc/en-us/articles/6255134251546-Edit-Message),
[deleting for everyone](https://support.signal.org/hc/en-us/articles/360050426432-Delete-for-everyone),
and [pinned messages](https://signal.org/blog/pinned-messages/).

The 3,944 fully qualified emoji strings/names come from Unicode Emoji 17.0, under
the included Unicode License V3. No emoji artwork is distributed: platforms render
their own glyphs. Source URL/hash are pinned in `scripts/inbox/emoji-source.json`.
To regenerate or verify both copies, download that exact input and run:

```sh
node scripts/inbox/generate-emoji.mjs /path/to/emoji-test.txt
node scripts/inbox/generate-emoji.mjs /path/to/emoji-test.txt --check
```

## Verification

`modules/msg/src/test` checks authorization/window policy, BSON defaults, JSON
redaction and Unicode reactions. With `LIXIANGQI_MSG_TEST_URI`, the randomized
isolated MongoDB suite checks participant isolation, competing edits, immutable
receipts, legacy previews and recoverable deletion. The server workflow supplies
MongoDB 8.2 and enables this suite. Gateway `MobilePlayAuthTest` checks scope and
both incoming and outgoing event restrictions.

`tests/inbox.spec.ts` runs the real browser controller/views against an isolated
HTTP fixture: 320/768/1440px layout, typing, replies, edits/history, reactions and
emoji search, pins, selection/deletion, forwarding, and delayed-snapshot races.
Flutter inbox tests cover cache restoration, foreground visibility, optimistic
sends, races, menus and responsive layouts. `integration_test/inbox_test.dart`
checks real Android emoji rendering, searchable reactions and reply interactions
using an isolated conversation. It sends no messages to real players.

### November 17, 2026 verification record

The source fingerprints and both mobile dispositions are recorded in
`doc/MESSAGING_RECONCILIATION.json`. This is working-tree implementation work;
no commit, push, deployment or app-store distribution was performed.

| Check                                                                                                                                          | Result                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`, `pnpm format`, `pnpm run lint`, `pnpm run check-format` (`lint.yml`)                                                           | Passed using Node 24 and pnpm 11.15.0                                                                                                           |
| `pnpm i18n-file-gen`, `pnpm i18n-file-gen --check`, `./ui/build --i18n` (`translations.yml`)                                                   | Passed; repeat generation preserved generated content                                                                                           |
| Translation XML DTD validation and `bin/trans-lint`                                                                                            | 6,227 XML files validated with libxml2 through Python lxml; zero lint errors, 1,390 pre-existing warnings                                       |
| `./ui/build --no-install -p` and `node ui/.test/runner.mjs` (`assets.yml`)                                                                     | Production assets passed; 780 UI tests passed. The runner is the target of `ui/test`, which is checked out as symlink text on this Windows host |
| `node scripts/pikafish-web/smoke.mjs`; Python unittest discovery in `scripts/pikafish-web/tests` and `scripts/pikafish/tests`                  | Passed; 2 publication and 9 engine-pin tests passed                                                                                             |
| `pnpm exec playwright test tests/inbox.spec.ts --project=chromium --reporter=line`                                                             | 8 passed; actual built styles inspected at 320, 768 and 1440px                                                                                  |
| Java 21 / SBT 2.0.3 `scalafmtAll`, `scalafmtCheckAll`, `-Depoll=true 'test;stage'` (`server.yml`)                                              | Passed on Windows, including the six messaging tests and isolated MongoDB 8.2 persistence test                                                  |
| Gateway `test` and canonical patch reverse-application check                                                                                   | 33 tests passed, including eight native scope tests; patch matches the gateway checkout                                                         |
| Unicode catalogue generator `--check`                                                                                                          | Both 3,944-entry catalogues match the pinned source hash                                                                                        |
| Pinned Flutter 3.47.6 formatting, `analyze --fatal-infos`, `test`                                                                              | Passed; 513 tests, two existing skips                                                                                                           |
| Android emulator `flutter drive --driver=test_driver/inbox.dart --target=integration_test/inbox_test.dart --dart-define=INBOX_SCREENSHOT=true` | Passed; real platform emoji, case-insensitive search, reactions, repeated long press and reply preview inspected                                |

Server verification enabled `LIXIANGQI_MSG_TEST_URI` plus the publication, analysis
and external-login database variables from `server.yml`, using an isolated local
MongoDB 8.2 instance. Optional PayPal, forum, traffic and Three Kingdoms database
suites were not enabled by that workflow and remained gated. Final SBT checks
reused successful cached tests where sources were unchanged.

Logs and browser captures are retained locally under `.tools/inbox-verification`;
native logs/captures are under the mobile checkout's `.tools`. The Android device
scenario uses the live binding's device-pointer propagation so navigation cancel
events reach held-press recognizers. The ordinary debug APK was rebuilt separately
after the fixture run; it is not the integration-test application.
iOS/macOS, physical devices, Linux-specific server dependencies and a live-account
two-device end-to-end session were not verified. WSL is unavailable on this host.
GitHub CodeQL and publishing/container jobs were not run locally. No staged checks
were required because no contribution was staged or committed.
