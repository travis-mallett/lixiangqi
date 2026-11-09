# Official blog publishing workflow

These instructions apply to official LiXiangQi blog posts and their revisions.
Follow the repository instructions, [writing guide](WRITING_GUIDE.md), and
[translation glossary](translations/GLOSSARY.md). Apply the writing guide's full
editing checklist to every edition, adapting its English-specific conventions to
natural Chinese and Vietnamese. Use its author-voice reference before drafting.

## Required editions and review

Unless the user explicitly requests otherwise, prepare English (`en`), Simplified
Chinese (`zh-Hans`), and Vietnamese (`vi`) editions of each official post. Treat
them as editions of one logical article, not unrelated posts. Use the existing
translation editor, storage, and publication mechanisms; preserve article identity,
authorship, comments, likes, and existing URLs.

1. Write and review the original against the writing guide. Verify implementation
   claims and sources, and preserve meaningful qualifications and uncertainty.
2. Translate the complete editorial content: title, introduction, body, captions,
   and meaningful image descriptions. Review text embedded in images and provide
   a suitable localized treatment where needed.
3. Write idiomatic native-language prose, not word-for-word English. Adapt sentence
   boundaries, idioms, and rhythm while preserving meaning and the author's voice.
   Use natural xiangqi terminology: 象棋 / 中国象棋 and cờ tướng. Follow the glossary;
   resolve unfamiliar terms rather than mechanically substituting chess vocabulary.
4. Preserve names, numbers, citations, URLs, code, move notation, position data,
   and embedded-board behavior. Do not invent anecdotes, quotations, factual
   claims, or stronger conclusions while translating.
5. Perform a separate editorial review of each translation for naturalness,
   completeness, terminology, and factual accuracy. Compare it with the source,
   then read it independently for fluency. Do not claim human or native-speaker
   review unless it actually occurred. Keep review notes out of published prose.
   Translation credits, translator/reviewer names (including AI attribution),
   review status, and translation publication/revision dates belong in private
   editorial records and editing tools. Do not display them in public articles,
   their Markdown representations, or mobile article views. Preserve the original
   author and article publication date; readers should see a simple language selector.
6. Inspect saved/rendered editions on desktop and narrow screens. Check paragraphs,
   Vietnamese diacritics, Chinese text, long titles, captions, links, and boards.
   Verify article rendering, edition links, and sharing in existing mobile blog
   consumers as required by the repository's mobile reconciliation workflow.
   Repeat the saved-content check after the final publish action: an editor's
   appearance before submission is not proof that paragraph boundaries, emphasis,
   captions, and links survived serialization.

## Publication and discovery checklist

Writing an official blog post includes completing publication and discovery for all
three editions by default. Proceed through review, solving the site's publishing
CAPTCHA, publishing, adding one homepage carousel card, verifying sitemap inclusion,
and requesting Google indexing without asking for renewed permission at each step.
An explicit request for a draft, preview, review-only work, or a publication hold
overrides this default. Report any incomplete edition or external blocker accurately.

Keep Google Search Console account information and operational records out of Git.
Do not commit account identities, property/account identifiers, credentials, tokens,
verification secrets, authenticated screenshots, browser/session data, quota details,
or submission receipts. Store necessary private records under the ignored
`blog/private-operations/` directory and verify they are ignored before saving.
Tracked documentation may describe the generic workflow and public sitemap/URLs.

1. **Publish stable edition URLs.** Each published URL must directly return the
   correct language anonymously, without a language cookie or selector interaction.
   Confirm substantive article text is present in the initial HTML. An explicit
   edition URL must not be overridden by account or browser language preferences.
2. **Preserve a simple reading experience.** Verify the language selector connects
   equivalent editions and sharing preserves the chosen edition. Lists should
   contain one entry for the logical article, not one duplicate per language.
3. **Check metadata.** Verify each edition's translated title and description,
   actual content language, self-referencing canonical URL, and reciprocal
   alternate-language annotations. Do not canonicalize translated editions to
   English. Advertise only published, accessible equivalents.
4. **Check indexing eligibility.** Confirm successful public responses, no
   unintended robots exclusion, and no `noindex` in HTML or response headers.
   Preserve the protections for drafts, private content, and unlisted content.
5. **Verify sitemap inclusion.** Confirm every published edition's canonical URL
   appears in the appropriate live sitemap. This should follow publication
   automatically; use or fix the owning sitemap mechanism rather than maintaining
   a parallel handwritten list. The current sitemap is
   `https://lixiangqi.com/sitemap.xml`; allow up to 30 seconds for its metadata cache
   to expire after publication. See [sitemap operations](../doc/BLOG_SITEMAP.md).
   Exclude drafts, unavailable editions, redirects,
   and noncanonical URLs. Do not add individual article URLs to `robots.txt`;
   that file should reference the sitemap itself. If sitemap infrastructure is
   missing, report the concrete discovery blocker rather than claiming completion
   or expanding a content-only task into an unrequested system redesign.
6. **Verify public links.** Check the appropriate blog list and feed. Follow the
   writing guide's homepage-carousel requirement: use Edit Carousel → Add for the
   logical official post and verify its card; use Pin only when requested. Do not
   create separate carousel cards solely for translations.
7. **Request Google indexing.** Once each published edition passes the checks,
   use Google Search Console's URL Inspection tool to request indexing for its
   canonical URL. Submit each new edition once. Privately record the URL, date, and whether
   the request was accepted. If access is unavailable or quota is exhausted,
   report the outstanding URLs without delaying otherwise authorized publication.
   Never bypass access restrictions or repeatedly resubmit unchanged pages. An
   accepted request is not proof that a page is indexed.
8. **Report completion.** Provide the edition URLs, editorial and rendered-review
   results, sitemap and carousel verification, mobile verification where applicable,
   and Google submission outcomes. Clearly distinguish published, submitted, and
   confirmed indexed states. Name incomplete work and blockers explicitly.

Search Console sitemap submission is site setup, not a per-post operation. Use the
existing verified property and submitted sitemap; do not resubmit the entire
sitemap for every article. Individual indexing requests supplement automatic
discovery and do not guarantee indexing or ranking. See Google's
[recrawl guidance](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl).

## Revisions and unpublication

- Before revising published content, preserve a recoverable copy using the existing
  editorial/versioning process. Keep stable URLs and original publication history.
- Review all editions affected by a source change. Track the source revision and
  translation review status using the existing system; do not present stale or
  materially inaccurate translations as newly reviewed.
- Update each edition's sitemap modification date for meaningful changes to that
  edition, not every visit, deployment, or incidental global UI change.
- For substantive published revisions, repeat the relevant rendering, metadata,
  discovery, and indexing-request checks. Do not repeatedly request indexing for
  unchanged editions.
- When an edition is unpublished, remove it from the sitemap and advertised
  language alternatives and verify the actual access/indexing response. Removing
  a sitemap entry alone does not remove a page from search engines.
