/**
 * Build the flat Paper Xiangqi piece set from portable brush glyph outlines.
 *
 * The photographed reference uses the shared 車, 馬, 士, and 炮 faces for both
 * colors. The paths are extracted from the OFL-licensed Masa Font Medium and
 * normalized here to one common visual size. This intentionally adds no
 * texture, bevel, shadow, or engraved-letter treatment.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const outputDir = path.join(root, 'public', 'piece', 'xiangqi-paper');
const glyphSource = JSON.parse(await readFile(path.join(here, 'masa-glyphs.json'), 'utf8'));
const targetGlyphBounds = {
  車: [70.5, 72.5],
  馬: [68.5, 72.5],
  相: [70, 72.5],
  象: [65, 72.5],
  士: [72.5, 65],
  帥: [72.5, 70.5],
  將: [72.5, 72.5],
  炮: [72.5, 65],
  兵: [72.5, 68.75],
  卒: [69, 72.5],
};

if (glyphSource.postScriptName !== 'MasaFont-Medium' || glyphSource.version !== '2.1') {
  throw new Error('Unexpected Paper Xiangqi glyph source');
}

const palette = {
  red: { background: '#cb966d', ink: '#a12220', ringWidth: 1.9 },
  black: { background: '#969875', ink: '#1a1911', ringWidth: 2.2 },
};

// Every role reaches the same 72.5-unit visual size. The secondary dimensions
// correct the font's unusually narrow 車/卒 and shallow 士/炮 contours to match
// the photographed pieces. Offsets remain explicit so optical centering can be
// audited per glyph.
const pieces = {
  rR: { glyph: '車', label: 'red chariot', offset: [0.45, 1.05] },
  rN: { glyph: '馬', label: 'red horse', offset: [-0.65, 0.9] },
  rB: { glyph: '相', label: 'red elephant', offset: [-0.55, 0.05] },
  rA: { glyph: '士', label: 'red advisor', offset: [-0.05, -0.4] },
  rK: { glyph: '帥', label: 'red general', offset: [0.4, 0.45] },
  rC: { glyph: '炮', label: 'red cannon', offset: [-0.05, 0.4] },
  rP: { glyph: '兵', label: 'red soldier', offset: [-0.15, -1.45] },
  bR: { glyph: '車', label: 'black chariot', offset: [0.45, 1.05] },
  bN: { glyph: '馬', label: 'black horse', offset: [-0.65, 0.9] },
  bB: { glyph: '象', label: 'black elephant', offset: [2.9, 0.3] },
  bA: { glyph: '士', label: 'black advisor', offset: [-0.05, -0.4] },
  bK: { glyph: '將', label: 'black general', offset: [0.65, 0.4] },
  bC: { glyph: '炮', label: 'black cannon', offset: [-0.05, 0.4] },
  bP: { glyph: '卒', label: 'black soldier', offset: [-0.45, 1.55] },
};

if (Object.keys(pieces).length !== 14) throw new Error('Paper Xiangqi requires exactly 14 roles');

function renderPiece(name, piece) {
  const color = name.startsWith('r') ? palette.red : palette.black;
  const [offsetX, offsetY] = piece.offset;
  const glyph = glyphSource.glyphs[piece.glyph];
  if (!glyph) throw new Error(`Missing ${piece.glyph} glyph outline`);

  const [minX, minY, maxX, maxY] = glyph.bounds;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const [targetWidth, targetHeight] = targetGlyphBounds[piece.glyph];
  const scaleX = targetWidth / (maxX - minX);
  const scaleY = targetHeight / (maxY - minY);

  return `<svg height="100" viewBox="-6 -6 112 112" width="100" xmlns="http://www.w3.org/2000/svg">
  <title>Paper ${piece.label} Xiangqi piece</title>
  <circle cx="50" cy="50" fill="${color.background}" r="48.5"/>
  <circle cx="50" cy="50" fill="none" r="41" stroke="${color.ink}" stroke-width="${color.ringWidth}"/>
  <path d="${glyph.path}" fill="${color.ink}" transform="translate(${50 + offsetX} ${50 + offsetY}) scale(${scaleX} ${-scaleY}) translate(${-centerX} ${-centerY})"/>
</svg>
`;
}

await mkdir(outputDir, { recursive: true });

for (const [name, piece] of Object.entries(pieces)) {
  const output = renderPiece(name, piece);
  await writeFile(path.join(outputDir, `${name}.svg`), output, 'utf8');
}

process.stdout.write(`Generated ${Object.keys(pieces).length} Paper Xiangqi piece assets in ${outputDir}\n`);
