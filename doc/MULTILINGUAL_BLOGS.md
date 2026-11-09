# Multilingual blog editions

A blog post is one article with one ID, author, original publication date, visibility,
moderation assessment, comments, likes and view count. Its existing content fields are
the source edition. `translations` contains language editions, each with an optional
draft and an optional published revision. Saving a draft keeps the published revision
available. Publishing replaces that edition, not the article. Unpublishing removes it
from public alternatives and discovery.

The source language can be any existing blog language. Initial translation targets are
`en`, `zh-Hans` and `vi`. The original URL remains `/@/author/blog/source-slug/id`;
translations append `/zh-Hans`, `/vi`, or another supported target. The source-language
suffix redirects to the original URL. Existing slug correction still applies. Explicit
URLs always select content independently of interface language, account preferences,
cookies and request headers. Missing editions return a 404 page with links to available
editions, never mislabeled source content.

## Editing and review

The existing article editor links to its language editors. Editors translate title,
introduction, Markdown, cover alternative text and credit. Captions and inline image
descriptions live in Markdown. The shared cover image remains article-owned.

Every revision records its translator, update time, reviewed source revision, and
reviewer/publication information. The first translation publication date survives later
edits. It is distinct from the original article's publication date. The source revision
is SHA-256 of the normalized language, title, introduction, exact Markdown and cover
identity/descriptions. Source edits therefore mark affected editions as needing review
without duplicating state flags. Metadata-only edits do not invalidate translations.
Published stale editions remain readable; the translation editor carries the review
notice. Translation attribution, review details and translation publication/revision
dates are editorial records only and are not displayed in public articles or mobile views.

Publication requires explicit review confirmation and the existing official-publication
permission. Draft preview requires the existing draft permission. Source saves preserve
concurrent translation changes; translation saves compare source and edition snapshots
and reject conflicts. Automated moderation includes all published editions within the
existing bounded text budget. Comments and like actions continue using the article ID.

## Reading and discovery

The initial HTML, Markdown response, title, description, social metadata, cover text and
document language describe the requested edition. The interface retains its own language.
Every published edition has a self-canonical and reciprocal published-language alternates.
Real edition links work without JavaScript; progressive enhancement carries approximate
reading progress, while browser history retains its normal scroll restoration.

Lists, author/profile cards, carousel JSON and Atom feeds select one available edition
per article. `X-Blog-Language`, then the `blogLanguage` cookie, then the interface locale
provide a preference for these surfaces. Unavailable preferences fall back to the source;
the article identifies its actual language and offers its available editions. The JSON
carousel includes `language`, `sourceLanguage`, `editions`, translated title/introduction,
URL and cover alternative text. Atom IDs and original publication dates remain shared.

The site language selector updates both the interface preference and the saved article
preference. On an article, it returns to the equivalent published edition, falling back
to that article's source if unavailable. The article-only selector keeps the interface
unchanged: its `selectLanguage=true` link saves the choice and redirects to the clean
edition URL. Ordinary article requests never rewrite the preference, including visits
to shared links or fallback originals. Existing stale blog-language cookies are replaced
when the reader next uses either selector.

Blog search uses the existing Mongo article collection and a text index over source and
published translations. Drafts are not indexed. Chinese characters and adjacent pairs
are materialized on writes so substring searches use the index rather than collection
scans. Visibility, author status and moderation filters apply to search results.
Private, draft, unlisted and spam indexing restrictions remain in force.

There is currently no website sitemap implementation. Feeds, lists and reciprocal HTML
links provide discovery; sitemap inclusion and Search Console requests must not be
reported as completed without actual infrastructure/access and verification.

## Reviewed official content and deployment

`blog/translations/manifest.json` identifies the seven original articles and source
revisions. Each article's `source.json` preserves its exact editorial source. Translated
Markdown and `editions.json` are durable release content. `reviews.json` records separate
editorial and rendered checks tied to exact content fingerprints. Review attribution
must distinguish AI review from human or native-speaker review.

`node tools/data_migration/package_blog_editions.mjs --validate` rejects missing or stale
reviews, missing/duplicate editions, changed source snapshots and changed links, code or
embedded-board markup. `--output FILE` builds the deterministic migration payload;
`--check FILE` verifies it against reviewed files.

The established `push-local-live` process validates and packages this payload, then runs
`20261108_blog_editions_v1.js` after official-post classification and before application
writers restart. The schema-only script is also part of local preview startup. It
preflights documents and release entries, preserves complete originals in
`__blog_editions_v1_backup`, initializes edition/search fields, creates the search index,
publishes reviewed content and records immutable completion receipts. It can resume an
interruption between post update and receipt creation. Completed releases do not
overwrite later editorial changes.

For recovery, stop application writers and run the packaged restore script with
`globalThis.blogEditionRestoreAcknowledged = true` in mongosh against the intended
database. It first preserves the current documents in
`__blog_editions_v1_restore_backup`, restores and verifies original documents, and removes
only this migration's index and receipts. Keep both backups so post-migration edits can
be recovered and a corrected migration can be rerun. Never drop the backup collections
as part of deployment.

## Mobile consumers

The main Flutter app keeps one logical article ID while retaining each edition URL and
language in the rendered document and navigation history. Its saved article-language
preference is separate from the English interface and applies to blog lists,
notifications and profile previews. Native edition links, sharing, deep links and read
markers use the shared identity. Read-marker migration retains a recoverable original.

Xiangqi Kids has no blog, adult community, blog notification, profile blog preview or
blog deep-link consumer. It needs no feature port. Blog content about deferred variants
does not enable those variants in either app.
