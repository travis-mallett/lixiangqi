import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RulesState } from 'xiangqi';

import type { EngineAnalysis, EngineScore } from 'lib/ceval/engines/pikafishProtocol';

import {
  adjudicateAlternative,
  linePositions,
  makeObjective,
  material,
  playerScore,
  playerMoveAllowance,
  storedLineProgress,
  winningContinuation,
  type PuzzleObjective,
} from '../src/xiangqiAdjudication.ts';

const fen = '4k4/9/9/9/4p4/9/9/9/9/R3K4 w - - 0 1';
const analysis = (score: EngineScore, pvMoves: string[] = []): EngineAnalysis => ({
  engine: 'Pikafish',
  depth: 18,
  nodes: 100,
  nps: 100,
  timeMs: 1000,
  score,
  bestMove: pvMoves[0],
  lines: [{ multipv: 1, depth: 18, seldepth: 20, score, pvMoves, wxfMoves: [] }],
});
const cp = (value: number, pv: string[] = []) => analysis({ redCp: value }, pv);
const state = (position = fen, gameResult = '*'): RulesState => ({
  fen: position,
  gameResult,
  turn: 'red',
  ply: 0,
  legalMoves: [],
  check: false,
});
const objective = (overrides: Partial<PuzzleObjective> = {}): PuzzleObjective => ({
  mate: false,
  startingCp: 800,
  player: 'red',
  allowance: 6,
  startingMaterial: 8,
  targetMaterial: 8,
  targetPosition: 'different position',
  ...overrides,
});

test('stored playback returns immediate replies and wins only on the matching line', () => {
  const solution = ['a1a2', 'e10d10', 'a2a3'];
  assert.deepEqual(storedLineProgress(solution, ['a1a2']), { kind: 'reply', uci: 'e10d10' });
  assert.deepEqual(storedLineProgress(solution, solution.slice(0, 2)), { kind: 'wait' });
  assert.deepEqual(storedLineProgress(solution, solution), { kind: 'win' });
  assert.deepEqual(storedLineProgress(solution, ['a1a4', 'e10d10', 'a4a3']), { kind: 'alternative' });
  assert.deepEqual(storedLineProgress(solution, [...solution, 'd10e10', 'a3a4']), { kind: 'alternative' });
});

test('tactical tolerance is inclusive and always uses the starting advantage', () => {
  const target = objective();
  for (const value of [800, 600, 500, 400])
    assert.deepEqual(adjudicateAlternative(target, state(), cp(value), 2), { result: 'continue' });
  assert.deepEqual(adjudicateAlternative(target, state(), cp(399), 3), {
    result: 'fail',
    reason: 'advantageLost',
  });
  assert.deepEqual(adjudicateAlternative(objective({ startingCp: 754 }), state(), cp(3), 1), {
    result: 'fail',
    reason: 'advantageLost',
  });
});

test('both evaluations use the player perspective for black', () => {
  assert.deepEqual(playerScore({ redCp: -800 }, 'black'), { cp: 800, mate: undefined });
  assert.deepEqual(playerScore({ redMate: -9 }, 'black'), { cp: undefined, mate: 9 });
  const target = objective({ player: 'black' });
  assert.equal(adjudicateAlternative(target, state(), cp(-400), 1).result, 'continue');
  assert.deepEqual(adjudicateAlternative(target, state(), cp(-399), 1), {
    result: 'fail',
    reason: 'advantageLost',
  });
});

test('mate scores alone never establish a qualifying continuation', () => {
  const target = objective({ mate: true });
  for (const distance of [1, 20, 100])
    assert.equal(adjudicateAlternative(target, state(), analysis({ redMate: distance }), 2).result, 'fail');
  for (const score of [{ redCp: 30000 }, { redMate: -2 }, { redMate: 0 }])
    assert.deepEqual(adjudicateAlternative(target, state(), analysis(score), 2), {
      result: 'fail',
      reason: 'forcedMateLost',
    });
});

test('finding mate does not turn a tactical objective into a mating objective', () => {
  const target = objective();
  assert.equal(adjudicateAlternative(target, state(), analysis({ redMate: 5 }), 1).result, 'continue');
  assert.equal(adjudicateAlternative(target, state(), cp(500), 2).result, 'continue');
  assert.equal(target.mate, false);
});

test('allowances use stored solver moves with mating allowances of three, four, then three times N', () => {
  const moves = ['a1a2', 'e10d10', 'a2a3'];
  assert.equal(makeObjective(fen, moves, cp(800), false).allowance, 6);
  assert.equal(makeObjective(fen, [...moves, 'd10e10'], cp(800), false).allowance, 6);
  assert.equal(makeObjective(fen, ['a1a2'], analysis({ redMate: 12 }), true).mate, true);
  assert.equal(makeObjective(fen, moves, analysis({ redMate: 12 }), false).mate, true);
  assert.equal(makeObjective(fen, moves, analysis({ redMate: 12 }), false).allowance, 4);
  assert.equal(makeObjective(fen, moves, undefined, true).allowance, 4);
  for (const n of [1, 2, 3, 4, 10]) {
    for (const plies of [2 * n - 1, 2 * n]) {
      const solution = Array<string>(plies).fill('a1a2');
      assert.equal(playerMoveAllowance(solution, true), n === 2 ? 4 : 3 * n);
      assert.equal(playerMoveAllowance(solution, false), 3 * n);
    }
  }
  for (const distance of [1, 2, 12])
    assert.equal(makeObjective(fen, moves, analysis({ redMate: distance }), true).allowance, 4);
});

test('reaching stored length is not success, and a winning detour expires at the fixed allowance', () => {
  assert.equal(adjudicateAlternative(objective(), state(), cp(800), 2).result, 'continue');
  assert.deepEqual(adjudicateAlternative(objective(), state(), cp(800), 6), {
    result: 'fail',
    reason: 'moveAllowanceExceeded',
  });
  assert.deepEqual(adjudicateAlternative(objective({ mate: true }), state(), analysis({ redMate: 1 }), 6), {
    result: 'fail',
    reason: 'moveAllowanceExceeded',
  });
});

test('terminal success precedes the move allowance and needs no engine score', () => {
  assert.deepEqual(adjudicateAlternative(objective({ mate: true }), state(fen, '1-0'), undefined, 6), {
    result: 'win',
  });
  assert.deepEqual(adjudicateAlternative(objective({ player: 'black' }), state(fen, '0-1'), undefined, 6), {
    result: 'win',
  });
  assert.deepEqual(adjudicateAlternative(objective(), state(fen, '1/2-1/2'), undefined, 1), {
    result: 'fail',
    reason: 'advantageLost',
  });
  assert.deepEqual(adjudicateAlternative(objective(), state(fen, '1-0'), undefined, 7), {
    result: 'fail',
    reason: 'moveAllowanceExceeded',
  });
});

test('Ls8lj mate scores after p8=7 require a complete continuation', () => {
  const initial = '4k1b2/4a4/3ab4/3P1P3/9/1N5p1/5n3/4p1C2/4A4/3K2c2 b - - 1 65';
  const solution = ['e3e2', 'b5d4', 'f4d3', 'g3f3', 'g1f1', 'd7c7', 'd3e1'];
  const positions = linePositions(initial, ['e3e2', 'g3f3', 'f4d3', 'b5c3', 'h5g5']);
  const target = makeObjective(initial, solution, analysis({ redMate: -4 }), true);
  assert.equal(target.allowance, 12);
  // Scores verified with the browser Pikafish at depth 18. The solver is Black
  // while Red is to move after the alternative pawn move.
  assert.equal(positions[5].turn, 'red');
  assert.deepEqual(adjudicateAlternative(target, positions[5], analysis({ redMate: -2 }), 3), {
    result: 'fail',
    reason: 'forcedMateLost',
  });
  assert.deepEqual(adjudicateAlternative(target, positions[5], analysis({ redMate: -5 }), 3), {
    result: 'fail',
    reason: 'forcedMateLost',
  });
  assert.deepEqual(adjudicateAlternative(target, positions[5], analysis({ redCp: -2000 }), 3), {
    result: 'fail',
    reason: 'forcedMateLost',
  });
});

test('equivalent stored position ignores move counters and wins on the last allowed move', () => {
  const target = objective({ targetPosition: fen.split(' ').slice(0, 2).join(' ') });
  assert.deepEqual(adjudicateAlternative(target, state(fen.replace('0 1', '8 7')), cp(400), 6), {
    result: 'win',
  });
  assert.equal(
    adjudicateAlternative({ ...target, mate: true }, state(), analysis({ redMate: 3 }), 1).result,
    'fail',
  );
});

test('material completion requires realized gain and rejects pending recapture', () => {
  const target = objective({ startingMaterial: 4, targetMaterial: 8 });
  assert.equal(material(fen, 'red'), 8);
  assert.equal(material(fen, 'black'), -8);
  assert.deepEqual(adjudicateAlternative(target, state(), cp(800, ['e10d10']), 6), { result: 'win' });
  const hanging = '4k4/9/9/9/4p4/9/9/9/r8/R3K4 b - - 0 1';
  assert.equal(
    adjudicateAlternative(
      objective({ startingMaterial: -5, targetMaterial: -1 }),
      state(hanging),
      cp(800, ['a2a1']),
      2,
    ).result,
    'continue',
  );
  assert.equal(adjudicateAlternative(target, state(), cp(800), 2).result, 'continue');
});

test('starting objective uses puzzle position after the setup move and rejects unusable baselines', () => {
  const positions = linePositions(fen, ['a1a2']);
  const target = makeObjective(positions[1].fen, ['e10d10'], cp(-800), false);
  assert.equal(target.player, 'black');
  assert.equal(target.startingCp, 800);
  assert.throws(() => makeObjective(fen, ['a1a2'], cp(0), false), /starting advantage/);
});

test('qualifying continuations replay full history and count only solver moves for either color', async t => {
  // The endpoint is the native legality/termination authority. These mocked
  // responses test the puzzle contract, not a second implementation of rules.
  const requests: unknown[] = [];
  let finalState = state(fen, '1-0');
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(_url, '/api/analysis/position');
    requests.push(JSON.parse(init!.body as string));
    return new Response(JSON.stringify(finalState));
  });
  const history = { initialFen: fen, moves: ['a1a4', 'e10d10', 'a4a5'] };
  const pv = ['d10e10', 'a5a6', 'e10d10', 'a6a7'];
  for (const player of ['red', 'black'] as const) {
    const target = objective({ mate: true, player, allowance: 4 });
    const current = {
      ...state(),
      turn: player === 'red' ? ('black' as const) : ('red' as const),
      legalMoves: [pv[0]],
    };
    finalState = state(fen, player === 'red' ? '1-0' : '0-1');
    const evaluation = analysis({ redMate: player === 'red' ? 9 : -9 }, pv);
    const continuation = await winningContinuation(target, current, evaluation, 2, history);
    assert.deepEqual(continuation, { moves: pv, finalState });
    assert.notEqual(continuation.moves, evaluation.lines[0].pvMoves);
    assert.deepEqual(adjudicateAlternative(target, current, evaluation, 2, continuation), {
      result: 'continue',
    });
    assert.deepEqual(requests.at(-1), { initialFen: fen, moves: [...history.moves, ...pv] });
    // The identical line cannot fit after consuming one additional solver move.
    const before = requests.length;
    assert.equal(await winningContinuation(target, current, evaluation, 3, history), undefined);
    assert.equal(requests.length, before);
  }
  assert.deepEqual(history.moves, ['a1a4', 'e10d10', 'a4a5']);
  assert.deepEqual(pv, ['d10e10', 'a5a6', 'e10d10', 'a6a7']);
});

test('solver-to-move continuations include the first solver move in their budget', async t => {
  const request = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify(state(fen, '1-0'))),
  );
  const target = objective({ mate: true, allowance: 4 });
  const pv = ['a1a2', 'e10d10', 'a2a3'];
  const current = { ...state(), legalMoves: [pv[0]] };
  const evaluation = analysis({ redMate: 2 }, pv);
  const history = { initialFen: fen, moves: [] };
  assert.ok(await winningContinuation(target, current, evaluation, 2, history));
  assert.equal(await winningContinuation(target, current, evaluation, 3, history), undefined);
  assert.equal(request.mock.callCount(), 1);
});

test('missing, invalid, inconsistent, and over-budget engine lines fail without native replay', async t => {
  const request = t.mock.method(globalThis, 'fetch', async () => {
    assert.fail('unqualified engine analysis must not reach native validation');
  });
  const target = objective({ mate: true, allowance: 4 });
  const current = { ...state(), turn: 'black' as const, legalMoves: ['e10d10'] };
  const pv = ['e10d10', 'a1a2'];
  const good = analysis({ redMate: 1 }, pv);
  const history = { initialFen: fen, moves: [] };
  for (const evaluation of [
    analysis({ redMate: 1 }),
    { ...good, lines: [] },
    { ...good, bestMove: undefined },
    { ...good, bestMove: 'e10f10' },
    analysis({ redMate: 1 }, ['e10f10', 'a1a2']),
    ...[
      {},
      { redCp: 30000 },
      { redMate: 0 },
      { redMate: -1 },
      { redMate: NaN },
      { redMate: Infinity },
      { redMate: 1, bound: 'lower' as const },
      { redMate: 1, bound: 'upper' as const },
    ].map(score => analysis(score, pv)),
    analysis({ redMate: 1 }, [...pv, ...pv, ...pv]),
  ])
    assert.equal(await winningContinuation(target, current, evaluation, 2, history), undefined);
  assert.equal(await winningContinuation(target, current, good, 4, history), undefined);
  assert.equal(await winningContinuation(target, current, good, 5, history), undefined);
  assert.equal(request.mock.callCount(), 0);
});

test('an unfinished PV, native draw, or native loss cannot establish a winning continuation', async t => {
  let result = '*';
  const request = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify(state(fen, result))),
  );
  const pv = ['e10d10', 'a1a2'];
  for (const player of ['red', 'black'] as const) {
    const target = objective({ mate: true, player });
    const current = {
      ...state(),
      turn: player === 'red' ? ('black' as const) : ('red' as const),
      legalMoves: [pv[0]],
    };
    for (result of ['*', '1/2-1/2', player === 'red' ? '0-1' : '1-0']) {
      assert.equal(
        await winningContinuation(target, current, analysis({ redMate: player === 'red' ? 1 : -1 }, pv), 1, {
          initialFen: fen,
          moves: [],
        }),
        undefined,
      );
    }
  }
  assert.equal(request.mock.callCount(), 6);
});

test('native illegal PV is a failed move while service and network failures remain errors', async t => {
  let status = 400;
  t.mock.method(globalThis, 'fetch', async () => {
    if (!status) throw new Error('network unavailable');
    return new Response(
      JSON.stringify({ error: status === 400 ? 'Illegal Xiangqi move' : 'service unavailable' }),
      { status },
    );
  });
  const validate = () =>
    winningContinuation(
      objective({ mate: true }),
      { ...state(), turn: 'black', legalMoves: ['e10d10'] },
      analysis({ redMate: 1 }, ['e10d10', 'a1a2']),
      1,
      { initialFen: fen, moves: ['a1a4'] },
    );
  assert.equal(await validate(), undefined);
  status = 500;
  await assert.rejects(validate(), /service unavailable/);
  status = 0;
  await assert.rejects(validate(), /network unavailable/);
});
