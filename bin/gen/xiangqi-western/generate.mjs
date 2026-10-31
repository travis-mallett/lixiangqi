import { JSDOM } from 'jsdom';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const output = path.join(root, 'public/piece/xiangqi-western');
const source = new JSDOM(await readFile(path.join(here, 'symbols.svg'), 'utf8'), {
  contentType: 'image/svg+xml',
});
const reference = source.window.document;
const roles = ['R', 'N', 'B', 'A', 'K', 'C', 'P'];
// The source sheet previews charcoal; the red finish shares its light direction.
const redFinish = { light: '#cc4832', mid: '#b93224', ink: '#ad261c', dark: '#801b14' };
const serialize = svg =>
  `${svg
    .replace(/\r\n/g, '\n')
    .replace(/[\t ]+$/gm, '')
    .trim()}\n`;

function symbolArtwork(symbol) {
  return `<g filter="url(#carved-edge)">${symbol.innerHTML}</g>`;
}
const previewIndex = process.argv.indexOf('--preview-dir');
const previewDir = previewIndex === -1 ? undefined : process.argv[previewIndex + 1];
if (previewIndex !== -1 && (!previewDir || previewDir.startsWith('--')))
  throw new Error('--preview-dir requires an output directory');
if (previewDir) await mkdir(previewDir, { recursive: true });
await mkdir(output, { recursive: true });

try {
  for (const color of ['b', 'r']) {
    // Use the actual face, not default-wood's separately decorated concealed back.
    const base = new JSDOM(await readFile(path.join(root, `public/piece/default-wood/${color}R.svg`)), {
      contentType: 'image/svg+xml',
    });
    try {
      const document = base.window.document;
      const svg = document.documentElement;
      const character = document.querySelector('#symbol');
      const ring = document.querySelector('#ring');
      if (!character || !ring || !document.querySelector('[data-piece-body]'))
        throw new Error(`Unexpected default-wood ${color}R structure`);
      character.remove();
      const ink = color === 'r' ? redFinish.ink : reference.documentElement.getAttribute('color');
      if (!/^#[0-9a-f]{6}$/i.test(ink ?? '')) throw new Error('Missing lacquer ink color');
      ring.setAttribute('stroke', ink);
      const blank = serialize(svg.outerHTML);
      await copyFile(
        path.join(root, `public/piece/default-wood/${color}Back.svg`),
        path.join(output, `${color}Back.svg`),
      );
      if (previewDir) await writeFile(path.join(previewDir, `${color}-base.svg`), blank);

      svg.setAttribute('color', ink);
      const material = document.importNode(reference.querySelector('defs'), true);
      for (const stop of material.querySelectorAll('[data-tone]')) {
        const tone = stop.getAttribute('data-tone');
        if (!Object.hasOwn(redFinish, tone)) throw new Error(`Unknown lacquer tone: ${tone}`);
        if (color === 'r') stop.setAttribute('stop-color', redFinish[tone]);
        stop.removeAttribute('data-tone');
      }
      svg.append(material);
      for (const role of roles) {
        const sourceSymbol = reference.getElementById(role);
        if (!sourceSymbol) throw new Error(`Missing symbol ${role}`);
        const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        symbol.setAttribute('id', 'symbol');
        symbol.setAttribute('viewBox', sourceSymbol.getAttribute('viewBox'));
        // The reference face radius is 112 px; default-wood's is 36.45 units.
        // Keep reference proportions and align to the raised face, not the body.
        symbol.setAttribute('x', '16.98');
        symbol.setAttribute('y', '14.43');
        symbol.setAttribute('width', '65.1');
        symbol.setAttribute('height', '65.1');
        symbol.innerHTML = symbolArtwork(sourceSymbol);
        svg.append(symbol);
        await writeFile(path.join(output, `${color}${role}.svg`), serialize(svg.outerHTML));
        if (previewDir) {
          const isolated = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" color="${ink}" viewBox="${sourceSymbol.getAttribute('viewBox')}">${material.outerHTML}${symbolArtwork(sourceSymbol)}</svg>`;
          await writeFile(path.join(previewDir, `${color}${role}-symbol.svg`), serialize(isolated));
        }
        symbol.remove();
      }
    } finally {
      base.window.close();
    }
  }
} finally {
  source.window.close();
}
console.log(`Generated 14 western faces and copied two unchanged default-wood backs to ${output}`);
