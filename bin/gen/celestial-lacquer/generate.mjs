// ImageGen owns every painted pixel. This script only extracts, sizes and packages
// the approved raster artwork for the shared 100-unit / 90-unit piece contract.
import { Resvg } from '@resvg/resvg-js';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../', import.meta.url);
const check = process.argv.includes('--check');
const key = 'celestial-lacquer';
const roles = ['general', 'advisor', 'elephant', 'horse', 'chariot', 'cannon', 'soldier', 'banner'];
const codes = ['K', 'A', 'B', 'N', 'R', 'C', 'P', 'M', 'K3'];
const sheets = {
  red: { prefix: 'r', glyphs: [...'帥仕相馬車炮兵旗蜀'] },
  black: { prefix: 'b', glyphs: [...'將士象馬車砲卒旗魏'] },
  green: { prefix: 'g', glyphs: [...'吳仕向馬車礮勇', null] },
  backs: { prefix: '', glyphs: [null, null, null], rows: 1 },
};
const path = code => `piece/${key}/${code}.svg`;
const read = name => readFileSync(new URL(name, root));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function save(name, bytes) {
  const url = new URL(name, root);
  const buffer = Buffer.from(bytes);
  if (check) {
    const actual = readFileSync(url);
    const matches = name.endsWith('.json')
      ? JSON.stringify(JSON.parse(actual)) === JSON.stringify(JSON.parse(buffer))
      : actual.equals(buffer);
    if (!matches) throw Error(`Stale Celestial Lacquer output: ${name}`);
  } else {
    mkdirSync(dirname(fileURLToPath(url)), { recursive: true });
    writeFileSync(url, buffer);
  }
}
const data = (bytes, type = 'png') => `data:image/${type};base64,${Buffer.from(bytes).toString('base64')}`;
const svg = (width, height, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
const images = new Map();
const receipt = {
  source: {},
  pieces: {},
  method: 'ImageGen raster extraction; no recoloring or replacement lettering.',
};

for (const [color, { prefix, glyphs, rows = 3 }] of Object.entries(sheets)) {
  const source = `bin/gen/celestial-lacquer/source/${color}.png`;
  const bytes = read(source);
  receipt.source[source] = sha256(bytes);
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (Math.abs(width / 3 - height / rows) > 1) throw Error(`Expected equal atlas cells: ${source}`);
  const uri = data(bytes);
  const pixels = new Resvg(
    svg(width, height, `<image width="${width}" height="${height}" href="${uri}"/>`),
  ).render().pixels;
  const cell = width / 3;
  const alpha = (x, y) => pixels[(y * width + x) * 4 + 3];
  for (const [index, glyph] of glyphs.entries()) {
    const col = index % 3,
      row = Math.floor(index / 3);
    const cx = Math.floor((col + 0.5) * cell),
      cy = Math.floor((row + 0.5) * cell);
    // Central opaque runs measure the actual disc, ignoring disconnected fringe
    // pixels in transparent gutters. Normalization preserves all interior paint.
    let left = cx,
      right = cx,
      top = cy,
      bottom = cy;
    while (left > col * cell && alpha(left - 1, cy) > 250) left--;
    while (right < (col + 1) * cell - 1 && alpha(right + 1, cy) > 250) right++;
    const middle = Math.round((left + right) / 2);
    while (top > row * cell && alpha(middle, top - 1) > 250) top--;
    while (bottom < (row + 1) * cell - 1 && alpha(middle, bottom + 1) > 250) bottom++;
    const w = right - left + 1,
      h = bottom - top + 1;
    if (Math.min(w, h) < cell * 0.8 || Math.max(w, h) > cell * 0.98)
      throw Error(`Unexpected disc bounds: ${color}/${index}: ${[left, top, w, h]}`);
    const code =
      color === 'backs'
        ? `${['r', 'b', 'g'][index]}Back`
        : glyph === null
          ? 'Back'
          : `${prefix}${codes[index]}`;
    // A circular alpha cut normalizes the outermost antialiasing/fringe only.
    // The artwork is not redrawn, recolored, or overlaid with font-generated text.
    const cropped = svg(
      384,
      384,
      `<defs><clipPath id="disc"><circle cx="192" cy="192" r="192"/></clipPath></defs>` +
        `<g clip-path="url(#disc)"><image x="${(-left * 384) / w}" y="${(-top * 384) / h}" width="${(width * 384) / w}" height="${(height * 384) / h}" preserveAspectRatio="none" href="${uri}"/></g>`,
    );
    const png = new Resvg(cropped).render().asPng();
    const label = glyph ?? 'Concealed';
    const output =
      svg(
        100,
        100,
        `<title>Celestial Lacquer — ${label}</title>` +
          `<image data-piece-body="true" x="5" y="5" width="90" height="90" href="${data(png)}"/>`,
      ) + '\n';
    save(`public/${path(code)}`, output);
    images.set(code, data(new Resvg(output, { fitTo: { mode: 'width', value: 384 } }).render().asPng()));
    receipt.pieces[code] = {
      glyph,
      sheet: color,
      cell: index,
      crop: [left, top, w, h],
      sha256: sha256(output),
    };
  }
}

const faces = (prefix, count = 8) =>
  Object.fromEntries(roles.slice(0, count).map((role, i) => [role, path(`${prefix}${codes[i]}`)]));
const entry = {
  key,
  name: 'Celestial Lacquer',
  category: 'traditional',
  variants: {
    xiangqi: {
      back: { red: path('rBack'), black: path('bBack') },
      faces: { red: faces('r'), black: faces('b') },
    },
    threeKingdoms: {
      back: { red: path('rBack'), black: path('bBack'), green: path('gBack') },
      faces: {
        red: { ...faces('r', 7), general: path('rK3') },
        black: { ...faces('b', 7), general: path('bK3') },
        green: faces('g', 7),
      },
    },
  },
};
const catalog = JSON.parse(read('ui/board/src/catalog.json'));
const index = catalog.pieceSets.findIndex(p => p.key === key);
if (check) {
  if (JSON.stringify(catalog.pieceSets[index]) !== JSON.stringify(entry))
    throw Error('Stale lacquer catalog entry');
} else {
  if (index < 0) catalog.pieceSets.push(entry);
  else catalog.pieceSets[index] = entry;
  save('ui/board/src/catalog.json', JSON.stringify(catalog, null, 2) + '\n');
}
save('bin/gen/celestial-lacquer/manifest.json', JSON.stringify(receipt, null, 2) + '\n');

// Render real shipped assets, not an ImageGen approximation of a playing board.
const board = read('doc/design/cracked-stone/preview.png');
let boardBody = `<image width="900" height="1000" href="${data(board)}"/>`;
const shadow = data(read('public/piece/effects/xiangqi-rest-shadow.png'));
function place(code, file, rank) {
  boardBody += `<image x="${58 + file * 98 - 98}" y="${59 + rank * 98 - 98}" width="196" height="196" href="${shadow}"/>`;
  boardBody += `<image x="${58 + file * 98 - 49}" y="${59 + rank * 98 - 49}" width="98" height="98" href="${images.get(code)}"/>`;
}
for (const [prefix, rank, cannonRank, soldierRank] of [
  ['b', 0, 2, 3],
  ['r', 9, 7, 6],
]) {
  ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'].forEach((code, file) => place(prefix + code, file, rank));
  [1, 7].forEach(file => place(prefix + 'C', file, cannonRank));
  [0, 2, 4, 6, 8].forEach(file => place(prefix + 'P', file, soldierRank));
}
save('doc/design/celestial-lacquer/board-preview.png', new Resvg(svg(900, 1000, boardBody)).render().asPng());
let sheet = '<rect width="1440" height="1160" fill="#676e68"/>';
[...images].forEach(([code, uri], i) => {
  const x = 15 + (i % 9) * 158,
    y = 18 + Math.floor(i / 9) * 280;
  sheet += `<image x="${x}" y="${y}" width="150" height="150" href="${uri}"/>`;
  sheet += `<image x="${x + 35}" y="${y + 175}" width="48" height="48" href="${uri}"/>`;
  sheet += `<image x="${x + 91}" y="${y + 183}" width="32" height="32" href="${uri}"/>`;
  sheet += `<text x="${x + 75}" y="${y + 249}" fill="white" text-anchor="middle" font-size="16" font-family="Arial">${code}</text>`;
});
save('doc/design/celestial-lacquer/contact-sheet.png', new Resvg(svg(1440, 1160, sheet)).render().asPng());
console.log(`${check ? 'Verified' : 'Packaged'} 29 ImageGen pieces, catalog and review previews.`);
