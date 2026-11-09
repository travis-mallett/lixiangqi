# Discoverability foundations — 2026-11-08

Implemented locally; production deployment is outstanding. Broader content, search-account
submissions, and main-site sitemap expansion were not part of this change.

## Website

- Corrected Simplified Chinese homepage description and Vietnamese homepage title and
  description to refer to xiangqi rather than Western chess.
- Added Chinese to the inherited search-language list. Simplified Chinese advertises
  `zh-Hans` at `/zh`; English points to explicit `/en`; the negotiating root remains
  `x-default`. Vietnamese remains `/vi`.
- Explicit anonymous language URLs no longer redirect according to Accept-Language.
  Existing signed-in navigation remains unchanged.
- The shared Page renderer owns canonical tags. Explicit language URLs self-canonicalize;
  other pages use an explicit canonical override, their Open Graph URL, or their current
  URL on the configured origin. Query strings are retained in that final fallback because
  they can select meaningful content. Pages flagged noRobots retain that protection.
- Blog editions use the shared canonical override without changing article URLs or
  alternate-language anchors consumed by the mobile app.
- Removed the standalone wiki controller, route, view, article resources, dedicated
  stylesheets, and obsolete article fixture test. The retired URL returns 404. The
  canonical encyclopedia article and the wiki's preserved migration source remain intact.

## Wiki and deployment

The sibling wiki owns `scripts/generate-sitemap.sh`. It uses the installed MediaWiki
maintenance generator for namespace 0, skipping redirects and noindex articles. It
publishes complete immutable generations and atomically replaces the sitemap index,
retaining older chunks for seven days. Failed generation preserves the published index.

The sibling deployment project explicitly packages the script, installs it in the wiki
image, mounts persistent generated output, serves XML through Apache, and advertises
`https://wiki.lixiangqi.com/sitemap.xml` through Caddy robots.txt. Both changed and unchanged
deployments generate it, and the existing cron schedule refreshes it hourly. HTTPS release
verification checks all aliases, robots.txt, index/chunk XML, and canonical article URLs.
No live articles, credentials, uploads, or database schema were changed by this task.

## Verification

- Frontend format, type-aware lint/style lint, and format check.
- Production asset build; 722 UI tests passed. The test launcher requires `cd ui && ./test`
  on this checkout; invoking it from the repository root fails before running tests.
- Translation generators and generated-key check; DTD validation of all 6,223 XML files
  using the existing lxml validator; translation lint of 6,177 destination files.
- Scalafmt and Scalafmt check; three focused Scala language/canonical tests; compile and stage.
- Six read-only HTTP regression tests against a production-mode loopback preview with an
  isolated MongoDB and Redis. They cover conflicting language headers, metadata, canonical
  and alternate links, nested language URLs, removal, and account authentication.
- Wiki PHP syntax; 14 wiki tests, including failed/atomic sitemap publication; seven
  deployment tests, including packaging, unchanged-release refresh, cron invocation,
  backup behavior, and preservation of edited articles.
- Real MediaWiki 1.43.9 sitemap generation against local wiki data with the production
  canonical host, without modifying article content.

Windows verification does not establish Linux/Docker/Caddy runtime parity. The full backend
integration suite, hosted CI/CodeQL, production deployment, and live HTTPS acceptance were
not run. No commit or push was prepared. The normal deployment must activate the website
and wiki image/configuration together; its wiki HTTPS verification then checks the live XML.

Rerun the HTTP checks with `DISCOVERABILITY_TEST=1`, `BASE_URL` set to the desired host,
and `pnpm exec playwright test tests/discoverability.spec.ts --project chromium --workers 1`.

## Both mobile applications

The reconciliation scanner was run before and after this task. Existing unrelated reviews
and deferred variants remain outstanding; neither app's checkpoint was advanced.

- **LiXiangQi Mobile: not applicable to native code.** Its blog repository parses
  `link[rel=canonical]` and article `a[hreflang]`; these existing URLs and anchors are
  preserved. It does not consume homepage search metadata, wiki sitemaps, or the retired
  standalone article. Native navigation, localization, and blog APIs are unchanged.
- **Xiangqi Kids: not applicable.** It has no wiki/blog metadata consumer or retired-article
  link. Gameplay, boards, puzzles, bots, accounts, and its smaller learning scope are unchanged.

Task-specific source fingerprints are recorded in `DISCOVERABILITY_FOUNDATIONS_REVIEW.json`.
They identify this review's working tree, not a comprehensive approval of concurrent edits.
