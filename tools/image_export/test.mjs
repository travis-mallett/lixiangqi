import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { renderImage } from './dist/renderer.mjs';

const root = fileURLToPath(new URL('../../public/', import.meta.url));
const catalog = JSON.parse(readFileSync(new URL('../../ui/board/src/catalog.json', import.meta.url)));
const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const request = { format: 'png', orientation: 'red', size: 180, frames: [{ fen }] };
const pngSize = image => [Buffer.from(image).readUInt32BE(16), Buffer.from(image).readUInt32BE(20)];

function gifFrames(image) {
  const data = Buffer.from(image);
  assert.equal(data.subarray(0, 6).toString(), 'GIF89a');
  let index = 13 + (data[10] & 128 ? 3 * 2 ** ((data[10] & 7) + 1) : 0),
    count = 0;
  const blocks = () => {
    while (data[index]) index += data[index] + 1;
    index++;
  };
  while (data[index] !== 0x3b) {
    assert(index < data.length, 'GIF has a complete trailer');
    if (data[index] === 0x21) {
      index += 2;
      blocks();
    } else {
      assert.equal(data[index], 0x2c);
      count++;
      const packed = data[index + 9];
      index += 10 + (packed & 128 ? 3 * 2 ** ((packed & 7) + 1) : 0);
      index++;
      blocks();
    }
  }
  return count;
}

test('every native board theme and piece set renders all ten ranks', () => {
  for (const theme of catalog.boards) {
    for (const orientation of ['red', 'black'])
      assert.deepEqual(pngSize(renderImage({ ...request, theme: theme.key, orientation }, root)), [180, 200]);
  }
  for (const piece of catalog.pieceSets)
    assert.deepEqual(pngSize(renderImage({ ...request, piece: piece.key }, root)), [180, 200]);
});

test('orientation, native rank-ten marks, clocks and labels survive rasterization', () => {
  const input = {
    ...request,
    size: 450,
    red: '红方 · Red',
    black: '黑方 · Black',
    frames: [
      {
        fen,
        lastMove: 'i10i9',
        check: true,
        glyph: '!?',
        clock: { red: 6543, black: 6000 },
        shapes: [
          { orig: 'i10', dest: 'a1', brush: 'green' },
          { orig: 'a10', brush: 'red' },
        ],
      },
    ],
  };
  const red = renderImage(input, root),
    black = renderImage({ ...input, orientation: 'black' }, root);
  assert.deepEqual(pngSize(red), [450, 552]);
  assert.notDeepEqual(red, black);
  const artifacts = new URL('../../.tools/image-export-check/', import.meta.url);
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(new URL('red.png', artifacts), red);
  writeFileSync(new URL('black.png', artifacts), black);
});

test('animated frames retain frame count and stable dimensions with optional clocks', () => {
  const gif = renderImage(
    {
      ...request,
      format: 'gif',
      frames: [{ fen }, { fen, clock: { red: 1234 } }, { fen, lastMove: 'a10i10', delay: 500 }],
    },
    root,
  );
  assert.equal(gifFrames(gif), 3);
});

test('invalid input is rejected without substituting a board or truncating frames', () => {
  for (const input of [
    { ...request, frames: [{ fen: 'invalid' }] },
    { ...request, theme: 'chess' },
    { ...request, orientation: 'white' },
    { ...request, frames: [{ fen, lastMove: 'i:i9' }] },
    { ...request, frames: [{ fen, shapes: [{ orig: 'j10', brush: 'red' }] }] },
    { ...request, format: 'gif', frames: Array(602).fill({ fen }) },
    { ...request, size: 5000 },
  ])
    assert.throws(() => renderImage(input, root));
});
