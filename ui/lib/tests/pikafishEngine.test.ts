import assert from 'node:assert/strict';
import test from 'node:test';

import { toLocalEval } from '../src/ceval/engines/pikafishProtocol.ts';

test('adapts Pikafish analysis to the native ceval contract', () => {
  const result = toLocalEval(
    {
      engine: 'Pikafish',
      bestMove: 'h1g3',
      depth: 18,
      nodes: 12000,
      nps: 26666,
      timeMs: 450,
      score: { cp: -42, redCp: 42 },
      lines: [
        {
          multipv: 1,
          depth: 18,
          seldepth: 24,
          score: { cp: -42, redCp: 42 },
          pvMoves: ['h1g3', 'h10g8'],
          wxfMoves: [],
        },
      ],
    },
    'xiangqi-fen',
  );

  assert.equal(result.cp, 42);
  assert.equal(result.bestmove, 'h1g3');
  assert.deepEqual(result.pvs[0].moves, ['h1g3', 'h10g8']);
});
