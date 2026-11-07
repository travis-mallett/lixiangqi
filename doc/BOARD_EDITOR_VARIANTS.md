# Variant board editor

The website board editor at `/editor` supports all five current game variants. Select a variant in the editor, or open the selected position from its analysis board. Variant changes start a fresh position; sharing and reloading retain the selected variant and perspective.

| Variant        | Editing and validation                                                                                                              | Continue from an edited position                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Xiangqi        | 9×10, seven roles per side, standard placement and turn checks                                                                      | Analysis, computer, friend                                     |
| Jieqi          | 9×10, revealed roles and concealed pieces; concealed starting slots, visible inventory and unrestricted revealed advisors/elephants | Analysis; games require a new private deal                     |
| Mini Xiangqi   | 7×7, five roles per side, its palace and soldier constraints                                                                        | Analysis, computer, friend                                     |
| Manchu+        | 9×10, ordinary Red army and Black's Banner army; marker survives capture of the Banner                                              | Analysis, computer, friend                                     |
| Three Kingdoms | Three territories and armies, native TK1 positions, army ownership, fallen generals and active turns                                | Analysis; existing game setup starts from the initial position |

Incomplete diagrams can be edited and shared. Analysis requires a valid position; computer and friend links also require an ongoing position and a supported custom-position setup flow. The editor does not add custom-deal Jieqi games or custom-position Three Kingdoms matchmaking.

## Owning implementations

`ui/editor` uses one controller and view with rectangular and Three Kingdoms position adapters. The shared board owns geometry, piece rendering, movement input and hit testing. The palettes use the existing theme assets, including concealed pieces, the Banner and kingdom generals. There are no new artwork or movement-rule implementations.

`XiangqiRules.validateEditorPosition` validates rectangular setups against the selected variant. The existing Standard strict API remains Standard-only for mobile callers. The website editor uses `POST /editor/validate?variant=…`; ordinary permissive replay/import APIs retain their contracts. Requests remain debounced and abortable, and obsolete results cannot enable actions.

Three Kingdoms drafts use `PositionEditor` and `PositionCodec` in the shared Scala core, compiled for the JVM and browser. The editor loads this existing browser rules bundle and validates locally. A draft may lack generals while being edited, but game parsing remains strict. Drafts still require coherent army ownership and an active side to move. Loading and rotating preserve TK1 metadata. Actual edits clear obsolete adjudication history while retaining army ownership, move number and elimination order. Removed armies lose their pieces; transferred armies retain their original colors and movement constraints.

Palette placement captures pointer events before either board renderer handles movement. This avoids a mouse-event conflict with the graph board while retaining click, drag and touch editing for rectangular boards.

The old Three Kingdoms analysis editor and its separate encoded-piece editing API were removed. Analysis now opens the same standalone editor. The lobby derives the native variant from a custom FEN, so Mini Xiangqi and Manchu+ retain the correct rules and computer difficulty rather than being submitted as Standard Xiangqi.

## Mobile reconciliation

The user explicitly excluded both mobile products from variant implementation. Both checkouts, instructions, feature documentation and existing review queues were inspected, and the reconciliation scanner was run. No mobile runtime, assets, engines or variant interfaces were changed by this expansion.

- **LiXiangQi Mobile — deferred by user.** Its existing Standard analysis editor continues to use `POST /api/analysis/import?strict=true`; that API still rejects non-Standard positions. Variant editors, variant engines and variant game setup remain part of its deferred variant project. Future acceptance must cover all variant position codecs, geometry, concealed information, ownership, native analysis and compatible setup links before enabling them.
- **Xiangqi Kids — deferred by user / editor not applicable.** Kids has no analysis or custom-position editor. Its current gameplay and puzzles remain Standard-only and do not consume the new editor API or Three Kingdoms bundle. Any future variant gameplay needs a separate product implementation; this change does not authorize an analysis editor in Kids.

The existing checkpoint and unrelated pending reviews remain unchanged. Each app's queue records the explicit deferral; queue entries are not implementation or parity claims.

## Deployment

The existing sibling `push-local-live.ps1` already rebuilds the Three Kingdoms Scala.js bundle and normal server/browser assets. Deploy the server, compiled shared rules and web assets together. There is no persistent-data migration or deployment-tool change, and no mobile release dependency for this website-only expansion. No production deployment was performed.

## Verification

Verification uses Node 24.15.0, pnpm 11.15.0 and the bundled Java 21/SBT launcher on Windows. Backend integration tests use an isolated MongoDB 8.2.11 instance with both `LIXIANGQI_PUBLICATION_TEST_URI` and `LIXIANGQI_ANALYSIS_TEST_URI` enabled. Browser tests use a separate local application/database, mocked mail and Chrome.

| Applicable check                | Command / scope                                                                                                         | Result                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Frontend lint and format        | `pnpm format`, `pnpm run lint`, `pnpm run check-format`                                                                 | Passed                                                   |
| Production assets               | `./ui/build --no-install -p` through Git Bash                                                                           | Passed                                                   |
| Frontend tests                  | `node ui/.test/runner.mjs` (the `ui/test` runner)                                                                       | 718 passed, none skipped                                 |
| Shared rules and backend        | `scalafmtAll`, `scalafmtCheckAll`, `threeKingdomsCore/packageBin`, `threeKingdomsJs/threeKingdomsBrowser`, `test;stage` | Passed                                                   |
| Browser regression              | `tests/board-editor.spec.ts`, Chrome, 1440/900/390px and touch input                                                    | 32 passed                                                |
| Translation generation          | `pnpm i18n-file-gen`, `./ui/build --i18n`, `pnpm i18n-file-gen --check`, repeated generation                            | Passed; generated keys/declarations stable               |
| Translation validation          | libxml2/lxml DTD validation of 6,223 XML files; `bin/trans-lint` over destination files                                 | Passed; zero errors, 1,390 existing translation warnings |
| Distributed engine              | `node scripts/pikafish-web/smoke.mjs`                                                                                   | Passed                                                   |
| Asset publication / preparation | Python unittest discovery in `scripts/pikafish-web/tests` and `scripts/pikafish/tests`                                  | 2 + 9 passed                                             |
| Main mobile isolation           | `supported_game_test.dart`, `lobby_repository_test.dart`                                                                | 14 passed                                                |
| Kids isolation                  | `variant_isolation_test.dart`                                                                                           | 2 passed                                                 |
| Reconciliation / patch hygiene  | `node scripts/mobile-reconciliation.mjs`, `git diff --check`                                                            | Passed; existing unrelated reviews remain open           |

The browser suite covers variant palettes and geometry, import/export, counters and perspective, sharing/reload, Standard and graph-board editing, touch input, concealed placement, ownership transfers, analysis handoff, Mini/Manchu setup and isolation of the Standard-only mobile API. Desktop, intermediate and phone screenshots were visually inspected.

Linux CI/dependency branches, Firefox, native Android/iOS builds and physical devices were not run for this expansion. Translation XML validation used the installed libxml2/lxml validator rather than the Linux `xmllint` executable. GitHub packaging/upload/deploy jobs and staged checks were not run: no commit, push or deployment was requested. Mobile verification is limited to existing unsupported-variant isolation tests because no mobile implementation changed.

Task-owned application, MongoDB and Redis processes were stopped after verification.

## Source review

This report covers only the editor expansion and its consumers. Concurrent email, tournament, profile, TV, blog and other working-tree changes are outside this review. The source fingerprints below identify the inspected bytes without advancing either app's checkpoint.

<!-- Final source fingerprints -->

Website HEAD: `f3d8e9cca137c47844b3bc16cb1f329a2ea557bd`. These SHA-256 values record the final uncommitted source bytes. Shared files may also contain pre-existing changes; this is a narrow editor review, not approval of unrelated work.

| File                                                        | SHA-256                                                          |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| app/controllers/Editor.scala                                | 37fba19d9dcd51fed89b59b2e726f3b282a18eb514f8e1fd9bc61217cc71a44b |
| conf/routes                                                 | 2b84c021a87baafd32fa4611280cca8c5e7cc6d92fac655d9e61adc01b0ea556 |
| modules/coreI18n/src/main/key.scala                         | e50bc6ce62aad212e6b7f198acff437aeae5f72fe72dd2ba92e57e28ef81a6ca |
| modules/web/src/main/ui/BoardEditorUi.scala                 | 0691bb67524076cfea907c26ad6fa1b25d2c545ba9fc012494d5270624adb32a |
| modules/xiangqi/src/main/XiangqiRules.scala                 | 2514501ca96952e020879d951f8f2ed4f36fba8820f16a93d8bbe2c02f845bfc |
| modules/xiangqi/src/test/EditorPositionTest.scala           | a56f93e1867714b612b622008cfc70ccb0c89231b0a827c4bbb09efd8ba5ded0 |
| modules/threeKingdomsCore/src/main/PositionCodec.scala      | 5c7243bb740a174915e8955ab9028b0b4c187f1cc1f078d3e1767d3a5308acbe |
| modules/threeKingdomsCore/src/main/PositionEditor.scala     | c8b4150ca0ab2a8aa9b5cd1d0121238ee79e6c0170aa0d93a84b0b321fa0018c |
| modules/threeKingdomsCore/src/test/PositionEditorTest.scala | a2f7026cea7223fdc87e84be3ab5cf2badea5f062c3e5946dc6ae91759516f52 |
| modules/threeKingdomsJs/src/main/Bridge.scala               | e907f3ba3aa461c86deff5d9fcedeaa958777b9da7808b68a999b34e530eecac |
| public/three-kingdoms-engine/main.js                        | 4bef59d151667b3c31b1101c3eafe2894181c71c06a47572dbcb9b0196551121 |
| public/three-kingdoms-engine/manifest.json                  | d1593d336a7a733ca9218eb8e5d03b7d30f3357f41c0d9303f89e421a09c8531 |
| translation/source/site.xml                                 | e7f32a64b0b1e2d7c5f8fc2c7b1d4d40d6776ec4b7e97eebdcf900447763e4a8 |
| ui/@types/lichess/i18n.d.ts                                 | ad012483ec53a9d603ab992565fff191f38ec59d06e3b8b17c8cf212a5f87ff5 |
| pnpm-lock.yaml                                              | 64cd84b82c4755eb3e8f7fec00eb5da0892ed16519143b02cf9a355e648768bf |
| ui/analyse/src/view/actionMenu.ts                           | 8439db64aab85d0f5c3de020fe270721db40bce454cc57c1c6502761a998d471 |
| ui/lib/src/board.ts                                         | 0e1ceafe40410058d118a63be774688c5d899009c6877fca95789a575f7e1798 |
| ui/editor/css/_editor.scss                                  | 43ca2afbdbdb7eb7a098c808436508293717ada6067cc952f18b67f19bb5d239 |
| ui/editor/css/_layout.scss                                  | b7503704bab483485caadd3cc96c59742be2eadd1da47c4d42e0730a3b0864bf |
| ui/editor/css/_spare.scss                                   | ec8e2d419e5582b9d377250f5761e05ab95be6580fcba3e766f0f0d69f1d6b10 |
| ui/editor/css/_tools.scss                                   | 534e58f7c4f98cd534a2e4aeea30e25578ed2d8b5a2b8ae5211e7d93496b39a6 |
| ui/editor/package.json                                      | 3b7c8655474d54230f605dd51b38ff4e4a3dcfed1b986fc1e1787a341de66f8b |
| ui/editor/tsconfig.json                                     | fa80f56c2bae3b3a198e01b617f0e1d020af5ed272cafc230a700f3e0f07f819 |
| ui/editor/src/board.ts                                      | 5cb10f836514b8b9b091c1e1943f464d5bb989813a2212513d6627987a9c6d55 |
| ui/editor/src/ctrl.ts                                       | be68c68f7cf463e206ab719bd872160b3f87f50a6c384d48c06503a0a59c57fa |
| ui/editor/src/editor.ts                                     | ad019b7064979cf66fad4c196feb2349174f6ef6555391099afbe43c718be679 |
| ui/editor/src/fen.ts                                        | f767e6c25c6277445e3579f763eedd35ee612a0926f200ddebc1217c0dc80335 |
| ui/editor/src/interfaces.ts                                 | c0f5fc28dae9e1657ff0e93a40fe2fd7a517aa3add288f5d1cda644b616e915b |
| ui/editor/src/position.ts                                   | abda24ffff2c3fad9d65ba05e085a637ec26b6fb886a0d96c6af95041c1ca0f3 |
| ui/editor/src/view.ts                                       | 1d3780b736190e9a2a94e0410a77aac6a9ded937eb18b87c821fc16a7a6b6efa |
| ui/editor/tests/editor.test.ts                              | f5973e28b7d572dfcec7aa140c6fa604f8b8f1ae39fd2a877c12a008c140087a |
| ui/editor/tests/variants.test.ts                            | 1d809a4fb28c9dca5c832c52bf558c81ea9363db532e1eb13b6126997cfbd2a9 |
| ui/lobby/src/setupCtrl.ts                                   | 4474b53527e9229618b839ff340fbb20957666de6544b0dcdeec672b57facd2d |
| ui/lobby/tests/setupDefaults.test.ts                        | 8b8d2e7813d751f6fcf02de7a4d6a4b9facb73dbb3f6013e5974bc931779cb4f |
| ui/threeKingdoms/src/types.ts                               | 5f0264a9357c17344c06f1ca9d146acd34907a3d425455374d74aa9783b98908 |
| ui/threeKingdoms/tests/positionFixture.ts                   | a88ccd4ed46a2ec43b8f69421d8b741f2c75c09b749492d1171f5253a80869ef |
| ui/threeKingdoms/tests/tree.test.ts                         | f100cfd26e41a2d511272bc73edb70b007bf08cd87873fdab3a7566a5c68d518 |
| ui/threeKingdoms/tests/playback.test.ts                     | 739853c7f48812934c53415263fb8418db94c20acd74cd826a4bf3fe2d97cb68 |
| ui/xiangqi/src/analysisThreeKingdoms.ts                     | 345208fef21acb1e6a8206769e6b50c89ff1c298031c699397ce09ad2f3f96d2 |
| ui/xiangqi/src/analysisXiangqi.ts                           | 62e55b8afce2a103c3c60438ba356f76056fba8b58ced063e018055d5ce2dca3 |
| ui/xiangqi/tests/threeKingdomsEngine.test.ts                | f21a3cb88bdeb6d7fca3e412391a1ea842ba685bc9d45f4c0f976e2a363571da |
| tests/board-editor.spec.ts                                  | 1a1cf4b0e13e1f794240820dc7ca6ac8846f8ce9342fe0d5848d69c999e592cc |
