import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import type { PikafishStatus } from 'lib/ceval/engines/pikafishBrowser';
import type { EngineAnalysis } from 'lib/ceval/engines/pikafishProtocol';

import type { XiangqiPuzzleEngineLike } from '../src/xiangqiPuzzleEngine.ts';

mock.module('lib/permalog', { namedExports: { log: () => Promise.resolve() } });
const { default: XiangqiPuzzleEngine, XIANGQI_PUZZLE_ENGINE_TIMEOUT_MS } =
  await import('../src/xiangqiPuzzleEngine.ts');

const result = (redCp = 800): EngineAnalysis => ({
  engine: 'Pikafish',
  depth: 18,
  nodes: 1,
  nps: 1,
  timeMs: 1,
  score: { redCp },
  lines: [],
});
function harness() {
  const work: Parameters<XiangqiPuzzleEngineLike['start']>[0][] = [];
  let status!: (status: PikafishStatus) => void;
  let created = 0,
    stopped = 0,
    destroyed = 0;
  const evaluator = new XiangqiPuzzleEngine(callback => {
    status = callback;
    created++;
    return {
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
  assert.equal(h.work.length, 1);
  h.work[0].emit(result(), false);
  assert.equal(h.work.length, 1);
  h.work[0].emit(result(), true);
  assert.equal((await first).score.redCp, 800);
  assert.equal(h.work.length, 2);
  h.work[1].emit(result(400), true);
  assert.equal((await second).score.redCp, 400);
  for (const request of h.work) {
    assert.equal(request.depth, 18);
    assert.equal(request.multiPv, 1);
    assert.equal(request.threads, 1);
    assert.equal(request.hashSize, 16);
  }
  assert.equal(h.counts().created, 1);
  h.evaluator.destroy();
});

test('queued searches preserve a snapshot of the complete move history', async () => {
  const h = harness();
  const first = h.evaluator.evaluate('first');
  const moves = ['h1g3', 'h10g8'];
  const second = h.evaluator.evaluate('current', { initialFen: 'root', moves });
  moves.push('a1a2');
  h.work[0].emit(result(), true);
  await first;
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
  h.evaluator.stop();
  await Promise.all([old, queued]);
  const next = h.evaluator.evaluate('next');
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
  h.work[0].emit(result(), true);
  await first;
  const failed = assert.rejects(h.evaluator.evaluate('second'), /engine failed/);
  h.status({ state: 'error', error: 'engine failed' });
  await failed;
  assert.equal(h.counts().destroyed, 1);
  const retried = h.evaluator.evaluate('retry');
  h.work[2].emit(result(), true);
  await retried;
  assert.equal(h.counts().created, 2);
  h.evaluator.destroy();
});

test('synchronous boot errors reject promptly', async () => {
  const evaluator = new XiangqiPuzzleEngine(status => {
    status({ state: 'error', error: 'no shared memory' });
    return { start() {}, stop() {}, destroy() {} };
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
    const analysis = { ...result(), score };
    h.work[h.work.length - 1].emit(analysis, true);
    assert.equal(await completed, analysis);
  }
  h.evaluator.destroy();
});

test('timeout includes boot and stops computation; destruction rejects pending evaluations', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  const timedOut = assert.rejects(h.evaluator.evaluate('loading'), /timed out/);
  t.mock.timers.tick(XIANGQI_PUZZLE_ENGINE_TIMEOUT_MS);
  await timedOut;
  assert.equal(h.counts().stopped, 1);
  const cancelled = assert.rejects(h.evaluator.evaluate('another'), /cancelled/);
  h.evaluator.destroy();
  await cancelled;
  await assert.rejects(h.evaluator.evaluate('after destruction'), /destroyed/);
});
