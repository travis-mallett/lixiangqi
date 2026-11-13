# Cracked Stone

The approved plain cracked-stone design is registered as **Cracked Stone**
(`xiangqi-cracked-stone`), with **Celestial Lacquer** as its matching piece set.
Selecting this board uses the existing website matching-pieces preference;
turning that option off preserves the user's chosen pieces. The global board
and piece defaults remain unchanged.

[Standard preview](preview.png) · [Standard SVG](../../../public/images/board/svg/xiangqi-cracked-stone.svg) · [Mini SVG](../../../public/images/board/svg/xiangqi-cracked-stone-minixiangqi.svg) · [Three Kingdoms SVG](../../../public/images/board/svg/xiangqi-cracked-stone-three-player.svg) · [Banqi SVG](../../../public/images/board/svg/xiangqi-cracked-stone-banqi.svg)

## Artwork and geometry

All boards share the approved weathered grey-green stone, natural irregular
fissures, neutral engraved frame and dark grid. Each SVG embeds its stone image;
the grid, frame and inscriptions are vector paths. There are no animated layers,
gold crack fills, external images, scripts or runtime fonts. The standard board's
rendered pixels are identical to the approved preview.

| Board | Canvas | Geometry and use |
| --- | --- | --- |
| Xiangqi, Jieqi, Manchu+ | 900 × 1000 | Shared standard definition: 98-unit pitch, intersections (58,59)–(842,941), river y=451–549 |
| Mini Xiangqi | 700 × 700 | Shared mini definition: 98-unit pitch, 49 intersections (56,56)–(644,644), two palaces and no river |
| Three Kingdoms | 1900.254664 × 1645.668812 | Shared 135-location hexagonal geometry, four corner-to-center advisor edges in each palace |
| Banqi | 496 × 896 | Prepared asset only: 4 × 8 square cells, 100-unit pitch, grid (48,48)–(448,848) |

Jieqi and Manchu+ reuse the standard asset because their grid is identical.
Banqi remains outside the supported runtime catalog, consistent with the other
prepared Banqi themes; this change does not enable a new playable variant.

The standard river lettering 楚河汉界 retains the exact filled contours traced
from the user's clearer reference. Three Kingdoms uses the existing outlined
kingdom and river labels, with their established geometry and provenance.
The approved texture and tracing hashes, imagegen prompt and typography sources
are recorded in [source.json](../../../bin/gen/cracked-stone/source.json).

## Regeneration

Using Node 24 and the installed project dependencies:

```powershell
node bin/gen/cracked-stone/generate.mjs
node bin/gen/cracked-stone/generate.mjs --check
```

This writes the four production SVGs and standard PNG preview. The production
standard SVG is canonical; the earlier design-only duplicate has been removed.
Rectangular layouts, shared material and Three Kingdoms geometry have separate
small generator modules. No existing piece artwork was changed.

## Verification

[review.json](review.json) records the exact source fingerprints and results.
Coverage includes all standard/mini/135-location grid intersections, transparent
hex corners, exact river contours and approved standard pixels, asset completeness,
backend automatic pairing and opt-out, and Chromium/Firefox at 320, 768 and
1440 px in both board orientations. The browser uses the production shared board
renderer and Celestial Lacquer pieces for Xiangqi, Mini, Three Kingdoms, Manchu+
and concealed Jieqi positions.

Website formatting/lint, the production asset build, frontend tests, Scala
formatting/preference tests, distributed-engine smoke and the asset workflow's
Python suites are checked. On this Windows checkout, `ui/test` is a symlink
placeholder; `node ui/.test/runner.mjs` runs its exact target. No full Linux
backend integration suite, Safari, iOS or physical-device checks were run.

The shared image exporter now rasterizes each catalog SVG once at its canonical
resolution and caches that image for frame composition. This preserves embedded
stone textures and lacquer artwork that were lost when SVG images were nested.
The export regression checks cover texture pixels and distinct colored backs.
Native snapshots already render each SVG directly, so this exporter correction
requires no additional native renderer.

## Native apps and release

Both **LiXiangQi Mobile** and **Xiangqi Kids** receive the static standard board
through the canonical snapshot script. Their catalog models consume the matching
piece set, and selecting Cracked Stone selects Celestial Lacquer. A later piece
choice remains independent. Main Mobile uses its existing Themes gallery and
appearance controls. Kids adds a Boards tab to its existing garden appearance
chooser, with English/Chinese labels. Its garden and gameplay interfaces remain
independent of the website.

Both apps run their pinned formatting, fatal-info analysis, Flutter tests,
source-snapshot checks and arm64/x64 Android debug builds. Native variants remain
explicitly deferred: Mini, Three Kingdoms, Manchu+ and Banqi are not added to the
native products. The two reconciliation receipts retain their checkpoints and
unrelated pending reviews; the Cracked Stone design hold is resolved as ported.

The existing `push-local-live.ps1` already builds the server-embedded catalog,
website assets and image export resources together. Release those through the
normal build/restart, and publish updated native bundles separately. There is no
migration or deployment-tool change. No deployment, commit or push was performed.
