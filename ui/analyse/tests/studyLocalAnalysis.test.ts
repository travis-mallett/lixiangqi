import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TreeNode } from 'lib/tree/types';

import { LocalAnalysisRun } from '../src/study/localAnalysisRun';

const nodes = () =>
  [
    { fen: 'root', state: { legalMoves: ['i1i2'] }, outcome: () => undefined },
    { fen: 'after', uci: 'i1i2', state: { legalMoves: ['i10i9'] }, outcome: () => undefined },
    { fen: 'end', uci: 'i10i9', state: { legalMoves: [] }, outcome: () => ({ winner: 'black' }) },
  ] as unknown as TreeNode[];

test('chapter analysis uses browser searches, complete history, red scores and native terminal outcomes', async () => {
  const histories: unknown[] = [];
  let destroyed = 0;
  const run = new LocalAnalysisRun(() => ({
    prepare: async () => {},
    destroy: () => {
      destroyed++;
    },
    start: work => {
      histories.push(work.history);
      work.emit(
        {
          engine: 'Pikafish',
          depth: 15,
          nodes: 100,
          nps: 100,
          timeMs: 2000,
          score: { redCp: histories.length * 10 },
          lines: [],
        },
        true,
      );
    },
  }));
  const batch = await run.run(nodes(), 'tiantian-v1', () => {});
  assert.deepEqual(histories, [
    { initialFen: 'root', ruleset: 'tiantian-v1', moves: [] },
    { initialFen: 'root', ruleset: 'tiantian-v1', moves: ['i1i2'] },
  ]);
  assert.deepEqual(batch.moves, ['i1i2', 'i10i9']);
  assert.deepEqual(
    batch.evaluations.map(e => e.cp ?? e.mate),
    [10, 20, -1],
  );
  assert.equal(destroyed, 1);
});

test('cancelling a chapter search rejects promptly and releases the browser engine', async () => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => {
    started = resolve;
  });
  let destroyed = 0;
  const run = new LocalAnalysisRun(() => ({
    prepare: async () => {},
    start: () => started(),
    destroy: () => {
      destroyed++;
    },
  }));
  const result = run.run(nodes(), 'tiantian-v1', () => {});
  await ready;
  run.cancel();
  await assert.rejects(result, /Cancelled/);
  assert.ok(destroyed > 0);
});

test('engine errors fail the run instead of leaving an indefinite loading state', async () => {
  const run = new LocalAnalysisRun(status => ({
    prepare: async () => {},
    destroy: () => {},
    start: () => status({ state: 'error', error: 'Network unavailable' }),
  }));
  await assert.rejects(
    run.run(nodes(), 'tiantian-v1', () => {}),
    /Network unavailable/,
  );
});
