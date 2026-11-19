# Inbox and private chat

For file selection, screening, publication, media reads and reporting, see [Moderated forum and inbox attachments](MODERATED_ATTACHMENTS.md).

The website and LiXiangQi Mobile share `modules/msg` and `controllers.inbox.Msg` as the
authority for message permissions, state and timestamps. The browser keeps the
two-pane layout; Flutter keeps its native navigation. Both use rounded bubbles,
reply previews, an animated three-dot typing bubble, message actions, reactions,
pins and explicit delivery/read acknowledgements. Xiangqi Kids has no inbox or
private-chat scope and is not a consumer of these features.

## Global Chat and message alerts

Global Chat is a public room for messages, files, media, polls and contacts pinned first in the main web and mobile inboxes.
It uses the standard account and public-chat moderation rules. Authors have the
usual 24-hour editing and deletion window. A moderator with the chat-timeout
permission can remove any post, including older posts. Public edits and deletions
invalidate the preview and remove stale notification excerpts. Delete leaves a
moderation record. The room has no membership roster or public reader list.

The room starts muted with mention alerts enabled. Unmuting enables alerts for
ordinary posts. Turning off mention alerts while muted silences the room. The
same exception applies to muted private groups. A later ordinary post cannot
cancel a pending mention alert in a muted group. Muting a direct chat silences
its alerts. The website bell and the mobile notification center honor the account’s
notification preferences. Browser and device push additionally require an enabled
channel and a registered browser or app installation. Reading a message during the
five-second notification delay suppresses its alert. Unread private conversations
remain visible in the inbox even when their notifications are muted.

The public homepage preview loads when the card enters the viewport. It displays
up to 12 recent excerpts of 320 characters, refreshes while visible, and supports
conditional requests. Signed-in players use the inbox conversation and composer directly in the card, including replies, reactions and scanned attachments. Its initial query loads the newest 12 messages. The card can open full history in the inbox. Anonymous visitors can read. The authenticated inbox
requests history in pages of 100 and subscribes to room updates while open.

Deploy the matching website backend and assets before the mobile update. The
new MongoDB indexes are additive and initialize on demand. A moderator using
native authentication needs two-factor authentication and a fresh sign-in for the
room-specific moderation grant. Normal inbox credentials retain their existing scope.

## Media, polls, contacts and links

The browser lightbox centers the active photo or clip. Its header shows the sender and time alongside Forward, Download and Close. The arrow keys move through the album and adjacent loaded albums. Select a photo to zoom. The attachment menu uses Signal Desktop’s Inter text, Signal Symbols and menu geometry. [Lightbox](https://github.com/signalapp/Signal-Desktop/blob/848443afc3fcc74a0e127ba4f4d8554b95da856e/ts/components/Lightbox.dom.tsx) · [Attachment menu](https://github.com/signalapp/Signal-Desktop/blob/848443afc3fcc74a0e127ba4f4d8554b95da856e/ts/components/CompositionArea.dom.tsx)

Both clients offer Photos & videos, File, Poll and Contact. A poll has two to ten choices and supports single or multiple selections. Participants can revise or withdraw their votes until the author ends the poll. A contact card shares a LiXiangQi account. Sending a poll or contact preserves the existing text draft. Older clients receive readable question and option text or the contact name.

Eligible HTTPS links can generate a preview while composing. A sender can remove a preview before sending. The server fetches the publisher’s metadata and optional thumbnail. The message carries the resulting snapshot. Recipients fetch any approved thumbnail from the private attachment endpoint, so opening an inbox does not request an image from the publisher. [Signal preview fetcher](https://github.com/signalapp/Signal-Desktop/blob/848443afc3fcc74a0e127ba4f4d8554b95da856e/ts/linkPreviews/linkPreviewFetch.preload.ts)

## Interaction and policy

- A clock means sending. One check means the server accepted the message. An
  outlined double check means a recipient’s client acknowledged delivery. A
  filled double check means the message was visible in their active conversation.
  Receipt times come from the first acknowledgment and synchronize across devices.
  Signing in on the web or resuming the native app downloads pending direct
  messages in batches of 100, including when the inbox is closed. Messages sent
  before the delivery queue shipped still acquire receipts when downloaded.
  Group receipts aggregate acknowledgments across the message’s original audience.
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
On resume or reconnect the server snapshot reconciles missed events. Registered Android and iOS installations receive private-message alerts through the configured Firebase project. The app checks the signed-in account when opening a notification. New alerts honor chat mutes, mention preferences and the account’s device-notification preference.

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
`Prepare-LilaWs`, and packs the hashed emoji catalogue with assets. Existing direct conversations require no migration.

For native background alerts, set the server environment variable `LIXIANGQI_INBOX_FCM_URL` to the LiXiangQi Firebase project’s FCM v1 messages endpoint and `LIXIANGQI_INBOX_FCM_CREDENTIALS` to the protected service-account file. The protected server environment supplies these values across releases. Mobile build options and iOS signing requirements are documented in the [native inbox guide](../../lixiangqi-mobile/doc/INBOX.md). Delivery uses the [FCM installation-ID target](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages).

## Chats, groups and organization

New chat offers friends, username lookup and group creation. A group has a stable identifier beginning with `~`, a name, an optional description and up to 32 members. The creator is its first administrator. New groups let members add eligible accounts found through site-wide username search. Administrators can restrict adding to administrators, change the name and description, remove members, grant or revoke administrator roles, and delete any member’s message within 24 hours of sending. Existing groups retain their prior administrator-only invitation setting until an administrator changes it.

Invite links start disabled. Administrators can enable, reset or disable a link and optionally require approval. Following a link shows a confirmation before joining or requesting access. Removed or blocked accounts cannot rejoin through that link. A new member sees messages addressed to them after joining. Adult members can publish screened attachments in groups that include kid accounts. Kid accounts can read those group attachments but cannot upload their own. Direct chat retains its separate recipient restrictions.
When the last administrator leaves, a remaining member takes that role. Blocking a group leaves it and prevents reinvitation. Deleting a group chat removes that member's local history from view. Existing direct threads keep their identifiers and data.

Each group message records its original audience. New members see messages sent after they join. Account eligibility, message visibility, membership, and media authorization apply to history, attachments and forwarding. Group media commits fence membership and account changes inside MongoDB transactions. A group sender sees a read receipt when every original recipient has read the message. Muted groups can still notify a member who is mentioned. The member can turn that option off in group settings.

Archive dates, manual unread marks, pinned chats, mute choices and folders belong to the individual account. A newer message brings an archived chat back into Chats. Message search and All media use server-side history with paginated results. Browser and Flutter clients share the group and organization endpoints in `conf/inbox.routes`.

Deploy the website and its matching WebSocket gateway together before distributing the updated mobile app. Group history uses the same replica-set transaction support as inbox attachments. The service creates additive indexes for memberships and organization settings on first use.

## Private photos and files

The plus button opens Photos and Files. The native app also offers camera capture. Selected photos appear as thumbnails with an add tile. Tap a thumbnail to edit locally with a pen or highlighter, four stroke widths, three text treatments, crop presets, or clock and xiangqi stickers. Send uploads the final versions for screening and publishes the accepted attachments with their caption. An unsuccessful upload stays in the draft for retry or removal. Enter sends on the website and Shift+Enter inserts a line break.

One photo keeps its proportions. Two share a row. Three use a large first photo with two smaller photos beside it. Four use two equal rows. Larger albums show two photos above three, with the hidden count on the fifth tile. Open any tile to browse the entire album and save an individual image. A file card shows the extension, filename and size. Download on the message opens a file chooser for mixed messages and albums. The timestamp and receipt overlay a captionless photo. Reactions overlap the lower edge of the bubble.

The sent glyph is one outlined circle with a check. A recipient delivery acknowledgement adds an overlapping outlined circle. A read acknowledgement fills both circles. These states use the existing receipt events. The website and mobile app expose a send action for a nonempty draft.

## References and asset licensing

Signal was inspected for behavior and layout, including its desktop Message,
MessageContextMenu and ReactionPicker components and Android ReactionMenu and
ReactionOverlayPlacement. The inbox uses Signal Messenger’s Signal Symbols for receipts, actions, attachments and editing tools. Both clients use the regular weight. The [upstream font](https://github.com/signalapp/Signal-Desktop/tree/848443afc3fcc74a0e127ba4f4d8554b95da856e/fonts/signal-symbols) and [source notice](../public/font/signal-symbols/NOTICE.txt) identify the exact revision and AGPL-3.0-only terms.

Signal’s album sizing, draft controls and image editor informed the attachment flow. [Desktop image grid](https://github.com/signalapp/Signal-Desktop/blob/main/ts/components/conversation/ImageGrid.dom.tsx) · [Desktop composer](https://github.com/signalapp/Signal-Desktop/blob/main/ts/components/CompositionArea.dom.tsx) · [Desktop media editor](https://github.com/signalapp/Signal-Desktop/blob/main/ts/components/MediaEditor.dom.tsx)

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

The staged HTTP regression creates a group including a non-friend, promotes an administrator, delivers a mention in a muted group, and follows the receipt and archive state across accounts. It also registers a Firebase installation and verifies removal on token revocation. The feature-specific verification for the November 18 website and mobile working trees is recorded in [the reconciliation receipt](MESSAGING_RECONCILIATION.json).

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
