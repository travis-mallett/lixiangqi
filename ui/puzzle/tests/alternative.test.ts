import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { EngineAnalysis } from 'lib/ceval/engines/pikafishProtocol';

import { evaluateAlternative } from '../src/alternative.ts';
import type { PuzzleObjective } from '../src/xiangqiAdjudication.ts';
import type XiangqiPuzzleEngine from '../src/xiangqiPuzzleEngine.ts';

const state = {
  fen: '4k4/9/9/9/4p4/9/R8/9/9/4K4 b - - 1 1',
  ply: 1,
  turn: 'black' as const,
  legalMoves: ['e10d10'],
  check: false,
  gameResult: '*',
};
const objective: PuzzleObjective = {
  mate: true,
  player: 'red',
  allowance: 9,
  startingCp: 800,
  startingMaterial: 0,
  targetMaterial: 1,
  targetPosition: '',
};
const history = { initialFen: 'initial', moves: ['a1a4'] };
const analysis = (depth: number, score = { redCp: 0 }): EngineAnalysis => ({
  engine: 'test',
  depth,
  nodes: 1,
  nps: 1,
  timeMs: 1,
  score,
  bestMove: 'e10d10',
  lines: [],
});

function engine(result: EngineAnalysis) {
  return {
    evaluator: {
      evaluate: async (fen: string, actual: typeof history) => {
        assert.equal(fen, state.fen);
        assert.deepEqual(actual, history);
        return result;
      },
    } as XiangqiPuzzleEngine,
  };
}

test('a shallow failure is adjudicated directly', async () => {
  const h = engine(analysis(15));
  const result = await evaluateAlternative(h.evaluator, objective, state, 1, history, () => true);
  assert.equal(result?.evaluation.depth, 15);
  assert.deepEqual(result?.decision, { result: 'fail', reason: 'forcedMateLost' });
});

test('missing evidence is unscored', async () => {
  const h = engine({ ...analysis(15), score: {} });
  await assert.rejects(
    evaluateAlternative(h.evaluator, objective, state, 1, history, () => true),
    /usable/,
  );
});

test('cancelled work is ignored', async () => {
  const h = engine(analysis(15));
  assert.equal(await evaluateAlternative(h.evaluator, objective, state, 1, history, () => false), undefined);
});

test('a newly found mate requires native validation before it is accepted', async t => {
  const pvMoves = ['e10d10', 'a4a5'];
  const rescued = {
    ...analysis(20),
    score: { redMate: 1 },
    lines: [
      {
        multipv: 1,
        depth: 20,
        seldepth: 22,
        score: { redMate: 1 },
        pvMoves,
        wxfMoves: [],
      },
    ],
  };
  const h = engine(rescued);
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.deepEqual(JSON.parse(init!.body as string), {
      initialFen: history.initialFen,
      moves: [...history.moves, ...pvMoves],
    });
    return new Response(JSON.stringify({ ...state, gameResult: '1-0' }));
  });
  const result = await evaluateAlternative(h.evaluator, objective, state, 1, history, () => true);
  assert.equal(result?.decision.result, 'continue');
  assert.deepEqual(result?.continuation?.moves, pvMoves);
});
