# Chinese username investigation — November 8, 2026

## Incident and cause

Read-only production requests confirmed that `/@/%25E7%259F%25B3%25E5%25A4%25B4`
returns 404 with “Invalid Lixiangqi username”, while `/@/%E7%9F%B3%E5%A4%B4` and
`/api/user/%E7%9F%B3%E5%A4%B4` return 200 for the intact account `石头`. The working
profile's generated links and Open Graph URL also contained the double encoding.

`LilaRouter` encoded `UserStr` in its path binder. Play's generated reverse routes
then encoded that result through `dynamicString`. Incoming routes decode one
layer, leaving percent escapes instead of a valid account name. ASCII usernames
hid the error. The old regression test exercised only the binder, bypassing the
second encoding performed by the real router.

The binder now returns raw account names, as required by the generated route
contract. Tests call actual reverse routes for profiles, profile previews, games,
public/native profile APIs, inbox, following, exports and studies, then use Play's
incoming `PathPattern` decoding before binding. The test reproduced the exact
reported URL before the fix. Percent signs remain invalid account characters;
there is no recursive decoding or relaxed username validation. Previously copied
double-encoded URLs need replacement with their canonical URL.

## Other defects found and fixed

- Chat replies, chat reports/timeouts and forum quotes extracted URL-encoded
  segments as if they were account names. A shared `userProfileName` parser now
  decodes and validates local profile URLs. Profile enhancement and chat link
  conversion use the same parser. Foreign origins, malformed escapes, subpages,
  query strings, fragments and double encoding are rejected.
- Forum mention completion still used an ASCII-only expression and a three-letter
  minimum for site search. It now uses the shared username repertoire and searches
  from two Unicode code points, including two-character names such as `石头`.
- The compact stored-chat parser still restricted authors to ASCII. It now accepts
  the canonical Han repertoire and retains existing title/status separators and
  storage layout. Regression tests preserve text and moderation flags through
  storage round trips. Existing retained raw Chinese chat records become readable;
  no data rewrite is performed.
- Chat self-mention removal treated a Chinese suffix as a word boundary, so one
  account's name could match the prefix of another's. It now shares the canonical
  complete-mention matcher, preserving other users, emails and profile URLs.
- Shortened server-rendered names could split a supplementary ideograph's UTF-16
  surrogate pair. Truncation now counts complete code points.

## Reviewed contracts

Registration, historical login forms, account IDs, search, JSON, user repository
lookup/casing, mentions, direct messages and websocket identity transport were
inspected. The existing canonical policy remains ASCII letters/digits/separators
plus unified Han ideographs, with 2–20 code points for new names and up to 30 for
existing names. Simplified/traditional Chinese, mixed Latin/Han and supplementary
characters are covered. ASCII casing remains locale-independent; Han spelling is
preserved. Compatibility ideographs, combining marks, invisible characters,
slashes, percent signs and emoji remain excluded. No database key or normalization
change is needed. The websocket's string/JSON identity transport needs no patch.

## Mobile reconciliation

This is a narrow review against website HEAD and the source fingerprints below.
Existing app checkpoints and unrelated pending reviews are not advanced or cleared.

| Product          | Disposition and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LiXiangQi Mobile | **Server inherited / already covered.** `PlayerRepository`, `PlayerDirectory` and `InboxRepository` encode path components once. `playerLinkUsername` decodes through `Uri.pathSegments`, so corrected server HTML restores those links. Native account forms send UTF-8 form bodies; identity parsing and mentions already accept Han. Added `石头` to profile-link tests and new registration/login transport tests for simplified, traditional, mixed and supplementary names. Shared server chat parsing and mention behavior apply to native game/community consumers. No mobile runtime change or release is required. |
| Xiangqi Kids     | **Already covered; public profiles/forum/chat controls not applicable.** Native account forms accept nonempty Unicode input, send UTF-8 form bodies and preserve account JSON names. Added the same registration/login transport tests. Kids has no public profile directory, forum quoting/autocomplete or adult moderation UI to port. Its account/game identity strings remain unchanged. No native runtime change or release is required.                                                                                                                                                                                |

Both app review receipts retain their pre-existing baseline/variant queues. No new
product decision or deferred implementation is introduced by this fix.

## Deployment and verification

Deploy the website server and browser assets together through the existing
`../lixiangqi-beta-deployment/push-local-live.ps1` build. Its server/asset packaging
already covers these changes. No deployment-tool change, migration, backup operation,
engine update or mobile release is required. No production writes or deployment
were performed during this investigation.

| Workflow / scope              | Command and result                                                                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lint.yml` lint and format    | Pinned Node 24.15.0 / pnpm 11.15.0: `pnpm install`, `pnpm format`, `pnpm run lint`, `pnpm run check-format` passed.                                                                                                                                                            |
| `assets.yml` production build | Git Bash `./ui/build --no-install -p` passed, including TypeScript and styles.                                                                                                                                                                                                 |
| `assets.yml` browser tests    | All **721** passed through `pnpm test` (the same `ui/.test/runner.mjs` entry point). `./ui/test` cannot execute on this Windows checkout because its symlink is checked out as a text placeholder.                                                                             |
| `assets.yml` engine checks    | `node scripts/pikafish-web/smoke.mjs` passed; `python -m unittest discover -s scripts/pikafish-web/tests` passed 2 tests and the corresponding `scripts/pikafish/tests` suite passed 9.                                                                                        |
| `server.yml` format           | Bundled Java 21 / SBT 2.0.3: `scalafmtAll` followed by `scalafmtCheckAll` passed.                                                                                                                                                                                              |
| `server.yml` test/build       | `-Depoll=true 'test;stage'` passed with `LIXIANGQI_PUBLICATION_TEST_URI` and `LIXIANGQI_ANALYSIS_TEST_URI` pointing at an isolated MongoDB **8.2.11** on port 27291. The temporary database process was stopped afterward.                                                     |
| Main mobile                   | Pinned Dart formatting, `flutter analyze --fatal-infos` and `flutter test` passed: **481** tests, 2 existing skips. Chinese mention navigation is covered at widths 390, 768 and 1280.                                                                                         |
| Kids                          | Required `scripts/check.ps1` passed: formatting, fatal-info analysis and **220** tests, 1 existing skip. An initial concurrent run hit the existing puzzle test's fixed 750 ms delay; that test passed separately and the complete check passed on rerun without code changes. |

The server run used the existing Windows launcher workaround
`--patch-module=java.base=data/local/jdk-selector-patch/classes`. Without it, this
host's JDK cannot establish loopback connections, causing unrelated HTTP/Mongo
tests to fail. The corrected run passed those integrations as well as the username
and chat tests. No application workaround was introduced.

Limits: Linux's dependency branch, CodeQL, Docker packaging/publishing and physical
Android/iOS runs were not executed. Other optional database suites retain their
normal environment-gated skips (including traffic and Three Kingdoms settlement);
the two database variables required by `server.yml` were enabled. There are no
native/platform, dependency or translation changes. No commit/push was requested;
staging and `lint-staged` were not performed. Unrelated existing lobby/TV edits
were left intact.

## Reviewed source fingerprints

Website base: `5a86e3e0229aae853864afad4a2efd6c8318af9e`. SHA-256 values below cover
only this task's source and test files, after formatting. The report itself is
fingerprinted in each app receipt. These hashes do not certify unrelated commits
or advance either app's baseline.

| Source file                                       | SHA-256                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| modules/chat/src/main/ChatApi.scala               | 3cf44f0c00a10f498c90b8e6986ddb76c92e42cf01ad854bd13a33685f7f66fd |
| modules/chat/src/main/Line.scala                  | 52563878c49c20aff3d40d1e3e189df08d759100193850aa191069236e76c7d7 |
| modules/chat/src/test/LineTest.scala              | ad9a09f79eaefd5b2b41d338a95efdba858eb4cf84d1fece2fa116d056a4f804 |
| modules/core/src/main/UsernameRules.scala         | a261d0c8a4ca2c93dad0211ddfcb3c750ac46ded45c8c64a6d7d0f90e00822ff |
| modules/core/src/main/userId.scala                | 33e456c36a1fdc0ea5415841d3300290edccd95ad81866ec099b9052763d814b |
| modules/core/src/test/UsernameTest.scala          | 8988c7fbcfd77e23f72bef2e0a0c2e95fde3b024c16f59954b64a0a3c8d495f8 |
| modules/security/src/test/UsernameRouteTest.scala | fc03b11c6ba24c1d37d2147f4f2b4a9aa0d9f1a2a84fb569330208bee5acef23 |
| modules/ui/src/main/helper/UserHelper.scala       | 3f1478d0a4b5610565d85e27fd4446a34c428d183544241c51eebf043f69d1ee |
| modules/ui/src/main/router/LilaRouter.scala       | 800e11e0e89deeea5feceb6af63f309d8b077bc42db1a4dd4e4a2024c238a8f8 |
| ui/bits/src/bits.forum.ts                         | 04df40e0837bd18c90f3508a3c6047a26e7d3c9947bbdbf79d7fb8385bc5b470 |
| ui/lib/src/chat/discussion.ts                     | b6a003475b6b57fe252483d0a12a95356c6fc8031ee493049ffab05b0937fa26 |
| ui/lib/src/chat/moderation.ts                     | a6cf0e287687db7d62f504b49b637b5f008e42175db1aa7f28330a7840d437eb |
| ui/lib/src/username.ts                            | e0231e1b17225778c831f722fc1daaa5f2d2b456c331d5b07e7b37e2098ba10e |
| ui/lib/src/view/profileLinks.ts                   | 7a83450e59e8c9ed6f4b52e0a17333a7d553ea2469780da3a978d50eb23ef278 |
| ui/lib/tests/username.test.ts                     | 5f1eb1d9f366983f8ac2af85bc14872cd6db87f1c5b7e3617fc038e814a22cd1 |
| ui/lib/tests/chatUsername.test.ts                 | 863fdc31861e922bd47277fe815067c45d873a316424f440967a94cc77e6d2ed |
