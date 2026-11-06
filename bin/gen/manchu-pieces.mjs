import { JSDOM } from 'jsdom';
// Run from the repository root: node bin/gen/manchu-pieces.mjs
import { readFileSync, writeFileSync } from 'node:fs';

import { lettering } from './piece-lettering.mjs';

const parse = source => new JSDOM(source, { contentType: 'image/svg+xml' }).window.document;
const glyphs = parse(readFileSync(new URL('./manchu/glyphs.svg', import.meta.url), 'utf8'));
const catalogFile = new URL('../../ui/board/src/catalog.json', import.meta.url);
const catalog = JSON.parse(readFileSync(catalogFile, 'utf8'));
const traditional = new Set(['default-wood', 'xiangqi-wudang', 'xiangqi-paper-traditional']);
// A single banner silhouette for pictorial sets, fitted inside each existing piece face.
const flag =
  '<path d="M28 78V18M29 20C43 10 55 32 75 20V53C55 65 43 43 29 53M18 80H43" ' +
  'fill="none" stroke="currentColor" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>';

for (const set of catalog.pieceSets)
  for (const [color, prefix] of [
    ['red', 'r'],
    ['black', 'b'],
  ]) {
    const source = readFileSync(
      new URL(`../../public/piece/${set.key}/${prefix}R.svg`, import.meta.url),
      'utf8',
    );
    let result;
    if (traditional.has(set.key)) result = lettering(source, set.key, 'banner', glyphs, 'manchu-symbol');
    else {
      const doc = parse(source);
      if (set.key === 'xiangqi-western') {
        const symbol = doc.getElementById('symbol');
        symbol.setAttribute('viewBox', '0 0 100 100');
        symbol.innerHTML = `<g filter="url(#carved-edge)">${flag}</g>`;
      } else if (set.key === 'xiangqi-international') {
        const body = doc.querySelector('[data-piece-body]');
        const group = body.parentElement;
        const ink = body.getAttribute('stroke');
        // Snapshot the live collection before removing its old artwork.
        for (const child of Array.from(group.children)) if (child !== body) child.remove();
        const symbol = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
        symbol.setAttribute('transform', 'translate(14 14) scale(.64)');
        symbol.setAttribute('color', ink);
        symbol.innerHTML = flag;
        group.append(symbol);
      } else throw new Error(`Missing Banner artwork for ${set.key}`);
      result = doc.documentElement.outerHTML + '\n';
      doc.defaultView.close();
    }
    const path = `piece/${set.key}/${prefix}M.svg`;
    writeFileSync(new URL(`../../public/${path}`, import.meta.url), result);
    set.variants.xiangqi.faces[color].banner = path;
  }
glyphs.defaultView.close();
writeFileSync(catalogFile, JSON.stringify(catalog, null, 2) + '\n');
