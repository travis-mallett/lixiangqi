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

- `public/piece/default-wood/*.svg` is the default traditional set, adapted from
  PyChess's `ttxqhanzi` pieces. See [design notes](design/default-wood-pieces.md).
  The retired Classic set's Wikimedia glyph outlines are retained only as
  Wudang generation sources in `ui/lib/css/theme/wudang/glyphs.json`.
- `public/piece/xiangqi-international/*.svg` and
  `public/piece/xiangqi-western/*.svg` are unchanged artwork from the
  `2dintl` and `Ka` directories, respectively, at PyChess Variants revision
  [`10f48bc32658f856628da5fb8b3ed723e0e089d6`](https://github.com/gbtami/pychess-variants/tree/10f48bc32658f856628da5fb8b3ed723e0e089d6/static/images/pieces/xiangqi).
  Only the filenames were mapped to Lixiangqi's fourteen-piece asset contract.

Source description pages:

- <https://commons.wikimedia.org/wiki/File:Xiangqi_board.svg>
- <https://commons.wikimedia.org/wiki/File:Xiangqi_gl1.svg> and the matching
  `ad1`, `al1`, `cd1`, `cl1`, `ed1`, `el1`, `gd1`, `hd1`, `hl1`, `rd1`,
  `rl1`, `sd1`, and `sl1` piece files

The local wood-grain source is an optimized copy of Lazur's Openclipart SVG:
all sixteen filter definitions correspond to the source in the same order.
Openclipart releases its collection under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
