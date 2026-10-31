import assert from 'node:assert/strict';
import { test } from 'node:test';

import { balanceShares, terminalShares } from '../src/evaluation';
import { Engine } from '../src/runtime';
import { Tree } from '../src/tree';
import type { EngineResult, Rules } from '../src/types';

const rules: Rules & {
  analyze(
    position: string,
    depth: number,
    nodes: number,
    multiPv: number,
    emit: (result: EngineResult) => void,
  ): EngineResult;
} = (await import(new URL('../../../public/three-kingdoms-engine/main.js', import.meta.url).href))
  .ThreeKingdoms;

test('browser engine emits complete ranked MultiPV lines and retains the evaluated participants', () => {
  const updates: EngineResult[] = [];
  const result = rules.analyze(rules.initial(), 3, 500, 5, r => updates.push(r));
  assert.ok(updates.length);
  assert.ok(result.nodes <= 500);
  assert.equal(result.lines.length, 5);
  assert.equal(new Set(result.lines.map(l => l.pvMoves[0])).size, 5);
  for (const line of result.lines) {
    let value = rules.initial();
    for (const move of line.pvMoves) value = rules.play(value, move);
    assert.deepEqual(line.active, rules.inspect(value).active);
    assert.equal(line.pvMoves.length, result.depth);
  }
});

test('balance is shift-invariant, ignores eliminated armies, and preserves final draws', () => {
  const line = { scores: [120, -240, 120], active: ['black', 'green', 'red'] as const, winners: null };
  const shares = balanceShares({ ...line, active: [...line.active] });
  assert.ok(shares[0] > shares[1]);
  assert.equal(shares[0], shares[2]);
  assert.ok(Math.abs(shares.reduce((a, b) => a + b) - 100) < 1e-8);
  assert.deepEqual(
    balanceShares({ ...line, active: [...line.active], scores: line.scores.map(x => x + 100000) }),
    shares,
  );
  assert.deepEqual(
    balanceShares({ scores: [100000, -1000000, 100000], active: ['black', 'red'], winners: null }),
    [50, 0, 50],
  );
  assert.deepEqual(
    balanceShares({ scores: [1000000, -1000000, -900000], active: ['black'], winners: ['black'] }),
    [100, 0, 0],
  );
  const duel = rules.event(rules.initial(), 'green', 'resign');
  const draw = rules.inspect(rules.event(duel, 'red', 'draw'));
  assert.deepEqual(terminalShares(draw), [50, 0, 50]);
});

test('evaluations survive tab export/import and corrupt shares fail without being trusted', () => {
  const tree = new Tree(rules, rules.initial());
  tree.current.evaluation = { shares: [25, 25, 50], depth: 3 };
  assert.deepEqual(
    Tree.import(rules, JSON.stringify(tree.export())).current.evaluation,
    tree.current.evaluation,
  );
  tree.current.evaluation.shares = [100, 100, 100];
  assert.throws(() => Tree.import(rules, JSON.stringify(tree.export())), /Invalid evaluation/);
});

test('worker snapshots keep the worker alive; replacement and stop reject obsolete searches', async () => {
  const originalWorker = globalThis.Worker;
  const originalSite = globalThis.site;
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: (event: { message: string }) => void;
    terminated = false;
    request: unknown;
    constructor() {
      workers.push(this);
    }
    postMessage(request: unknown) {
      this.request = request;
    }
    terminate() {
      this.terminated = true;
    }
  }
  Object.assign(globalThis, { Worker: FakeWorker, site: { asset: { url: (path: string) => path } } });
  const engine = new Engine();
  try {
    const updates: boolean[] = [];
    const pending = engine.analyze('one', {
      depth: 3,
      nodes: 500,
      multiPv: 5,
      emit: (_, final) => updates.push(final),
    });
    const result: EngineResult = { depth: 1, nodes: 10, lines: [] };
    workers[0].onmessage!({ data: { result, final: false } });
    assert.equal(workers[0].terminated, false);
    assert.deepEqual(updates, [false]);
    workers[0].onmessage!({ data: { result, final: true } });
    assert.deepEqual(await pending, result);
    assert.equal(workers[0].terminated, true);
    assert.deepEqual(updates, [false, true]);
    const first = engine.analyze('two');
    const firstRejected = assert.rejects(first, { name: 'AbortError' });
    const next = engine.analyze('three');
    const nextRejected = assert.rejects(next, { name: 'AbortError' });
    assert.equal(workers[1].terminated, true);
    engine.stop();
    await Promise.all([firstRejected, nextRejected]);
    assert.equal(workers[2].terminated, true);
  } finally {
    engine.stop();
    Object.assign(globalThis, { Worker: originalWorker, site: originalSite });
  }
});
