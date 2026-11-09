# Page loading and navigation audit — November 9, 2026

Implemented against website commit `d39599ca8e531bfd2297c58e49e77693c3eff96e`.
Exact reviewed source bytes are recorded in `PAGE_LOADING_REVIEW.json` and both
mobile receipts. Changes are local; no production deployment, production-database
read, migration, commit, or push was performed.

## Findings and corrections

| Finding                                                                                                                                                                          | Owning correction                                                                                                                                                                                                                                                               | Verification                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firefox could expose an unstyled document before external CSS finished, showing an enormous logo and a misleading network warning.                                               | Initialize the shared `site.load` promise in a synchronous head script immediately after blocking stylesheets, in full pages and both embed layouts. Give the logo intrinsic dimensions. Remove the obsolete warning and its hiding stylesheet.                                 | Reproduced the original flash with delayed CSS and a content-script-style layout read. Regression holds CSS behind an explicit gate and verifies the body cannot be parsed/exposed early in Firefox or Chromium. |
| Every HTML document contained the network warning, making it eligible for Google snippets even without a failed network request.                                                 | Remove that diagnostic from the HTML entirely. Preserve real descriptions, content and existing error handling.                                                                                                                                                                 | Raw HTML and JavaScript-disabled browser checks. Existing search snippets require Google's subsequent recrawl; this task cannot establish when they will refresh.                                                |
| Noto Sans and Roboto downloaded twice: hashed preloads, then unhashed CSS URLs. CSS URL rewriting depended on filesystem symlinks and used inconsistent Windows path separators. | Use the canonical asset manifest for CSS URL rewriting, normalize dependency paths, and support existing manifests for CSS-only builds. This also fixes fingerprinting of other CSS image references.                                                                           | Production build on the actual Windows deployment workstation; regression confirms one hashed URL per text font. A build test covers current-build overrides and a filesystem without symlinks.                  |
| Late text fonts resized the sidebar and changed leaderboard column count after first paint.                                                                                      | Use `font-display: optional` for text faces with existing preloads. On a slow font response, retain the first painted fallback for that document; cached visits can use the web font immediately. Keep icon-font behavior.                                                      | Delay font responses beyond the short block period and verify identical leaderboard bounds before/after their arrival in both browsers.                                                                          |
| Boardless pages eagerly requested board artwork and decoded every piece set entry, including unused variants.                                                                    | Remove unconditional board/piece preloads. Decode the standard piece set when a static or dynamic board needs it; preserve atomic piece-set switching, concealed backs and shadows.                                                                                             | No board/piece requests on leaderboard/manuals; dynamic readiness and piece-switching tests; board/editor regressions. The default board SVG alone is 2,567,402 source bytes. Artwork is unchanged.              |
| Fingerprinted assets expired after one hour, recreating cold loads after idle sessions.                                                                                          | Successful fingerprinted CSS, JavaScript and hashed media receive a one-year immutable cache policy. Mutable JSON/JS/CSS revalidate; other unhashed media retain the one-hour policy. Failed asset responses are never cached.                                                  | Four server cases plus real HTTP checks for immutable CSS, mutable manifest and missing assets.                                                                                                                  |
| The client manifest's filename hash excluded its changing build-date bytes.                                                                                                      | Hash the entire emitted manifest, including its metadata, so an immutable URL always identifies the actual bytes.                                                                                                                                                               | Browser test recomputes the fetched manifest's SHA-256 and checks its filename.                                                                                                                                  |
| Open tabs could lose lazy-loaded modules and styles after a deployment deleted their old hashed assets.                                                                          | The existing deployment transport retains retired fingerprinted browser files for seven days. Repeated releases do not extend retirement; mutable manifests, server binaries, data and source maps are not retained by this policy. Reject changes to existing immutable names. | Six new retention cases and all 90 deployment-transport tests. No SSH/deployment operation was run.                                                                                                              |
| Concurrent dynamic stylesheet callers could resolve before a link loaded; failures could hang forever. Menus could render before CSS.                                            | Share each link's pending promise, reject/remove failed links for retry, and wait for optional module CSS before initialization. Apply to preferences, challenges, notifications, command-palette preferences and study tag input.                                              | Four stylesheet-loader tests plus a gated preferences-menu browser regression. Dialogs and other existing awaiting callers inherit the corrected loader.                                                         |
| The homepage reserved no space for its main play controls before JavaScript initialized.                                                                                         | Render the translated initial play controls on the server using the widget's shared classes; hydrate the existing DOM through Snabbdom. Preserve real navigation links and enable interactive controls on initialization.                                                       | Before/after layout checks at 1440, 960 and 390 px, both browsers. The variants section moves at most two pixels.                                                                                                |
| TV/puzzle embed templates requested a retired `chessground.min.js` bundle, and TV loaded Cash twice.                                                                             | Remove obsolete tags; use the existing shared board modules and embed bootstrap.                                                                                                                                                                                                | Template compilation and TV-embed request regression. A populated daily-puzzle embed was not available in the isolated database.                                                                                 |

The Firefox behavior is documented in [Mozilla bug 1459305](https://bugzilla.mozilla.org/show_bug.cgi?id=1459305).
The synchronous script is useful application bootstrap, not a delay timer or a hidden-page overlay.
The font policy follows the browser's [font-display contract](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@font-face/font-display)
and [preloaded optional font guidance](https://web.dev/articles/preload-optional-fonts).

## Scope and measurements

Inspected shared document/embedded-document templates, CSS compilation, asset
manifests and HTTP headers, piece readiness, lazy styles/modules, lobby hydration,
service-worker behavior, deployment deletion planning and native consumers.
The push-notification service worker has no fetch/cache interception responsible
for these symptoms. Existing server-rendered navigation remains the foundation;
no client router, speculative request flood or extra server-side computation was added.

Public production reads covered the homepage, leaderboard, ancient manuals,
analysis, editor, puzzle entry and TV frame. Lishogi's public homepage/player
pages were a reference for request volume and stable rendering. Production
and localhost have different content, compression and server latency, so their
wall-clock times and transfer totals are not an honest speed-up comparison.

The following measurements use the same isolated local database and Chromium
viewport (1440 × 1000), with 70 ms simulated latency and 1 MiB/s download bandwidth.
They compare the intermediate build before the final font/build corrections to
the completed build, not a deployed before/after benchmark:

| Leaderboard measurement             | Before final font/build corrections |   After |
| ----------------------------------- | ----------------------------------: | ------: |
| Cold-load cumulative layout shift   |                               0.212 | 0.00005 |
| Repeat-load cumulative layout shift |                               0.212 |       0 |
| Completed resource requests         |                                  38 |      36 |
| Duplicate Noto Sans/Roboto URLs     |                                   2 |       0 |
| Repeat-load resource transfer bytes |                              76,568 |       0 |

The original production leaderboard recorded 69 completed resources; the final
local page records 36. Removed eager board/piece requests explain most of that
reduction, but content differences prevent treating it as a universal percentage.
Resource timing excludes requests still in progress when sampled; the removed
2.5 MB board preload is therefore documented separately rather than added to an
inaccurate transfer claim. Final local homepage CLS was 0.0094; manuals and editor
were zero; analysis was 0.0182. These samples do not establish a site-wide field percentile.

Local diagnostic artifacts are under ignored `data/local/loading-audit/`:
`baseline.json`, `comparison.json`, `after.json`, `locales.json`, logs, screenshots
and the deterministic Firefox reproduction. Automated regression source is
`tests/page-loading.spec.ts`. Testing used a separate empty MongoDB/Redis instance;
no production snapshot was copied. English, Chinese and Vietnamese page loads
were checked at three widths in both browsers, including actual negotiated
language, overflow and JavaScript exceptions (54 combinations).

## Verification

| Applicable job or check         | Command / scope                                                                                                        | Result                                                                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lint.yml` lint and format      | Repository pnpm 11.15 / Node 24: `pnpm format`, `pnpm run lint`, `pnpm run check-format`                               | Passed                                                                                                                                                                |
| `assets.yml` build              | Git Bash `./ui/build --no-install -p`                                                                                  | Passed                                                                                                                                                                |
| `assets.yml` frontend tests     | `node ui/.test/runner.mjs` (equivalent runner; the checked-out `ui/test` symlink is a plain file on Windows)           | 737 passed                                                                                                                                                            |
| `assets.yml` engine smoke       | `node scripts/pikafish-web/smoke.mjs` against prepared pinned engine/network                                           | Passed, including multithreading and truncated-network rejection                                                                                                      |
| `assets.yml` publication tests  | `python -m unittest discover -s scripts/pikafish-web/tests`                                                            | 2 passed                                                                                                                                                              |
| `assets.yml` installation tests | `python -m unittest discover -s scripts/pikafish/tests`                                                                | 9 passed                                                                                                                                                              |
| `server.yml` format             | Bundled Java 21 / SBT 2.0.3 `scalafmtAll`, `scalafmtCheckAll`                                                          | Passed                                                                                                                                                                |
| `server.yml` test/stage         | `-Depoll=true 'test;stage'`, both publication/analysis integration-test URIs set to isolated MongoDB 8.2 on port 27291 | Passed, including four new cache-policy tests; SBT reuses successful testQuick results                                                                                |
| Browser loading                 | `LOADING_TEST=1 BASE_URL=http://127.0.0.1:9667 pnpm exec playwright test tests/page-loading.spec.ts`                   | 28 passed (Firefox and Chromium), including More → Back → More                                                                                                        |
| Existing board/editor browsers  | Both suites, both browsers, including geometry, variants, images, touch and analysis/editor transitions                | 76 passed; one existing skip. Firefox clipboard case excluded because Playwright does not support its requested clipboard permissions; Chromium clipboard case passed |
| Deployment transport            | From sibling deployment checkout: `python -m unittest discover -s tests`                                               | 90 passed                                                                                                                                                             |

The local JVM requires the existing Windows selector patch at
`data/local/jdk-selector-patch/classes` to open test sockets. Staging also required
stopping the preview first to release Windows JAR locks. These are verification
environment constraints, not production changes. Linux execution, Docker image
publication, GitHub CodeQL and Safari/WebKit were not performed. No dependency
or platform artifact changed. Translation, bot-calibration, human-bot and mining
workflow path filters are not triggered by this change. No contribution was staged,
so staged hooks and outgoing-range checks are not claimed.

## Both mobile applications

**LiXiangQi Mobile: browser changes not applicable to native rendering; external
website destinations inherit them after deployment.** Its leaderboard/profile
are native Flutter screens. `lib/data/players/player_repository.dart` still reads
the unchanged leaderboard content selectors; flags/flairs remain compatible
unhashed media with their existing short cache. `leaderboard_page.dart` and
`player_profile_page.dart` open unsupported website destinations in an in-app
browser, which benefits from the website release. Native board assets, fonts,
gameplay, account APIs, engine and puzzle contracts do not change.

**Xiangqi Kids: not applicable to its native navigation/rendering.** Its garden,
bots, puzzles, accounts and shared Flutter board have no website CSS, document
bootstrap, browser font swapping or lobby hydration counterpart. No artwork or
rules change needs porting. Neither app needs a runtime edit or mobile release.
Flutter tests, Android/iOS builds and physical devices were not run for this
documentation-only reconciliation. Existing pending reviews/variant deferrals
remain open; neither global source checkpoint was advanced.

## Deployment and remaining limits

Rebuild and release both website server and assets through the existing
`../lixiangqi-beta-deployment/push-local-live.ps1` process. The companion changes
are in `push_transport.py` and `tests/test_browser_assets.py` in that checkout;
they must accompany the release process. The ordinary release manifest tracks
retention and pruning automatically. No user-data migration or new dependency
is required. Caddy already passes through application cache headers and compresses
responses; no proxy change was necessary.

Old tabs are supported for seven days after their assets retire; this is a bounded
storage policy, not indefinite compatibility. Expired retained files are pruned
by subsequent deployments. Hashed assets already cached by a browser can live
longer. A real blocked/failed stylesheet can still prevent correct presentation;
removing the false warning does not promise operation without required assets.
On a slow first load, optional text fonts intentionally keep the system fallback
for that page. Large board textures remain a real cold-load cost on pages that
actually display a board. Public-route and isolated-fixture checks do not prove
every authenticated flow, live game, third-party service or browser extension
configuration. No performance claim here substitutes for post-deployment field
measurements or Google's next crawl.
