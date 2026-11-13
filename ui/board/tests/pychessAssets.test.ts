import { Resvg } from '@resvg/resvg-js';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { miniXiangqi, standardXiangqi } from '../src/definitions';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url));
const parse = (path: string) => new JSDOM(read(path), { contentType: 'image/svg+xml' });

test('the pinned original PyChess artwork is intact', () => {
  const manifest = JSON.parse(read('bin/gen/pychess-white/source.json').toString());
  for (const [path, hash] of Object.entries(manifest.files))
    assert.equal(
      createHash('sha256')
        .update(read(`bin/gen/pychess-white/source/${path}`))
        .digest('hex'),
      hash,
      path,
    );
});

test('white character and symbol faces preserve every original path without the baked extrusion', () => {
  const roles = { K: 'king', A: 'advisor', B: 'elephant', N: 'horse', R: 'chariot', C: 'cannon', P: 'pawn' };
  for (const [set, source, suffix] of [
    ['xiangqi-white', 'hnz', ''],
    ['xiangqi-white-international', 'ct2', '2'],
  ])
    for (const side of ['red', 'black'])
      for (const [role, name] of Object.entries(roles)) {
        const original = parse(`bin/gen/pychess-white/source/${source}/${side}_${name}${suffix}.svg`);
        const face = parse(`public/piece/${set}/${side[0]}${role}.svg`);
        try {
          const paths = (dom: JSDOM) =>
            Array.from(dom.window.document.querySelectorAll('path')).map(p => p.getAttribute('d'));
          assert.deepEqual(paths(face), paths(original), `${set}/${side}/${role}`);
          assert.equal(face.window.document.querySelectorAll('filter, text').length, 0);
          assert.equal(face.window.document.querySelector('[data-piece-body]')?.getAttribute('r'), '45');
        } finally {
          original.window.close();
          face.window.close();
        }
      }
});

test('light wood grid intersections coincide with the canonical standard and mini frames', () => {
  for (const [definition, suffix] of [
    [standardXiangqi, ''],
    [miniXiangqi, '-minixiangqi'],
  ] as const) {
    const { columns, rows, frame } = definition.geometry;
    const width = frame.marginX * 2 + (columns - 1) * frame.cellSize;
    const file = `public/images/board/svg/xiangqi-light-wood${suffix}.svg`;
    const { pixels } = new Resvg(read(file)).render();
    for (let rank = 0; rank < rows; rank++)
      for (let col = 0; col < columns; col++) {
        const x = frame.marginX + col * frame.cellSize;
        const y = frame.marginY + rank * frame.cellSize;
        // Pixel centers straddle the exact vector intersection; outer endpoints
        // use butt caps, so inspect the four samples surrounding that point.
        const dark = [-1, 0].some(dy =>
          [-1, 0].some(dx => {
            const index = ((y + dy) * width + x + dx) * 4;
            return pixels[index] < 60 && pixels[index + 1] < 60 && pixels[index + 2] < 60;
          }),
        );
        assert.ok(dark, `${file}: ${x},${y}`);
      }
  }
});
