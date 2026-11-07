# Standard xiangqi board editor — 2026-11-06

This records the initial Standard restoration. The subsequent [variant expansion](BOARD_EDITOR_VARIANTS.md) supersedes its Standard-only editor scope; the Standard-only mobile API contract remains in place.

The editor is available under **Tools → Board editor** (`/editor`) and from the standard analysis board's settings menu. It supports a 9×10 board and the seven standard roles for each side. Other variants remain outside this editor's scope.

## Ownership and behavior

- `ui/editor` owns editing, FEN fields, perspective, sharing and action availability. The shared board still owns rendering, dragging, placement and hit testing. Both spare armies use the shared piece theme.
- Path and query FENs preserve side to move and counters. Shared URLs preserve perspective. Invalid or variant FENs are rejected visibly. Empty and incomplete diagrams remain editable and shareable.
- Every position change clears the previous validation result immediately. Validation is debounced, obsolete requests are aborted, late responses are ignored, and destruction cancels outstanding work. Flipping only changes perspective.
- `XiangqiRules.validateStandardPosition` owns strict initial-position checks. It reuses the placement and turn checks formerly local to lessons: one general per side, piece limits, palace/advisor/elephant/soldier placement, facing generals, and the side not to move being in check. The permissive diagram/replay parser remains available to its existing consumers.
- `POST /api/analysis/position?strict=true` validates the initial standard position. `POST /api/analysis/import?strict=true` validates the effective imported root, including a FEN supplied in PGN headers. Both APIs retain their existing response format and default behavior when `strict` is omitted.
- Valid positions can open analysis. Only ongoing positions with legal moves can open computer or friend setup. Validation service failures have a retry action and are not labeled invalid positions.
- Embedded study editors retain their local callback contract and do not mount page resize controls or navigation links. Superseded chess-only editor CSS was removed.

## Mobile reconciliation

Both apps' instructions, feature documentation, consumers and existing queues were inspected. The scanner was run before and after this work. Existing checkpoints and unrelated outstanding reviews were not advanced or cleared.

**LiXiangQi Mobile: ported / already covered.** Native analysis, board exploration and computer setup already have editors with placement, erasure, turn selection and localized controls. The analysis editor now requests strict validation through `XiangqiRepository.importNotation(validateInitialPosition: true)` before replacing the workspace. Rejected edits preserve the original board. The native diagram editor remains intentionally permissive; it does not claim a diagram is playable. Website navigation, DOM/CSS, palette rendering, clipboard controls and URL handling have no corresponding native defect to port. No variant UI or rules were added.

**Xiangqi Kids: not applicable.** This smaller product has no analysis or custom-position editor surface. Its gameplay, puzzle/replay imports and bots continue to use the unchanged default API contracts. No shared artwork, board geometry, legal-move generation, engine, account or game-creation contract changed. Its existing baseline and variant queues remain open; this review is not a parity claim.

## Verification and release

- Node 24.15.0 and pinned pnpm 11.15.0: repository formatting, type-aware lint, SCSS lint, format check and production asset build passed. The frontend runner passed 707 tests, including eight editor regressions. On Windows the runner was invoked as `node ui/.test/runner.mjs` because `ui/test` is a text representation of the Unix link.
- Scala: `scalafmtAll`, `scalafmtCheckAll`, and `-Depoll=true 'test;stage'` passed. Mongo integration tests used isolated MongoDB 8.2.11 on port 27291 with `LIXIANGQI_PUBLICATION_TEST_URI` and `LIXIANGQI_ANALYSIS_TEST_URI` enabled. The checkout's existing Windows JDK selector patch was needed for socket access. The new strict-position tests and existing lesson tests passed.
- Translations: Scala and TypeScript generation passed; repeated generation left identical bytes; key freshness passed. All 6,223 XML files passed DTD validation using lxml/libxml2 (the Windows equivalent of the workflow's xmllint check). `bin/trans-lint translation/dest/*/*.xml` passed with zero errors and 1,390 existing warnings.
- Chromium: all 10 live HTTP checks passed, covering desktop 1440px, intermediate 900px and phone 390px layouts, both spare armies, FEN/perspective reload, mouse placement/replacement/erasure/dragging, touch placement/erasure, strict validation and variant rejection, analysis navigation, clipboard copying and computer/friend setup handoff. Screenshots at all three widths were inspected.
- Main mobile: pinned Flutter formatting, `flutter analyze --fatal-infos`, all 477 tests (two existing skips), and `flutter build apk --debug` passed, including strict API request and failed-edit workspace preservation. No Android/iOS platform code changed; physical devices and iOS builds were not tested. No Kids code changed.
- Linux CI, Firefox and production were not exercised. No commit, push or deployment was requested. Unrelated tournament artwork/layout edits already in the working tree are outside this change.
- Verification cleanup: `scripts/windows/Start-Lixiangqi.ps1 -StopOnly` stopped the test application. The isolated MongoDB and Redis processes were stopped separately; no task-owned application/SBT process or listener on ports 9663, 27291 or 6389 remained.

Deployment uses the existing `../lixiangqi-beta-deployment/push-local-live.ps1` server/asset build. Deploy the backend and web assets together, and deploy the backend before releasing the mobile strict-validation consumer. There is no data migration, engine update or deployment-tool change.

## Reviewed source fingerprint

The narrow review is against website HEAD `f3d8e9cca137c47844b3bc16cb1f329a2ea557bd` plus the working-tree files listed below. These fingerprints do not certify unrelated changes since either app's earlier checkpoint.

| File                                              | SHA-256                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| app/controllers/Editor.scala                      | 90263faba2a0d665b3cd903abd22b986f9d97b5fd4c2d2c123c8744d8b6e3fb3 |
| app/controllers/UserAnalysis.scala                | 0fb54d93b82ecb233fe78b2d74112298c34060d37c61acb2d9c6bb4b8d1cbb61 |
| conf/routes                                       | 5a33ebed011324e352dc4d721a180253fcd125dd7d14c55ffccae275d8921304 |
| modules/coreI18n/src/main/key.scala               | 3227e0392c0bcded052e5da90249204ec49c47cff36f5ba07546557d5e4475df |
| modules/web/src/main/ui/BoardEditorUi.scala       | 97d8e013645d385d73c929a7c0f25e9cc81ae578c0789bfc1c23bbd68c30b490 |
| modules/web/src/main/ui/TopNav.scala              | ec5d6cef88d8a70f394a5c832adb7d7635380c5c642c75a6449825f853a2728f |
| modules/xiangqi/src/main/XiangqiRules.scala       | e254a41234b694cd5de413255afac56a8f0bc8def279ea49c3a9c0692acb70d8 |
| modules/xiangqi/src/test/EditorPositionTest.scala | 04bd1bad457f802484bdbee93e369c1eee503ba91a5a5444b30e80e7163da031 |
| translation/source/site.xml                       | 660250dff4d2b314892810963c851df23bac9054172d6f8d5cbc983851fad2e7 |
| ui/@types/lichess/i18n.d.ts                       | e3f34df7e05366c58945ad34e32a9bceee48050c532ec4d7e1ad6d3f627d0b88 |
| ui/analyse/src/view/actionMenu.ts                 | 7815e076249baa113eb64d24572fcb03ec023bd0c23cf702f27f93dc178e9c38 |
| ui/editor/css/_editor.scss                        | 43ca2afbdbdb7eb7a098c808436508293717ada6067cc952f18b67f19bb5d239 |
| ui/editor/css/_layout.scss                        | b7503704bab483485caadd3cc96c59742be2eadd1da47c4d42e0730a3b0864bf |
| ui/editor/css/_spare.scss                         | 69cd8e4e3ded604e938bb159d2a7c06a18173766f95b79b56307c4d380174d39 |
| ui/editor/css/_tools.scss                         | 9fb9bcf8fc9d4d027f30edd43f8dfaf182e9a244941bb410bb74ad8bb1d6be5f |
| ui/editor/src/board.ts                            | c4a9c03405087ed259977e52698944f1c4295dcf903e9112333150ec8b8f6934 |
| ui/editor/src/ctrl.ts                             | db9af60220ec93c5ceadde3e35e0dc636e65ed961798ae5bf5b1c343569cb105 |
| ui/editor/src/fen.ts                              | a416c7ace4328ba9d7463abbfd4a81d8e34ca8e7c1e022f63eb178ae4671749a |
| ui/editor/src/interfaces.ts                       | 03738ae06493ec35c84cf8aac3945431c52222588aef22b94bbd368c8bf79fef |
| ui/editor/src/view.ts                             | f89a56debe11501138b5e40a65e49af0e160931d25b6637a3bb93f4955d2e94e |
| ui/editor/tests/editor.test.ts                    | 2126cf156579d7efa96ca8904eefd230e33e2dd259c33b8f431de8b0adfb17fd |
| ui/xiangqi/src/analysisXiangqi.ts                 | 38713bfb3f425ec36b5d15cfa8a95d72beff5b4732d7ae2f4abb2233bd5e77a8 |
| tests/board-editor.spec.ts                        | 9fa7d969bb2060ff27b49cd28f0afd485e93858f733f4847e1fafc00809d1cf9 |
