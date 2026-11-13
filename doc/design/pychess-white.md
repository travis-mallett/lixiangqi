# PyChess White and Light Wood

The shared appearance catalog includes **PyChess White** (Chinese characters),
**PyChess White Symbols**, and **PyChess Light Wood**. Selecting the board with
matching pieces enabled selects the Chinese set. Existing preference, viewer,
thumbnail and image-export consumers use the same catalog.

## Original artwork

Original files are retained under `bin/gen/pychess-white/source/`, downloaded from
[PyChess Variants revision 4e1e3b4](https://github.com/pychess/pychess-variants/tree/4e1e3b4794d7e7da5d276c6325fe1efc4ebbe554/static):

- `images/pieces/xiangqi/hnz`: Chinese faces and covered backs.
- `images/pieces/xiangqi/ct2`: matching pictorial faces and covered backs.
- `images/board/xiangqiLightWood.png`: the selected golden wood board. PyChess
  supplies this board as a PNG, not an SVG.
- `images/board/xiangqiWikimedia.svg`: the matching outlined river lettering.

`source.json` pins the revision and SHA-256 of each original asset. PyChess's
original `COPYING.md` and this repository's attribution table record AGPL-3.0-or-later.
Existing Kai lettering sources supply the additional kingdom and Banner characters;
see [Three Kingdoms pieces](three-kingdoms-pieces.md).

## Geometry and material

The board embeds the original wood image, using its unmarked top margin as a
continuous grain strip. Vector grid lines replace the raster's original grid.
Standard Xiangqi uses a 900×1000 canvas, 98-unit pitch and first intersection
(58,59). Mini Xiangqi uses a 700×700 canvas, 98-unit pitch and margin 56. Three
Kingdoms uses the canonical 135-location graph generator and outlined river labels.

Every original face path is preserved. The source's baked grey extrusion is
removed so the shared motion renderer owns depth and shadows. A neutral white
body with a subtle bevel occupies the canonical 90-unit diameter in a 100-unit
canvas. The shared renderer samples the front circumference into a continuous
sidewall material, preserving the bevel's lighting without mixing in inscription
colors. Both native renderers use the same sampling rule. See
[solid lifted sidewalls](piece-sidewalls.md) for the geometry, wood treatment,
opacity and performance contract.

Both sets support Standard, Jieqi, Mini Xiangqi, Manchu+ and Three Kingdoms.
Generated extensions include red/black concealed backs, green pieces and backs,
Chinese kingdom generals, and Chinese/pictorial Manchu Banner pieces. There are
54 piece SVGs across the two sets and four board SVGs, including the standalone
Banqi board at `public/images/board/svg/xiangqi-light-wood-banqi.svg`.

## Regeneration

Run from the website checkout, with its installed dependencies:

```sh
node bin/gen/pychess-white/generate.mjs
node ../lixiangqi-mobile/scripts/snapshot-board-assets.cjs .
node ../lixiangqi-mobile/scripts/snapshot-board-assets.cjs . --target ../lixiangqi-mobile-kids
```

Generation is offline. The existing three-player and Manchu generators own their
extensions. The mobile snapshot script supports `--check` and writes the same
standard-only catalog, artwork, notices and geometry to either existing app.

## Both mobile products

**LiXiangQi Mobile: ported.** The existing Themes picker consumes the new board and
both sets. Its shared board uses the new neutral material sampling. Standard-only
snapshots include all seven piece roles and side-specific backs.

**Xiangqi Kids: ported.** The shared board now uses the same inset geometry,
90%-diameter material, hit targets, overlay positions and side-specific backs.
The bundled catalog contains the new artwork. Kids does not currently expose a
theme picker; its independent navigation and garden/avatar artwork are preserved.
This resolves the specific `KIDS-BOARD` artwork/geometry review. It does not
establish a comprehensive product baseline or resolve engine/gameplay reviews.

**Variant gameplay/artwork is not applicable to the current native releases:**
both apps remain Standard-only under the previously explicit variant deferral.
No variant feed, engine, board editor or navigation was enabled. Each app's receipt
records the reviewed website bytes without advancing its broader checkpoint.

## Verification and release

- `lint.yml`: `pnpm format`, `pnpm run lint` (type-aware and SCSS lint), and
  `pnpm run check-format` pass using the prepared Node 24 / pnpm 11 installation.
- `assets.yml`: `./ui/build --no-install -p`,
  `node scripts/pikafish-web/smoke.mjs`, and both Python unittest suites under
  `scripts/pikafish-web/tests` and `scripts/pikafish/tests` pass. The local Python
  is 3.13 rather than CI's 3.12; unchanged engine/network assets were already prepared.
- The frontend suite passes 743 tests. `./ui/test` has an existing relative-path
  failure in this checkout; `node ui/.test/runner.mjs` runs the same test runner.
- Source hashes, original paths, lettering bounds and every Standard/Mini grid
  intersection are checked. Offline regeneration is reproducible.
- Chromium and Firefox exercise both sets on all three geometries at 1440, 768
  and 390 px, including actual held and paused carry frames and cleanup after a
  flip. Existing board compositing/layout tests pass (Firefox skips the single
  Chromium-only compositor measurement).
- `pref/Test/scalafmt`, `pref/scalafmtCheckAll` and
  `pref/testOnly lila.pref.PrefTest` pass, including all 12 cases covering
  the catalog's categories and complete piece asset maps.
- Both native snapshot checks verify 130 assets plus catalog/geometry. Both
  pinned Flutter formatting and fatal-info analysis checks pass. Main: 498 tests,
  two existing skips. Kids: 228 tests, one existing skip. Both Android debug APKs
  build successfully. Actual native held-piece renders were visually inspected.

This task does not claim a full Scala `test;stage`, Linux server build, CodeQL,
iOS build, physical-device check or live deployment. Existing unrelated website
and mobile reconciliation work remains outside this review.

Release the rebuilt website assets **and server**: `build.sbt` packages the
catalog as a server resource. The existing full `push-local-live` path already
handles both; no deployment-tool change or data migration is required. Release
the native bundles independently. Nothing was committed, pushed or deployed.
