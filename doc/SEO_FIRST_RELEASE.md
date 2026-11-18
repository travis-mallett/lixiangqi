# Discoverability first release — 2026-11-15

Implemented in the website, `../xiangqipedia`, and `../lixiangqi-beta-deployment` working trees.
Nothing was committed, pushed, deployed, or submitted to a search engine. Private Search Console
exports and account details are not included in this repository.

## Corrections

- **Privacy:** give `/privacy` its own static route. The optimized router's `/privacy/traffic`
  bucket prevented the old generic CMS route from matching `/privacy`. The explicit route uses
  the existing CMS policy, including any administrator-authored override. `/page/privacy`
  keeps its existing redirect. Correct the two obsolete `.org` domain references in the
  default legal copy; no policy terms or stored content are changed.
- **Languages:** community-blog alternate URLs start from the unprefixed route and preserve
  filters/pagination. Shared link rendering escapes query separators, and localized canonicals
  retain their query. Navigation uses the actual unprefixed variants route. Historical malformed
  language URLs are not given blanket redirects.
- **Manifest:** identify LiXiangQi and Chinese chess; remove the unrelated Lichess store listings.
  Keep working asset URLs and the existing icons.
- **Tools:** English, Simplified Chinese and Vietnamese metadata and persistent server-rendered
  introductions for analysis, editor, database, notation, puzzles and the theme directory.
  Published puzzle themes have distinct titles/descriptions and landing URLs. The notation
  trainer's interactive sections use second-level headings under the persistent page heading.
- **Discovery:** the main sitemap combines 31 curated static entries, published puzzle themes
  with available puzzles, and existing visible official-blog editions. One XML writer escapes
  all URLs, enforces uniqueness/capacity and retains real article modification dates. Static
  pages do not invent modification timestamps. Locale alternatives are reciprocal. The
  robots/sitemap host guard uses the same authority as the application's canonical-host check.
- **Learning links:** connect the lobby, tools and learning pages to completed content, including
  the encyclopedia, classical manuals and the three published mating-pattern articles.
  The existing wiki sitemap already covers its published articles; its generation and namespace
  exclusions are retained.
- **Duplicates:** `/players?community=1` canonicalizes to `/players`; actual search, pagination
  and ordering remain represented in canonical URLs.
- **Wiki legal links:** the footer points to the website's existing privacy policy and terms.
  Two exact Caddy 301 rules recover the old wiki privacy/disclaimer destinations. Other missing
  wiki pages retain their existing behavior.
- **Deployment:** readiness accepts the expanded same-origin sitemap, requires key landing
  pages, rejects duplicate/foreign URLs, checks privacy and retains authentication/noindex guards.

## Intentional exclusions

No changes to robots restrictions, private/account/API exclusions, unfinished lessons, archived
or retired content, or deferred Arena/Swiss/simul/streak/storm/racer features. No mass redirects,
new thin content, native variants, data migrations, or search-engine account mutations.
The unified `/tournament` surface and unrelated working-tree changes are preserved.

## Verification

Verification used Node 24.15.0, pnpm 11.15.0, bundled Java 21, MongoDB 8.2.11 and Redis 8.2.7.
The production-mode loopback preview used isolated Mongo/Redis ports, two synthetic published
puzzles and a separate empty catalogue SQLite database. It never used production user data.

| Applicable check                      | Command / result                                                                                                                                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend lint/format (`lint.yml`)     | `pnpm format`, `pnpm run lint`, `pnpm run check-format`: passed                                                                                                                                                         |
| Translation keys (`translations.yml`) | `pnpm i18n-file-gen`, `./ui/build --i18n`, `pnpm i18n-file-gen --check`: passed; repeat generation left both tracked key files unchanged                                                                                |
| Translation XML                       | All 6,223 XML files passed the repository DTD using Python lxml; `xmllint` itself is unavailable on this host                                                                                                           |
| Translation lint                      | Repository `bin/trans-lint`: zero errors; 1,390 existing warnings                                                                                                                                                       |
| Assets (`assets.yml`)                 | `./ui/build --no-install -p`: passed                                                                                                                                                                                    |
| UI suite                              | `cd ui && ./test`: 780 passed, zero failed; the script needs its UI working directory on this Windows setup                                                                                                             |
| Engine asset workflow checks          | `node scripts/pikafish-web/smoke.mjs`: passed; Python publication/preparation suites: 2 + 9 passed                                                                                                                      |
| Scala formatting (`server.yml`)       | Bundled Java/SBT `scalafmtAll;scalafmtCheckAll`: passed                                                                                                                                                                 |
| Backend (`server.yml`)                | `-Depoll=true 'test;stage'` with both publication/analysis Mongo environment variables: passed; final source changes passed tests again, then staging succeeded after stopping the preview to release Windows JAR locks |
| Focused Scala regression              | Sitemap XML (2), public sitemap/canonical links (4), blog translation/sitemap (11): passed                                                                                                                              |
| HTTP regression                       | `DISCOVERABILITY_TEST=1 BASE_URL=http://127.0.0.1:9667 pnpm exec playwright test tests/discoverability.spec.ts --project=chromium --workers=1`: 13 passed                                                               |
| Wiki                                  | PHP syntax: passed; `npm test`: 14 passed; rendered footer destinations verified in the in-app browser                                                                                                                  |
| Deployment                            | Wiki deployment suite: 7 passed; readiness suite: 3 passed, including rejection cases                                                                                                                                   |
| Browser rendering                     | In-app browser: policy, tool introductions, heading persistence after JavaScript, completed-content links; desktop, 768px and 390px layout checks                                                                       |
| Mobile reconciliation                 | Scanner before/after; task-specific fingerprints and both app dispositions recorded separately                                                                                                                          |

The HTTP suite checks English/Chinese/Vietnamese metadata with conflicting language preferences,
single-prefix blog alternates, policy and alias responses, manifest plus all seven icons, distinct
puzzle themes, directory canonicals, retained authentication/removal behavior, and every URL in
the fixture sitemap for HTTP 200, exact canonical URL and absence of `noindex`. Article publication
visibility and translation editions are covered by the Scala tests rather than populated preview
blog data.

Windows checks do not establish Linux runtime, Docker, hosted CodeQL, or live Caddy/HTTPS parity.
No Linux/WSL or Caddy runtime is installed. Those checks and production acceptance remain for CI
and deployment. Browser verification covers the changed content/layout, not a complete online-game
session; the isolated preview has no websocket server or production catalogue.

## Delivery and mobile disposition

Deploy the website assets/server, wiki configuration and companion Caddy/readiness changes
together through the existing `push-local-live` process. No migration or native app release is
required. After deployment, rerun the HTTP suite against HTTPS and submit the main and wiki
sitemaps/request validation in the search consoles; this implementation does not claim reindexing
or improved rankings before recrawl.

- **LiXiangQi Mobile — server inherited / no native port:** `lib/features/profile/me_content.dart`
  opens `/privacy` and `/terms-of-service`, so it receives the corrected destination after website
  deployment. Its blog page/repository consumes article canonical URLs and language anchors, which
  remain unchanged. Web metadata, manifests, sitemaps, footer/navigation and heading layout have no
  native counterpart. Gameplay, puzzles, analysis and account APIs are unchanged.
- **Xiangqi Kids — not applicable:** no affected privacy/wiki/blog metadata consumer was found;
  its gameplay, bots, puzzles, account contracts and shared board are unchanged. No native UI or
  feature is added. The deferred variant project remains deferred.

See `SEO_FIRST_RELEASE_REVIEW.json` for exact task source fingerprints and deployment dependencies.
Only these reviewed files are added to the mobile working-tree receipts. Neither commit checkpoint
nor unrelated outstanding review is advanced.
