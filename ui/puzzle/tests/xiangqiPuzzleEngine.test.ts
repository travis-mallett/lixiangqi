import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mock, test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { RulesState } from 'xiangqi';

import type { PikafishStatus } from 'lib/ceval/engines/pikafishBrowser';
import { PikafishProtocol, type EngineAnalysis } from 'lib/ceval/engines/pikafishProtocol';

import type { XiangqiPuzzleEngineLike } from '../src/xiangqiPuzzleEngine.ts';

mock.module('lib/permalog', { namedExports: { log: () => Promise.resolve() } });
const {
  default: XiangqiPuzzleEngine,
  XIANGQI_PUZZLE_ENGINE_TIMEOUT_MS,
  puzzleEngineThreads,
} = await import('../src/xiangqiPuzzleEngine.ts');

const result = (redCp = 800): EngineAnalysis => ({
  engine: 'Pikafish',
  depth: 18,
  nodes: 1,
  nps: 1,
  timeMs: 1,
  score: { redCp },
  lines: [],
});
function harness(preparation = Promise.resolve()) {
  const work: Parameters<XiangqiPuzzleEngineLike['start']>[0][] = [];
  let status!: (status: PikafishStatus) => void;
  let created = 0,
    stopped = 0,
    destroyed = 0;
  const evaluator = new XiangqiPuzzleEngine(callback => {
    status = callback;
    created++;
    return {
      prepare: () => preparation,
      start: request => work.push(request),
      stop: () => {
        stopped++;
      },
      destroy: () => {
        destroyed++;
      },
    };
  });
  return {
    evaluator,
    work,
    status: (value: PikafishStatus) => status(value),
    counts: () => ({ created, stopped, destroyed }),
  };
}

test('engine is lazy, sequential, and uses identical fixed settings for each position', async () => {
  const h = harness();
  assert.equal(h.counts().created, 0);
  const first = h.evaluator.evaluate('first');
  const second = h.evaluator.evaluate('second');
  await setImmediate();
  assert.equal(h.work.length, 1);
  h.work[0].emit(result(), false);
  assert.equal(h.work.length, 1);
  h.work[0].emit(result(), true);
  assert.equal((await first).score.redCp, 800);
  await setImmediate();
  assert.equal(h.work.length, 2);
  h.work[1].emit(result(400), true);
  assert.equal((await second).score.redCp, 400);
  for (const request of h.work) {
    assert.ok('movetime' in request.search);
    assert.equal(request.search.movetime, 4000);
    assert.equal(request.search.extension?.minMovetime, 2000);
    assert.equal(request.search.extension?.maxMovetime, 11000);
    assert.equal(request.search.extension?.needed(result()), false);
    assert.equal(request.search.extension?.complete(result()), true);
    assert.equal(request.multiPv, 1);
    assert.equal(request.threads, puzzleEngineThreads());
    assert.equal(request.hashSize, 16);
  }
  assert.equal(h.counts().created, 1);
  h.evaluator.destroy();
});

test('progress belongs only to the active request and stops after cancellation or completion', async () => {
  const h = harness();
  const depths: number[] = [];
  const first = h.evaluator.evaluate('first', undefined, undefined, analysis => depths.push(analysis.depth));
  const rejected = assert.rejects(first, /cancelled/);
  await setImmediate();
  h.work[0].emit({ ...result(), depth: 3 }, false);
  assert.deepEqual(depths, [3]);
  h.evaluator.stop();
  await rejected;
  const second = h.evaluator.evaluate('second', undefined, undefined, analysis =>
    depths.push(analysis.depth),
  );
  await setImmediate();
  h.work[0].emit({ ...result(), depth: 30 }, false);
  h.work[1].emit({ ...result(), depth: 5 }, false);
  h.work[1].emit(result(), true);
  await second;
  h.work[1].emit({ ...result(), depth: 40 }, false);
  assert.deepEqual(depths, [3, 5]);
  h.evaluator.destroy();
});

test('queued searches preserve a snapshot of the complete move history', async () => {
  const h = harness();
  const first = h.evaluator.evaluate('first');
  const moves = ['h1g3', 'h10g8'];
  const second = h.evaluator.evaluate('current', { initialFen: 'root', moves });
  moves.push('a1a2');
  await setImmediate();
  h.work[0].emit(result(), true);
  await first;
  await setImmediate();
  assert.deepEqual(h.work[1].history, { initialFen: 'root', moves: ['h1g3', 'h10g8'] });
  assert.equal(h.work[1].fen, 'current');
  h.work[1].emit(result(), true);
  await second;
  h.evaluator.destroy();
});

test('cancellation rejects pending work and ignores late callbacks without tearing down the engine', async () => {
  const h = harness();
  const old = assert.rejects(h.evaluator.evaluate('old'), /cancelled/);
  const queued = assert.rejects(h.evaluator.evaluate('queued'), /cancelled/);
  await setImmediate();
  h.evaluator.stop();
  await Promise.all([old, queued]);
  const next = h.evaluator.evaluate('next');
  await setImmediate();
  h.work[0].emit(result(-999), true);
  h.work[1].emit(result(600), true);
  assert.equal((await next).score.redCp, 600);
  assert.equal(h.counts().created, 1);
  assert.equal(h.counts().destroyed, 0);
  h.evaluator.destroy();
});

test('a later engine error rejects current work and permits a fresh engine on retry', async () => {
  const h = harness();
  const first = h.evaluator.evaluate('first');
  await setImmediate();
  h.work[0].emit(result(), true);
  await first;
  const failed = assert.rejects(h.evaluator.evaluate('second'), /engine failed/);
  await setImmediate();
  h.status({ state: 'error', error: 'engine failed' });
  await failed;
  assert.equal(h.counts().destroyed, 1);
  const retried = h.evaluator.evaluate('retry');
  await setImmediate();
  h.work[2].emit(result(), true);
  await retried;
  assert.equal(h.counts().created, 2);
  h.evaluator.destroy();
});

test('synchronous boot errors reject promptly', async () => {
  const evaluator = new XiangqiPuzzleEngine(status => {
    status({ state: 'error', error: 'no shared memory' });
    return {
      prepare: () => Promise.reject(new Error('no shared memory')),
      start() {},
      stop() {},
      destroy() {},
    };
  });
  await assert.rejects(evaluator.evaluate('fen'), /no shared memory/);
  evaluator.destroy();
});

test('completed analysis reaches adjudication even without a usable exact score', async () => {
  const h = harness();
  for (const score of [
    {},
    { redCp: NaN },
    { redMate: Infinity },
    { cp: 800 },
    { redCp: 800, bound: 'lower' as const },
  ]) {
    const completed = h.evaluator.evaluate('fen');
    await setImmediate();
    const analysis = { ...result(), score };
    h.work[h.work.length - 1].emit(analysis, true);
    assert.equal(await completed, analysis);
  }
  h.evaluator.destroy();
});

test('preparation does not consume the search watchdog; a hung search is discarded', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let prepared!: () => void;
  const h = harness(
    new Promise<void>(resolve => {
      prepared = resolve;
    }),
  );
  const timedOut = assert.rejects(h.evaluator.evaluate('loading'), /timed out/);
  t.mock.timers.tick(5 * XIANGQI_PUZZLE_ENGINE_TIMEOUT_MS);
  await setImmediate();
  assert.equal(h.work.length, 0);
  assert.equal(h.counts().destroyed, 0);
  prepared();
  await setImmediate();
  assert.equal(h.work.length, 1);
  t.mock.timers.tick(XIANGQI_PUZZLE_ENGINE_TIMEOUT_MS);
  await timedOut;
  assert.equal(h.counts().destroyed, 1);
  const cancelled = assert.rejects(h.evaluator.evaluate('another'), /cancelled/);
  h.evaluator.destroy();
  await cancelled;
  await assert.rejects(h.evaluator.evaluate('after destruction'), /destroyed/);
});

test('threads use half the reported logical CPUs with a minimum of one', () => {
  for (const [cpus, threads] of [
    [1, 1],
    [2, 1],
    [3, 1],
    [8, 4],
    [32, 16],
  ])
    assert.equal(puzzleEngineThreads(cpus), threads);
});

test('zalD3 H4+3 keeps searching past the recorded shallow failure, bounded at fifteen seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/zalD3.json', import.meta.url), 'utf8')) as {
    initialFen: string;
    moves: string[];
    puzzleFen: string;
    solution: string[];
    state: RulesState;
    trace: string[];
  };
  const { evaluateAlternative } = await import('../src/alternative.ts');
  const { makeObjective } = await import('../src/xiangqiAdjudication.ts');
  const objective = makeObjective(fixture.puzzleFen, fixture.solution, {
    objective: 'mate',
    solutions: [fixture.solution],
  });
  for (const reachesDepth20 of [true, false]) {
    const commands: string[] = [];
    const protocol = new PikafishProtocol();
    protocol.connected(command => commands.push(command));
    protocol.received('uciok');
    protocol.received('readyok');
    const evaluator = new XiangqiPuzzleEngine(() => ({
      prepare: () => Promise.resolve(),
      start: work => protocol.compute({ ...work, stopRequested: false }),
      stop: () => protocol.compute(),
      destroy: () => protocol.compute(),
    }));
    const evaluation = evaluateAlternative(
      evaluator,
      objective,
      fixture.state,
      1,
      {
        initialFen: fixture.initialFen,
        moves: fixture.moves,
      },
      () => true,
    );
    await setImmediate();
    let elapsed = 0;
    const tickTo = (time: number) => {
      t.mock.timers.tick(time - elapsed);
      elapsed = time;
    };
    const receive = (index: number) => {
      const info = fixture.trace[index];
      tickTo(Number(/\btime (\d+)/.exec(info)![1]));
      protocol.received(info);
    };
    receive(0);
    receive(1);
    tickTo(4000);
    receive(2);
    tickTo(6000);
    assert.equal(commands.at(-1), 'go infinite', 'depth 19 must not end as an error at six seconds');
    if (reachesDepth20) receive(3);
    else {
      tickTo(14999);
      assert.equal(commands.at(-1), 'go infinite');
      tickTo(15000);
    }
    assert.equal(commands.at(-1), 'stop');
    protocol.received('bestmove e9f9');
    const result = await evaluation;
    assert.equal(result?.evaluation.depth, reachesDepth20 ? 20 : 19);
    assert.equal(result?.evaluation.score.redCp, reachesDepth20 ? -945 : -943);
    assert.deepEqual(result?.decision, { result: 'fail', reason: 'forcedMateLost' });
    assert.equal(
      commands.filter(c => c.startsWith('go ')).length,
      1,
      'confirmation never restarts the search',
    );
    assert.ok(
      commands.some(c => c.startsWith(`position fen ${fixture.initialFen} moves `) && c.endsWith('f6g8')),
    );
    evaluator.destroy();
  }
});
