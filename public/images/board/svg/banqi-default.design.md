# Banqi default wood board specification

`banqi-default.svg` is a standalone artwork asset, not a registered playable variant.
It retains the embedded wood material from `lixiangqi-default.svg`.

## Geometry

- Canvas: 496 × 896, `viewBox="0 0 496 896"`.
- Playing field: (48,48) to (448,848), four columns and eight rows.
- Cells: 100 × 100; piece centers: `(98 + 100c, 98 + 100r)`.
- Grid stroke: 3 units, matching the parent per 100-unit cell.
- Playing frame: `(40,40,416,816)`, stroke 6, offset 8 from the grid.
- Ink: `#5b2712`, group opacity `0.351560395`, without engraving.

The parent board owns the style. The former recessed grid, heavy frame, and
fret decorations have been removed. Engraving on the parent's lettering does
not apply to its grid. Paper and Wudang use their own parent frame and ink;
tournament has no extra frame. Wudang's ornamental rim remains in its raster
background.

## Regeneration and verification

Run from the repository root:

```sh
node bin/gen/banqi-board-styles.mjs
node --test bin/gen/board-theme.test.mjs
```

The synchronizer preserves embedded materials and cell geometry, and reads
ink, opacity, stroke widths, and frame offsets from the current parent SVGs
through `bin/gen/board-theme.mjs`. All lengths are scaled relative to cell
size rather than canvas size. Banqi has 100-unit cells; mini and three-player
boards have 98-unit piece canvases.

## Renderer contract

A future cell-board definition uses four columns, eight rows, and
`frame: { cellSize: 100, marginX: 98, marginY: 98 }`. These margins locate the
first piece center, not the outer grid boundary. The renderer includes half
a cell around outer piece centers. Do not pass 48 as the frame margin.

Grid IDs are `banqi-grid`, `banqi-grid-bounds`, `banqi-grid-columns`, and
`banqi-grid-rows`. Framed themes also have `banqi-playing-frame`. The SVG is
self-contained and does not require external images or fonts.
