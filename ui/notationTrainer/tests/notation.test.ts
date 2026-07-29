import assert from 'node:assert/strict';
import test from 'node:test';

import { isCorrectNotation, notationFor } from '../src/notation.ts';

const exercise = {
  fen: '4k4/9/9/9/9/9/1C7/9/9/5K3 w - - 0 1',
  turn: 'red' as const,
  legalMoves: ['b4e4'],
  move: 'b4e4',
  resultFen: '4k4/9/9/9/9/9/4C4/9/9/5K3 b - - 1 1',
  wxf: 'C8=5',
  chinese: '炮八平五',
};

test('selects the requested notation without substituting another system', () => {
  assert.equal(notationFor(exercise, 'wxf'), 'C8=5');
  assert.equal(notationFor(exercise, 'chinese'), '炮八平五');
});

test('accepts conventional WXF punctuation while preserving the move meaning', () => {
  assert.equal(isCorrectNotation(' C8.5 ', exercise.wxf), true);
  assert.equal(isCorrectNotation('C8−5', 'C8-5'), true);
  assert.equal(isCorrectNotation('c8=5', exercise.wxf), false);
  assert.equal(isCorrectNotation('C2=5', exercise.wxf), false);
});

test('requires uppercase WXF pieces for Red and lowercase WXF pieces for Black', () => {
  assert.equal(isCorrectNotation('H2+3', 'H2+3'), true);
  assert.equal(isCorrectNotation('h2+3', 'H2+3'), false);
  assert.equal(isCorrectNotation('h2+3', 'h2+3'), true);
  assert.equal(isCorrectNotation('H2+3', 'h2+3'), false);
});

test('accepts WXF front and rear markers only before the piece letter', () => {
  assert.equal(isCorrectNotation(' +R.8 ', '+R=8'), true);
  assert.equal(isCorrectNotation('−h+3', '-h+3'), true);
  assert.equal(isCorrectNotation('R+=8', '+R=8'), false);
  assert.equal(isCorrectNotation('h-+3', '-h+3'), false);
});

test('checks WXF Chinese notation as a complete move', () => {
  assert.equal(isCorrectNotation(' 炮八平五 ', exercise.chinese), true);
  assert.equal(isCorrectNotation('炮二平五', exercise.chinese), false);
});
