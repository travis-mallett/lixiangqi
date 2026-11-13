// Original PyChess outlines stay in source/. Regeneration is entirely offline.
import { JSDOM } from 'jsdom';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { generateBoards } from './boards.mjs';

const source = name => new URL(`./source/${name}`, import.meta.url);
const output = name => new URL(`../../../public/${name}`, import.meta.url);
const roles = {
  K: 'king',
  A: 'advisor',
  B: 'elephant',
  N: 'horse',
  R: 'chariot',
  C: 'cannon',
  P: 'pawn',
  Back: 'covered',
};
const sets = [
  { key: 'xiangqi-white', name: 'PyChess White', category: 'traditional', folder: 'hnz', suffix: '' },
  {
    key: 'xiangqi-white-international',
    name: 'PyChess White Symbols',
    category: 'graphicalSymbols',
    folder: 'ct2',
    suffix: '2',
  },
];
const ns = 'http://www.w3.org/2000/svg';
const hashes = {};
const read = name => {
  const bytes = readFileSync(source(name));
  hashes[name] = createHash('sha256').update(bytes).digest('hex');
  return bytes;
};
const catalogFile = new URL('../../../ui/board/src/catalog.json', import.meta.url);
const catalog = JSON.parse(readFileSync(catalogFile, 'utf8'));
const roleNames = {
  K: 'general',
  A: 'advisor',
  B: 'elephant',
  N: 'horse',
  R: 'chariot',
  C: 'cannon',
  P: 'soldier',
};

for (const set of sets) {
  mkdirSync(output(`piece/${set.key}`), { recursive: true });
  for (const [side, prefix] of [
    ['red', 'r'],
    ['black', 'b'],
  ]) {
    for (const [role, original] of Object.entries(roles)) {
      const name = `${set.folder}/${side}_${original}${role === 'Back' ? '' : set.suffix}.svg`;
      const dom = new JSDOM(read(name), { contentType: 'image/svg+xml' });
      const doc = dom.window.document;
      const root = doc.documentElement;
      const originalBody = doc.querySelector('circle[fill="#fff"]');
      if (originalBody?.getAttribute('r') !== '40.79224') throw new Error(`Unexpected body: ${name}`);
      const base = originalBody.parentElement;
      const ring = base.querySelector('circle[fill="none"]');
      if (!ring) throw new Error(`Missing ring: ${name}`);
      originalBody.remove();
      base.removeAttribute('filter');
      base.id = 'piece-ring';
      base.remove();
      // The source's offset filter bakes in a four-unit grey extrusion. Motion
      // owns physical depth and cast shadows; keep only the source face/ring.
      for (const filter of doc.querySelectorAll('filter')) filter.remove();
      for (const text of doc.querySelectorAll('text')) {
        if (text.textContent.trim()) throw new Error(`Unoutlined source lettering: ${name}`);
        text.remove();
      }
      const defs = doc.createElementNS(ns, 'defs');
      for (const el of Array.from(root.children)) if (el.localName.endsWith('Gradient')) defs.append(el);
      defs.insertAdjacentHTML(
        'beforeend',
        '<radialGradient id="white-material"><stop offset="0" stop-color="#fff"/><stop offset=".96" stop-color="#fff"/><stop offset=".984" stop-color="#f1f2ef"/><stop offset="1" stop-color="#c7cac6"/></radialGradient>',
      );
      const symbol = doc.createElementNS(ns, 'g');
      symbol.id = 'symbol';
      symbol.setAttribute('fill', side === 'red' ? '#d40000' : '#000000');
      if (role !== 'Back') symbol.append(...Array.from(root.children));
      // All originals have face center (46,46), including the ring's transform.
      // Include the original outer stroke in the source body's diameter.
      const scale = 90 / (2 * 40.79224 + 0.325698);
      root.replaceChildren(defs);
      root.setAttribute('width', '100');
      root.setAttribute('height', '100');
      root.setAttribute('viewBox', '0 0 100 100');
      const body = doc.createElementNS(ns, 'circle');
      for (const [key, value] of Object.entries({
        cx: '50',
        cy: '50',
        r: '45',
        fill: 'url(#white-material)',
        'data-piece-body': '',
      }))
        body.setAttribute(key, value);
      const art = doc.createElementNS(ns, 'g');
      art.id = 'piece-artwork';
      art.setAttribute('transform', `translate(50 50) scale(${scale}) translate(-46 -46)`);
      art.append(base);
      if (role !== 'Back') art.append(symbol);
      root.append(body, art);
      writeFileSync(output(`piece/${set.key}/${prefix}${role}.svg`), root.outerHTML + '\n');
      dom.window.close();
    }
  }
  const variants = {
    xiangqi: {
      back: Object.fromEntries(['red', 'black'].map(side => [side, `piece/${set.key}/${side[0]}Back.svg`])),
      faces: Object.fromEntries(
        ['red', 'black'].map(side => [
          side,
          Object.fromEntries(
            Object.entries(roleNames).map(([code, role]) => [role, `piece/${set.key}/${side[0]}${code}.svg`]),
          ),
        ]),
      ),
    },
  };
  const entry = { key: set.key, name: set.name, category: set.category, variants };
  const index = catalog.pieceSets.findIndex(item => item.key === set.key);
  if (index < 0) catalog.pieceSets.push(entry);
  else catalog.pieceSets[index] = entry;
}

generateBoards(read);
const board = {
  key: 'xiangqi-light-wood',
  name: 'PyChess Light Wood',
  coordinateLight: '#fff4dc',
  coordinateDark: '#2f160c',
  matchingPieceSet: 'xiangqi-white',
  geometries: {
    'xiangqi-9x10': 'images/board/svg/xiangqi-light-wood.svg',
    'minixiangqi-7x7': 'images/board/svg/xiangqi-light-wood-minixiangqi.svg',
    'three-player-xiangqi-135': 'images/board/svg/xiangqi-light-wood-three-player.svg',
  },
};
const index = catalog.boards.findIndex(item => item.key === board.key);
if (index < 0) catalog.boards.push(board);
else catalog.boards[index] = board;
writeFileSync(catalogFile, JSON.stringify(catalog, null, 2) + '\n');
writeFileSync(
  new URL('./source.json', import.meta.url),
  JSON.stringify(
    {
      repository: 'https://github.com/pychess/pychess-variants',
      commit: '4e1e3b4794d7e7da5d276c6325fe1efc4ebbe554',
      license: 'AGPL-3.0-or-later',
      files: hashes,
    },
    null,
    2,
  ) + '\n',
);

// The canonical variant generators own recoloring, kingdom lettering and banners.
await import('../three-player-pieces.mjs');
await import('../manchu-pieces.mjs');
console.log('Generated PyChess White, White Symbols, Light Wood and their variant artwork.');
