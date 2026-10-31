import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { boardAssets } from '../src/catalog';
import { miniXiangqi, boardDefinitionForFen } from '../src/definitions';
import { boardImageSvg } from '../src/image';
import { boardLayout } from '../src/layout';
import { positionFromFen, positionToFen } from '../src/position';

const start = 'rcnkncr/p1ppp1p/7/7/7/P1PPP1P/RCNKNCR w - - 0 1';

test('Mini coordinate artwork has seven correctly ordered file labels in both orientations', () => {
  const dom = new JSDOM(
    readFileSync(
      new URL('../../../public/images/board/svg/minixiangqi-file-coordinates.svg', import.meta.url),
      'utf8',
    ),
    { contentType: 'image/svg+xml' },
  );
  try {
    const rows = [...dom.window.document.querySelectorAll('svg > g')];
    assert.equal(rows.length, 4);
    rows.forEach((row, rowIndex) => {
      const glyphs = [...row.querySelectorAll('use')];
      assert.equal(glyphs.length, 7);
      glyphs.forEach((glyph, index) => {
        const script = rowIndex === 0 || rowIndex === 3 ? 'arabic' : 'hanzi';
        assert.equal(glyph.getAttribute('href'), `#${script}-${index + 1}`);
        assert.equal(
          glyph.getAttribute('transform'),
          `translate(${(rowIndex < 2 ? 3 - index : index - 3) * 100})`,
        );
      });
    });
  } finally {
    dom.window.close();
  }
});

test('Mini Xiangqi FEN selects seven files and ranks without changing standard boards', () => {
  const definition = boardDefinitionForFen(start);
  assert.equal(definition, miniXiangqi);
  const position = positionFromFen(start, definition);
  assert.equal(position.board, 'minixiangqi');
  assert.equal(position.pieces.size, 24);
  assert.equal(positionToFen(position, definition), start.split(' ').slice(0, 2).join(' '));
  assert.equal(position.pieces.get('d7')?.participant, 'black');
  assert.equal(position.pieces.get('d1')?.participant, 'red');
  assert.throws(() => positionFromFen(start.replace('RCNKNCR', 'RCNKNCRR'), definition));
});

test('every Mini board theme has seven continuous lines per axis aligned to all 49 intersections', () => {
  const { canvasWidth, canvasHeight, viewport } = boardLayout(miniXiangqi.geometry);
  assert.deepEqual([canvasWidth, canvasHeight], [700, 700]);
  for (const theme of boardAssets.boards) {
    const path = theme.geometries[miniXiangqi.geometry.id];
    assert.ok(path, theme.key);
    const dom = new JSDOM(readFileSync(new URL(`../../../public/${path}`, import.meta.url), 'utf8'), {
      contentType: 'image/svg+xml',
    });
    try {
      const root = dom.window.document.documentElement;
      assert.equal(root.getAttribute('viewBox'), '0 0 700 700');
      const grid = root.querySelector('#gridlines')!.getAttribute('d')!;
      assert.equal(grid.match(/V/g)?.length, 7);
      assert.equal(grid.match(/H/g)?.length, 7);
      for (let index = 0; index < 7; index++) {
        const point = 56 + index * 98;
        assert.ok(grid.includes(`M${point},56V644M56,${point}H644`));
        assert.ok(Math.abs((viewport.left + (viewport.width * (index + 0.5)) / 7) * 700 - point) < 1e-9);
      }
      assert.equal(
        root.querySelector('#palaces')?.getAttribute('d'),
        'M252,56L448,252M448,56L252,252M252,448L448,644M448,448L252,644',
      );
    } finally {
      dom.window.close();
    }
    for (const set of boardAssets.pieceSets) {
      const image = boardImageSvg(
        {
          definition: miniXiangqi,
          position: positionFromFen(start, miniXiangqi),
          perspective: 'black',
          theme: theme.key,
          pieceSet: set.key,
        },
        path => path,
      );
      assert.ok(image.includes(path), theme.key);
      assert.ok(image.includes(set.variants.xiangqi.faces.red.general), set.key);
    }
  }
});
