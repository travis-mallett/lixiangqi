# Multilingual blog verification — November 8, 2026

Implemented against website HEAD `32e85bcc932229ffe30ab9bc9b1181a145bd9bee`
plus the task's working-tree changes. See [architecture and recovery](MULTILINGUAL_BLOGS.md).
Exact reviewed source SHA-256 values are recorded in both mobile reconciliation
receipts; their broader checkpoints and unrelated pending items remain unchanged.

## Publication state and release handoff

**Initial release deployed by the user; language-selector follow-up not deployed.**
The user reported deploying and opening translated articles, then reported the
language-selection defect documented below. No deployment or Search Console
submission was performed by the agent. The disposable preview contains the fourteen
translations for rendering and integration checks.

The established deployment tool now packages only reviewed translations and runs
the recoverable blog migration before restarting writers. `push-local-live.ps1
-PrepareOnly` passed, including the protected deployment-boundary check and
deterministic fourteen-edition payload validation for the initial release. That
prepared release does not include the subsequent selector fix; rebuild before the
next deployment.

The filtered source is `.tools/blog-editions/release-source`. It contains HEAD plus
the intended task changes, excluding unrelated working-tree changes to root
`AGENTS.md`, `doc/BOARD_EDITOR.md`, `ui/board/src/definitions.ts` and
`ui/editor/src/board.ts`. `blog/AGENTS.md` is included because the user explicitly
requested the editorial-only attribution rule. The deployment tool's optional
`-SourceProject` selects this snapshot, now updated with the selector fix. Rebuild it
through the established command (from the website checkout):

```powershell
& ../lixiangqi-beta-deployment/push-local-live.ps1 -SourceProject "$PWD/.tools/blog-editions/release-source"
```

Do not substitute the mixed working tree without reviewing its unrelated changes.
Read-only preflight confirmed the seven production source articles still match
their stored snapshots and all seven wiki payload files match production bytes.
This work does not translate or change wiki content.

The migration preserves complete pre-migration documents in
`__blog_editions_v1_backup`. Its tested restore preserves the current state in
`__blog_editions_v1_restore_backup` before restoring originals. Backups remain
available for correction and reruns. Migration tests cover interruption/resume,
source mismatch, later edits, idempotence, index creation and restoration.

## Language-selector follow-up

The site menu changed the interface language without replacing `blogLanguage`, so
the previous Chinese preference continued to control cards and feeds. Separately,
the return-page code treated a missing URL query as an exception and redirected to
the home page. Ordinary article GETs also overwrote the preference with the displayed
content language, including when reading a fallback original.

The owning site language action now replaces both preferences and returns to the
same article's available edition (or its source). Safe return paths preserve query
strings. Article-only selection saves its preference through a redirect to the clean
edition URL; ordinary article visits leave saved preferences unchanged. Explicit URLs
still override every preference. Existing cookies recover on the next language choice;
no database migration, cookie-clearing instruction or new dependency is needed.

Regression verification: 26 existing edition/editor browser cases passed, and all four
new selector cases passed on the final server build. These exercise the actual site
menu on articles and the home page through Chinese, English, Vietnamese, French and
German, stale cookies, authenticated accounts, no-JavaScript article links, query
preservation, safe redirects and clean sharing URLs. The first authenticated test
needed an explicit JSON Accept header for its settings probe; it passed after that
test correction. Backend Scalafmt/check and `test;stage` passed with both isolated Mongo
integration environments enabled. Frontend formatting, lint and format check passed.

Main mobile already stores its article preference independently and shares canonical
URLs. Updated its server-markup fixture with the selection query and verified all 22
blog tests; required full check passed 490 tests with two existing skips and clean
analysis/formatting. No native runtime change or Android rebuild is needed for this
follow-up. Kids still has no blog consumer and needs no port. Both exact-byte receipts
were updated without advancing unrelated review checkpoints. Linux/iOS/physical-device
checks were not repeated; this server fix has not been deployed or verified live.

## Official edition URLs

English URLs are unchanged. Append `/zh-Hans` or `/vi` to the following original
URLs for the independently addressable editions. The user reported publishing these
with the initial deployment; the agent has not independently reverified them live.

| Original article   | English URL                                                                                                      | Chinese                                                                                                                   | Vietnamese                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| First tournament   | [English](https://lixiangqi.com/@/ChineseChessOutLoud/blog/lunps28-wins-lixiangqis-first-tournament/m1L9BrtK)    | [简体中文](https://lixiangqi.com/@/ChineseChessOutLoud/blog/lunps28-wins-lixiangqis-first-tournament/m1L9BrtK/zh-Hans)    | [Tiếng Việt](https://lixiangqi.com/@/ChineseChessOutLoud/blog/lunps28-wins-lixiangqis-first-tournament/m1L9BrtK/vi)    |
| Manchu+            | [English](https://lixiangqi.com/@/ChineseChessOutLoud/blog/manchu-one-banner-against-an-army/4wtrgg9Y)           | [简体中文](https://lixiangqi.com/@/ChineseChessOutLoud/blog/manchu-one-banner-against-an-army/4wtrgg9Y/zh-Hans)           | [Tiếng Việt](https://lixiangqi.com/@/ChineseChessOutLoud/blog/manchu-one-banner-against-an-army/4wtrgg9Y/vi)           |
| Pikafish release   | [English](https://lixiangqi.com/@/ChineseChessOutLoud/blog/pikafish-2026-09-06-is-now-on-lixiangqi/RzIGHoys)     | [简体中文](https://lixiangqi.com/@/ChineseChessOutLoud/blog/pikafish-2026-09-06-is-now-on-lixiangqi/RzIGHoys/zh-Hans)     | [Tiếng Việt](https://lixiangqi.com/@/ChineseChessOutLoud/blog/pikafish-2026-09-06-is-now-on-lixiangqi/RzIGHoys/vi)     |
| Mini Xiangqi       | [English](https://lixiangqi.com/@/ChineseChessOutLoud/blog/introducing-mini-xiangqi-on-lixiangqi/Izs07M5E)       | [简体中文](https://lixiangqi.com/@/ChineseChessOutLoud/blog/introducing-mini-xiangqi-on-lixiangqi/Izs07M5E/zh-Hans)       | [Tiếng Việt](https://lixiangqi.com/@/ChineseChessOutLoud/blog/introducing-mini-xiangqi-on-lixiangqi/Izs07M5E/vi)       |
| Jieqi              | [English](https://lixiangqi.com/@/ChineseChessOutLoud/blog/introducing-jieqi-on-lixiangqi/XApFEJf7)              | [简体中文](https://lixiangqi.com/@/ChineseChessOutLoud/blog/introducing-jieqi-on-lixiangqi/XApFEJf7/zh-Hans)              | [Tiếng Việt](https://lixiangqi.com/@/ChineseChessOutLoud/blog/introducing-jieqi-on-lixiangqi/XApFEJf7/vi)              |
| Three Kingdoms     | [English](https://lixiangqi.com/@/ChineseChessOutLoud/blog/introducing-three-kingdoms-on-lixiangqi/B0sJgBNB)     | [简体中文](https://lixiangqi.com/@/ChineseChessOutLoud/blog/introducing-three-kingdoms-on-lixiangqi/B0sJgBNB/zh-Hans)     | [Tiếng Việt](https://lixiangqi.com/@/ChineseChessOutLoud/blog/introducing-three-kingdoms-on-lixiangqi/B0sJgBNB/vi)     |
| Basic Kill puzzles | [English](https://lixiangqi.com/@/ChineseChessOutLoud/blog/introducing-basic-kill-puzzles-on-lixiangqi/ks4dsSLm) | [简体中文](https://lixiangqi.com/@/ChineseChessOutLoud/blog/introducing-basic-kill-puzzles-on-lixiangqi/ks4dsSLm/zh-Hans) | [Tiếng Việt](https://lixiangqi.com/@/ChineseChessOutLoud/blog/introducing-basic-kill-puzzles-on-lixiangqi/ks4dsSLm/vi) |

All fourteen editions received a separate AI editorial review: source comparison
and an independent fluency read, following the writing guide, author's voice
reference and shared terminology glossary. This was not human/native-speaker review.
Titles, introductions, prose, captions and meaningful image descriptions are
translated. Original diagrams are retained with localized descriptions of important
embedded text. Numerical table values, links, code and board markup were validated.
Content fingerprints and review evidence are in `blog/translations/reviews.json`.

All 21 language/article combinations were captured at 1440px. Representative Manchu+,
Three Kingdoms and Basic Kill articles were also captured at 900px and 390px, totaling
39 layouts. All images loaded and no page overflow occurred. Full translated bodies,
Chinese typography, Vietnamese diacritics, tables, captions and long titles were
visually reviewed. Final captures confirm no public translation attribution or dates.
The original author/date and simple edition selector remain. Evidence is retained
locally under `.tools/blog-editions/screenshots`.

## Checks

| Workflow or layer        | Commands and results                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend lint            | `pnpm format`, `pnpm run lint`, `pnpm run check-format`: passed.                                                                                                                                                                                                                                                             |
| Assets                   | `./ui/build --no-install -p`, `./ui/test`: passed; 722 tests.                                                                                                                                                                                                                                                                |
| Server                   | Bundled Java 21/SBT: `scalafmtAll`, `scalafmtCheckAll`, `-Depoll=true 'test;stage'`: final run passed, with isolated Mongo 8.2.11 integration databases enabled. Blog domain suites: 17 tests.                                                                                                                               |
| Translations             | `pnpm i18n-file-gen`, `./ui/build --i18n`, `pnpm i18n-file-gen --check`, repeated generation: passed. XML DTD validation: 6,223 files; translation lint: zero errors, 1,390 existing warnings.                                                                                                                               |
| Anonymous browser        | `BLOG_EDITIONS_TEST=1 BLOG_PREVIEW=1 BASE_URL=http://127.0.0.1:9663 pnpm exec playwright test tests/blog-editions.spec.ts --project=chromium`: 24 passed. All languages, conflicting preferences, initial HTML/Markdown, metadata, missing editions, single-entry discovery, links/history and no public editorial credits.  |
| Editorial browser        | Reset `tests/fixtures/blog-editions.js` in the named disposable preview; `BLOG_PREVIEW=1` Playwright `blog-editions-editor.spec.ts`: 2 passed. Draft/private/spam/unlisted protection, published-versus-draft revisions, concurrency, source invalidation, unpublish, shared comments and likes.                             |
| Migration/package        | Node packager test passed; Python migration suite 64 passed with two environment-dependent skips, both subsequently rerun successfully. Seven blog-specific real-Mongo migration tests passed. Reviewed package `--validate` and `--check` passed.                                                                           |
| Deployment               | 84 deployment tests passed; `push-local-live.ps1 -SourceProject … -PrepareOnly` passed, including release-boundary validation.                                                                                                                                                                                               |
| Main mobile              | Pinned Flutter 3.47.6 formatting, `flutter analyze --fatal-infos`, full `flutter test`: 490 passed, two existing skips. Full Android debug APK built after the public-credit removal.                                                                                                                                        |
| Mobile behavior          | Contract/widget tests cover locale normalization, remembered preference, canonical sharing, deep links, missing editions, single identity and read-marker recovery. Android emulator rendered the actual BlogPage in all three languages using an isolated-preview transport; exact edition browser-opening intent verified. |
| Other applicable tooling | Node snapshot/completion/objective suites passed. Python Jieqi collection (29), supported kinds, engine installation, content/environment (116), online capture, live catalogue (49), and desktop (101) suites passed.                                                                                                       |

Broad puzzle-mining verification found two failures in unchanged code:
`IsolatedHistoryTest.test_discovery_compares_isolated_boards_and_preserves_source_provenance`
(history-source string mismatch) and
`PersistenceTest.test_rescan_skips_current_version_native_games` (`None` job).
Those failures were not repaired as unrelated blog work. Initial existing PayPal
timeout/Fishnet Mongo failures passed on rerun; the final full backend run passed.

Windows verification does not cover the Linux dependency branch: WSL was unavailable.
No iOS build or physical-device test was possible. The emulator rendering harness is
not a live-production app test. Firefox, hosted CodeQL and Docker publication were
not run. No commit/push was made, so staged-only checks were not applicable.

## Both mobile applications and remaining release checks

Main mobile: implemented existing blog consumers, independent language preference,
edition-aware rendering, links/sharing, profile previews and notification/read-marker
identity. Recoverable read-marker migration prevents separate unread entries for
translations. Deploy the website and data migration before releasing the mobile app.

Kids: not applicable. Its runtime and tests contain no blog/ublog consumer, article
list, adult profile-blog preview, blog notification or blog deep-link route. No
gameplay, bot, puzzle, account or shared-board contract changed. No adult community
feature was added, and no Kids runtime release or migration is required.

After deployment, rerun the public browser suite against `https://lixiangqi.com`
with `BLOG_EDITIONS_TEST=1` and without `BLOG_PREVIEW`; verify backup/receipt counts,
all fourteen live URLs and the production Android deep links. Request Search Console
inspection/indexing only after publication, as the user directed. The repository
now has a sitemap implementation added in the subsequent sitemap task; see
[blog sitemap verification](BLOG_SITEMAP.md) for publication, Google discovery and
individual indexing-request status. The translation task itself did not introduce
the sitemap or a broader SEO system.
