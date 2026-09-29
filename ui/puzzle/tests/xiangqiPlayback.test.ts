import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import type { EngineAnalysis } from 'lib/ceval/engines/pikafishProtocol';

import type { PuzzleOpts } from '../src/interfaces.ts';

mock.module(new URL('../src/keyboard.ts', import.meta.url).href, { defaultExport: () => {} });
mock.module('lib/bigFileStorage', { namedExports: { bigFileStorage: () => ({}) } });
mock.module('lib/permalog', { namedExports: { log: () => Promise.resolve() } });
const { default: PuzzleCtrl } = await import('../src/ctrl.ts');
const { default: XiangqiPuzzleEngine } = await import('../src/xiangqiPuzzleEngine.ts');

const fen = '4k4/9/9/9/4p4/9/9/9/9/R3K4 w - - 0 1';
const opts = (): PuzzleOpts => ({
  data: {
    variant: 'xiangqi',
    puzzle: {
      id: 'test',
      playback: { objective: 'tactic', startingCp: 800, solutions: [['a1a2', 'e10d10', 'a2a3']] },
      rating: 1500,
      plays: 1,
      initialPly: 0,
      themes: [],
      state: { fen, ply: 0, turn: 'red', legalMoves: ['a1a2', 'a1a4'], check: false, gameResult: '*' },
    },
    game: { id: 'test', initialFen: fen, moves: [], rated: false, players: [] as any },
    angle: { key: 'mix', name: 'mix', desc: '', icon: 'mix.svg' },
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
  },
  settings: { difficulty: 'normal' },
  showRatings: false,
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
  prepare = async (): Promise<void> => {},
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
  const preparation = mock.method(XiangqiPuzzleEngine.prototype, 'prepare', prepare);
  const ctrl = new PuzzleCtrl(options, () => {});
  preparation.mock.restore();
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

test('preparation locks every player input without searching or recording an attempt', async t => {
  let ready!: () => void;
  const preparation = new Promise<void>(resolve => {
    ready = resolve;
  });
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    assert.fail('loading must not submit a move');
  });
  const { ctrl, results } = controller(opts(), undefined, () => preparation);
  assert.equal(ctrl.boardSetup().canMove, false);
  assert.deepEqual(ctrl.boardSetup().legalMoves, []);
  assert.equal(ctrl.canHint(), false);
  ctrl.userXiangqiMove('a1a2');
  ctrl.playUci('a1a2');
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(results, []);
  ready();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(ctrl.boardSetup().canMove, true);
  assert.equal(ctrl.canHint(), true);
  assert.deepEqual(results, []);
});

test('startup failure exposes Retry before completion and recovery unlocks the board', async t => {
  t.mock.method(console, 'error', () => {});
  const { ctrl, results } = controller(opts(), undefined, async () => {
    throw new Error('download failed');
  });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(ctrl.engineStatus.state, 'error');
  assert.equal(ctrl.completed, false);
  assert.equal(ctrl.canRetry(), true);
  assert.equal(ctrl.boardSetup().canMove, false);
  t.mock.method(XiangqiPuzzleEngine.prototype, 'prepare', async () => {});
  ctrl.retryFailedMove();
  assert.equal(ctrl.canRetry(), false, 'retry cannot start overlapping preparations');
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(ctrl.engineStatus.state, 'ready');
  assert.equal(ctrl.boardSetup().canMove, true);
  assert.deepEqual(results, []);
});

test('only Hint is available until a failure or success, including keyboard Next', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { default: actions } = await import('../src/view/actions.ts');
  for (const outcome of ['fail', 'win'] as const) {
    const { ctrl, results } = await readyController();
    const children = () => actions(ctrl).children as import('snabbdom').VNode[];
    assert.deepEqual(
      children().map(v => v.data?.attrs?.disabled),
      [true, true, false, true, true],
    );
    assert.equal(children()[2].sel, 'button.fbt.hint');
    ctrl.nextPuzzle();
    ctrl.viewSolution();
    ctrl.retryPuzzle();
    assert.deepEqual(results, []);
    assert.equal(ctrl.completed, false);
    assert.equal(ctrl.mode, 'play');
    if (outcome === 'fail') (ctrl as any).setXiangqiFailure({ result: 'fail', reason: 'forcedMateLost' });
    ctrl.applyProgress(outcome);
    assert.equal(ctrl.canUseActions(), true);
    assert.equal(ctrl.canHint(), false);
    assert.equal(children()[2].sel, 'a.fbt.analyze');
    assert.ok(children()[2].data?.attrs?.href);
    assert.equal(children()[1].data?.attrs?.disabled, false);
    assert.equal(children()[3].data?.attrs?.disabled, false);
    assert.equal(children()[4].data?.attrs?.disabled, false);
    assert.equal(actions(ctrl).data?.class?.failed, outcome === 'fail');
    ctrl.retryPuzzle();
    assert.equal(ctrl.canUseActions(), true, 'completing a puzzle unlocks its review actions until Next');
    ctrl.initiate(opts().data);
    assert.equal(ctrl.canUseActions(), false);
    assert.equal(ctrl.canHint(), true);
  }
});

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
  const positions = linePositions(fen, ctrl.data.puzzle.playback.solutions[0]);
  for (let index = 0; index < 3; index++) {
    const state = { ...positions[index + 1], needsHydration: false };
    ctrl.addNode(makeXiangqiNode(state, ctrl.data.puzzle.playback.solutions[0][index], '', 0), ctrl.path);
    await internal.adjudicateXiangqi();
    assert.equal(ctrl.moveEvaluationDepth, undefined);
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
    evaluate: async (
      position: string,
      _history: unknown,
      _policy: unknown,
      progress: (analysis: EngineAnalysis) => void,
    ): Promise<EngineAnalysis> => {
      assert.equal(ctrl.moveEvaluationDepth, 1);
      progress({ depth: 7, timeMs: 1000 } as EngineAnalysis);
      assert.equal(ctrl.moveEvaluationDepth, 7);
      progress({ depth: 6, timeMs: 900 } as EngineAnalysis);
      assert.equal(ctrl.moveEvaluationDepth, 7);
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
  assert.equal(ctrl.moveEvaluationDepth, undefined);
  assert.deepEqual(results, []);
  await internal.adjudicateXiangqi();
  assert.deepEqual(evaluated, [position.fen]);
});

test('a stale deviation evaluation cannot adjudicate the next puzzle', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { ctrl, results } = await readyController();
  const internal = ctrl as any;
  let resolve!: (analysis: EngineAnalysis) => void;
  let evaluations = 0;
  let progress!: (analysis: EngineAnalysis) => void;
  internal.xiangqiEngine = {
    stop() {},
    evaluate: (_fen: string, _history: unknown, _policy: unknown, onProgress: typeof progress) => {
      progress = onProgress;
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
  assert.equal(ctrl.moveEvaluationDepth, 1);
  ctrl.initiate({ ...opts().data, puzzle: { ...opts().data.puzzle, id: 'next' } });
  progress({ depth: 30 } as EngineAnalysis);
  assert.equal(ctrl.moveEvaluationDepth, undefined);
  resolveOld({ engine: 'test', depth: 18, nodes: 1, nps: 1, timeMs: 1, score: { redCp: 800 }, lines: [] });
  await pending;
  assert.equal(evaluations, 1);
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
  const { puzzleNotationTree } = await import('../src/xiangqi.ts');
  const exported = puzzleNotationTree(ctrl.initialNode, ctrl.initialPath).tree;
  assert.equal(exported.root.children[0].uci, 'a1a4');
  assert.equal(exported.root.children[0].children[0].uci, 'e10d10');
  assert.equal(requests[2].initialFen, fen);
  assert.equal(ctrl.lastFeedback, 'good');
  assert.deepEqual(results, []);
});

test('Ls8lj insufficient mating evidence is unscored', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const initial = '4k1b2/4a4/3ab4/3P1P3/9/1N5p1/5n3/4p1C2/4A4/3K2c2 b - - 1 65';
  const options = opts();
  options.data.game.initialFen = initial;
  options.data.puzzle.playback.solutions[0] = ['e3e2', 'b5d4', 'f4d3', 'g3f3', 'g1f1', 'd7c7', 'd3e1'];
  options.data.puzzle.playback.objective = 'mate';
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
  await assert.rejects(internal.adjudicateXiangqi(), /complete winning continuation/);
  assert.equal(internal.xiangqiObjective.allowance, 12);
  assert.deepEqual(results, []);
});

test('an authoritative draw overrides a matching solution without engine evaluation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const options = opts();
  options.data.puzzle.playback.solutions[0] = ['a1a2'];
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
  score: { redMate: 2 },
  bestMove: pvMoves[0],
  lines: [{ multipv: 1, depth: 18, score: { redMate: 2 }, pvMoves, wxfMoves: [] }],
});

test('accepted mating continuation supplies replies, hints, and completion without more searches', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const options = opts();
  options.data.puzzle.playback.objective = 'mate';
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
  assert.ok(ctrl.solutions.at(accepted)?.complete);
  assert.deepEqual(results, [true]);
});

test('failed mating deviations and evaluation errors preserve the accepted continuation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const options = opts();
  options.data.puzzle.playback.objective = 'mate';
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
  await assert.rejects(internal.adjudicateXiangqi(), /complete winning continuation/);
  ctrl.jump(path);
  assert.equal(nextXiangqiMove(ctrl), 'a4a5');
  assert.ok(ctrl.solutions.at(accepted)?.complete);
  assert.deepEqual(results, []);
  internal.xiangqiEngine = {
    evaluate: async () => {
      throw new Error('timeout');
    },
  };
  ctrl.addNode(makeXiangqiNode(deviation, 'a4a6', '', 1), path);
  await assert.rejects(internal.adjudicateXiangqi(), /timeout/);
  assert.ok(ctrl.solutions.at(accepted)?.complete);
});

test('a stale continuation validation cannot replace the next puzzle solution', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const options = opts();
  options.data.puzzle.playback.objective = 'mate';
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
  assert.ok(ctrl.solutions.at(opts().data.puzzle.playback.solutions[0])?.complete);
  assert.deepEqual(results, []);
});

test('explicit objective metadata starts both puzzle types without engine analysis', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const objective of ['mate', 'tactic'] as const) {
    const options = opts();
    options.data.puzzle.playback.objective = objective;
    const search = t.mock.method(XiangqiPuzzleEngine.prototype, 'evaluate', async () => {
      assert.fail('saved objective must not search');
    });
    const { ctrl } = await readyController(options);
    assert.equal(ctrl.xiangqiEvaluating, false);
    assert.equal((ctrl as any).xiangqiObjective.mate, objective === 'mate');
    assert.equal(ctrl.boardSetup().canMove, true);
    assert.equal(search.mock.callCount(), 0);
    search.mock.restore();
  }
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
  assert.equal(ctrl.boardSetup().canMove, false);
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
  assert.ok(ctrl.solutions.at(ctrl.data.puzzle.playback.solutions[0])?.complete);
  assert.equal(ctrl.mode, 'try');
  assert.equal(ctrl.lastFeedback, 'init');
  assert.equal(ctrl.xiangqiFailure, undefined);
  assert.equal(ctrl.resultSent, true);
  assert.equal(ctrl.hintHasBeenShown(), true);
  assert.equal(ctrl.next, next);
  assert.equal(internal.xiangqiObjective, objective);
  assert.equal(ctrl.boardSetup().canMove, true);
  ctrl.addNode(makeXiangqiNode(state, 'a1a4', '', 0), ctrl.path);
  ctrl.applyProgress('win');
  assert.equal(ctrl.solvedMoves, 1);
  assert.deepEqual(results, [false]);
  ctrl.jump(ctrl.initialPath);
  assert.equal(ctrl.solvedMoves, 1, 'review navigation must not change the solve statistics');
});

test('failed deviations play defense after 750ms, reveal failure after animation, and retry both plies', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(performance, 'now', () => 0);
  const options = opts();
  options.pref.animation.duration = 250;
  options.data.puzzle.playback.objective = 'mate';
  const { ctrl, results } = await readyController(options);
  t.mock.timers.tick(500);
  const internal = ctrl as any;
  const { linePositions } = await import('../src/xiangqiAdjudication.ts');
  const positions = linePositions(fen, ['a1a4', 'e10d10']);
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    requests.push(body.move);
    const index = body.moves.length + 1;
    return new Response(
      JSON.stringify({
        ...positions[index],
        legalMoves: ['e10d10'],
        notation: body.move,
        chineseNotation: body.move,
        needsHydration: false,
      }),
    );
  });
  let searches = 0;
  internal.xiangqiEngine = {
    stop() {},
    evaluate: async () => {
      searches++;
      return { ...matingAnalysis(['e10d10']), depth: 20, score: { redCp: 800 } };
    },
  };
  await internal.playXiangqiUciAt(ctrl.path, 'a1a4');
  assert.deepEqual(results, []);
  assert.equal(ctrl.xiangqiFailure, undefined);
  t.mock.timers.tick(749);
  assert.deepEqual(requests, ['a1a4']);
  t.mock.timers.tick(1);
  await new Promise<void>(r => setImmediate(r));
  assert.deepEqual(requests, ['a1a4', 'e10d10']);
  assert.deepEqual(results, []);
  t.mock.timers.tick(249);
  assert.equal(ctrl.xiangqiFailure, undefined);
  t.mock.timers.tick(1);
  assert.equal(ctrl.xiangqiFailure, 'forcedMateLost');
  assert.equal(ctrl.node.uci, 'e10d10');
  assert.deepEqual(results, [false]);
  const animations: unknown[] = [];
  ctrl.ground({
    display: (_position: unknown, transition: unknown) => animations.push(transition),
    setPresentation() {},
    setInteraction() {},
    presentTransition() {},
    playPremove() {},
    select() {},
    cancelPremove() {},
    setMarks() {},
  } as any);
  ctrl.retryFailedMove();
  assert.equal(ctrl.node.uci, 'a1a4');
  assert.deepEqual(animations[0], { kind: 'backward', effects: [] });
  assert.equal(ctrl.boardSetup().canMove, false);
  t.mock.timers.tick(249);
  assert.equal(ctrl.node.uci, 'a1a4');
  t.mock.timers.tick(1);
  assert.deepEqual(animations[1], { kind: 'backward', effects: [] });
  assert.equal(ctrl.path, ctrl.initialPath);
  assert.equal(ctrl.mode, 'try');
  assert.equal(ctrl.xiangqiFailure, undefined);
  assert.equal(ctrl.initialNode.children.length, 0);
  await internal.playXiangqiUciAt(ctrl.path, 'a1a4');
  assert.equal(searches, 1, 'retry reuses the completed decision');
  ctrl.resultSent = true;
  ctrl.retryPuzzle();
  await internal.playXiangqiUciAt(ctrl.path, 'a1a4');
  assert.equal(searches, 1, 'restart reuses the completed decision');
  assert.equal(ctrl.initialNode.children.length, 1, 'no retry variations');
  animations.length = 0;
  ctrl.jump(ctrl.initialPath);
  assert.deepEqual(animations[0], { kind: 'backward', effects: [] });
  ctrl.jump(ctrl.initialPath + ctrl.initialNode.children[0].id);
  assert.deepEqual(animations[1], { kind: 'forward' }, 'forward navigation uses the normal animation');
});

test('saved root alternatives use no engine and reveal every nested variation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const options = opts();
  const lines = [
    ['a1a2', 'e10d10', 'a2a3'],
    ['a1a2', 'e10d10', 'a2a4'],
    ['a1a5', 'e10d10', 'a5a6'],
  ];
  options.data.puzzle.playback = { objective: 'mate', solutions: lines };
  const { ctrl } = await readyController(options);
  t.mock.timers.tick(0);
  const internal = ctrl as any;
  internal.xiangqiEngine = {
    stop() {},
    evaluate: async () => assert.fail('saved alternatives must not search'),
  };
  const { linePositions } = await import('../src/xiangqiAdjudication.ts');
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    const moves = [...body.moves, body.move];
    const position = linePositions(body.initialFen, moves).at(-1)!;
    return new Response(
      JSON.stringify({ ...position, notation: body.move, chineseNotation: body.move, needsHydration: false }),
    );
  });
  await internal.playXiangqiUciAt(ctrl.path, 'a1a5');
  assert.equal(ctrl.xiangqiBestMove, true);
  assert.equal(ctrl.lastFeedback, 'good');
  await internal.viewXiangqiSolution();
  const root = ctrl.initialNode;
  assert.equal(root.children.length, 2);
  const a = root.children.find(node => node.uci === 'a1a2')!;
  assert.deepEqual(a.children[0].children.map(node => node.uci).sort(), ['a2a3', 'a2a4']);
  const b = root.children.find(node => node.uci === 'a1a5')!;
  assert.equal(b.children[0].children[0].uci, 'a5a6');
});

test('a native draw on the defender reply is announced only after its animation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(performance, 'now', () => 0);
  const options = opts();
  options.pref.animation.duration = 250;
  const { ctrl, results } = await readyController(options);
  t.mock.timers.tick(500);
  const internal = ctrl as any;
  const { linePositions } = await import('../src/xiangqiAdjudication.ts');
  const positions = linePositions(fen, ['a1a2', 'e10d10']);
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    const index = body.moves.length + 1;
    return new Response(
      JSON.stringify({
        ...positions[index],
        gameResult: index === 2 ? '1/2-1/2' : '*',
        notation: body.move,
        chineseNotation: body.move,
        needsHydration: false,
      }),
    );
  });
  await internal.playXiangqiUciAt(ctrl.path, 'a1a2');
  t.mock.timers.tick(750);
  await new Promise<void>(r => setImmediate(r));
  assert.equal(ctrl.node.uci, 'e10d10');
  assert.deepEqual(results, []);
  t.mock.timers.tick(250);
  assert.equal(ctrl.xiangqiFailure, 'lineDrawn');
  assert.deepEqual(results, [false]);
  ctrl.retryFailedMove();
  assert.equal(ctrl.node.uci, 'a1a2');
  t.mock.timers.tick(500);
  assert.equal(ctrl.path, ctrl.initialPath);
});

test('Solution replaces source history and attempts with only published branches, preserving rules history', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { linePositions } = await import('../src/xiangqiAdjudication.ts');
  const { makeXiangqiNode } = await import('../src/xiangqi.ts');
  const options = opts();
  const sourceFen = fen.replace(' w ', ' b ');
  options.data.game.initialFen = sourceFen;
  options.data.game.moves = ['e10d10'];
  const position = linePositions(sourceFen, options.data.game.moves)[1];
  options.data.puzzle.state = { ...position, needsHydration: false };
  options.data.puzzle.playback.solutions = [
    ['a1a2', 'd10e10', 'a2a3'],
    ['a1a4', 'd10e10', 'a4a5'],
  ];
  const { ctrl } = await readyController(options);
  t.mock.timers.tick(0);
  ctrl.addNode(makeXiangqiNode(linePositions(position.fen, ['a1a6'])[1], 'a1a6', '', 0), ctrl.path);
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    assert.equal(body.initialFen, sourceFen);
    assert.equal(body.moves[0], 'e10d10');
    const state = linePositions(sourceFen, [...body.moves, body.move]).at(-1)!;
    return new Response(
      JSON.stringify({ ...state, needsHydration: false, notation: body.move, chineseNotation: body.move }),
    );
  });
  await (ctrl as any).viewXiangqiSolution();
  assert.equal(ctrl.tree.root.fen, position.fen);
  assert.equal(ctrl.tree.root.uci, undefined);
  assert.equal(ctrl.initialPath, '');
  assert.equal(ctrl.path, '');
  assert.deepEqual(
    ctrl.tree.root.children.map(node => node.uci),
    ['a1a2', 'a1a4'],
  );
  assert.equal(ctrl.boardSetup().canMove, false);
  ctrl.completed = true;
  ctrl.retryPuzzle();
  assert.equal(ctrl.initialNode.fen, position.fen);
  assert.equal(ctrl.initialNode.children.length, 0);
  assert.equal(ctrl.viewingSolution, false);
});
