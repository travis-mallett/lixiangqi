import assert from 'node:assert/strict';
import test from 'node:test';

import { isXiangqiCapture, selectXiangqiNotation } from '../src/game/xiangqi';

test('selects the requested Xiangqi notation with a safe English fallback', () => {
  assert.equal(selectXiangqiNotation('C8=5', '炮八平五', 'english'), 'C8=5');
  assert.equal(selectXiangqiNotation('C8=5', '炮八平五', 'chinese'), '炮八平五');
  assert.equal(selectXiangqiNotation('C8=5', undefined, 'chinese'), 'C8=5');
});

test('detects captures from consecutive Xiangqi positions', () => {
  const before = '4k4/9/9/9/4p4/9/9/9/p8/R3K4 w - - 0 1';
  const afterCapture = '4k4/9/9/9/4p4/9/9/9/R8/4K4 b - - 1 1';
  const afterQuietMove = '4k4/9/9/9/4p4/9/9/R8/p8/4K4 b - - 1 1';

  assert.equal(isXiangqiCapture(before, afterCapture), true);
  assert.equal(isXiangqiCapture(before, afterQuietMove), false);
});
