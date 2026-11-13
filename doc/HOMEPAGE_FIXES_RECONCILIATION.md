# Homepage usability fixes — November 12, 2026

Source anchor: `78ea77b4e186c966533dd3d306dcbd3574889125` plus the exact working-tree
fingerprints in `HOMEPAGE_FIXES_RECONCILIATION.json`. This review covers only these
fixes, not concurrent artwork, TV-link, or other outstanding changes. Neither app's
baseline checkpoint advances.

## Changes

- Three Kingdoms TV uses the shared website board initializer, including piece-image
  readiness. Its previous direct renderer call left pieces hidden in minimal embeds.
- The computer button uses update-aware event binding: server-rendered DOM is reused
  during hydration, so insert-only hooks cannot attach its click listener. The handler
  also survives an ongoing game ending and the button becoming enabled.
- Custom opens the existing lobby overlay with pools, lobby and correspondence tabs.
- The homepage no longer forces the full wordmark into the narrow shared header.
  Shared dropdowns stay within the viewport and scroll vertically on smaller screens.
- Carousel swipes and arrows restart autoplay; vertical touch scrolling remains native.
- Updates links to the full feed using the existing translated More label.
- Rectangular homepage puzzle and TV boards use the shared corner radius; graph boards
  retain their polygonal shape. No board asset, geometry or rules change is involved.

## Native applications

**LiXiangQi Mobile: not applicable.** Reviewed its AGENTS.md, README, reconciliation
queue and native `lib/features/home/home_page.dart`. Home navigation and settings
are Flutter widgets, not the website header/lobby DOM. The browser carousel, Updates
feed and CSS presentation have no port. The TV change initializes browser images,
not API positions or rules. Native variants remain explicitly deferred.

**Xiangqi Kids: not applicable.** Reviewed its AGENTS.md, README, reconciliation
queue and `lib/features/play/game_page.dart`. Its garden, bot map, settings and
`XiangqiBoard` are independent Flutter UI. No affected browser embed, DOM hydration,
carousel or rectangular web thumbnail styling is consumed. Variants remain deferred.

No native source or asset updates are required. Existing queues and checkpoints are
unchanged. Deploy the website assets and server-rendered homepage together through
the existing deployment process; no migration or deployment-tool change is needed.

## Verification

- Frontend production asset build and TypeScript checks.
- Full frontend test suite, including hydrated computer-button and Custom-route
  regression coverage, swipe direction, vertical gestures, click suppression and timer.
- Browser fixtures using production CSS at 320, 390, 430, 540, 768, 1024 and 1440px:
  long username, viewport containment and reachable final settings option.
- Browser regression executes the real Three Kingdoms embed against a controlled feed
  and verifies that image readiness reveals populated pieces and the game link.
- Oxfmt check, type-aware Oxlint, Stylelint, Scalafmt check and Scala compilation.

Checks use existing installed dependencies; pnpm's automatic dependency installation
could not create its sandbox store symlink, so equivalent local binaries and the asset
builder entry point were used. Browser tests use fixtures rather than a live account.
No physical mobile-device, native Android/iOS, Linux backend or full backend integration
test claim is made. No commit or push was requested.
