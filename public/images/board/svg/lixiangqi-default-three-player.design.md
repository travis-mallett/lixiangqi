# Three-player Xiangqi: default wood board

This is the canonical artwork specification for
`lixiangqi-default-three-player.svg`. It reconstructs the grid in the two
user-supplied references dated 29 October 2026, then applies the current
LiXiangQi default wood material and calibrated artwork treatment.

The asset is a design-stage board, not an enabled game. It does not register a
variant, change the existing two-player renderer, or define move legality.
Its construction source is `bin/gen/three-player-xiangqi.mjs`; the generated
SVG contains all 135 named piece centers in `metadata#three-player-geometry`.

## Coordinate contract

Coordinates are measured to **stroke centers**, with origin at the center of
the regular hexagon, positive x right, and positive y down. All values below
are final SVG units; there is no additional 0.98 artwork transform.

Let:

```text
p = 98                         shortest neighboring-center distance
R = 9p = 882                   grid hexagon circumradius AND side length
H = √3 R / 2                   grid hexagon apothem
m = 59                         wood border, perpendicular to every grid edge
Ro = R + 2m / √3               outer wood hexagon circumradius
W = 2Ro                        canvas width
T = 2(H + m)                   canvas height
```

| Measurement | Value |
| --- | ---: |
| Grid circumradius / side | 882 |
| Grid apothem H | 763.834406137875 |
| Grid bounding box | 1764 × 1527.66881227575 |
| Home-edge file spacing | 110.25 = 9p/8 |
| Intervening-edge rank spacing | 98 = p |
| Central-file rank spacing | 152.766881227575 = H/5 |
| Outer wood circumradius Ro | 950.127331764376 |
| Canvas W × T | 1900.254663528752 × 1645.668812275750 |
| Aspect ratio W/T | 2/√3 |
| Grid-to-wood normal border | 59 |
| Piece canvas | 98 × 98 |
| Visible piece body diameter | 88.2 |
| Minimum neighboring-body clearance | 9.8 |
| Minimum body-to-straight-wood-edge clearance | 14.9 |

The root viewBox is `-Ro -(H+m) W T`. For a top-left coordinate system, add
`(Ro, H+m)` to every center. The SVG serializes coordinates to six decimal
places; the formulas and metadata retain double-precision values. Do not
round the construction to integer pixels or stretch the image to a rectangle.

The six grid vertices, in clockwise order, are:

```text
( R, 0), ( R/2, H), (-R/2, H),
(-R, 0), (-R/2,-H), ( R/2,-H)
```

## Why the scale is based on the shortest interval

The hexagon's three home edges each have **eight** file intervals. Each
intervening edge has **nine** intervals: four ranks belonging to one player,
one river mouth, and four ranks belonging to the other player. All six sides
have equal length.

Setting home-edge spacing to 98 would make the shorter intervals only
87.111111 units. The existing 88.2-unit piece bodies would overlap there.
Instead, the nine-interval edges use the shared 98-unit pitch and the
eight-interval home edges use 110.25. This preserves both the reference shape
and the existing piece-size contract.

The standard board's 100 × 100 piece assets render into 98 × 98 squares at
scale 1, giving their 90-unit bodies an 88.2-unit diameter. This board uses
exactly that conversion, with no theme-specific size adjustment. Piece
images remain circular and undistorted even where the grid cells are skewed.

At display width `w`, multiply **all** board and piece dimensions by `w/W`.
For a desired on-screen body diameter `d`, use `w = Wd/88.2`. A larger board
topology necessarily has smaller pieces if squeezed into the same bounding
box as the two-player board. The shared contract is the size at equal artwork
scale, not equal piece size at unequal zoom factors.

The outer wood border is a true parallel offset, not 59 units added to the
hexagon radius. The latter would reserve only 51.0955 units normal to a side.
The wood corners use quadratic rounding, with tangent points 14 units along
each adjacent edge; grid and frame corners remain sharp. Every visible piece
body fits inside the rounded wood silhouette. Transparent corners of the
piece's square image can extend beyond that silhouette: do not clip piece
elements to the background's wood clip path.

## One sector, then three exact rotations

Each territory has nine files `f = 0…8` and five ranks `r = 0…4`.
Rank 0 is the home edge; rank 4 is the river bank. Files increase left to
right when that territory is at the bottom. These are artwork identifiers,
not a proposed move-notation or persistence format.

The bottom territory is Wei. Its continuous coordinate formula is:

```text
x(f,r) = (f - 4) p (9 + r) / 8
y(f,r) = H [1 - r/5 + |f - 4| r/45]
```

Use integer f/r for piece centers. Fractional values are only an interpolation
of the artwork. The two halves are bilinear quadrilateral patches, joined at
file 4. The files are straight, the ranks are straight on each half, and the
ranks bend at file 4. There is no circular grid, radial fan, or curved river.

An equivalent construction, useful for drawing by hand, is:

```text
Lr = (-R/2 - rR/18, H(1 - r/9))
Cr = (0, H(1 - r/5))
Dr = ( R/2 + rR/18, H(1 - r/9))

Files 0…4 divide Lr→Cr into four equal intervals.
Files 4…8 divide Cr→Dr into four equal intervals.
```

| Rank | Left endpoint x | Endpoint y/H | Center y/H | Right endpoint x |
| --- | ---: | ---: | ---: | ---: |
| 0 | -441 | 1 | 1 | 441 |
| 1 | -490 | 8/9 | 4/5 | 490 |
| 2 | -539 | 7/9 | 3/5 | 539 |
| 3 | -588 | 6/9 | 2/5 | 588 |
| 4 | -637 | 5/9 | 1/5 | 637 |

For sector s, rotate these coordinates by `120s` degrees about the origin:

```text
Qθ(x,y) = (x cosθ - y sinθ, x sinθ + y cosθ)

s=0: wei, bottom,      θ=0°
s=1: wu,  upper left,  θ=120°
s=2: shu, upper right, θ=240°
```

This is clockwise rotation in SVG coordinates. A location ID is
`sector:file:rank`, for example `wei:4:0` at `(0,H)` or `wei:4:4` at `(0,H/5)`.
There are exactly **135 distinct primary-grid locations**, 45 per sector,
and 96 quadrilateral cells, 32 per sector. All locations, lines, river banks,
palaces, and markers use this same construction.

## Rivers and central triangle

The top river is the trapezoid with vertices:

```text
(-p/2,-H), (p/2,-H), (3R/20,-H/10), (-3R/20,-H/10)
```

Its mouth is exactly 98 units wide. Its inner edge is 264.6 units wide.
The other two channels are this same trapezoid rotated ±120°. Rank-4 bank
segments own their long boundaries; there are no additional parallel bank
strokes and no grid lines running through the river interiors.

The three rank-4 center-file locations bound the empty central triangle:

```text
(-132.3,-76.3834406137875)
( 132.3,-76.3834406137875)
(     0,152.766881227575)
```

Equivalently, these are `Q120s(0,H/5)`. The triangle is equilateral, with side
`3R/10 = 264.6`. Draw its three edges exactly once. Its corners are existing
sector locations. The geometric center `(0,0)` and triangle interior are not
additional piece locations. No plaque or decorative center line is inserted.

The six-segment outer grid perimeter remains continuous across all three
river mouths, as in both references. Outside files and home ranks are part
of that perimeter and must not be drawn a second time.

## Palaces and advisor paths

Each palace occupies files 3…5 and ranks 0…2. Draw **four individual straight
segments**, one from each corner to the existing central grid location:

```text
C = P(4,1) = (0,4H/5)                 before the sector rotation

P(3,0) ↔ C
P(5,0) ↔ C
P(3,2) ↔ C
P(5,2) ↔ C
```

All four diagonal endpoints coincide exactly with the center-file/rank-1
intersection, making one unified joint. The bottom palace center is
`(0,611.067524910300)`; rotate it and its corners by 120° and 240° for the
other two palaces. There are twelve diagonal segments across the board.
The center is already one of the 135 primary-grid locations; no additional
location is introduced.

Because the ranks bend, opposite corner-to-center segments are not
collinear. They must retain their change of direction at C. Never substitute
a single corner-to-opposite-corner chord or calculate the center from the
crossing of such chords.

`palaceDiagonalEdges` in the generator and SVG geometry metadata lists these
twelve **undirected pairs of location IDs**. The rendered palace segments
are derived from those same pairs and the canonical location table. This is
the geometric adjacency contract for future advisor movement: an advisor
slides between the center and one connected corner, in either direction.
The four corners are not directly connected to one another by a single
advisor edge. The rules layer remains responsible for occupancy, captures,
check, and other legality constraints.

For an advisor animation along one edge A↔B, interpolate the already rotated
canonical centers: `position(t) = (1-t)A + tB`, for `0 ≤ t ≤ 1`. This follows
the painted segment exactly. Do not reuse a full-palace chord or interpolate
between opposite corners. Any route displaying successive edges must pass
through C and preserve the bend there. Rendering, hit testing, movement
paths, and future advisor adjacency must share these same node coordinates.

## Lettering and position markers

All nine glyphs are outlined paths, normalized and centered by their ink
bounds. There are no live font or network dependencies. The labels follow
the reference orientations rather than all facing the bottom player.

| Label | Unrotated anchors | Whole-label rotation |
| --- | --- | ---: |
| 魏 | `(0,4H/5)` | 0° |
| 吴 | `(0,4H/5)` | 120° |
| 蜀 | `(0,4H/5)` | 240° |
| 荆、州 | `(0,-0.42H)`, `(0,-0.65H)` | 0° |
| 赤、壁 | `(0,-0.42H)`, `(0,-0.65H)` | -120° |
| 祁、山 | `(0,-0.42H)`, `(0,-0.65H)` | 120° |

River glyphs receive an additional 180° rotation at their own centers before
the whole-label rotation. The longest ink dimension is 127.4 units for each
river glyph and `H/4 = 190.958601534469` for each kingdom glyph. Proportions
within a glyph are preserved. These are fixed Chinese board inscriptions,
not untranslated application UI.

The default board does not contain outlines for these nine characters.
The new inscriptions use matching regular-script **FandolKai Regular 0.3**,
outlined without changing the glyph shapes. The [Fandol source and licensing](https://ctan.org/tex-archive/fonts/fandol)
identify the Fandol team, Clerk Ma and Jie Su, and GPL with font exception.
The outline source and full license are kept in
`bin/gen/three-player-xiangqi-glyphs.svg` and
`bin/gen/three-player-xiangqi-font.LICENSE.txt`. Regeneration uses the stored
paths, not an installed font. Text anchors follow the references; font shapes
and optical extents intentionally follow the LiXiangQi calligraphic style.

The source `FandolKai-Regular.otf` SHA-256 is
`ea7e7fb4f9b3ac694a68d43946e04d21deed6e8c29a7c2d3081e1a4138f2f827`.
Outlining used the existing `@resvg/resvg-js` 2.6.2 `toString()` conversion
at font size 1000, with system fonts disabled. Each resulting glyph was
centered by its ink bounds and uniformly normalized to longest dimension 1.

Use the default cannon markers at `(1,2)` and `(7,2)`, and soldier markers
at `(0,3)`, `(2,3)`, `(4,3)`, `(6,3)`, `(8,3)`, in every sector. There are
21 marked locations. The reference game screenshot shows these markers;
the monochrome reference omits them.

The canonical mark is the default board's `M18,6H6V18`, scaled by 0.98:
5.88-unit gap and 11.76-unit arms. At each corner, use unit vectors toward
the neighboring file and rank, and map the mark into those two directions.
At the bent center file, use the left and right rank directions separately.
At outside files 0 and 8, omit the two outward-facing corners. This retains
the default mark size while following the actual skewed grid.

The monochrome reference's outside A–O / 1–9 legend is an indexing aid, not
part of the wooden game-board reference. It is not burned into this asset.
Likewise, the references' UI, player pieces, logos, and watermarks are absent.

## Default wood materials and layer order

The canonical default board's embedded PNG bytes are reused **unchanged**.
The 1190 × 1322 source remains embedded, so this SVG is self-contained. The
image occupies `(W+200) × ((W+200)1000/900)` units, centered on the origin.
This is a uniform enlargement of the source board's 900 × 1000 mapping.
The hexagon clips an interior region, keeping the old rectangular bevel
outside the visible face. Grain stays continuous across the rivers and all
three sectors; it is not tiled, reflected, or assembled from rotated panels.

The perimeter has a new shallow vector bevel following the hexagonal face.
It uses the default warm wood/brown/light palette and transparent corners.
The rectangular source board's corner alpha cannot define a hexagon, so the
new face clip is the authority for this asset's silhouette.

Visible layers, in order:

1. Clipped original wood texture and the hexagonal wood rim.
2. Heavy playing frame, offset **7.84 normal units** outside the grid.
3. Grid perimeter, files, bent ranks, river junction triangle, palace diagonals,
   and position markers, composited in one translucent ink group.
4. All nine engraved inscriptions, filtered together in global board space.

| Treatment | Final-board value |
| --- | --- |
| Grid, palace and marker stroke | 2.94 = 3 × 0.98 |
| Heavy frame stroke | 5.88 = 6 × 0.98 |
| Grid/frame/marker ink | `#5b2712`, group opacity `0.351560395` |
| Text base | `#9e8168`, opaque |
| Text isotropic inner rim | Blur 2.94; `#250001` at 0.26 |
| Text directional recess | Blur 0.588, offset (1.47,1.47); `#250001` at 0.34 |
| Text lower-right highlight | Blur 0.588, offset (0.98,0.98); `#e7f3ff` at 0.0774 |

The engraving's primitive sequence is copied from the current
`lixiangqi-default.svg`, with its original 0.98 scale baked into filter
distances. It uses sRGB compositing. Applying it after all glyph rotations
keeps the lighting direction consistent. Text does not receive the grid's
opacity a second time. The full-canvas filter region prevents clipping.

## Reference alignment and its limits

The supplied images are a 739 × 745 monochrome diagram and a 1466 × 986
game screenshot. They agree on the regular-hexagon construction above.
They contain small skew/raster differences, so literal pixel equality with
both captures is impossible. The production SVG keeps exact rotational
symmetry; screenshot distortion is only part of the comparison transform.

One projective transform per image registers the **entire** construction.
There are no independent per-sector warps or hand-adjusted line endpoints.
For a canonical coordinate, first set `u=x/98`, `v=y/98`. Multiply
`(u,v,1)` by the following matrix, then divide x and y by the resulting third
component to obtain source-image pixel coordinates:

```text
Reference 1:
  35.983002520156  -0.399738264186  369.639581175012
   0.195641205230  35.893788042795  362.143165914407
  -0.000050364819  -0.000205317038    1

Reference 2:
  55.927642038862  -0.008964118526  708.408981492702
  -0.043533580574  55.884054764432  482.446922769628
  -0.000010240345  -0.000040920535    1
```

Initial registration used six independently selected perimeter corners:

```text
Reference 1: (694,364) (530,644) (204,642) (46,361) (211,81) (534,83)
Reference 2: (1212,482) (960,919) (457,919) (205,483) (457,47) (960,47)
```

Registration verification sampled 17 interior positions along each of the
54 straight primary-grid segments. A 10-pixel perpendicular intensity profile located
narrow dark stroke cores. Low-contrast, broad, or >3-pixel-offset detections
were rejected to avoid labels, pieces, and shadows. A robust subset refined
the one global registration, retaining the six corners as anchors. Reported
residuals compare the resulting model with all accepted core detections:

| Reference | Accepted / attempted profiles | Median distance | RMS distance | 95th percentile |
| --- | ---: | ---: | ---: | ---: |
| Monochrome | 893 / 918 | 0.342 px | 0.762 px | 1.730 px |
| Game screenshot | 730 / 918 | 0.498 px | 1.003 px | 2.250 px |

These are registered **visible-line core** measurements, not whole-image
pixel error, proof about occluded segments, or a claim about exact glyph
shape matching. Palace segments are excluded from these statistics: lettering
and pieces obscure their joints. Their geometry is verified directly against
the four corner-to-center node pairs in each sector. Updated magenta overlays
contain all 66 primary-grid and palace segments. The primary grid has a
subpixel median fit with remaining differences at the source images'
raster/stroke scale.

Task-local proof files are in `.tools/three-player-board/`: the two
`reference-*-overlay.svg` / `.png` files, measurement JSON files and script,
renders at widths 380/760/1200, and `piece-clearance.png` with existing wood
pieces placed at all 135 centers. These are review evidence, not shipped
runtime assets; the user-supplied screenshots are not added to the repository.

## Reproduction and future integration

From the repository root:

```sh
node bin/gen/three-player-xiangqi.mjs
```

The generator reads the current source themes and committed glyph paths,
writes this board and its tournament/Wudang/paper siblings, and verifies
135 distinct centers, four distinct palace
corners joined to the central grid location per sector, the global 98-unit
minimum distance, the 88.2-unit piece body, and border clearances. There is no
font download, new package, procedural-noise renderer, or server computation.
Re-run the visual/texture checks if the source theme is recalibrated.

All four themes use the canonical construction in
`bin/gen/three-player-xiangqi/geometry.mjs`; this extraction preserves the
approved default wood SVG byte for byte. Theme-specific paints, materials,
and lettering are documented in [the theme design](three-player-themes.design.md).

Future runtime support belongs behind the shared `@lixiangqi/board` API.
The current backend only supports two-player rectangular geometries; this
topology must not be squeezed into its file/rank viewport or implemented as a
page-specific patch. Move the canonical coordinate construction into the
owning geometry module when that backend is implemented, and have artwork
generation use it. Do not retain a separate second runtime calculation.

Preserve these invariants:

- Three sectors differ only by exact 120° rotations.
- There are 135 primary-grid locations and no center/river-interior node.
- Home sides have eight intervals; intervening sides have nine.
- River mouths are p wide; the central triangle has side 3R/10.
- Each palace has four corner-to-center segments meeting at P(4,1); advisor
  paths follow those same undirected edges and retain the bend between edges.
- Pieces use 98-unit square canvases and 88.2-unit bodies at equal zoom.
- Normal border is 59 units on every side; image aspect ratio is 2/√3.
- Grid ink, widths, marker dimensions, and engraving follow the default theme.
- Text is outlined, the material is embedded, corners are transparent, and
  no external resource, script, or CSS is required.

This asset-only addition needs no data migration, service, deployment-tool
change, or theme-catalog registration. Normal asset hashing includes the SVG.

## Completed validation

- Exact embedded-PNG equality with the current default board.
- Generator/overlay parity for all 66 straight primary-grid and palace segments.
- Each palace has exactly four distinct corners joined to the existing center
  node. The SVG metadata and rendered paths use the same twelve advisor edges.
- All 135 existing wood piece bodies fit without overlap; the rounded face
  was also inspected with every location occupied.
- Chromium renders at 380, 760 and 1200 pixels wide, over both light and dark
  backgrounds, preserve the aspect ratio and complete artwork. SVG image and
  CSS background modes produce identical pixels at the tested 760-pixel size.
- Formatting and repository code/style lint pass; the asset production build
  passes; all 506 frontend tests pass. On this Windows checkout, `ui/test` is
  a symlink-text file, so its actual target was run as
  `node ui/.test/runner.mjs` through Bash.
