# Community article promotion — November 13, 2026

Blog moderators (`ModerateBlog`, including roles that inherit it) may promote a
community article through the existing editor. The shared `canSetOfficial` rule
controls the checkbox, form validation and API authorization. Authors with
`PublishOfficialBlog` retain their existing ability to publish their own official
articles. Disabled accounts and unrelated moderation roles gain no permission.

Promotion preserves the author, original publication date, article ID, URL, likes,
comments and translations. Official articles retain the existing author-only edit
policy: promotion does not give the moderator continuing editorial access to
another author's official content. The existing controller logs the moderator's
edit. No new role, route, data migration, or deployment procedure is required.

The author-only policy was verified in `UblogBlog.Allows`, `OfficialBlogTest`, the
source and translation forms, and the controller/API guards before changing the
promotion rule. Sitemap visibility remains owned by the existing official-post
query; hidden, unlisted, draft and disabled-author protections are unchanged.

## Live article and deployment hold

Article: [Designing Internationalized Pieces for Eastern Forms of Chess](https://lixiangqi.com/@/couchtomato/blog/designing-internationalized-pieces-for-eastern-forms-of-chess/SJBuYeuR), by CouchTomato.

- [Simplified Chinese](https://lixiangqi.com/@/couchtomato/blog/designing-internationalized-pieces-for-eastern-forms-of-chess/SJBuYeuR/zh-Hans) and [Vietnamese](https://lixiangqi.com/@/couchtomato/blog/designing-internationalized-pieces-for-eastern-forms-of-chess/SJBuYeuR/vi) editions were published through the in-app browser.
- The original article and its author credit were preserved. Both translations
  retain all 18 body images, with localized descriptions and explanations of the
  English diagram labels. Saved paragraph boundaries were verified after correcting
  the editor's initial paragraph merging. All images loaded in the published pages.
- The existing homepage carousel entry was already live; no duplicate was added.
- The live article remains a community post. It has `noindex,nofollow` and is absent
  from the official-post sitemap. Published language alternates and translated
  descriptions are present. Indexing eligibility has not yet passed.
- The user explicitly retained manual deployment. After deployment, promote the
  article using the official-post checkbox, verify all three public edition URLs,
  canonical metadata and sitemap entries, then request indexing once per edition.
  No deployment or indexing submission was performed in this task.

Editorial and operational notes are private under the ignored
`blog/private-operations/` directory, not in tracked content.

## Mobile reconciliation

Source: website HEAD `78ea77b4e186c966533dd3d306dcbd3574889125` plus the exact
working-tree hashes in `BLOG_OFFICIAL_PROMOTION_RECONCILIATION.json`. This is a
narrow review, not approval of the checkout's unrelated concurrent changes. No
app checkpoint was advanced.

**LiXiangQi Mobile: server inherited / already covered.** Inspected its instructions,
existing multilingual-blog review, `BlogRepository` and `BlogPage`. The repository
reads the same post identity, HTML body, language links and canonical URL; the page
switches editions and shares the selected URL. Published translations use that
existing contract. Promotion later makes the same article eligible for the official
list and its existing notifications. There is no native promotion editor to port.
The browser preference instruction and website editor help have no native counterpart.
No app code change or release is needed. No native device or iOS rendering was tested
in this task.

**Xiangqi Kids: not applicable.** Its instructions and reconciliation documentation
confirm no native blog list, article renderer, blog notifications or edition-link
consumer. This change affects none of its gameplay, bots, puzzles, accounts or board
assets. No Kids feature, code change or release is needed.

## Verification

| Workflow / check                 | Command and result                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server: focused regression suite | Bundled Java 21/SBT: `ublog/test`, 23 passed, none skipped. Final repeat reused SBT's successful test cache.                                                              |
| Server: formatting               | `ublog/scalafmt`, `ublog/Test/scalafmt`, `scalafmtCheckAll` passed.                                                                                                       |
| Frontend lint                    | `pnpm run lint` (type-aware Oxlint and Stylelint) passed.                                                                                                                 |
| Frontend formatting              | `pnpm format` scoped to this task's Markdown and generated declarations; `pnpm run check-format` passed repository-wide.                                                  |
| Translation generation           | `pnpm i18n-file-gen`, `./ui/build --i18n`, and `pnpm i18n-file-gen --check` passed. Existing Scala keys did not change; TypeScript declaration comments were regenerated. |
| Translation XML                  | All 6,223 XML files passed `translation/resources.dtd` validation using the installed lxml/libxml2 parser; no `xmllint` executable was available.                         |
| Translation lint                 | Repository `bin/trans-lint` over `translation/dest/*/*.xml`: zero errors, 1,390 existing warnings. Python UTF-8 output was required on Windows.                           |
| Assets                           | `./ui/build --no-install -p` passed.                                                                                                                                      |
| UI tests                         | All 752 tests passed, none skipped. Windows materialized `ui/test` as a symlink-text file; executed its actual target with `node ui/.test/runner.mjs`.                    |

No commit or push is part of this task. Full backend `test;stage`, MongoDB integration
jobs, Linux runtime verification, CodeQL, engine distribution suites, native builds,
and a local-server browser test of the changed permission control were not run.
The blog domain suite covers the shared authorization rule used by the control,
forms and API; live browser verification covers the published content only.
The entire unrelated working tree is not certified for release.
