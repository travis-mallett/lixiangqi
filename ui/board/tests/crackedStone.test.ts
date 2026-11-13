import { Resvg } from '@resvg/resvg-js';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { boardAssets } from '../src/catalog';
import { miniXiangqi, standardXiangqi } from '../src/definitions';
import { boardLayout } from '../src/layout';
import threePlayer from '../src/three-player-geometry.json';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url));
const asset = (suffix = '') => read(`public/images/board/svg/xiangqi-cracked-stone${suffix}.svg`);
const parse = (bytes: Buffer) => new JSDOM(bytes, { contentType: 'image/svg+xml' });
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('Cracked Stone retains the approved standard image and exact traced lettering', () => {
  assert.equal(
    hash(new Resvg(asset(), { font: { loadSystemFonts: false } }).render().asPng()),
    '5a3a052255e7c5ccb475499a95c860714e6bb3e16881310559f3f7acf9fd4963',
    'The approved standard artwork changed',
  );
  const reference = parse(read('bin/gen/cracked-stone/river.svg'));
  const board = parse(asset());
  try {
    for (const id of ['chu', 'he', 'han', 'jie'])
      assert.equal(
        board.window.document.getElementById(`river-${id}`)?.getAttribute('d'),
        reference.window.document.querySelector(`#${id} path`)?.getAttribute('d'),
      );
  } finally {
    reference.window.close();
    board.window.close();
  }
});

test('registered stone boards use Celestial Lacquer and self-contained static artwork', () => {
  const theme = boardAssets.boards.find(board => board.key === 'xiangqi-cracked-stone')!;
  assert.equal(theme.matchingPieceSet, 'celestial-lacquer');
  assert.equal(boardAssets.defaultBoard, 'lixiangqi-default');
  assert.equal(boardAssets.defaultPieces, 'default-wood');
  for (const suffix of ['', '-minixiangqi', '-three-player', '-banqi']) {
    const dom = parse(asset(suffix));
    try {
      const doc = dom.window.document;
      assert.equal(
        doc.querySelectorAll('script, style, text, animate, animateTransform, set, foreignObject').length,
        0,
      );
      assert.equal(doc.querySelectorAll('image').length, 1);
      for (const element of doc.querySelectorAll('[href]')) {
        const href = element.getAttribute('href')!;
        assert.ok(href.startsWith('#') || href.startsWith('data:image/jpeg;base64,'));
        if (href.startsWith('#')) assert.ok(doc.getElementById(href.slice(1)), href);
      }
    } finally {
      dom.window.close();
    }
  }
});

function assertInk(pixels: Buffer, width: number, x: number, y: number, label: string) {
  assert.ok(
    [-1, 0, 1].some(dy =>
      [-1, 0, 1].some(dx => {
        const i = ((Math.floor(y) + dy) * width + Math.floor(x) + dx) * 4;
        return pixels[i] < 65 && pixels[i + 1] < 65 && pixels[i + 2] < 65 && pixels[i + 3] === 255;
      }),
    ),
    `${label}: no engraved line at ${x},${y}`,
  );
}

test('every standard and mini intersection meets the shared renderer frame', () => {
  for (const [definition, suffix] of [
    [standardXiangqi, ''],
    [miniXiangqi, '-minixiangqi'],
  ] as const) {
    const { columns, rows, frame } = definition.geometry;
    const layout = boardLayout(definition.geometry);
    const rendered = new Resvg(asset(suffix)).render();
    assert.equal(rendered.width, layout.canvasWidth);
    assert.equal(rendered.height, layout.canvasHeight);
    const pixels = rendered.pixels;
    for (let rank = 0; rank < rows; rank++)
      for (let file = 0; file < columns; file++)
        assertInk(
          pixels,
          rendered.width,
          frame.marginX + file * frame.cellSize,
          frame.marginY + rank * frame.cellSize,
          definition.id,
        );
  }
});

test('all 135 kingdom intersections align and the hexagon has transparent corners', () => {
  const rendered = new Resvg(asset('-three-player')).render();
  const pixels = rendered.pixels;
  assert.ok(Math.abs(rendered.width - threePlayer.width) < 1);
  assert.ok(Math.abs(rendered.height - threePlayer.height) < 1);
  for (const [location, [x, y]] of Object.entries(threePlayer.locations))
    assertInk(pixels, rendered.width, x, y, location);
  assert.equal(pixels[3], 0);
  const dom = parse(asset('-three-player'));
  try {
    const metadata = JSON.parse(dom.window.document.getElementById('three-player-geometry')!.textContent);
    assert.equal(metadata.palaceDiagonalEdges.length, 12);
    assert.equal(metadata.locations.length, 135);
  } finally {
    dom.window.close();
  }
});

test('prepared Banqi artwork uses 32 square cells rather than an intersection board', () => {
  const rendered = new Resvg(asset('-banqi')).render();
  assert.equal(rendered.width, 496);
  assert.equal(rendered.height, 896);
  const pixels = rendered.pixels;
  for (let rank = 0; rank <= 8; rank++)
    for (let file = 0; file <= 4; file++)
      assertInk(pixels, rendered.width, 48 + file * 100, 48 + rank * 100, 'Banqi');
});
