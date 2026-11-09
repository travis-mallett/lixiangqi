# Board compositing and check-halo reconciliation

Reviewed November 8, 2026, against website HEAD
`486935b00c38e831232b7c1db91f10eeb968e428` and the exact source SHA-256 values
recorded in both apps' `reviewedWorkingTree` receipts. This is a narrow review;
neither app's commit checkpoint nor unrelated pending reviews advance.

## Website behavior and ownership

The shared board motion layer owns the check halo. It is a child of the visible
piece at rest and of its face stack during lift/carry/landing. Backward slides,
dragging, rapid interruptions and selection therefore cannot leave a full red
disc at a vacated or not-yet-occupied square. Reconciliation clears halos from
captured/reused nodes, absent pieces and positions with highlights disabled.
The rectangular and graph adapters supply checked locations, without duplicating
the effect or adding rules calculations. All rectangular variants use this path.

Resting boards reserve a compositor surface at board level, rather than a layer
for every face and contact shadow. Resting graph pieces and move markers use
2D translation. Active WAAPI animations retain browser acceleration, and companion
effects receive the same document-timeline start time. The intentional separate
contact-shadow plane remains below all faces and clipped at the artwork edge;
moving shadows into individual piece stacking contexts would damage overlap.
No scroll listener, per-frame JavaScript synchronization, server computation,
dependency, artwork or geometry change was added.

The isolated nine-board Chromium fixture (six full 32-piece boards plus three
single-general boards) used **404 content layers with the previous compiled CSS
and 20 with the revised CSS**, a 95% reduction. This compares CSS on the same
current renderer and fixture; it is a layer-overhead measurement, not an FPS,
GPU-memory or physical-device benchmark. The resting screenshot was inspected.
The original user's transient GPU symptom was not independently captured.

## LiXiangQi Mobile and Xiangqi Kids

**Ported in both apps.** Their existing `lib/design/board/board_overlay.dart`
also painted check at fixed squares. That painting was removed. `BoardPieceFace`
now owns `CheckHaloPainter` inside the same perspective transform as the general,
with `xiangqi_board.dart` supplying current checked state and excluding captured
pieces. Their gameplay, puzzles and replay use this shared implementation. The
main app's analysis/replay consumers inherit it without feature-specific patches.
Kids retains its independent product and standard-only scope.

**Browser compositor changes are not applicable to either app.** Both use native
Flutter rendering, one board repaint boundary and the same animation-controller
sample for piece/shadow positions; neither uses CSS `will-change`, browser tiles
or independent WAAPI readiness. Their existing native shadow batching is retained.
No board asset snapshot or variant project is required.

## Verification and deployment

- Website: `pnpm format`, `pnpm run lint`, `pnpm run check-format` and the production
  `./ui/build --no-install -p` passed, using Node 24 and pnpm 11.15.0. Installed
  dependencies were reused with `pnpm_config_verify_deps_before_run=false` because
  automatic pnpm install attempted a forbidden sandbox store symlink.
- `node ui/.test/runner.mjs`: 731 tests passed, including 85 board tests. The
  required root `./ui/test` command was attempted but has an existing relative-path
  failure (`.test/runner.mjs`); the actual runner was executed directly.
- Chromium and Firefox: 13 browser tests passed at 1440, 900 and 390 pixels,
  including repeated forward/backward interruptions during actual carry, scrolling,
  halo/face alignment, shadow travel, check removal and graph layout. One Chromium
  CDP-only layer-count test is intentionally skipped in Firefox.
- Main mobile: pinned SDK formatting and fatal-info analysis passed; 493 tests
  passed with two existing skips. Android debug APK build passed.
- Kids: required `scripts/check.ps1` passed formatting, fatal-info analysis and
  223 tests with one existing skip. Android debug APK build passed.
- Each native app has a new deterministic asset-preload regression that verifies
  the halo and face share their screen center during interrupted forward/backward
  travel, and that clearing check, disabling highlights or removing the piece
  removes the halo.
- iOS, Safari, physical devices and production deployment were not tested.
  Backend/engine workflow jobs were not run: no backend or engine code changed.

Deploy ordinary rebuilt website assets and release each native app independently.
There is no server contract, data migration or deployment-script dependency.
No commit, push or deployment was requested or performed.
