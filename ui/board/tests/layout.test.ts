import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { boardAssets } from '../src/catalog';
import { standardXiangqi } from '../src/definitions';
import { boardImageSvg } from '../src/image';
import { boardLayout, pieceGeometry } from '../src/layout';
import { positionFromFen } from '../src/position';

test('all four vector boards share the exact symmetric grid used by the renderer', () => {
  const { canvasWidth, canvasHeight, viewport: layout } = boardLayout(standardXiangqi.geometry);
  assert.deepEqual([canvasWidth, canvasHeight], [900, 1000]);
  for (const name of ['lixiangqi-default', 'paper-board', 'xiangqi-tournament', 'xiangqi-wudang']) {
    const svg = readFileSync(
      new URL(`../../../public/images/board/svg/${name}.svg`, import.meta.url),
      'utf8',
    );
    const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
    try {
      assert.equal(
        dom.window.document.querySelector('#board-artwork')?.getAttribute('transform'),
        'scale(0.98)',
      );
    } finally {
      dom.window.close();
    }
  }
  for (let file = 0; file < 9; file++) {
    for (let rank = 0; rank < 10; rank++) {
      const x = layout.left + (layout.width * (file + 0.5)) / 9;
      const y = layout.top + (layout.height * (rank + 0.5)) / 10;
      assert.ok(Math.abs(x * 900 - (58 + file * 98)) < 1e-10);
      assert.ok(Math.abs(y * 1000 - (59 + rank * 98)) < 1e-10);
    }
  }
});

test('cell boards retain their full viewport and invalid artwork frames are rejected', () => {
  assert.deepEqual(boardLayout({ id: 'cells', columns: 4, rows: 8, placement: 'cells' }), {
    canvasWidth: 400,
    canvasHeight: 800,
    viewport: { width: 1, height: 1, left: 0, top: 0 },
  });
  assert.throws(
    () => boardLayout({ ...standardXiangqi.geometry, frame: { cellSize: 0, marginX: 58, marginY: 59 } }),
    /Invalid board artwork frame/,
  );
});

test('every theme and piece set exports the same viewport and piece size, including Wudang', () => {
  const { viewport: layout } = boardLayout(standardXiangqi.geometry);
  assert.deepEqual(pieceGeometry, { canvasSize: 100, bodyDiameter: 90, scale: 1 });
  for (const theme of boardAssets.boards)
    for (const pieces of boardAssets.pieceSets) {
      const svg = boardImageSvg(
        {
          definition: standardXiangqi,
          position: positionFromFen('4k4/9/9/9/9/9/9/9/9/R3K4 w', standardXiangqi),
          perspective: 'red',
          theme: theme.key,
          pieceSet: pieces.key,
          labels: { red: 'Red', black: 'Black' },
        },
        path => path,
      );
      assert.ok(
        svg.includes(
          `translate(${layout.left * 900} ${52 + layout.top * 1000}) scale(${layout.width} ${layout.height})`,
        ),
      );
      assert.ok(svg.includes('x="0" y="900" width="100" height="100"'));
      assert.ok(svg.includes('x="-50" y="850" width="200" height="200"'));
    }
});

test('concealed pieces export the back for their participant', () => {
  for (const { key: pieceSet } of boardAssets.pieceSets) {
    const svg = boardImageSvg(
      {
        definition: standardXiangqi,
        perspective: 'red',
        pieceSet,
        position: {
          active: 'red',
          pieces: new Map([
            ['a1', { face: 'down', back: 'default', participant: 'red' }],
            ['a10', { face: 'down', back: 'default', participant: 'black' }],
          ]),
        },
      },
      path => path,
    );
    assert.ok(svg.includes(`piece/${pieceSet}/rBack.svg`));
    assert.ok(svg.includes(`piece/${pieceSet}/bBack.svg`));
  }
});
