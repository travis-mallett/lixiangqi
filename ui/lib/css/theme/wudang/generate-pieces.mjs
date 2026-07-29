/**
 * Build the standalone Wudang brush-and-seal Xiangqi set.
 *
 * The established Xiangqi glyph paths are retained for competitive
 * readability. This generator remounts those paths on theme-owned soot and
 * cinnabar pigment discs; it never writes to the source piece package.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const sourceDir = path.join(root, 'public', 'piece', 'xiangqi-wikipedia');
const outputDir = path.join(root, 'public', 'piece', 'xiangqi-wudang');
const pieces = ['rP', 'bP', 'rB', 'bB', 'rN', 'bN', 'rR', 'bR', 'rA', 'bA', 'rC', 'bC', 'rK', 'bK'];

const palette = {
  red: {
    high: '#b1564b',
    mid: '#963f36',
    low: '#6e2b25',
    edge: '#59211d',
  },
  black: {
    high: '#2e3c3e',
    mid: '#152022',
    low: '#090f10',
    edge: '#050a0b',
  },
};

const defs = colors => `<defs>
  <radialGradient id="pigment" cx=".34" cy=".27" r=".76">
    <stop offset="0" stop-color="${colors.high}"/>
    <stop offset=".56" stop-color="${colors.mid}"/>
    <stop offset="1" stop-color="${colors.low}"/>
  </radialGradient>
  <filter id="edge" x="-8%" y="-8%" width="116%" height="116%">
    <feTurbulence type="fractalNoise" baseFrequency=".055" numOctaves="2" seed="23" result="rough"/>
    <feDisplacementMap in="SourceGraphic" in2="rough" scale="1.15" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
</defs>`;

const mount = colors => `<ellipse cx="50" cy="53" rx="44.5" ry="45" fill="#071011" opacity=".26"/>
<circle cx="50" cy="50" r="47.2" fill="url(#pigment)" stroke="${colors.edge}" stroke-width="3.4" stroke-dasharray="117 7 38 4 73 8 31 5" stroke-linecap="round" filter="url(#edge)"/>
<circle cx="50" cy="50" r="42.8" fill="none" stroke="#f0ece2" stroke-opacity=".18" stroke-width="1.5" stroke-dasharray="92 4 44 8 69 5 30 7"/>
<g stroke="#f0ece2" stroke-opacity=".075" stroke-width="2.1" stroke-linecap="round">
  <line x1="19" y1="22" x2="56" y2="8"/>
  <line x1="81" y1="77" x2="45" y2="92"/>
</g>`;

await mkdir(outputDir, { recursive: true });

for (const piece of pieces) {
  const source = path.join(sourceDir, `${piece}.svg`);
  const output = path.join(outputDir, `${piece}.svg`);
  const colors = piece.startsWith('r') ? palette.red : palette.black;
  let svg = await readFile(source, 'utf8');

  svg = svg
    .replace(/<circle\b[^>]*\/>/g, '')
    .replace(/\sfill="#c00"/g, '')
    .replace(
      /^(<svg\b[^>]*>)/,
      `$1<title>Wudang ${piece} Xiangqi piece</title>${defs(colors)}${mount(colors)}`,
    )
    .replace(
      /<path\b/,
      '<path fill="#f0ece2" stroke="#0d1516" stroke-opacity=".24" stroke-width=".3" paint-order="stroke fill"',
    );

  await writeFile(output, `${svg}\n`, 'utf8');
}

process.stdout.write(`Generated ${pieces.length} Wudang piece assets in ${outputDir}\n`);
