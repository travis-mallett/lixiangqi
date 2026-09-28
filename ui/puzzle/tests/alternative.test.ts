import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { EngineAnalysis } from 'lib/ceval/engines/pikafishProtocol';

import { evaluateAlternative } from '../src/alternative.ts';
import type { PuzzleObjective } from '../src/xiangqiAdjudication.ts';
import type XiangqiPuzzleEngine from '../src/xiangqiPuzzleEngine.ts';
import type { PuzzleSearchPolicy } from '../src/xiangqiPuzzleEngine.ts';

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

function engine(...results: EngineAnalysis[]) {
  const extensions: boolean[] = [];
  const confirmations: boolean[] = [];
  return {
    extensions,
    confirmations,
    evaluator: {
      evaluate: async (fen: string, actual: typeof history, policy: PuzzleSearchPolicy) => {
        assert.equal(fen, state.fen);
        assert.deepEqual(actual, history);
        const checkpoint = results.shift()!;
        const extended = policy.extend(checkpoint);
        extensions.push(extended);
        let result = extended && results.length ? results.shift()! : checkpoint;
        if (extended) {
          while (true) {
            const confirm = policy.needsConfirmation(result);
            confirmations.push(confirm);
            if (!confirm || !results.length) break;
            result = results.shift()!;
          }
        }
        return result;
      },
    } as XiangqiPuzzleEngine,
  };
}

test('failure extends the existing search instead of starting another evaluation', async () => {
  const h = engine(analysis(15), analysis(20));
  const result = await evaluateAlternative(h.evaluator, objective, state, 1, history, () => true);
  assert.deepEqual(h.extensions, [true]);
  assert.deepEqual(result?.decision, { result: 'fail', reason: 'forcedMateLost' });
});

test('a usable shallow result is adjudicated when the search budget is exhausted', async () => {
  const h = engine(analysis(10), analysis(19));
  const result = await evaluateAlternative(h.evaluator, objective, state, 1, history, () => true);
  assert.deepEqual(h.confirmations, [true]);
  assert.equal(result?.evaluation.depth, 19);
  assert.deepEqual(result?.decision, { result: 'fail', reason: 'forcedMateLost' });
});

test('only a still-shallow adverse result receives the longer depth-confirmation budget', async () => {
  const h = engine(analysis(15), analysis(19), analysis(20));
  const result = await evaluateAlternative(h.evaluator, objective, state, 1, history, () => true);
  assert.deepEqual(h.extensions, [true]);
  assert.deepEqual(h.confirmations, [true, false]);
  assert.equal(result?.evaluation.depth, 20);
  const tactic = { ...objective, mate: false };
  const rescued = engine(analysis(15), analysis(17, { redCp: 800 }));
  assert.equal(
    (await evaluateAlternative(rescued.evaluator, tactic, state, 1, history, () => true))?.decision.result,
    'continue',
  );
  assert.deepEqual(rescued.confirmations, [false]);
  const missing = engine({ ...analysis(15), score: {} }, { ...analysis(19), score: {} });
  await assert.rejects(
    evaluateAlternative(missing.evaluator, objective, state, 1, history, () => true),
    /usable/,
  );
  assert.deepEqual(missing.confirmations, [false], 'missing evidence retains the existing six-second budget');
});

test('deeper search can rescue a tactical move; every adverse score receives confirmation', async () => {
  const tactic = { ...objective, mate: false };
  const h = engine(analysis(15), analysis(20, { redCp: 800 }));
  assert.equal(
    (await evaluateAlternative(h.evaluator, tactic, state, 1, history, () => true))?.decision.result,
    'continue',
  );
  for (const result of [analysis(15, { redCp: 800 }), analysis(22)]) {
    const h = engine(result);
    await evaluateAlternative(h.evaluator, tactic, state, 1, history, () => true);
    assert.deepEqual(h.extensions, [result.score.redCp === 0]);
  }
});

test('cancelled work never starts confirmation', async () => {
  const h = engine(analysis(15));
  assert.equal(await evaluateAlternative(h.evaluator, objective, state, 1, history, () => false), undefined);
  assert.deepEqual(h.extensions, [false]);
});

test('a shallow tactical failure on the last allowed move can still be rescued as a win', async () => {
  const tactic = {
    ...objective,
    mate: false,
    allowance: 1,
    targetPosition: state.fen.split(' ').slice(0, 2).join(' '),
  };
  const h = engine(analysis(15), analysis(20, { redCp: 800 }));
  assert.equal(
    (await evaluateAlternative(h.evaluator, tactic, state, 1, history, () => true))?.decision.result,
    'win',
  );
  assert.deepEqual(h.extensions, [true]);
});

test('a newly found mate requires native validation before it rescues a failure', async t => {
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
  const h = engine(analysis(15), rescued);
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
