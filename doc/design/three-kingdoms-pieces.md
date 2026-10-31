# Three Kingdoms character pieces

`bin/gen/three-player-pieces.mjs` owns the green pieces and kingdom generals.
Run it from the repository root with Node and the installed project dependencies:

```sh
node bin/gen/three-player-pieces.mjs
```

The generator retains each set's original body, face, rings, texture, lighting,
and palette. Advisor, horse, and chariot outlines are recolored directly from
the original red pieces. The six new inscriptions are 蜀, 魏, 吳, 向, 礮, and 勇.
The international and western sets continue to use their existing symbols.

## Lettering

The original wood and paper assets contain customized, rounded clerical
outlines, rather than editable text with a recorded font name. The additional
inscriptions use **FZLiShu-S01 / 方正隶书_GBK** as the clerical outline source.
This is a style reconstruction, not a claim that their customized contours are
identical to that font. Wood and paper have separate aspect, size, and weight
calibrations. The existing red and black contours are preserved.

Wudang uses **TW-Kai / 全字庫正楷體**. Its original outlined letters are heavier
than the plain font. The new glyphs use a 24-font-unit rounded contour stroke,
calibrated against the original piece silhouettes, and retain the translucent
dark edge around the ivory lettering.

| Set                       | Center in artwork coordinates | Maximum ink box | Vertical aspect | Contour weight (font units) | Maximum ink radius |
| ------------------------- | ----------------------------- | --------------- | --------------- | --------------------------- | ------------------ |
| default-wood              | 45.585438, 42.485431          | 52 × 43         | 1.3             | 3                           | 29                 |
| xiangqi-paper-traditional | 46, 46                        | 55 × 43         | 1.2             | 0                           | 36                 |
| xiangqi-wudang            | 50, 50                        | 64 × 64         | 1               | 24                          | 39.8               |

These coordinates precede the shared `piece-artwork` body transform. Wood ink is
centered on the raised face, which sits above the body center. An old character's
individual transform must be removed when replacing it.

Fitting includes the painted contour weight. Both the rectangular ink box and
the actual radial extent constrain size, so diagonal strokes cannot reach the
ring even when their bounding box fits. The radial measurement uses a 512-pixel
authoring render with a conservative half-pixel allowance. Output consists only
of fixed SVG paths; neither clients nor servers perform this measurement.

## Outline authoring and attribution

The twelve fixed outlines are committed in
`bin/gen/three-player-xiangqi/piece-glyphs.svg`. No font program is distributed,
and normal regeneration needs no installed fonts. To intentionally revise these
outlines, use fontTools and the two source fonts:

```sh
python bin/gen/three-player-xiangqi/outline-pieces.py /path/to/FZLSK.TTF /path/to/TW-Kai-98_1.ttf
```

- Clerical source: Founder, [方正隶书](https://www.foundertype.com/index.php/FontInfo/index/id/141).
  Font SHA-256: `78b1dacc8d4e88b6d540dc4de9372610e340e36a6baf6a6e4509183195e13f83`.
- Kai source: 數位發展部，[CNS11643中文標準交換碼全字庫網站](https://www.cns11643.gov.tw),
  [Government Open Data License v1.0](https://www.cns11643.gov.tw/pageView.jsp?ID=59).
  Font SHA-256: `d5e8d7d8743c5cf816bdeb393a443f65105a8130266a04c19560e1d3401b28f0`.

`ui/board/tests/pieceLettering.test.ts` verifies the final transformed ink center,
size, inscriptions, and circular clearance for all eighteen replacement assets.
Visual review also covers the original and new pieces at 32, 48, 64, and 100 pixels.
No runtime dependency, data migration, or deployment change is required.
