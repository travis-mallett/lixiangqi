# Three-player Xiangqi: tournament, Wudang, and paper

These three standalone SVGs extend the approved default wood board:

- `xiangqi-tournament-three-player.svg`
- `xiangqi-wudang-three-player.svg`
- `paper-board-three-player.svg`

The complete coordinate and advisor-path contract remains in
[the geometry design](lixiangqi-default-three-player.design.md). All four
themes share `bin/gen/three-player-xiangqi/geometry.mjs`, including the
135 positions, 54 primary segments, 12 palace segments, marker locations,
label anchors, and geometry metadata. Theme changes cannot move a piece.

## Dimensions and palace invariant

The canvas is 1900.254663529 × 1645.668812276 units, with its origin at the
center. Grid circumradius is 882; its apothem is 763.834406138. Every side
has a 59-unit perpendicular border. Pieces retain 98-unit canvases and
88.2-unit bodies; minimum center spacing is 98 and body-to-face clearance
is at least 14.9 units. The face is a regular hexagon, transparent outside.

Each palace has **four independent corner-to-center segments**:
`(3,0)—(4,1)`, `(5,0)—(4,1)`, `(3,2)—(4,1)`, `(5,2)—(4,1)`, rotated
with its sector. Advisor paths follow these undirected edges. Opposite
halves are not collinear; do not replace them with two full-palace chords
or interpolate an advisor through the old chord intersection.

All lettering uses the same approved anchors and rotations. Kingdom
lettering has longest ink dimension 190.958601534; river lettering 127.4.
The inscription is 魏、吳、蜀 and 荊州、赤壁、祁山. The traditional forms
吳 and 荊 match the original themes' traditional Chinese font repertoire.

## Exact source paint settings

Source styles are read directly from the corresponding standard SVG, not
from miniature-board approximations. Its artwork transform is `scale(0.98)`;
the three-player generator converts stroke and marker lengths into final
units once. It asserts that the source transform and marker construction
still have the expected form.

| Property | Tournament | Wudang | Paper |
| --- | --- | --- | --- |
| Source asset | `xiangqi-tournament.svg` | `xiangqi-wudang.svg` | `paper-board.svg` |
| Grid / palace / marker ink | `#000` | `#111111` | `#cd7770` |
| Grid / palace / marker width | 1.96 | 2.94 | 1.372 |
| Artwork opacity | 1 | 0.82990654, grouped once | 1 |
| Extra playing frame | none | `#111111`, width 5.88 | `#d44b42`, width 5.39 |
| Extra frame's normal offset | — | 7.84 | 5.88 |
| Marker gap / outer extent | 4.9 / 14.7 | 5.88 / 17.64 | 5.88 / 17.64 |
| Lettering fill | `#000` | `#111111` | `#d73b32` |
| Additional lettering opacity | 1 | 1; inherits artwork opacity | 0.37782805 |
| Lettering face | 超世紀粗方篆 / JetLink BoldRightJang | 全字庫正楷體 / TW-Kai | UnYetgul |

Paths retain butt caps and miter grid joins. Tournament has a **single**
playing perimeter, formed by the six perimeter segments; it must not gain
the default wood board's heavy second frame. Paper's opacity applies only
to lettering. Wudang's opacity applies to the combined grid and lettering
group, so overlapping ink receives opacity once. These themes have no
default-wood engraving filter or blur.

## Materials

**Tournament:** the original `#ffc400` surface and all three illumination
gradients are reused with their exact stops, colors, and opacities. Only
the material's normalized layout maps from 900 × 1000 to the new canvas.
Six bevel strips preserve the original 5.75-unit normal depth. Upper/left
and lower/right edges use their respective original gradient stops,
hairline colors and opacities. The two inset rim lines retain depths
2.645 and 5.06, widths 1.15 and 1.035, and original paint settings.

**Wudang:** the original embedded PNG is reused byte for byte, including
the mountains, paper, charcoal rim, and distressed gold border. No new
texture or AI-generated restyling is used. A continuous piecewise affine
SVG mapping reshapes the rectangular material into a hexagon. Its source
outer ring has vertices `(450,0)`, `(450,500)`, `(-450,500)`, `(-450,0)`,
`(-450,-500)`, `(450,-500)`; its inner ring replaces 450/500 with 392/441.
These map respectively to the six face and grid vertices. Each ring strip
uses two triangles; the inner face uses six center-to-edge triangles.
All 18 tiles reference one embedded image. Shared endpoints are verified
numerically. Clips overscan by a factor 1.0015 to cover raster antialiasing
seams; the outer face clips the overscan. The material mapping never
transforms grid lines, text, or piece centers. The separate border ring
keeps its thickness at the existing piece scale.

**Paper:** a flat `#f2f1ec` hexagon, with the original thin red print and
heavier red frame. No texture, shadow, bevel, or ornament is introduced.

## Lettering sources and reproduction

The nine glyphs per theme are committed SVG outlines under
`bin/gen/three-player-xiangqi/`. No fonts are needed by browsers or the
normal generator. The original standard boards are unchanged.

- **Tournament:** JetLink BoldRightJang / 超世紀粗方篆. The font identified
  in the standard SVG was recovered from its
  [font distribution page](https://www.fontowns.com/font/1329903/).
  The four existing 楚河漢界 outlines reproduce with identical thresholded
  silhouettes at a 220-pixel longest dimension. Only nine document glyphs
  are retained, as with the existing board; the font program is not bundled.
- **Paper:** UnYetgul from
  [Unfonts-extra](https://ctan.org/pkg/unfonts-extra), by Koaunghi Un and
  Won-kyu Park. GPL-2.0-or-later text accompanies the glyph fixture in
  `UnYetgul.LICENSE.txt`. The four existing inscriptions reproduce with
  identical thresholded silhouettes at the same comparison size.
- **Wudang:** the historical TW-Kai 98.1 font, matching the CNS Kai family
  named in the [original board source](https://commons.wikimedia.org/wiki/File:Xiangqi_board.svg).
  Attribution: 數位發展部，CNS11643中文標準交換碼全字庫網站，
  <https://www.cns11643.gov.tw>.
  [Government Open Data License v1.0](https://www.cns11643.gov.tw/pageView.jsp?ID=59).
  Its standard-board outlines are heavier than the plain font face. The
  new letters use a 22-font-unit round contour stroke, calibrated across
  all four original inscriptions, before the original `(0.79,0.62)` aspect
  correction. The four normalized silhouettes have intersection-over-union
  0.9671–0.9739 against the existing integer-rounded cubic outlines. This
  records the small outline reconstruction difference explicitly; the
  family, ink weight, aspect treatment, fill, and opacity are preserved.
  Lettering is centered and sized by ink bounds including this stroke.

Font SHA-256 identifiers used for authoring:

```text
JetLink BoldRightJang:
8616075abd1dd82cb730c01510231ad1f248c52946d68050317662764f7de23e
UnYetgul:
c9d42eaac473b8ab0461cc6c2d1a1bac79b0babdf73974c7269ae17b81fd5d51
TW-Kai 98.1:
10eaaf2bf6c8853f10ddfca1a7805f104c3fe59129a843b816b331f36870aaaf
```

Regenerate all four boards from the repository root:

```sh
node bin/gen/three-player-xiangqi.mjs
```

For intentional lettering changes only, `outline-font.py` accepts a theme
(`tournament`, `wudang`, or `paper`) and the corresponding font path. This
optional authoring step requires fontTools; it is not a build dependency.
It verifies the family, uses true Bézier ink bounds, preserves contours,
and emits the nine fixed inscriptions. The historical seal font's three
invalid trailing empty `loca` offsets are corrected in memory; requested
glyphs are checked to precede those slots. No font program is modified.

The main generator owns the existing wood rendering; `geometry.mjs` owns
all coordinates and edges; `themes.mjs` reads source paint and emits the
three new assets; `materials.mjs` owns material adaptation only.

## Validation and integration scope

Validation covers identical shared grid/palace paths and metadata across
all four themes; all 135 centers and piece clearances; source paint values;
embedded Wudang PNG identity; outlined lettering and local-only SVG
references; and renders at 380, 760, and 1200 pixels. Browser verification
covers both light and dark surroundings and image/CSS-background use.
The previously approved default wood SVG remains byte-identical after
extracting the shared geometry.

These assets do not register a playable three-player variant or change
the theme catalog. No runtime service, dependency, migration, or deployment
tool change is required. Future runtime integration must consume the
shared geometry and palace adjacency contract rather than derive moves
from the visual theme.
