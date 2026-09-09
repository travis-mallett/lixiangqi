import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import type { EngineAnalysis } from 'lib/ceval/engines/pikafishProtocol';

import type { PuzzleOpts } from '../src/interfaces.ts';

mock.module(new URL('../src/keyboard.ts', import.meta.url).href, { defaultExport: () => {} });
mock.module('lib/ceval', {
  namedExports: {
    CevalCtrl: class {
      reset() {}
    },
    winningChances: {},
  },
});
mock.module('lib/bigFileStorage', { namedExports: { bigFileStorage: () => ({}) } });
mock.module('voice', { namedExports: { makeVoiceMove: () => undefined } });
mock.module('keyboard-move', { namedExports: { ctrl: () => undefined } });
mock.module('lib/permalog', { namedExports: { log: () => Promise.resolve() } });
const { default: PuzzleCtrl } = await import('../src/ctrl.ts');
const { default: XiangqiPuzzleEngine } = await import('../src/xiangqiPuzzleEngine.ts');

const fen = '4k4/9/9/9/4p4/9/9/9/9/R3K4 w - - 0 1';
const opts = (): PuzzleOpts => ({
  data: {
    variant: 'xiangqi',
    puzzle: {
      id: 'test',
      solution: ['a1a2', 'e10d10', 'a2a3'],
      rating: 1500,
      plays: 1,
      initialPly: 0,
      themes: [],
      state: { fen, ply: 0, turn: 'red', legalMoves: ['a1a2', 'a1a4'], check: false, gameResult: '*' },
    },
    game: { id: 'test', initialFen: fen, pgn: '', moves: [], rated: false, players: [] as any },
    angle: { key: 'mix', name: 'mix', desc: '' },
  },
  pref: {
    animation: { duration: 0 },
    notationStyle: 'wxf',
    coords: 0,
    destination: true,
    highlight: true,
    rookCastle: false,
    moveEvent: 0,
    blindfold: false,
    keyboardMove: false,
    voiceMove: false,
  },
  settings: { difficulty: 'normal' },
  showRatings: false,
  externalEngineEndpoint: '',
});

function controller(
  options = opts(),
  starting = async (): Promise<EngineAnalysis> => ({
    engine: 'test',
    depth: 18,
    nodes: 1,
    nps: 1,
    timeMs: 1,
    score: { redCp: 800 },
    lines: [],
  }),
) {
  Object.assign(site, { sound: { load() {}, play() {}, say() {}, move() {} }, blindMode: true });
  const chain = {
    addClass() {
      return chain;
    },
    on() {
      return chain;
    },
  };
  Object.assign(globalThis, { $: () => chain, location: window.location });
  (window as any).lichess = {};
  const initialSearch = mock.method(XiangqiPuzzleEngine.prototype, 'evaluate', starting);
  const ctrl = new PuzzleCtrl(options, () => {});
  initialSearch.mock.restore();
  const results: boolean[] = [];
  ctrl.sendResult = async win => {
    results.push(win);
  };
  ctrl.autoNext(false);
  return { ctrl, results };
}

async function readyController(options = opts()) {
  const result = controller(options);
  await new Promise<void>(resolve => setImmediate(resolve));
  return result;
}

test('stored solution playback does not invoke the alternative evaluator', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { ctrl, results } = await readyController();
  const internal = ctrl as any;
  internal.xiangqiEngine = {
    evaluate() {
      throw new Error('stored path must not evaluate');
    },
  };
  const { makeXiangqiNode } = await import('../src/xiangqi.ts');
  const { linePositions } = await import('../src/xiangqiAdjudication.ts');
  const positions = linePositions(fen, ctrl.data.puzzle.solution);
  for (let index = 0; index < 3; index++) {
    const state = { ...positions[index + 1], needsHydration: false };
    ctrl.addNode(makeXiangqiNode(state, ctrl.data.puzzle.solution[index], '', 0), ctrl.path);
    await internal.adjudicateXiangqi();
  }
  assert.deepEqual(results, [true]);
  assert.equal(ctrl.mode, 'view');
});

test('alternative playback caches the starting evaluation and continues with engine replies', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { ctrl, results } = await readyController();
  const internal = ctrl as any;
  const evaluated: string[] = [];
  internal.xiangqiEngine = {
    evaluate: async (position: string): Promise<EngineAnalysis> => {
      evaluated.push(position);
      return {
        engine: 'test',
        depth: 18,
        nodes: 1,
        nps: 1,
        timeMs: 1,
        score: { redCp: 800 },
        bestMove: 'e10d10',
        lines: [],
      };
    },
  };
  const { makeXiangqiNode } = await import('../src/xiangqi.ts');
  const { linePositions } = await import('../src/xiangqiAdjudication.ts');
  const position = linePositions(fen, ['a1a4'])[1];
  ctrl.addNode(
    makeXiangqiNode({ ...position, legalMoves: ['e10d10'], needsHydration: false }, 'a1a4', '', 0),
    ctrl.path,
  );
  await internal.adjudicateXiangqi();
  assert.deepEqual(evaluated, [position.fen]);
  assert.equal(ctrl.lastFeedback, 'good');
  assert.deepEqual(results, []);
  await internal.adjudicateXiangqi();
  assert.deepEqual(evaluated, [position.fen, position.fen]);
});

test('a stale deviation evaluation cannot adjudicate the next puzzle', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { ctrl, results } = await readyController();
  const internal = ctrl as any;
  let resolve!: (analysis: EngineAnalysis) => void;
  let evaluations = 0;
  internal.xiangqiEngine = {
    stop() {},
    evaluate: () => {
      evaluations++;
      return new Promise<EngineAnalysis>(r => {
        resolve = r;
      });
    },
  };
  const { makeXiangqiNode } = await import('../src/xiangqi.ts');
  const { linePositions } = await import('../src/xiangqiAdjudication.ts');
  const position = linePositions(fen, ['a1a4'])[1];
  ctrl.addNode(makeXiangqiNode({ ...position, needsHydration: false }, 'a1a4', '', 0), ctrl.path);
  const pending = internal.adjudicateXiangqi();
  const resolveOld = resolve;
  ctrl.initiate({ ...opts().data, puzzle: { ...opts().data.puzzle, id: 'next' } });
  resolveOld({ engine: 'test', depth: 18, nodes: 1, nps: 1, timeMs: 1, score: { redCp: 800 }, lines: [] });
  await pending;
  assert.equal(evaluations, 2);
  assert.equal(ctrl.data.puzzle.id, 'next');
  assert.equal(ctrl.lastFeedback, 'init');
  assert.deepEqual(results, []);
});

test('rules requests preserve history and engine errors leave an explicit retry without scoring', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { ctrl, results } = await readyController();
  const internal = ctrl as any;
  const { linePositions } = await import('../src/xiangqiAdjudication.ts');
  const requests: { initialFen: string; moves: string[]; move: string }[] = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init!.body as string);
    requests.push(request);
    const positions = linePositions(request.initialFen, [...request.moves, request.move]);
    return new Response(
      JSON.stringify({
        ...positions[positions.length - 1],
        legalMoves: ['e10d10'],
        needsHydration: false,
        notation: '',
        chineseNotation: '',
      }),
    );
  });
  t.mock.method(console, 'error', () => {});
  internal.xiangqiEngine = {
    evaluate: async () => {
      throw new Error('offline');
    },
  };
  await internal.playXiangqiUciAt(ctrl.path, 'a1a4');
  assert.equal(ctrl.path, ctrl.initialPath);
  assert.equal(ctrl.xiangqiEngineError, true);
  assert.equal(typeof ctrl.xiangqiRetry, 'function');
  assert.equal(ctrl.mode, 'play');
  assert.deepEqual(results, []);
  internal.xiangqiEngine = {
    evaluate: async (): Promise<EngineAnalysis> => ({
      engine: 'test',
      depth: 18,
      nodes: 1,
      nps: 1,
      timeMs: 1,
      score: { redCp: 800 },
      bestMove: 'e10d10',
      lines: [],
    }),
  };
  await internal.playXiangqiUciAt(ctrl.path, 'a1a4');
  await internal.playXiangqiUciAt(ctrl.path, 'e10d10');
  assert.deepEqual(requests[2].moves, ['a1a4']);
  const { puzzleAnalysisTree } = await import('../src/xiangqi.ts');
  const exported = puzzleAnalysisTree(ctrl.initialNode);
  assert.equal(exported.root.children[0].uci, 'a1a4');
  assert.equal(exported.root.children[0].children[0].uci, 'e10d10');
  assert.equal(requests[2].initialFen, fen);
  assert.equal(ctrl.lastFeedback, 'good');
  assert.deepEqual(results, []);
});

test('Ls8lj rejects a mate score without a complete continuation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const initial = '4k1b2/4a4/3ab4/3P1P3/9/1N5p1/5n3/4p1C2/4A4/3K2c2 b - - 1 65';
  const options = opts();
  options.data.game.initialFen = initial;
  options.data.puzzle.solution = ['e3e2', 'b5d4', 'f4d3', 'g3f3', 'g1f1', 'd7c7', 'd3e1'];
  options.data.puzzle.themes = ['mateIn4'];
  options.data.puzzle.state = { ...options.data.puzzle.state!, fen: initial, turn: 'black', ply: 129 };
  const { ctrl, results } = await readyController(options);
  const internal = ctrl as any;
  const { makeXiangqiNode } = await import('../src/xiangqi.ts');
  const { linePositions } = await import('../src/xiangqiAdjudication.ts');
  const moves = ['e3e2', 'g3f3', 'f4d3', 'b5c3', 'h5g5'];
  const positions = linePositions(initial, moves);
  for (let i = 0; i < moves.length; i++)
    ctrl.addNode(
      makeXiangqiNode({ ...positions[i + 1], legalMoves: ['f7f8'], needsHydration: false }, moves[i], '', 0),
      ctrl.path,
    );
  internal.xiangqiEngine = {
    evaluate: async (position: string): Promise<EngineAnalysis> => ({
      engine: 'test',
      depth: 18,
      nodes: 1,
      nps: 1,
      timeMs: 1,
      score: { redMate: position === initial ? -4 : -2 },
      bestMove: 'f7f8',
      lines: [],
    }),
  };
  await internal.adjudicateXiangqi();
  assert.equal(ctrl.lastFeedback, 'fail');
  assert.equal(internal.xiangqiReplyPending, false);
  assert.equal(internal.xiangqiObjective.allowance, 12);
  assert.deepEqual(results, [false]);
});

test('an authoritative draw overrides a matching solution without engine evaluation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const options = opts();
  options.data.puzzle.solution = ['a1a2'];
  const { ctrl, results } = await readyController(options);
  const { makeXiangqiNode } = await import('../src/xiangqi.ts');
  ctrl.addNode(
    makeXiangqiNode({ ...options.data.puzzle.state!, gameResult: '1/2-1/2' }, 'a1a2', '', 0),
    ctrl.path,
  );
  await (ctrl as any).adjudicateXiangqi();
  assert.deepEqual(results, [false]);
});

test('alternative nodes remain distinct after 26 sibling attempts', async () => {
  const { makeXiangqiNode } = await import('../src/xiangqi.ts');
  const state = opts().data.puzzle.state!;
  const ids = Array.from({ length: 100 }, (_, i) => makeXiangqiNode(state, 'a1a2', '', i).id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => id.length === 2));
});

// These tests exercise controller contracts with mocked native results. The
// browser's linePositions helper reconstructs boards; it does not adjudicate.
const matingAnalysis = (pvMoves: string[] = []): EngineAnalysis => ({
  engine: 'test',
  depth: 18,
  nodes: 1,
  nps: 1,
  timeMs: 1,
  score: { redMate: 20 },
  bestMove: pvMoves[0],
  lines: [{ multipv: 1, depth: 18, score: { redMate: 20 }, pvMoves, wxfMoves: [] }],
});

test('accepted mating continuation supplies replies, hints, and completion without more searches', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const options = opts();
  options.data.puzzle.themes = ['mateIn2'];
  const { ctrl, results } = await readyController(options);
  const internal = ctrl as any;
  const { makeXiangqiNode, nextXiangqiMove } = await import('../src/xiangqi.ts');
  const { linePositions } = await import('../src/xiangqiAdjudication.ts');
  const accepted = ['a1a4', 'e10d10', 'a4a5', 'd10e10', 'a5e5'];
  const positions = linePositions(fen, accepted);
  let searches = 0;
  internal.xiangqiEngine = {
    evaluate: async () => {
      searches++;
      if (searches > 1) throw new Error('retained continuation must not search');
      return matingAnalysis(accepted.slice(1));
    },
  };
  const validations: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, '/api/analysis/position');
    validations.push(JSON.parse(init!.body as string));
    return new Response(JSON.stringify({ ...positions.at(-1), gameResult: '1-0' }));
  });
  for (let i = 0; i < accepted.length; i++) {
    if (i > 0) assert.equal(nextXiangqiMove(ctrl), accepted[i]);
    ctrl.addNode(
      makeXiangqiNode(
        {
          ...positions[i + 1],
          needsHydration: false,
          legalMoves: accepted[i + 1] ? [accepted[i + 1]] : [],
          gameResult: i === accepted.length - 1 ? '1-0' : '*',
        },
        accepted[i],
        '',
        0,
      ),
      ctrl.path,
    );
    await internal.adjudicateXiangqi();
  }
  assert.equal(searches, 1);
  assert.deepEqual(validations, [{ initialFen: fen, moves: accepted }]);
  assert.equal(internal.xiangqiObjective.allowance, 4);
  assert.deepEqual(ctrl.xiangqiContinuation, accepted);
  assert.deepEqual(results, [true]);
});

test('failed mating deviations and evaluation errors preserve the accepted continuation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const options = opts();
  options.data.puzzle.themes = ['mateIn2'];
  const { ctrl, results } = await readyController(options);
  const internal = ctrl as any;
  const { makeXiangqiNode, nextXiangqiMove } = await import('../src/xiangqi.ts');
  const { linePositions } = await import('../src/xiangqiAdjudication.ts');
  const accepted = ['a1a4', 'e10d10', 'a4a5'];
  const positions = linePositions(fen, accepted);
  let analysis = matingAnalysis(accepted.slice(1));
  internal.xiangqiEngine = { evaluate: async () => analysis };
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify({ ...positions[3], gameResult: '1-0' })),
  );
  ctrl.addNode(makeXiangqiNode({ ...positions[1], legalMoves: ['e10d10'] }, 'a1a4', '', 0), ctrl.path);
  await internal.adjudicateXiangqi();
  ctrl.addNode(makeXiangqiNode(positions[2], 'e10d10', '', 0), ctrl.path);
  await internal.adjudicateXiangqi();
  const path = ctrl.path;
  const deviation = linePositions(positions[2].fen, ['a4a6'])[1];
  analysis = matingAnalysis();
  ctrl.addNode(makeXiangqiNode(deviation, 'a4a6', '', 0), path);
  await internal.adjudicateXiangqi();
  assert.equal(ctrl.path, path);
  assert.equal(nextXiangqiMove(ctrl), 'a4a5');
  assert.deepEqual(ctrl.xiangqiContinuation, accepted);
  assert.deepEqual(results, [false]);
  internal.xiangqiEngine = {
    evaluate: async () => {
      throw new Error('timeout');
    },
  };
  ctrl.addNode(makeXiangqiNode(deviation, 'a4a6', '', 1), path);
  await assert.rejects(internal.adjudicateXiangqi(), /timeout/);
  assert.deepEqual(ctrl.xiangqiContinuation, accepted);
});

test('a stale continuation validation cannot replace the next puzzle solution', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const options = opts();
  options.data.puzzle.themes = ['mateIn2'];
  const { ctrl, results } = await readyController(options);
  const internal = ctrl as any;
  const { makeXiangqiNode } = await import('../src/xiangqi.ts');
  const { linePositions } = await import('../src/xiangqiAdjudication.ts');
  const position = linePositions(fen, ['a1a4'])[1];
  let resolve!: (response: Response) => void;
  let requested!: () => void;
  const requestStarted = new Promise<void>(r => {
    requested = r;
  });
  t.mock.method(
    globalThis,
    'fetch',
    () =>
      new Promise<Response>(r => {
        resolve = r;
        requested();
      }),
  );
  internal.xiangqiEngine = { stop() {}, evaluate: async () => matingAnalysis(['e10d10', 'a4a5']) };
  ctrl.addNode(makeXiangqiNode({ ...position, legalMoves: ['e10d10'] }, 'a1a4', '', 0), ctrl.path);
  const pending = internal.adjudicateXiangqi();
  await requestStarted;
  ctrl.initiate({ ...opts().data, puzzle: { ...opts().data.puzzle, id: 'next' } });
  resolve(new Response(JSON.stringify({ ...position, gameResult: '1-0' })));
  await pending;
  assert.deepEqual(ctrl.xiangqiContinuation, opts().data.puzzle.solution);
  assert.deepEqual(results, []);
});

test('ambiguous puzzles cannot play until their starting classification fixes the allowance', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolve!: (analysis: EngineAnalysis) => void;
  const { ctrl, results } = controller(
    opts(),
    () =>
      new Promise<EngineAnalysis>(r => {
        resolve = r;
      }),
  );
  const internal = ctrl as any;
  assert.equal(ctrl.xiangqiEvaluating, true);
  assert.equal(ctrl.makeXiangqiGroundOpts().movableColor, undefined);
  const request = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('must not submit yet');
  });
  await internal.playXiangqiUciAt(ctrl.path, 'a1a2');
  assert.equal(request.mock.callCount(), 0);
  resolve(matingAnalysis());
  await new Promise<void>(r => setImmediate(r));
  assert.equal(internal.xiangqiObjective.mate, true);
  assert.equal(internal.xiangqiAllowance, 4);
  assert.equal(ctrl.makeXiangqiGroundOpts().movableColor, 'white');
  assert.deepEqual(results, []);
});

test('starting classification errors stay unscored and block moves until existing retry succeeds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(console, 'error', () => {});
  const { ctrl, results } = controller(opts(), async () => {
    throw new Error('offline');
  });
  const internal = ctrl as any;
  await new Promise<void>(r => setImmediate(r));
  assert.equal(ctrl.xiangqiEngineError, true);
  assert.equal(ctrl.makeXiangqiGroundOpts().movableColor, undefined);
  internal.xiangqiEngine = { evaluate: async () => matingAnalysis() };
  ctrl.xiangqiRetry!();
  await new Promise<void>(r => setImmediate(r));
  assert.equal(ctrl.xiangqiEngineError, false);
  assert.equal(internal.xiangqiAllowance, 4);
  assert.equal(ctrl.makeXiangqiGroundOpts().movableColor, 'white');
  assert.deepEqual(results, []);
});

test('move allowance retry clears the attempt while preserving the rated result and next puzzle', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { ctrl, results } = await readyController();
  const internal = ctrl as any;
  const { makeXiangqiNode } = await import('../src/xiangqi.ts');
  const { linePositions } = await import('../src/xiangqiAdjudication.ts');
  const state = { ...linePositions(fen, ['a1a4'])[1], needsHydration: false };
  ctrl.addNode(makeXiangqiNode(state, 'a1a4', '', 0), ctrl.path);
  const failedPath = ctrl.path;
  const next = ctrl.next;
  const objective = internal.xiangqiObjective;
  ctrl.resultSent = true;
  ctrl.hintHasBeenShown(true);
  ctrl.xiangqiFailure = 'moveAllowanceExceeded';
  ctrl.applyProgress('fail');
  assert.equal(ctrl.path, failedPath);
  assert.equal(ctrl.makeXiangqiGroundOpts().movableColor, undefined);
  ctrl.toggleHint();
  assert.equal(ctrl.showHint(), false);
  const request = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('exhausted attempts cannot submit another move');
  });
  await internal.playXiangqiUciAt(ctrl.path, 'e10d10');
  assert.equal(request.mock.callCount(), 0);
  const generation = internal.xiangqiGeneration;
  ctrl.retryPuzzle();
  assert.ok(internal.xiangqiGeneration > generation);
  assert.equal(ctrl.path, ctrl.initialPath);
  assert.equal(ctrl.initialNode.children.length, 0);
  assert.deepEqual(ctrl.xiangqiContinuation, ctrl.data.puzzle.solution);
  assert.equal(ctrl.mode, 'try');
  assert.equal(ctrl.lastFeedback, 'init');
  assert.equal(ctrl.xiangqiFailure, undefined);
  assert.equal(ctrl.resultSent, true);
  assert.equal(ctrl.hintHasBeenShown(), true);
  assert.equal(ctrl.next, next);
  assert.equal(internal.xiangqiObjective, objective);
  assert.equal(ctrl.makeXiangqiGroundOpts().movableColor, 'white');
  ctrl.addNode(makeXiangqiNode(state, 'a1a4', '', 0), ctrl.path);
  ctrl.applyProgress('win');
  assert.equal(ctrl.solvedMoves, 1);
  assert.deepEqual(results, [false]);
  ctrl.jump(ctrl.initialPath);
  assert.equal(ctrl.solvedMoves, 1, 'review navigation must not change the solve statistics');
});
