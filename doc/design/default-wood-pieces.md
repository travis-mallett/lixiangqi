# default-wood pieces

The selectable `default-wood` theme uses the 14 traditional `ttxqhanzi` SVGs from
[PyChess Variants, revision 6e38d77426991710ec4a1d641773e17cb66f921a](https://github.com/gbtami/pychess-variants/tree/6e38d77426991710ec4a1d641773e17cb66f921a/static/images/pieces/xiangqi/ttxqhanzi).
Upstream licenses this directory under AGPLv3+. See `COPYING.md`.

The PyChess character outlines and wooden silhouette are retained. The ring and
face geometry, character placement, and character weight are calibrated to the
references. Embedded drop shadows are removed: LiXiangQi owns piece shadows in
its shared board rendering. This is the default piece set for new users and for
missing, retired, or invalid saved piece-set keys. Classic Xiangqi and Paper
Xiangqi are no longer selectable or shipped as piece sets.

`PieceSets.default` owns the default choice. Appearance defaults, profile BSON
decoding, export lookups, and asset resolution use that choice. Invalid profile
values are normalized when read, without a bulk database migration; a subsequent
preference save writes the normalized value. Existing valid selections remain
unchanged. Invalid anonymous session selections are ignored in favor of the
default; invalid query overrides preserve the user's valid saved selection.

## Reference calibration

The supplied top-down TianTian screenshots were sampled in RGB space. Ink masks
were restricted to the central 30-pixel radius and eroded by one pixel to exclude
antialiased edges. Across six red and seven black pieces:

| Sample               | Pixels | Mean RGB                | SVG ink   |
| -------------------- | -----: | ----------------------- | --------- |
| Red symbol centers   |  4,127 | 147.192, 61.643, 41.083 | `#933e29` |
| Black symbol centers |  3,976 | 58.574, 57.325, 56.014  | `#3b3938` |

Symbols and rings use opaque matching ink. Wood and lighting layers are below
both, so they cannot wash out the measured colors.

The wood reference was estimated across the screenshots, excluding symbols by
using the 85th percentile at each pixel. The clear strip left of the horse
(reference x=34..39, y=53..78) averages RGB 242.386, 185.103, 125.738.
These are area averages, not a claim of pixel-identical reproduction: the
retained PyChess character outlines differ from TianTian.

The grain is a simple sample of clear wood near the top of the reference face
(x=60..83, y=35..39), mirrored at its boundaries, converted to 16 grayscale
levels, and resized to 48×16. The 348-byte PNG is embedded in each SVG at 3.5%
opacity. Embedding lets CSS background images render without nested external
resource requests. There is no runtime turbulence or displacement filter.

The face fill is `#f6b97b`; the rounded body gradient uses `#f3bf86`, `#f3bb7f`,
`#dca05c`, and `#a17e53`. The inherited lower-left curved reflection uses
`#fff0cb` at 15% opacity with a 0.65-unit blur. The broad inherited wood glow is
reduced to 8%. The original reflection path is retained.

## Body-relative geometry and character weight

Geometry uses `red_horse_0.png` from the supplied TianTian `piece_frames` folder.
The wooden boundary is fitted at its luminance transition to the background,
excluding the cast shadow. The ring is fitted separately to ink coverage in an
annulus, excluding the character. Coordinates below use pixel-edge origins
(pixel centers are at half-integers).

| Geometry       |  Center x |  Center y |  Radius x |  Radius y |
| -------------- | --------: | --------: | --------: | --------: |
| Reference wood | 70.216738 | 69.988126 | 37.993705 | 38.976747 |
| Reference ring | 69.819902 | 66.639057 | 30.773297 | 29.636076 |
| SVG wood       | 45.999996 | 46.000001 | 39.690415 | 40.902851 |
| SVG ring       | 45.585438 | 42.485431 | 32.147560 | 31.100594 |

Map reference positions relative to the wood center using the ratio of the
wood radii on each axis. This avoids treating image padding or a cast shadow as
part of the piece. The resulting ring stroke is 2.236931 SVG units. Every piece
uses this same ring, with the underlying face resized to meet it. The ring-only
overlay matches the reference to its raster precision; antialiasing and small
irregularities in the reference remain.

Each of the 14 characters is fitted to its own top-down reference. Bounding boxes
and ink coverage are measured inside the ring, then mapped through the same
wood-relative coordinates. Each `symbol` group positions and scales the original
path; a matching-color rounded stroke increases its weight. Chromium renders at
8× resolution were used to refine the strokes until integrated ink coverage was
within 0.25% of the estimated reference coverage. This matches overall size and
weight without replacing the distinct PyChess calligraphy with a traced glyph.

The old character blur filters were removed so they cannot clip the expanded
strokes; vector antialiasing handles the edges. The shadow filter and all its
references were removed. Only the wood-lighting blur filters remain.

All 14 assets were decoded in Chromium at 32, 48, 64, 92, and 140 pixels, with
body-aligned comparisons for all pieces and an isolated ring overlay. Their SVG
character and reflection path data remain identical to the downloaded source.

## Shared contact shadow

`public/piece/effects/xiangqi-rest-shadow.png` is generated by
`python bin/gen/xiangqi-shadow.py` (Pillow required). The 512-pixel texture is
displayed in a layer twice the board's piece-box width and height. Its fitted
ellipse center is (271.439, 295.061), radii (108.994, 114.625), Gaussian-equivalent
edge sigma 12.393, core opacity 0.39737, and color `#170a00`. These parameters
match the broad, soft downward shadow in the resting TianTian reference frames;
they are a smooth approximation, not an exact reconstruction of hidden pixels.

At a 76-pixel wooden-body width, the shadow center is 5.31 pixels right and
13.44 pixels below the wood center. Its edge sigma is 4.26 pixels. Alignment
uses the wooden body, not the transparent sprite canvas. The fit reduces
visible-alpha RMS error against the reference from 0.0707 to about 0.0116.

Idle pieces and landing pieces share this texture. The contact shadow fades
away during pickup and returns during landing. The separate airborne texture
fades in on pickup and out on landing, preserving LiXiangQi's lifted-piece
presentation. The lifted reference sprites alone do not specify that runtime
shadow. Shadow softness is baked into the PNGs; no live blur filter is needed.

Contact shadows are board-level companions (`.xiangqi-piece-shadow`) rather than
children or pseudo-elements of pieces. Their board-plane z-index stays below
every piece face, including adjacent pieces and fading captures. The shared
ChessgroundX renderer keeps companions aligned through redraws, resizing, flips,
dragging and DOM reuse, and removes them when their piece disappears. Motion
mirrors travel/fading onto the companion while animating contact opacity
independently. Lifting a face never lifts its contact shadow's stacking layer.
The airborne shadow is a child of the lifted piece, below its face but allowed
above neighboring pieces. It is removed when the lifted presentation ends.
