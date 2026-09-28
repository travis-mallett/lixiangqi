import assert from 'node:assert/strict';
import test from 'node:test';

import type { TreeNodeBase } from 'lib/tree/types';

import {
  clearSourceGameEvals,
  hasStoredEvaluations,
  matchesSourceGame,
  snapshotSourceGame,
} from '../src/study/sourceGameAnalysis.ts';

function fixture(): TreeNodeBase[] {
  const root: TreeNodeBase = { id: '', ply: 0, fen: 'root', children: [] };
  const first: TreeNodeBase = { id: 'aa', ply: 1, fen: 'first', uci: 'a4a5', children: [] };
  const last: TreeNodeBase = { id: 'bb', ply: 2, fen: 'last', uci: 'a7a6', children: [] };
  root.children = [first];
  first.children = [last];
  return [root, first, last];
}

test('stored chapter and broadcast scores include zero and mate zero, but not browser-only scores', () => {
  const nodes = fixture();
  assert.equal(hasStoredEvaluations(nodes), false);
  nodes[0].eval = { cp: 42 };
  assert.equal(hasStoredEvaluations(nodes), false);
  nodes[1].eval = { cp: 0 };
  assert.equal(hasStoredEvaluations(nodes), true);
  nodes[1].eval = { mate: 0 };
  assert.equal(hasStoredEvaluations(nodes), true);
});

test('immutable source identity rejects mainline edits but accepts side variations', () => {
  const nodes = fixture();
  const original = snapshotSourceGame(nodes);
  assert.equal(matchesSourceGame(nodes[0], original), true);
  nodes[0].children!.push({ id: 'cc', ply: 1, fen: 'variation', uci: 'c4c5' });
  assert.equal(matchesSourceGame(nodes[0], original), true);
  nodes[1].uci = 'e4e5';
  assert.equal(matchesSourceGame(nodes[0], original), false);
  nodes[1].uci = 'a4a5';
  nodes[1].children = [];
  assert.equal(matchesSourceGame(nodes[0], original), false);
});

test('invalidating source scores preserves chapter annotations and removes overlays on variations', () => {
  const nodes = fixture();
  nodes[1].eval = { cp: 17 };
  nodes[2].eval = Object.assign({ cp: 20 }, { sourceGame: true });
  nodes[0].children!.push({
    id: 'cc',
    ply: 1,
    fen: 'variation',
    eval: Object.assign({ mate: 0 }, { sourceGame: true }),
  });
  clearSourceGameEvals(nodes[0]);
  assert.deepEqual(nodes[1].eval, { cp: 17 });
  assert.equal(nodes[2].eval, undefined);
  assert.equal(nodes[0].children![1].eval, undefined);
});
