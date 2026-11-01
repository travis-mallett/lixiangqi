import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBoard, boardPresentation, threeKingdoms, standardXiangqi, miniXiangqi } from '../src';
import { annotationBrushes, renderAnnotation } from '../src/renderer/annotations';
import { graphPoint } from '../src/renderer/graphGeometry';

test('shared annotations have filled heads, cell-relative widths and shortened overlapping arrows', () => {
  const normal = renderAnnotation(annotationBrushes.green, [0, 0], [2, 0], false, false, 0.5);
  const overlap = renderAnnotation(annotationBrushes.green, [0, 0], [2, 0], false, true, 0.5);
  assert.equal(normal.querySelector('path')?.getAttribute('fill'), annotationBrushes.green.color);
  assert.equal(normal.querySelector('line')?.getAttribute('stroke-width'), String(10 / 64));
  assert.equal(normal.querySelector('line')?.getAttribute('x2'), String(2 - 10 / 64));
  assert.equal(overlap.querySelector('line')?.getAttribute('x2'), String(2 - 20 / 64));
  const preview = renderAnnotation(annotationBrushes.red, [0, 0], undefined, true, false, 0.5);
  assert.equal(preview.getAttribute('opacity'), '0.9');
  assert.equal(preview.getAttribute('stroke-width'), String(3 / 64));
});

test('graph marks preserve layers, custom artwork, locations and all perspectives using shared primitives', () => {
  const element = document.createElement('div');
  document.body.append(element);
  const board = createBoard(element, {
    definition: threeKingdoms,
    position: { active: 'red', pieces: new Map() },
    presentation: boardPresentation('interactive', 'red'),
    interaction: { mode: 'display' },
    services: { assetUrl: path => path },
  });
  try {
    const marks = [{ from: 'wei:0:0', to: 'wu:0:0', brush: 'blue', lineWidth: 12 }];
    board.setMarks(marks);
    board.setMarks([{ from: 'shu:0:0', brush: 'red' }], 'annotation');
    for (const perspective of ['red', 'black', 'green']) {
      board.setPresentation(boardPresentation('interactive', perspective));
      const line = element.querySelector('.graph-board__marks line')!;
      const point = graphPoint(threeKingdoms.geometry, marks[0].from, perspective);
      assert.equal(Number(line.getAttribute('x1')), point[0] / threeKingdoms.geometry.pieceSize);
      assert.equal(Number(line.getAttribute('y1')), point[1] / threeKingdoms.geometry.pieceSize);
      assert.equal(line.getAttribute('stroke-width'), String(12 / 64));
      assert.equal(
        element.querySelector('.graph-board__marks circle')?.getAttribute('r'),
        String(0.5 - 2 / 64),
      );
    }
    board.setMarks([{ from: 'shu:0:0', svg: '<path data-custom="yes" d="M0 0L100 100"/>' }], 'annotation');
    assert.ok(element.querySelector('[data-custom="yes"]'));
    board.setMarks([], 'annotation');
    assert.ok(element.querySelector('.graph-board__marks line'));
    board.setMarks([]);
    assert.equal(element.querySelector('.graph-board__marks .cg-shapes')?.childElementCount, 0);
  } finally {
    board.destroy();
    element.remove();
  }
});

test('rectangular adapters use the same annotation primitive, including default brushes', () => {
  for (const definition of [standardXiangqi, miniXiangqi]) {
    const element = document.createElement('div');
    document.body.append(element);
    const board = createBoard(element, {
      definition,
      position: { active: definition.participants[0], pieces: new Map() },
      presentation: boardPresentation('interactive', definition.participants[0]),
      interaction: { mode: 'display' },
      services: { assetUrl: path => path },
    });
    try {
      board.setMarks([{ from: 'a1', to: 'b2' }]);
      board.redraw();
      assert.ok(element.querySelector('.cg-shapes g path[fill="#15781b"]'));
      assert.equal(element.querySelector('.cg-shapes line')?.getAttribute('stroke-width'), String(10 / 64));
    } finally {
      board.destroy();
      element.remove();
    }
  }
});

test('custom brushes retain rectangular rounding and fallback semantics on every renderer', () => {
  for (const definition of [standardXiangqi, miniXiangqi, threeKingdoms]) {
    const element = document.createElement('div');
    document.body.append(element);
    const board = createBoard(element, {
      definition,
      position: { active: 'red', pieces: new Map() },
      presentation: boardPresentation('interactive', 'red'),
      interaction: { mode: 'display' },
      services: { assetUrl: path => path },
    });
    const from = definition === threeKingdoms ? 'wei:0:0' : 'a1';
    const to = definition === threeKingdoms ? 'wu:0:0' : 'b2';
    try {
      for (const [lineWidth, width, opacity] of [
        [undefined, 15, 0.35],
        [12, 12, 0.4],
        [12.6, 13, 0.4],
        [0, 15, 0.4],
      ] as const) {
        for (const layer of ['user', 'annotation'] as const) {
          board.setMarks([{ from, to, brush: 'paleGrey', lineWidth }], layer);
          board.redraw();
          const line = element.querySelector('.cg-shapes line')!;
          assert.equal(line.getAttribute('stroke-width'), String(width / 64), definition.id);
          assert.equal(line.parentElement?.getAttribute('opacity'), String(opacity), definition.id);
          board.setMarks([], layer);
        }
      }
    } finally {
      board.destroy();
      element.remove();
    }
  }
});
