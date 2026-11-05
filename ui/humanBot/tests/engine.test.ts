import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { EngineAnalysis, EngineLine } from '../../lib/src/ceval/engines/pikafishProtocol.ts';
import { scoredPikafishLines } from '../src/xiangqi/engine.ts';

const line = (move: string, depth = 9): EngineLine => ({
  multipv: 1,
  depth,
  seldepth: depth,
  score: { cp: 20 },
  pvMoves: [move],
  wxfMoves: [],
});
const analysis = (bestMove: string, lines: EngineLine[]): EngineAnalysis => ({
  bestMove,
  lines,
  engine: 'test',
  depth: 9,
  nodes: 15688,
  nps: 100000,
  timeMs: 150,
  score: { cp: 20 },
});
test('a node stop reporting an unscored bestmove preserves completed scored evidence', () => {
  const previous = [line('e5e3'), line('b1b4')];
  const result = scoredPikafishLines(
    analysis('e5i5', previous),
    new Map(previous.map(pv => [pv.pvMoves[0], pv])),
  );
  assert.deepEqual(result, previous);
  assert(!result.some(pv => pv.pvMoves[0] === 'e5i5'), 'Missing scores must not be fabricated');
});
test('a newer scored final bestmove is retained without mixing different iterations', () => {
  const newer = line('e5i5', 10);
  assert.deepEqual(
    scoredPikafishLines(analysis('e5i5', [line('e5e3'), line('b1b4')]), new Map([['e5i5', newer]])),
    [newer],
  );
  assert.throws(() => scoredPikafishLines(analysis('e5i5', []), new Map()), /without any scored/);
});
