# Lixiangqi Default Board Design Record

## Purpose

This file is the design record for `lixiangqi-default.svg`. It documents the
visual intent, source material, measured values, SVG construction, and
alignment constraints needed to reproduce or adapt the board without
accidentally changing its established appearance.

Markdown is used because this document is human-readable, diffable in version
control, and can live beside the asset it describes without becoming a runtime
dependency.

## Assets

| File | Role |
| --- | --- |
| `lixiangqi-default.svg` | Final self-contained 900 × 1000 board asset. |
| `board-background_rev1.png` | 1190 × 1322 RGBA wood-and-bevel raster embedded in the final SVG. |
| `xiangqi-wikipedia.svg` | Local Wikipedia-derived thematic/vector source used for comparison. |
| `xiangqi-file-coordinates.svg` | Standalone coordinate-artwork source/reference. |

The final SVG uses `viewBox="-450 -500 900 1000"`. The raster background is
embedded at `x=-450`, `y=-500`, `width=900`, and `height=1000` with
`preserveAspectRatio="none"`, so the deployed board has no external image
dependency.

## Design philosophy

The overall goal is to look immediately familiar to players of mainstream
Chinese online xiangqi products. **天天象棋**, **JJ象棋**, **多乐中国象棋**,
**途游中国象棋**, and similar platforms use a remarkably consistent visual
language: warm wood, a softly beveled board, restrained brown printed or burned
artwork, a strong outer playing-field frame, and subdued internal lines.

The default Lixiangqi board follows that Chinese online-board convention without
copying one application's complete artwork. The wood, bevel, translucency, and
shallow engraved treatment are inspired principally by **天天象棋**. The
thematic layout of the printed artwork—grid construction, palace diagonals,
river lettering, position markers, and border verses—comes from the
[Wikipedia xiangqi-board diagram](https://en.wikipedia.org/wiki/Xiangqi#/media/File:Xiangqi_board.svg).

The underlying Wikimedia file is
[Xiangqi board.svg](https://commons.wikimedia.org/wiki/File:Xiangqi_board.svg),
created by Wikimedia Commons contributor **Wj654cj86** and released by its
author into the public domain. The final Lixiangqi composition is a materially
modified theme built around that vector vocabulary.

## Wikipedia-derived artwork

The Wikipedia diagram provides the thematic base for:

- the nine-file, ten-rank grid and palace diagonals;
- the river glyph outlines `楚河` and `漢界`;
- the soldier (`兵`/`卒`) and cannon (`炮`/`砲`) starting-point positioning
  marks—the small L-shaped **position markers** or **定位角标**;
- the vertical outer-border verses `觀棋不語真君子` and
  `起手無回大丈夫`.

The river glyph outlines are retained from the Wikipedia-derived artwork. In
the final composition, both river labels are stored and displayed upright to
the viewer, matching the presentation normally used by Chinese online xiangqi
platforms, rather than making one label face the opposing player. Do not apply
another rotation when reusing these final paths.

## Vector modifications

All measurements below are SVG user units in the 900 × 1000 viewBox.

| Element | Wikipedia-derived value | Lixiangqi value | Design reason |
| --- | ---: | ---: | --- |
| Grid-line stroke | `4` | `3` | Makes the playing grid lighter and less dominant on the wood. |
| Palace-diagonal stroke | `4` | `3` | Keeps diagonal weight identical to the grid. |
| Outer frame stroke | `4` | `6` | Gives the playing field the strong outline used by the Chinese app reference style. |
| Inner frame stroke | `4` | `3` | Preserves hierarchy between the heavy outer frame and internal artwork. |
| Position-marker stroke | `4` | `3` | Matches the lighter grid weight. |
| Position-marker path | `M30,10H10V30` | `M18,6H6V18` | Reduces the geometry to 60% and brings it closer to its intersection. |
| Marker gap from intersection | `10` | `6` | Tightens the spacing by 40%. |
| Marker arm length | `20` | `12` | Reduces the visual footprint without changing the right-angle design. |

The two frame rectangles are:

- outer: `x=-408`, `y=-458`, `width=816`, `height=916`, `stroke-width=6`;
- inner: `x=-400`, `y=-450`, `width=800`, `height=900`, `stroke-width=3`.

The painted outer edge of the heavy frame is therefore exactly `x=±411` and
`y=±461`.

## Wood color calibration

The wood was recalibrated against the supplied 628 × 730 Tiantian
`chessboard.png` reference using 90 windows arranged in nine columns and ten
rows across the playing field. These are sampling windows, not board cells
(the xiangqi grid has 8 × 9 cells). Each window is approximately half a cell
wide and high. Grid strokes, palace diagonals, position marks, and river
lettering are masked out before averaging encoded-sRGB channels.

The reference playing field runs approximately from (41.5, 61.5) to
(585.5, 668.5); the SVG field runs from (50, 50) to (850, 950) in image
coordinates. Sampling uses this correspondence rather than screenshot scaling.

A smooth quadratic RGB offset is baked into the canonical RGBA background
and its identical embedded PNG. No runtime filter or extra image is required.
For image coordinates X,Y in the 900 × 1000 board, let
`u = (X - 450) / 400` and `v = (Y - 500) / 450`.
The fitted additive corrections, in 0–255 encoded-sRGB units, are:

| Term | Red | Green | Blue |
| --- | ---: | ---: | ---: |
| 1 | 3.134019 | 9.571158 | 14.372182 |
| v | -1.240003 | -1.399969 | -1.634114 |
| v² | -2.417381 | -3.436900 | -4.975264 |
| u | -0.023804 | 0.178831 | 0.223406 |
| uv | -0.555416 | -0.800327 | -1.049994 |
| u² | -1.349086 | -1.900267 | -3.453322 |

These describe the completed correction, not a filter to apply again.
Dimensions and every alpha-channel value are preserved. A quadratic was
chosen to correct the broad lighting difference without fitting individual
wood-grain variations. The 90-window mean absolute RGB error drops from
7.161 to 0.627 before rasterization; an Inkscape 1800 × 2000 render measures
0.775, with a worst individual window/channel difference of 3.180.
The textures and raster sampling differ, so this is a measured close match,
not pixel equality.

## Printed grid ink

The grid, palace diagonals, frame, and position markers share one translucent
burned-ink treatment, recalibrated after the wood correction:

```text
ink color: #5b2712
group opacity: 0.351560395
color interpolation used for calibration: sRGB
```

The fit uses 154 internal/inner-border line segments and 60 samples distributed
along all four heavy outer-frame edges. Reference core pixels exclude partially
covered antialiased edges; corresponding corrected wood samples provide the
underlying color. The fitted model is:

```text
output = alpha × ink + (1 − alpha) × wood
```

A shared transmission and premultiplied RGB pigment were fitted by least
squares, then the pigment was rounded to 8-bit RGB and opacity refitted.
Mean absolute RGB error is 0.980 for grid samples and 1.875 for the outer
frame. These are compositing-model errors against the reference core samples,
not a claim of pixel-identical antialiasing at every display size.
The translucent ink retains visible wood-grain variation beneath the artwork.

## Engraved lettering

The river text and border verses use the same calibrated shallow-engraving
model. They are rendered separately from the translucent grid so they are not
darkened a second time by the grid's group opacity.

### Measured color targets

The lettering calibration used these measurements from the **天天象棋**
reference:

| Measurement | Target |
| --- | --- |
| Stable interior plateau/median | `RGB(158, 129, 104)` = `#9e8168` |
| Deep-interior mean | `RGB(157.9517, 129.4348, 104.2174)` |
| Body mean | `RGB(155.3117, 126.8677, 101.1270)` |
| Body luminance | `131.0564` |
| Darkest measured bevel pixel | `#573b2e` |
| Upper-left edge luminance | `118.9522` |
| Lower-right edge luminance | `130.5352` |
| Directional edge difference | `11.5830` luminance units |

Luminance here means the encoded-sRGB calculation
`Y = 0.2126R + 0.7152G + 0.0722B`; it is not a linear-light measurement.

The dark edge ramp closely follows the direction from the plateau color
`#9e8168` toward the original engraving shadow color `#250001`, which is why the engraving reuses
`#250001` for both shadow components. The very narrow lower-right highlight was
best fitted by the cool near-white `#e7f3ff` at `0.0774` opacity.

### SVG filter construction

Both engraving filters use `filterUnits="userSpaceOnUse"`,
`primitiveUnits="userSpaceOnUse"`, and
`color-interpolation-filters="sRGB"`. Their primitive sequence and values are
identical:

1. Invert `SourceAlpha` with `feComponentTransfer` using
   `tableValues="1 0"`.
2. Create the soft all-around recessed edge with `feGaussianBlur
   stdDeviation="3"`, clip it inside `SourceAlpha`, and flood it with
   `#250001` at `0.26` opacity.
3. Create the directional upper-left dark edge with `feGaussianBlur
   stdDeviation="0.6"`, offset it by `dx=1.5`, `dy=1.5`, subtract it from
   `SourceAlpha`, and flood it with `#250001` at `0.34` opacity.
4. Create the narrow lower-right highlight with `feGaussianBlur
   stdDeviation="0.6"`, offset it by `dx=1`, `dy=1`, subtract
   `SourceAlpha`, and flood it with `#e7f3ff` at `0.0774` opacity.
5. Merge in this order: highlight, `SourceGraphic`, isotropic dark rim,
   directional dark rim.

The text base fill is always `#9e8168` with no wrapper opacity.

Two filter definitions are retained because they need different safe filter
regions:

- `xiangqi-river-engraving`: `x=-300`, `y=-60`, `width=600`, `height=120`;
- `xiangqi-border-verse-engraving`: `x=-470`, `y=-520`, `width=940`,
  `height=1040`.

The wider verse filter prevents its Gaussian blur and highlight from being
clipped near the board sides. The filter is applied to an untransformed
top-level group after both the normal and 180-degree verse instances have been
assembled. This keeps the blur/offset measurements in board units and makes
the apparent lighting direction consistent for all four verse instances.

The filtered verse output is then clipped—not repositioned—to
`x=-470`, `y=-461`, `width=940`, `height=922`. This prevents the filter's faint
external highlight from extending past the already calibrated top and bottom
frame edges.

## Border-verse optical fitting

The Wikipedia-derived border verses were originally under
`scale(0.113)` with anchors `translate(-3805,2301)` and
`translate(3805,2301)`. The beveled background makes the board's apparent edge
sit inward from the literal SVG edge, so geometric centering against `x=±450`
looked too far outward and allowed the glyphs to intrude into the bevel
highlight.

The final transforms are preserved exactly as follows:

```svg
<g transform="scale(0.113)">
  <g transform="translate(-3779,2450.686099) scale(0.94)">…</g>
  <g transform="translate(3779,2450.626018) scale(0.94)">…</g>
</g>
```

This produces:

- a uniform 6% reduction in verse size and spacing;
- an inward optical shift of `26 × 0.113 = 2.938` board units on each side;
- separate vertical anchors for the two terminal glyph shapes;
- lower terminal path extrema of `460.999999954` and `461.000000034`, which
  coincide with the frame's exact `y=461` outer edge within numerical precision;
- mirrored top extrema at `y=-461` through the existing 180-degree reuse.

Do not round the two vertical translations to the same integer. Their small
difference compensates for the slightly different path extrema of the final
characters and preserves exact top/bottom alignment.

## Background and transparency

The wood background is intentionally RGBA. Its rounded corners must remain
transparent; there is no white matte. The former one-pixel white seam at the
top was removed, and the curved corner antialiasing uses board-colored
partially transparent pixels so that the wood fades naturally into page
transparency instead of terminating in a white fringe.

The application presentation layer must not add another corner radius. All
Xiangqi `cg-board` elements and their background pseudo-elements use
`border-radius: 0`; the asset's own alpha channel is the sole authority for the
visible corner shape.

When re-exporting or deriving another board:

- preserve the 1190 × 1322 raster dimensions unless the complete embedding
  and sampling pipeline is intentionally recalibrated;
- export as RGBA without a white matte;
- retain the alpha-feathered curved edge;
- verify all four corners over both light and dark test backgrounds;
- do not resample the background independently of the 900 × 1000 SVG mapping
  without rechecking line-color compositing.

## Layer order and invariants

The final visible order is:

1. embedded transparent-corner wood background;
2. translucent frame, grid, palace diagonals, and position markers;
3. engraved border verses;
4. engraved river text.

The border verses must not remain beneath the engraved copy inside the
`0.351560395` grid group. A second dark layer changes both the
antialiased edge color and the measured body color.

When changing this theme, preserve these invariants unless the design is being
deliberately recalibrated:

- root size and viewBox remain 900 × 1000 and `-450 -500 900 1000`;
- all nine files, ten ranks, palace diagonals, and legal starting-position
  markers remain geometrically aligned;
- grid/frame ink remains `#5b2712` at `0.351560395` opacity;
- engraved text base remains `#9e8168` with the recorded filters;
- river and verse glyph path data remain unchanged unless a typography redesign
  is explicitly intended;
- border-verse transforms and `y=±461` terminal alignment remain exact;
- corners remain transparent and free of white fringe.
- Xiangqi board containers do not impose CSS corner rounding over the artwork.

## Reproduction checklist

1. Start from the RGBA wood-and-bevel background and map it to the 900 × 1000
   viewBox.
2. Import the Wikipedia-derived grid, river glyphs, position markers, and border
   verse paths.
3. Apply the geometry and stroke changes in the vector-modification table.
4. Render the grid/frame layer with `#5b2712` at
   `0.351560395` opacity.
5. Orient both river labels upright to the viewer.
6. Apply the exact border-verse transforms rather than visually approximating
   them.
7. Render river and verse text once, with base `#9e8168` and the recorded
   engraving primitives.
8. Apply the verse effect only after both rotated verse halves are assembled,
   then clip its vertical output to `y=-461…461`.
9. Verify a native 900 × 1000 render and a high-resolution render. Confirm that
   no verse effect pixels extend above or below the outer frame, the central
   board matches the calibrated reference measurements, and the transparent corners have no white fringe.
