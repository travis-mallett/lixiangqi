# Celestial Lacquer

An ImageGen-authored piece collection based on the approved November 12, 2026
lacquer mockup. Vermilion, ink-black and emerald lacquer carry warm gold
calligraphy. The generals feature restrained Vermilion Bird, Black Warrior and
Azure Dragon ornament; ordinary pieces use related peripheral cloud gestures.

[Actual starting-position preview](board-preview.png) · [All assets at 150, 48 and 32 px](contact-sheet.png)

## Complete inventory

| Army | Standard faces | Variant faces | Back |
| --- | --- | --- | --- |
| Red | 帥 仕 相 馬 車 炮 兵 | 旗 (Manchu), 蜀 (Three Kingdoms general) | Red lacquer |
| Black | 將 士 象 馬 車 砲 卒 | 旗 (Manchu), 魏 (Three Kingdoms general) | Black lacquer |
| Green | — | 吳 仕 向 馬 車 礮 勇 (Three Kingdoms) | Green lacquer |
| Neutral | — | — | Dark brown cloud-knot back, no side or role information |

There are 29 unique assets: 14 standard faces, two banners, two replacement
kingdom generals, seven green faces, three color-matched backs and one neutral
back. Mini Xiangqi and Jieqi reuse the existing standard family. The green Wu
inscription uses the calligraphic 吴 shape also found in the existing kingdom
artwork; the semantic role remains 吳. The complex cannon 礮 was corrected through
ImageGen against the existing outlined glyph and the CNS11643 石駮 decomposition.

The user's final direction is color-matched backs. Jieqi uses those backs because
the side is public. `Back.svg` is supplied for Banqi, whose face-down pieces must
not reveal their side. Banqi is not a supported runtime board in this checkout;
this artwork does not add or advertise Banqi gameplay.

## Authoring and reproducibility

All materials, characters, ornaments and backs were painted by the built-in
ImageGen tool. The approved mockup established the reference. Red was generated
as a coordinated 3×3 master; black referenced red and the original mockup;
green referenced both army masters. A targeted ImageGen edit corrected 礮.
The three matching backs were generated together using all army references.
Exact prompts and reference lineage are in
[`prompts.json`](../../../bin/gen/celestial-lacquer/prompts.json).

`bin/gen/celestial-lacquer/source/` retains the approved mockup, final atlases and
the existing Wudang glyph used only as a correction reference. The rejected
green sheet is not a runtime fallback. Its prompt is retained to explain the
correction, not as a second canonical implementation.

```sh
node bin/gen/celestial-lacquer/generate.mjs
node bin/gen/celestial-lacquer/generate.mjs --check
```

Packaging extracts the opaque central bounds of each disc, normalizes its round
silhouette, removes fringe outside that silhouette, and supplies a 384 px raster
inside the existing 100-unit SVG canvas with a 90-unit body. The SVG is only an
embedded-image container; it does not recreate the artwork as vectors, substitute
fonts, recolor a second army or add symbols. Existing shared rendering owns
resting shadows, lift, sidewalls and flips. Source/output hashes and extraction
bounds are recorded in `manifest.json`.

The generator owns only this collection and its catalog entry. The older vector
variant generators now touch only the collections they own, preserving these
authored variant images. No dependency or persistent-data migration is added.

## Integration and mobile disposition

The shared catalog makes Celestial Lacquer selectable on the website. The main
mobile app receives the 14 standard faces and two matching backs through its
existing snapshot and theme selection workflow. Xiangqi Kids receives that same
standard snapshot, plus a compact visual piece picker from the garden settings
button; selection is saved before notifying games and puzzles.

Both mobile apps remain Standard Xiangqi only. Their variant projects remain
explicitly deferred, so variant artwork is website-only until those consumers
exist. This session authorizes the piece set in all three products. The separate
Cracked Stone board integration hold remains unchanged; its appearance here is
a design preview, not a newly selectable board.

Deployment requires the normal website build/restart (the server embeds the
catalog) and updated native bundles. No production deployment is performed.
Verification results are recorded in `verification.json`; broader reconciliation
checkpoints and unrelated outstanding reviews are not advanced.
