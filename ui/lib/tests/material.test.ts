import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getMaterialDiff, getScore, xiangqiMaterialScore } from '../src/game/material';
import { XIANGQI_START_FEN } from '../src/game/xiangqi';

test('material comparison reads all ten ranks and balances the complete Xiangqi starting position', () => {
  const material = getMaterialDiff(XIANGQI_START_FEN);
  assert.equal(getScore(material), 0);
  assert.ok(Object.values(material).every(side => Object.values(side).every(count => count === 0)));
});

test('material comparison includes advisors and cannons and reverses the player perspective', () => {
  const fen = '4k4/9/9/9/9/9/9/1C7/9/3AK4 w - - 0 1';
  const material = getMaterialDiff(fen);
  assert.equal(material.red.advisor, 1);
  assert.equal(material.red.cannon, 1);
  assert.equal(material.red.general, 0);
  assert.equal(xiangqiMaterialScore(fen, 'red'), 6.5);
  assert.equal(xiangqiMaterialScore(fen, 'black'), -6.5);
});
