# Western Xiangqi pieces

The chariot, horse, elephant, general, cannon, and soldier are traced from the
supplied two-row wooden-piece mockup. The advisor uses the later charcoal shield
reference, including its rim, curved face, and pedestal. The editable
Bezier outlines and shaded planes are in
[`symbols.svg`](../../bin/gen/xiangqi-western/symbols.svg). The source coordinates
refer to the mockup's 1918 × 820 canvas, except the shield, whose paths retain
the 1254 × 1254 reference coordinates inside a scaled group. Each symbol declares
its own 200-unit square viewBox. Both colors share these outlines.

The black and red palettes, wood mounting, and exports are owned by
[`generate.mjs`](../../bin/gen/xiangqi-western/generate.mjs). Run from the root:

```sh
node bin/gen/xiangqi-western/generate.mjs
```

This replaces all 14 faces and both concealed backs in
`public/piece/xiangqi-western/`. Existing catalog paths and preference keys remain
unchanged. No server change or data migration is required.

For separate, transparent SVGs of the symbols and the character-free bases:

```sh
node bin/gen/xiangqi-western/generate.mjs --preview-dir .tmp/western-pieces/symbols
```

## Reference and material

Contours, overlapping planes, ivory tusk, and narrow golden incisions follow
the mockup. Smooth shaded planes retain its depth without surface hatching.
The charcoal finish uses `#272829` ink with a `#484b4d` highlight and `#18191a`
shadow. The warmer red uses `#ad261c` ink, `#cc4832` highlights, and `#801b14`
shadows. Smooth gradients give the symbols a polished lacquer finish; the rings
match their primary ink. The horse and elephant eyes remain transparent cutouts.
This is an editable vector reconstruction, not a pixel-identical
conversion of the raster: the source's irregular texture and small differences
between corresponding red and black silhouettes are not reproduced literally.
The symbols contain no raster images, font glyphs, or external resources.

Each base comes directly from the matching `default-wood` chariot SVG with its
`symbol` group removed. The wood geometry, embedded grain, gradients, and lighting
are retained; only the ring pigment changes. Concealed backs are copied byte for
byte from the matching `default-wood` backs. The original `default-wood` theme is
not modified. Its licensing and provenance are
documented in [default-wood-pieces.md](default-wood-pieces.md).

Symbols align with the raised face center and retain the reference proportions.
Faces and backs use the shared 100-unit canvas and centered 90-unit body. The
small symbol bevel belongs to the carving; piece cast shadows remain owned by
the board renderer.

Render review sheets in a browser with each SVG loaded directly as an image.
Nesting these SVGs in another SVG and rendering that sheet with resvg can omit
their embedded wood grain, even though the individual assets retain it.
