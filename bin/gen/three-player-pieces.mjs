import { JSDOM } from 'jsdom';
// Reuse each set's original vector geometry and material; recolor only its red ink.
// Run from the repository root: node bin/gen/three-player-pieces.mjs
import { readFileSync, writeFileSync } from 'node:fs';

import { lettering as fitLettering } from './piece-lettering.mjs';

const parse = source => new JSDOM(source, { contentType: 'image/svg+xml' }).window.document;
const glyphs = parse(
  readFileSync(new URL('./three-player-xiangqi/piece-glyphs.svg', import.meta.url), 'utf8'),
);
const chineseSets = new Set(['default-wood', 'xiangqi-wudang', 'xiangqi-paper-traditional', 'xiangqi-white']);

const lettering = (source, set, name) => fitLettering(source, set, name, glyphs, 'three-kingdoms-symbol');

const palettes = {
  'xiangqi-white': { '#d40000': '#18783b' },
  'xiangqi-white-international': Object.fromEntries(
    [
      'c83737',
      'c83939',
      'c93a3a',
      'ca3d3d',
      'cb4242',
      'cb7a7a',
      'cc4646',
      'cd4848',
      'cd7d7d',
      'ce4c4c',
      'ce4d4d',
      'cf5050',
      'cf8080',
      'cf8181',
      'd08181',
      'd25b5b',
      'd35f5f',
      'd38787',
      'd68d8d',
      'de8787',
      'e9afaf',
      'a02c2c',
      'd40000',
    ].map(hex => {
      // Preserve each original shaded tone's lightness while rotating red to green.
      const [r, g, b] = hex.match(/../g);
      return [`#${hex}`, `#${g}${r}${b}`];
    }),
  ),
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
  // Only rebuild variants for the vector collections this generator owns.
  if (!Object.hasOwn(palettes, set.key)) continue;
  const pieces = structuredClone(set.variants.xiangqi);
  // The Manchu Banner belongs only to the two-player piece family.
  for (const faces of Object.values(pieces.faces)) delete faces.banner;
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
