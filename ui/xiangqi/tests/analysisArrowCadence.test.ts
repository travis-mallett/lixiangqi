import { strict as assert } from 'node:assert';
import test from 'node:test';

import type { EngineAnalysis } from 'lib/ceval';

import { createArrowCadence, makeMilestones } from '../src/analysisArrowCadence.ts';

const result = (depth: number): EngineAnalysis => ({
  engine: 'Pikafish',
  depth,
  nodes: 1,
  nps: 1,
  timeMs: 1,
  score: {},
  lines: [{ multipv: 1, depth, seldepth: depth, score: {}, pvMoves: ['b10c8'], wxfMoves: [] }],
});

test('spaces four arrow updates from depth five through the target', () => {
  assert.deepEqual(makeMilestones(20, 4), [5, 10, 15, 20]);
  assert.deepEqual(makeMilestones(10, 4), [5, 7, 8, 10]);
  assert.deepEqual(makeMilestones(30, 4), [5, 13, 22, 30]);
  assert.deepEqual(makeMilestones(18, 3), [5, 12, 18]);
});

test('publishes only milestone snapshots and holds the previous recommendation', () => {
  const cadence = createArrowCadence(20, 4);
  assert.equal(cadence.accept(result(4), false), undefined);
  assert.equal(cadence.accept(result(5), false)?.depth, 5);
  assert.equal(cadence.accept(result(8), false), undefined);
  assert.equal(cadence.published?.depth, 5);
  assert.equal(cadence.accept(result(10), false)?.depth, 10);
});

test('publishes an early final result once it is usable', () => {
  const cadence = createArrowCadence(20, 4);
  assert.equal(cadence.accept(result(8), true)?.depth, 8);
  assert.equal(cadence.accept(result(8), true), undefined);
});

test('allows one revised final snapshot at the published depth', () => {
  const cadence = createArrowCadence(20, 4);
  assert.equal(cadence.accept(result(5), false)?.depth, 5);
  assert.equal(cadence.accept(result(5), true)?.depth, 5);
  assert.equal(cadence.accept(result(5), true), undefined);
});

test('rebases future milestones when cadence settings change mid-search', () => {
  const cadence = createArrowCadence(20, 4);
  cadence.accept(result(8), false);
  cadence.configure(30, 2);
  assert.equal(cadence.accept(result(20), false), undefined);
  assert.equal(cadence.accept(result(30), false)?.depth, 30);
});

test('one requested update waits for the final result', () => {
  const cadence = createArrowCadence(20, 1);
  assert.equal(cadence.accept(result(15), false), undefined);
  assert.equal(cadence.accept(result(20), true)?.depth, 20);
});

test('skipped and repeated depths cannot add intermediate arrow updates', () => {
  const cadence = createArrowCadence(20, 4);
  assert.equal(cadence.accept(result(12), false)?.depth, 12);
  assert.equal(cadence.accept(result(12), false), undefined);
  assert.equal(cadence.accept(result(10), false), undefined);
  assert.equal(cadence.accept(result(14), false), undefined);
  assert.equal(cadence.accept(result(20), false)?.depth, 20);
  assert.equal(cadence.accept(result(21), false), undefined);
});

test('new searches clear the old recommendation and restart at depth five', () => {
  const cadence = createArrowCadence(20, 4);
  cadence.accept(result(20), true);
  cadence.reset(10, 4);
  assert.equal(cadence.published, undefined);
  assert.equal(cadence.accept(result(4), true)?.depth, 4);
  assert.equal(cadence.accept(result(5), false)?.depth, 5);
});

test('node searches publish a first candidate and a shallow completed result', () => {
  const cadence = createArrowCadence({ nodes: 250000 }, 4);
  const first = { ...result(1), nodes: 100 };
  assert.equal(cadence.accept(first, false), first);
  assert.equal(cadence.accept({ ...result(2), nodes: 1000 }, false), undefined);
  const next = { ...result(2), nodes: 100000 };
  assert.equal(cadence.accept(next, false), next);
  const completed = { ...result(3), nodes: 250000 };
  assert.equal(cadence.accept(completed, true), completed);
  assert.equal(cadence.accept(completed, true), undefined);
});

test('empty engine snapshots cannot consume the first recommendation', () => {
  const cadence = createArrowCadence({ nodes: 250000 });
  assert.equal(cadence.accept({ ...result(1), lines: [] }, false), undefined);
  assert.equal(cadence.accept(result(1), false)?.depth, 1);
});
