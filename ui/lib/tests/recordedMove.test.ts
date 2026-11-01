import assert from 'node:assert/strict';
import test from 'node:test';

import { assertRecordedMovePosition } from '../src/game/recordedMove';
import type { RulesState } from '../src/game/xiangqiNotation';

test('recorded position verification preserves red, black, capture, and mini transitions', () => {
  for (const [variant, initial, final, move] of [
    ['xiangqi', '5k3/9/9/Pp7/9/9/9/9/9/4K4 w - - 0 1', '5k3/9/9/1P7/9/9/9/9/9/4K4 b - - 0 1', 'a7b7'],
    ['xiangqi', '5k3/9/9/p8/9/9/9/9/9/4K4 b - - 0 1', '5k3/9/9/9/p8/9/9/9/9/4K4 w - - 1 2', 'a7a6'],
    ['minixiangqi', '4k2/7/7/P6/7/7/3K3 w - - 0 1', '4k2/7/P6/7/7/7/3K3 b - - 1 1', 'a4a5'],
  ]) {
    const turn = initial.split(' ')[1] === 'w' ? 'red' : 'black';
    const before: RulesState = {
      variant,
      fen: initial,
      ply: turn === 'red' ? 0 : 1,
      turn,
      legalMoves: [move],
      check: false,
      gameResult: '*',
    };
    const after: RulesState = {
      ...before,
      fen: final,
      ply: before.ply + 1,
      turn: turn === 'red' ? 'black' : 'red',
      legalMoves: [],
    };
    assert.doesNotThrow(() => assertRecordedMovePosition(before, move, after));
    assert.throws(() => assertRecordedMovePosition(before, move, { ...after, fen: initial }), /position/);
    assert.throws(() => assertRecordedMovePosition(before, move, { ...after, reveal: 'cannon' }), /position/);
    assert.throws(() => assertRecordedMovePosition({ ...before, legalMoves: [] }, move, after), /position/);
  }
});
