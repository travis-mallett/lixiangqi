import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RulesState } from 'xiangqi';

import type { EngineAnalysis, EngineScore } from 'lib/ceval/engines/pikafishProtocol';

import { PuzzleSolutions, defenderDelay } from '../src/solutions.ts';
import {
  adjudicateAlternative,
  makeObjective,
  playerScore,
  playerMoveAllowance,
  winningContinuation,
  type PuzzleObjective,
} from '../src/xiangqiAdjudication.ts';
import { fixturePositions } from './positionFixtures.ts';

const fen = '4k4/9/9/9/4p4/9/9/9/9/R3K4 w - - 0 1';
const state = (gameResult = '*'): RulesState => ({
  fen,
  gameResult,
  turn: 'black',
  ply: 1,
  legalMoves: ['e10d10'],
  check: false,
});
const analysis = (score: EngineScore, pvMoves = ['e10d10', 'a1a2']): EngineAnalysis => ({
  engine: 'test',
  depth: 20,
  nodes: 100,
  nps: 100,
  timeMs: 10,
  score,
  bestMove: pvMoves[0],
  lines: [{ multipv: 1, depth: 20, score, pvMoves, wxfMoves: [] }],
});
const objective = (changes: Partial<PuzzleObjective> = {}): PuzzleObjective => ({
  mate: true,
  player: 'red',
  startingCp: 800,
  allowance: 15,
  startingMaterial: 8,
  targetMaterial: 8,
  targetPosition: 'different',
  ...changes,
});

test('root and nested alternatives share prefixes, preserve all leaves, and provide local distances', () => {
  const a = ['a1a2', 'e10d10', 'a2a3', 'd10e10', 'a3e3'];
  const a2 = [...a.slice(0, 4), 'a3a10'];
  const b = ['a1a4', 'e10d10', 'a4a5', 'd10e10', 'a5e5'];
  const tree = new PuzzleSolutions([a, a2, b]);
  assert.equal(tree.root.remaining, 3);
  assert.equal(tree.root.children.size, 2);
  assert.equal(tree.at(a.slice(0, 4))?.children.size, 2);
  for (const line of [a, a2, b]) assert.equal(tree.at(line)?.complete, true);
  assert.equal(tree.at(a.slice(0, 2))?.remaining, 2);
  assert.equal(tree.at(['a1a2', 'e10d10', 'a4a5']), undefined);
  const detour = ['a1a6', 'e10d10', 'a6a7', 'd10e10', 'a7a8', 'e10d10', 'a8e8'];
  tree.add(detour);
  assert.equal(tree.at(detour.slice(0, 2))?.remaining, 3);
  assert.equal(tree.at(a2)?.complete, true);
});

test('reply delay exceeds every configured animation and never falls below 750ms', () => {
  for (const animation of [0, 120, 250, 500]) assert.equal(defenderDelay(animation), 750);
  assert.equal(defenderDelay(1000), 1100);
});

test('objective and allowance come entirely from published metadata', () => {
  const solution = ['a1a2', 'e10d10', 'a2a3'];
  assert.equal(
    makeObjective(
      fen,
      solution,
      { objective: 'mate', solutions: [solution] },
      fixturePositions(fen, solution),
    ).allowance,
    4,
  );
  assert.equal(
    makeObjective(
      fen,
      solution,
      { objective: 'tactic', startingCp: 800, solutions: [solution] },
      fixturePositions(fen, solution),
    ).mate,
    false,
  );
  assert.throws(
    () =>
      makeObjective(
        fen,
        solution,
        { objective: 'tactic', solutions: [solution] },
        fixturePositions(fen, solution),
      ),
    /starting advantage/,
  );
  for (const n of [1, 2, 3, 5]) {
    assert.equal(playerMoveAllowance(Array(2 * n - 1).fill('a1a2'), true), n === 2 ? 4 : 3 * n);
  }
});

test('mate beyond the remaining budget is distinct from losing mate', () => {
  assert.deepEqual(adjudicateAlternative(objective(), state(), analysis({ redMate: 10 }), 6), {
    result: 'fail',
    reason: 'mateExceedsAllowance',
    needed: 10,
    remaining: 9,
  });
  assert.deepEqual(adjudicateAlternative(objective(), state(), analysis({ redCp: 3000 }), 6), {
    result: 'fail',
    reason: 'forcedMateLost',
  });
  assert.deepEqual(adjudicateAlternative(objective(), state(), analysis({ redMate: -2 }), 6), {
    result: 'fail',
    reason: 'forcedMateLost',
  });
});

test('unverified engine evidence never counts as a player failure', () => {
  for (const score of [{}, { redMate: 1, bound: 'lower' as const }, { redMate: NaN }])
    assert.throws(() => adjudicateAlternative(objective(), state(), analysis(score), 1), /usable score/);
  assert.throws(
    () => adjudicateAlternative(objective(), state(), analysis({ redMate: 1 }), 1),
    /complete winning continuation/,
  );
});

test('terminal outcomes and last allowed move are handled before engine analysis', () => {
  assert.deepEqual(adjudicateAlternative(objective(), state('1-0'), undefined, 15), { result: 'win' });
  assert.deepEqual(adjudicateAlternative(objective(), state('1-0'), undefined, 16), {
    result: 'fail',
    reason: 'moveAllowanceExceeded',
  });
  assert.deepEqual(adjudicateAlternative(objective(), state('1/2-1/2'), undefined, 1), {
    result: 'fail',
    reason: 'lineDrawn',
  });
  assert.deepEqual(adjudicateAlternative(objective(), state('0-1'), undefined, 1), {
    result: 'fail',
    reason: 'lineLost',
  });
  assert.deepEqual(adjudicateAlternative(objective(), state(), analysis({ redCp: 3000 }), 15), {
    result: 'fail',
    reason: 'moveAllowanceExceeded',
  });
});

test('tactical tolerance uses the fixed baseline and the solver perspective', () => {
  for (const player of ['red', 'black'] as const) {
    const sign = player === 'red' ? 1 : -1;
    assert.deepEqual(playerScore({ redMate: sign * 2 }, player).mate, 2);
    assert.equal(
      adjudicateAlternative(objective({ mate: false, player }), state(), analysis({ redCp: 400 * sign }), 2)
        .result,
      'continue',
    );
    assert.deepEqual(
      adjudicateAlternative(objective({ mate: false, player }), state(), analysis({ redCp: 399 * sign }), 2),
      { result: 'fail', reason: 'advantageLost' },
    );
  }
});

test('tactical position completion still succeeds on the final allowed move', () => {
  const target = objective({ mate: false, targetPosition: fen.split(' ').slice(0, 2).join(' ') });
  assert.deepEqual(adjudicateAlternative(target, state(), analysis({ redCp: 400 }), 15), { result: 'win' });
});

test('native continuation validation preserves history and accepts wins for either solver color', async t => {
  const requests: any[] = [];
  let result = '1-0';
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests.push(JSON.parse(init!.body as string));
    return new Response(JSON.stringify(state(result)));
  });
  for (const player of ['red', 'black'] as const) {
    result = player === 'red' ? '1-0' : '0-1';
    const evaluation = analysis({ redMate: player === 'red' ? 1 : -1 });
    const continuation = await winningContinuation(
      objective({ player }),
      { ...state(), turn: player === 'red' ? 'black' : 'red' },
      evaluation,
      2,
      { initialFen: fen, moves: ['a1a4'] },
    );
    assert.ok(continuation);
    assert.deepEqual(requests.at(-1).moves, ['a1a4', 'e10d10', 'a1a2']);
    assert.equal(
      adjudicateAlternative(objective({ player }), state(), evaluation, 2, continuation).result,
      'continue',
    );
  }
});

test('unfinished, drawn, illegal, and inconsistent continuations remain unverified', async t => {
  let status = 200,
    result = '*';
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(JSON.stringify(status === 200 ? state(result) : { error: 'invalid PV' }), { status }),
  );
  const validate = (evaluation = analysis({ redMate: 1 })) =>
    winningContinuation(objective(), state(), evaluation, 1, { initialFen: fen, moves: [] });
  for (result of ['*', '1/2-1/2', '0-1']) assert.equal(await validate(), undefined);
  status = 400;
  assert.equal(await validate(), undefined);
  status = 500;
  await assert.rejects(validate());
  assert.equal(await validate({ ...analysis({ redMate: 1 }), bestMove: 'e10f10' }), undefined);
});
