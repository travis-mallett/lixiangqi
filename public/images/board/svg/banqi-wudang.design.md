# Wudang Banqi board artwork

## Assets

- `banqi-wudang.svg`: self-contained board, with the generated PNG embedded.
- `banqi-wudang-background.png`: generated material with unchanged image data and Inkscape-compatible metadata.
- Style reference: `Wudang Background.png` and `xiangqi-wudang.svg`, both unchanged.

The background was created with the **built-in image_gen tool**, using the
original Wudang background as a style reference. No CLI/API fallback was used.
The raster supplies the distressed gold-leaf rim, organic charcoal border,
rice-paper texture, and ink-wash mountains. There is no SVG fret/knot border,
river, lettering, logo, or playing piece.

## Geometry and styling

Use the shared Banqi coordinate specification in
[banqi-default.design.md](banqi-default.design.md) for placement and input:

- Canvas: 496 × 896, `viewBox="0 0 496 896"`.
- Playing field: (48,48) to (448,848), 4 columns × 8 rows.
- Cell size: 100 × 100; all four grid margins: 48.
- Piece centers: `(98 + 100c, 98 + 100r)`, for column 0…3 and row 0…7.
- Plain playing-frame centerline: (40,40), width 416, height 816.
- Wudang grid stroke: 3; plain frame stroke: 6.
- Wudang ink: `#111111`, with group opacity `0.82990654`.
- No blur, engraving filter, or extra vector decoration.

The plain black playing-field frame is retained as in the original Wudang
board. The ornamental outer border is entirely part of the generated image.
All vector coordinates are final board units, with no scaling transform.

The generator returned a **948 × 1659** PNG (4:7), despite the requested
31:56 size. The complete image is mapped to the 496 × 896 SVG canvas using
`preserveAspectRatio="none"`. This modest aspect adjustment applies only to
the background: the vector grid and cells remain exactly square. No crop
removes any part of the gold/ink frame, and the original generated pixels
remain intact in both the source PNG and embedded image.

## Inkscape compatibility

The generated PNG's `caBX` (C2PA provenance) metadata chunk caused Inkscape to
display its missing-image red X. Removing only that ancillary chunk fixes the
render. The PNG header, compressed `IDAT` bytes, and decoded pixel scanlines
remain identical; the SVG embeds the same cleaned PNG as the source file.
The original generated file is retained in the image-generation output folder.
Keep this compatibility cleanup when replacing the background, and verify an
actual Inkscape export in addition to browser rendering.

## Generation prompt

The exact prompt used with `Wudang Background.png` as the reference follows.

```text
Use case: stylized-concept, production game-board background asset.
Input image 1 is the original LiXiangQi Wudang BACKGROUND, a style/material reference. Create a NEW portrait Banqi background derived faithfully from it, not a screenshot or mockup.
Output composition: exact 31:56 portrait aspect ratio, ideally 992 x 1792 pixels. Full flat front-on rectangular board fills the entire image. No perspective, no surrounding scene, no drop shadow.
Preserve the reference's warm ivory aged rice-paper texture, charcoal Chinese ink-wash mountain brushwork concentrated at upper-left and lower-right, restrained gray/taupe washes, and especially the irregular deep charcoal ink border with its narrow distressed gold-leaf inner rim. Match the reference's natural painted surfaces, restrained palette, and gold patina. Recompose the mountains for the taller, narrower canvas instead of stretching the reference. Keep the central playing area pale and open.
Border layout is essential: make a complete gold/ink frame on ALL FOUR sides, with equal physical widths at top, bottom, left and right. On the requested 992 x 1792 canvas, place the fine gold rim about 44 pixels inside each edge; the rough charcoal frame mainly occupies the outer 12–56 pixels. Corners have organic rounded brush ends like the reference, no geometric fret knots. At 96 pixels inward from every edge the playing grid will begin later, so leave that area clear of border ornaments. Do not draw the playing grid.
Only the decorative material background is generated: NO grid lines, NO straight playing-field rectangles inside the gold rim, NO pieces, NO Chinese characters, NO text, logos, seals, UI, or watermarks. No added Greek-key or square-knot border. The existing SVG Banqi grid will be overlaid afterward.
Generate one complete high-quality opaque background image, retaining the reference's gray-taupe material around the outermost ragged ink edge.
```
