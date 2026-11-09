# Blog sitemap

Production publishes `https://lixiangqi.com/sitemap.xml`, advertised in
`https://lixiangqi.com/robots.txt`. The sitemap is generated from published official
blog data, including each published language edition. No manually maintained URL
list or per-post deployment is required. Its metadata cache expires after 30 seconds.

`UblogApi` uses the existing visibility query: source posts must be live, their
blogs must be above the unlisted tier, and their authors must be enabled. Translation
drafts and revisions without a publication timestamp are excluded. Ordinary community
posts retain their existing crawler policy; this change does not make them indexable.
The sitemap endpoint returns 404 when production crawling is disabled or the host
is not the configured canonical host. Authentication on private pages is unchanged.

Every URL has a self-canonical location, its actual revision timestamp, and reciprocal
language alternates. The current release contains seven articles in English,
Simplified Chinese and Vietnamese: 21 unique URLs. Capacity is deliberately checked:
before exceeding 10,000 source articles or 50,000 edition URLs, implement sitemap
partitioning rather than silently dropping entries.

## November 8, 2026 verification and deployment

- Both blog test suites passed: 18 tests, including published-versus-draft sitemap
  coverage. Scala formatting and compilation passed. Frontend formatting, lint and
  format verification passed. `git diff --check` passed.
- The deployment readiness check now verifies the robots sitemap declaration, valid
  XML and unique canonical blog URLs. All 84 deployment tests passed.
- All 21 production URLs returned HTTP 200 without redirect, with self-canonical
  tags, no `noindex` header/meta directive, and matching reciprocal language links.
- The live database inventory contained exactly seven live source articles, all
  official, each with Chinese and Vietnamese published editions.
- Deployed only the application, blog and generated-route jars; retained the existing
  Linux runtime dependencies, frontend assets, configuration and persistent data.
  No data migration was needed. Source comparison against the previous release found
  only sitemap changes. A bytecode audit explained other changed classes as compiler
  metadata/order and three unused compiler-generated locals in the unchanged blog UI.
- Deployment held the shared operation lock, checked original and uploaded artifact
  hashes, and retained rollback copies at
  `/opt/lixiangqi-beta-sitemap-20261109T015513Z`. Public homepage, training, video,
  explorer, stylesheet, crawler policy and private-page authentication checks passed.
- Full backend/integration tests and a Linux rebuild were not rerun for this narrow
  sitemap change; the two blog suites, compilation and live checks are the validation
  performed here. No commit or push was made.

## Mobile reconciliation

LiXiangQi Mobile: not applicable. Its existing blog API and edition URLs are unchanged;
it does not consume robots.txt or XML sitemaps. No app release is needed.

Xiangqi Kids: not applicable. It has no blog consumer, and this crawler endpoint changes
none of its gameplay, puzzle, account or board contracts. No app release is needed.

The reconciliation scanner was run for both siblings. This review covers only the
sitemap files below, not other concurrent changes; no broad checkpoint was advanced.
Account-specific Search Console outcomes and submission records are kept privately
under the Git-ignored `blog/private-operations/` directory. They must not be committed.
