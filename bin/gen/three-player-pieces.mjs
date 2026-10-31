import { Resvg } from '@resvg/resvg-js';
import { JSDOM } from 'jsdom';
// Reuse each set's original vector geometry and material; recolor only its red ink.
// Run from the repository root: node bin/gen/three-player-pieces.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const parse = source => new JSDOM(source, { contentType: 'image/svg+xml' }).window.document;
const glyphs = parse(
  readFileSync(new URL('./three-player-xiangqi/piece-glyphs.svg', import.meta.url), 'utf8'),
);
const chineseSets = new Set(['default-wood', 'xiangqi-wudang', 'xiangqi-paper-traditional']);

// These coordinates belong to the artwork, before the shared piece-body transform.
// Fit the new ink once. The original symbol's transform is specific to that old
// character, so it must never wrap a replacement glyph.
const letteringStyles = {
  'default-wood': {
    family: 'lishu',
    center: [45.585438, 42.485431],
    box: [52, 43],
    radius: 29,
    aspect: 1.3,
    weight: 3,
  },
  'xiangqi-paper-traditional': {
    family: 'lishu',
    center: [46, 46],
    box: [55, 43],
    radius: 36,
    aspect: 1.2,
    weight: 0,
  },
  'xiangqi-wudang': { family: 'kai', center: [50, 50], box: [64, 64], radius: 39.8, aspect: 1, weight: 24 },
};

function inkRadius(artwork, bounds) {
  // A rectangular fit alone is insufficient for a circular face: wide diagonal
  // strokes can still collide with its ring. Measure painted ink at authoring
  // time, with a conservative half-pixel allowance. The output stays pure SVG.
  const size = 512;
  const { x, y, width, height } = bounds;
  const pixels = new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
      `viewBox="${x} ${y} ${width} ${height}" preserveAspectRatio="none">${artwork}</svg>`,
    { font: { loadSystemFonts: false } },
  ).render().pixels;
  let radius = 0;
  for (let row = 0; row < size; row++)
    for (let col = 0; col < size; col++)
      if (pixels[(row * size + col) * 4 + 3])
        radius = Math.max(
          radius,
          Math.hypot(((col + 0.5) / size - 0.5) * width, ((row + 0.5) / size - 0.5) * height),
        );
  return radius + Math.hypot(width, height) / (2 * size);
}

function lettering(source, set, name) {
  const doc = parse(source);
  const style = letteringStyles[set];
  const template = glyphs.getElementById(`${style.family}-${name}`);
  if (!template) throw new Error(`Missing ${style.family} lettering for ${name}`);
  const glyph = doc.importNode(template, true);
  glyph.removeAttribute('id');
  const wrapper = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
  wrapper.id = 'three-kingdoms-symbol';
  wrapper.setAttribute('aria-label', glyph.getAttribute('aria-label'));
  wrapper.append(glyph);
  const path = glyph.querySelector('path');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', style.weight);
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('paint-order', 'stroke fill');
  // Include the weight when fitting; otherwise dense glyphs can touch the ring.
  const artwork = `<g transform="scale(1 ${style.aspect})">${glyph.outerHTML}</g>`;
  const measured = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 2 2">${artwork}</svg>`, {
    font: { loadSystemFonts: false },
  }).getBBox();
  if (!measured) throw new Error(`Empty ${set}/${name} lettering`);
  const scale = Math.min(
    style.box[0] / measured.width,
    style.box[1] / measured.height,
    style.radius / inkRadius(artwork, measured),
  );
  wrapper.setAttribute(
    'transform',
    `translate(${style.center.join(' ')}) scale(${scale}) ` +
      `translate(${-measured.x - measured.width / 2} ${-measured.y - measured.height / 2}) ` +
      `scale(1 ${style.aspect})`,
  );
  let ink;
  if (set === 'default-wood') {
    const symbol = doc.getElementById('symbol');
    ink = symbol.querySelector('path').getAttribute('fill');
    symbol.removeAttribute('transform');
    symbol.replaceChildren(wrapper);
  } else if (set === 'xiangqi-wudang') {
    const artwork = doc.getElementById('piece-artwork');
    const old = [...artwork.children].findLast(n => n.localName === 'path');
    if (!old) throw new Error('Wudang symbol structure changed');
    ink = old.getAttribute('fill');
    // Retain the original fine, translucent dark outline around the ivory ink.
    const edge = path.cloneNode(true);
    const unitScale = Math.abs(Number(glyph.getAttribute('transform').match(/scale\(([^ ]+)/)[1]));
    edge.setAttribute('stroke', old.getAttribute('stroke'));
    edge.setAttribute('stroke-opacity', old.getAttribute('stroke-opacity'));
    edge.setAttribute(
      'stroke-width',
      style.weight + Number(old.getAttribute('stroke-width')) / (scale * unitScale),
    );
    glyph.prepend(edge);
    old.replaceWith(wrapper);
  } else {
    const symbol =
      [...doc.querySelectorAll('#piece-artwork g')].find(g => g.getAttribute('fill')) ??
      doc.querySelector('#piece-artwork path');
    if (!symbol) throw new Error('Paper symbol structure changed');
    ink = symbol.getAttribute('fill') ?? '#000';
    symbol.replaceWith(wrapper);
  }
  wrapper.setAttribute('fill', ink);
  wrapper.setAttribute('color', ink);
  const result = doc.documentElement.outerHTML + '\n';
  doc.defaultView.close();
  return result;
}

const palettes = {
  'default-wood': { '#933e29': '#2c663e' },
  'xiangqi-wudang': {
    '#59211d': '#163e2c',
    '#6e2b25': '#215138',
    '#963f36': '#39724b',
    '#b1564b': '#52895e',
  },
  'xiangqi-paper-traditional': { '#df4a4a': '#258044' },
  'xiangqi-international': { '#df4a4a': '#258044' },
  'xiangqi-western': {
    '#ad261c': '#24683c',
    '#801b14': '#194c2b',
    '#b93224': '#2b7644',
    '#cc4832': '#3f8a55',
  },
};

for (const [set, palette] of Object.entries(palettes)) {
  for (const role of ['K', 'A', 'B', 'N', 'R', 'C', 'P', 'Back']) {
    const source = new URL(`../../public/piece/${set}/r${role}.svg`, import.meta.url);
    const original = readFileSync(source, 'utf8');
    let green = original.replace(/#[0-9a-f]{6}\b/gi, color => palette[color.toLowerCase()] ?? color);
    // Some backs contain only wood; identical material is intentional.
    if (role !== 'Back' && green === original) throw new Error(`Missing ink palette for ${set}/${role}`);
    const glyph = { K: 'wu', B: 'elephant', C: 'cannon', P: 'soldier' }[role];
    if (glyph && chineseSets.has(set)) green = lettering(green, set, glyph);
    writeFileSync(new URL(`../../public/piece/${set}/g${role}.svg`, import.meta.url), green);
  }
  if (chineseSets.has(set))
    for (const [side, kingdom] of [
      ['r', 'shu'],
      ['b', 'wei'],
    ]) {
      const source = readFileSync(new URL(`../../public/piece/${set}/${side}K.svg`, import.meta.url), 'utf8');
      writeFileSync(
        new URL(`../../public/piece/${set}/${side}K3.svg`, import.meta.url),
        lettering(source, set, kingdom),
      );
    }
}

const catalogFile = new URL('../../ui/board/src/catalog.json', import.meta.url);
const catalog = JSON.parse(readFileSync(catalogFile, 'utf8'));
for (const set of catalog.pieceSets) {
  const pieces = structuredClone(set.variants.xiangqi);
  pieces.faces.green = Object.fromEntries(
    Object.keys(pieces.faces.red).map(role => [role, pieces.faces.red[role].replace('/r', '/g')]),
  );
  pieces.back.green = pieces.back.red.replace('/r', '/g');
  if (chineseSets.has(set.key))
    for (const color of ['red', 'black'])
      pieces.faces[color].general = pieces.faces[color].general.replace('K.svg', 'K3.svg');
  set.variants.threeKingdoms = pieces;
  delete set.variants.xiangqi.faces.green;
  delete set.variants.xiangqi.back.green;
}
writeFileSync(catalogFile, JSON.stringify(catalog, null, 2) + '\n');
