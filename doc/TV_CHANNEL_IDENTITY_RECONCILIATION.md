# Homepage TV channel identity — November 7, 2026

The homepage selects a random variant on each request. Its variant iframe now has
a channel-specific browsing-context name, tying browser frame-history identity to
the same variant used for the heading, link and source URL. Previously every
variant occupied the same unnamed frame slot. No selection, game-feed, rules or
layout behavior changes.

Browser history restoration is the suspected cause of the reported mismatched
heading and board, not a locally confirmed reproduction. Local HTTP fixtures in
Chromium and Firefox exercised reload and back navigation with alternating Manchu+
and Three Kingdoms content. Those checks matched both before and after assigning
channel names; they do not establish reproduction of the intermittent report.
Related browser history behavior is documented in
[Mozilla bug 354176](https://bugzilla.mozilla.org/show_bug.cgi?id=354176).
The user also observed the problem in DuckDuckGo on mobile; that browser has not
been tested here.

Both mobile AGENTS.md files and reconciliation queues were read, and the scanner
was run. LiXiangQi Mobile: **not applicable**; its native WatchRepository consumes
`/api/stream/game/$id`, not the homepage iframe. Xiangqi Kids: **not applicable**;
its native gameplay repository and standard board do not render homepage TV
iframes. No app changes, variant enablement or checkpoint advancement is needed.
Existing unrelated pending reviews remain open.

Deployment: normal website template deployment; no migration, mobile release,
asset rebuild or deployment-tool change is required.

Validation: `scalafmtCheckAll` and `compile` passed with the bundled Java 21/SBT
launcher. Repository Oxfmt check, type-aware Oxlint, Stylelint and `git diff --check`
passed using installed tools. No full backend test/stage, Linux CI, live-site or
physical-device verification was performed for this template-attribute change.

Source: `5a86e3e0229aae853864afad4a2efd6c8318af9e` plus
`app/views/lobby/home.scala`, SHA-256
`181ca5f2ca8292e83db7a99eb0a899df9b3d4cc89d0843faa3f24f94029c62ea`.
