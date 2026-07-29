import assert from 'node:assert/strict';
import test from 'node:test';

import { selectXiangqiNotation } from '../src/game/xiangqi';

test('selects the requested Xiangqi notation with a safe English fallback', () => {
  assert.equal(selectXiangqiNotation('C8=5', '炮八平五', 'english'), 'C8=5');
  assert.equal(selectXiangqiNotation('C8=5', '炮八平五', 'chinese'), '炮八平五');
  assert.equal(selectXiangqiNotation('C8=5', undefined, 'chinese'), 'C8=5');
});
