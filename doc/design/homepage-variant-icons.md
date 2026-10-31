# Homepage variant icons

The six transparent 224 × 224 PNGs in `public/images/homepage/variants/` are
generated illustrations, displayed at 112 CSS pixels by the lobby. They use
the existing asset filenames and were regenerated with the built-in ImageGen
tool to match `lixiangqi-default.svg` and the `default-wood` pieces.

Reference inputs: the previous icon (composition), the rendered default board
(material and grid), `default-wood/rK.svg` (piece finish), and
`default-wood/rBack.svg` (concealed-piece decoration).

## Generation prompts

Shared direction: edit the original composition into a polished small homepage
icon matching the reference board and pieces. Keep a nearly top-down view,
square transparent canvas, clean edge margin, and board occupying about 90%
of the canvas. Use softly textured pale honey-tan wood, muted brown grid,
smooth peach-gold discs, broad flat faces, and opaque ink rings.
Red ink is #933e29, charcoal #3b3938, and green #2c663e.
Use soft upper-left illumination, shallow bevels, and subtle contact shadows.
Avoid saturated orange varnish, heavy outlines, ornate frames, shiny gold rims,
labels, and extra objects.

- **jieqi:** Preserve the arrangement of face-down discs and one revealed charcoal 將 disc on a small palace board. Concealed discs use the geometric red rim of reference 4.
- **banqi:** Preserve a 4 by 4 board of concealed discs with one revealed red 兵 piece. All concealed discs use pale wood and geometric red rim as reference 4, never dark red faces.
- **manchu:** Preserve three charcoal 車 馬 炮 pieces across the top and one larger red 俥 piece at bottom on a palace board.
- **mini-xiangqi:** Preserve the compact empty rectangular grid with palace diagonals, no pieces.
- **three-player:** Preserve the hexagonal three-sector board with charcoal 魏 at top, red 蜀 lower left, green 吳 lower right. Green ink #2c663e.
- **other:** Preserve three overlapping miniature wooden boards: square grid at left, hexagonal three-sector at right, square grid in front. No pieces.

The generated PNGs were downsampled with the repository's existing Resvg
renderer, retaining alpha. No runtime image generation or new dependencies are
required. The Jieqi-specific saturation/brightness compensation was removed;
the shared disabled-card treatment remains.
