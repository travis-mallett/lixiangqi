# PyChess standard Xiangqi source ledger

The standard-Xiangqi ports are derived from PyChess Variants revision
[`7dc114b1ce2c12fed294d36db2db04dd59857d9b`](https://github.com/gbtami/pychess-variants/tree/7dc114b1ce2c12fed294d36db2db04dd59857d9b)
and remain GPL-3.0 licensed. No PyChess checkout is required at build or
runtime.

- `ui/lib/css/theme/board/_xiangqi-pieces.scss` maps ChessgroundX roles to
  the locally stored Wikipedia assets. Alternate-variant, promoted, and covered-piece
  styles are intentionally omitted.

`ui/lib/src/game/xiangqi.ts` and `ui/xiangqi/src/index.ts` port the standard
Xiangqi constants, board configuration, and coordinate codec from PyChess
`client/variants.ts`, `client/chess.ts`, and `client/cgCtrl.ts`. They
deliberately contain no alternate variant mechanics.

The Wikimedia board and piece artwork was created by Wikimedia Commons user
Wj654cj86 and released into the public domain:

- `public/images/board/svg/xiangqi-wikipedia.svg` is the original Wikimedia
  board physically cropped from 900x1200 to the exact 900x1000 board bounds,
  with the out-of-bounds background and top/bottom coordinate-number artwork
  removed rather than merely hidden by the viewport. The vertical inscriptions
  and exact half-cell-margin 9x10 grid are retained. The background is the
  original Wikimedia asset's exact `#eebb55` (`#eb5`). An original procedural
  beechwood grain is placed beneath the artwork at 40% opacity and magnified
  500% around the board center, exposing only the central portion through the
  SVG viewport. This makes the procedural fibers resolve as wood rather than
  subpixel brushed-metal noise on 4K displays. Its local source rectangle retains
  a centered 5% safety margin before magnification so displaced and convolved
  filter detail reaches every visible edge without filter-boundary artifacts.
  Its filter is monochrome and derives every visible grain pixel from that exact
  background color by applying one shared brightness multiplier to the red,
  green, and blue channels, so the texture introduces no independent hue. The
  grid, marks,
  river lettering, and side inscriptions are composited together at 100% opacity
  so the ink reads as burned into the wood. The grain recipe is adapted from
  Lazur's public-domain
  [wood grain filter pack 4](https://openclipart.org/detail/256780/wood-grain-filter-pack-4),
  retained locally as `public/images/board/svg/158871-wood-grain.svg`: one of
  its sixteen samples
  was converted to neutral luminance structure and evaluated continuously over
  the complete board, avoiding tiling seams and visible repetition. Its
  turbulence is capped at six octaves with approximately 3.5 to 5 pixels per
  finest feature when the 9:10 board fills a 3840x2160 display. This prevents
  unresolvable subpixel grain from being regenerated during board resizing.
  Four inexpensive directional linear gradients and compact perimeter strokes
  add a 5.75-unit micro-bevel outside the playable grid. At the 782-pixel
  Tiantian reference width this resolves to a measured five-pixel profile:
  one dark boundary pixel, a two-pixel light ridge, and a two-pixel inner
  shadow. Bottom and right retain slightly deeper edge shading for top-left
  illumination. A separate low-frequency illumination pass sits above the
  background and grain but below the bevel and ink, so the grid, marks, river
  text, and inscriptions remain unaffected. It was fitted from the Tiantian
  reference after masking the pieces, grid, lettering, grain, and edge bevel:
  the broad elliptical peak is at 53.2%
  across and 43.6% down the board (29 units right and 64 units above center),
  with fitted one-sigma radii of approximately 377 by 352 SVG units. Two radial
  gradients reproduce the central bloom and outer falloff, while a 5% diagonal
  gradient captures the reference's slight top-left to bottom-right bias. It is
  self-contained native SVG geometry with no raster or external asset
  dependency.
- `public/piece/xiangqi-wikipedia/*.svg` comes from the fourteen standard
  Wikimedia pieces retained in the referenced PyChess revision's
  `static/images/pieces/xiangqi/wikim/` directory, renamed to Lixiangqi's
  piece-file contract.

Source description pages:

- <https://commons.wikimedia.org/wiki/File:Xiangqi_board.svg>
- <https://commons.wikimedia.org/wiki/File:Xiangqi_gl1.svg> and the matching
  `ad1`, `al1`, `cd1`, `cl1`, `ed1`, `el1`, `gd1`, `hd1`, `hl1`, `rd1`,
  `rl1`, `sd1`, and `sl1` piece files

The local wood-grain source is an optimized copy of Lazur's Openclipart SVG:
all sixteen filter definitions correspond to the source in the same order.
Openclipart releases its collection under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
