import assert from 'node:assert/strict';
import test from 'node:test';

import { MINI_XIANGQI_START_FEN } from 'lib/game/minixiangqi';
import { createMoveTree } from 'lib/tree/native';

import { analysisWorkspaceKey, restoreReplayWorkspace } from '../src/analysisReplayWorkspace';
import { serializeAnalysisTabs, deserializeAnalysisTabs, type AnalysisTab } from '../src/analysisTabs';
import { fixtureTree } from './treeFixtures';

const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
function replay(id = 'game-one'): AnalysisTab {
  return {
    id: 'tab-native',
    title: id,
    kind: 'game',
    gameId: id,
    initialFen: fen,
    tree: fixtureTree(fen, ['a4a5', 'a7a6']),
    activePath: 'a4a5/a7a6',
  };
}
function clone(tab: AnalysisTab): AnalysisTab {
  return deserializeAnalysisTabs(serializeAnalysisTabs([tab], tab.id)).tabs[0];
}
test('game, variant and general workspaces cannot overwrite one another', () => {
  const one = replay(),
    two = replay('game-two');
  const mini = { ...one, initialFen: MINI_XIANGQI_START_FEN };
  const keys = [
    analysisWorkspaceKey(),
    analysisWorkspaceKey(one),
    analysisWorkspaceKey(two),
    analysisWorkspaceKey(mini),
  ];
  assert.equal(new Set(keys).size, 4);
  const storage = new Map(keys.map(key => [key, 'unique draft ' + key]));
  const before = new Map(storage);
  storage.set(keys[1], JSON.stringify(serializeAnalysisTabs([one], one.id)));
  for (const key of [keys[0], keys[2], keys[3]]) assert.equal(storage.get(key), before.get(key));
});
test('reopening merges edits without replacing recorded state, order, metadata or linked ply', () => {
  const original = replay();
  original.activePath = original.tree.root.children[0].path;
  original.tree.root.metadata = { Result: '1-0' };
  const saved = clone(original);
  saved.tree.root.comments = [{ id: 'unique', by: { kind: 'unknown' }, text: 'unique replay comment' }];
  const variation = fixtureTree(fen, ['c4c5']).root.children[0];
  saved.tree.root.children.unshift(variation);
  saved.tree.root.children[1].state = { ...saved.tree.root.children[1].state, check: true };
  saved.tree.root.metadata = { Result: '0-1' };
  saved.activePath = variation.path;
  const other = { ...clone(saved), id: 'extra', kind: 'analysis' as const };
  const state = original.tree.root.children[0].state;
  const result = restoreReplayWorkspace([saved, other], original, true);
  assert.equal(result.tabs.length, 2);
  assert.equal(result.tabs[1], other);
  assert.equal(original.tree.root.children[0].uci, 'a4a5');
  assert.equal(original.tree.root.children[0].state, state);
  assert.deepEqual(original.tree.root.metadata, { Result: '1-0' });
  assert.equal(original.tree.root.comments?.[0].text, 'unique replay comment');
  assert.equal(original.activePath, original.tree.root.children[0].path);
  assert.ok(original.tree.pathExists(variation.path));
  const reopened = replay();
  restoreReplayWorkspace([clone(saved)], reopened, false);
  assert.equal(reopened.activePath, variation.path);
});
test('missing recorded moves are restored, while incompatible drafts fail without modifying saved data', () => {
  const saved = replay();
  saved.tree.root.children = [];
  saved.activePath = '';
  const original = replay();
  restoreReplayWorkspace([saved], original, false);
  assert.equal(original.tree.root.children[0].uci, 'a4a5');
  const incompatible = replay();
  incompatible.tree.root.children[0].fen = 'wrong';
  const before = JSON.stringify(serializeAnalysisTabs([incompatible], incompatible.id));
  assert.throws(() => restoreReplayWorkspace([incompatible], replay(), false), /preserved/);
  assert.equal(
    JSON.stringify(serializeAnalysisTabs([incompatible], incompatible.id)).replace(/savedAt[^,]+/g, ''),
    before.replace(/savedAt[^,]+/g, ''),
  );
});
test('Mini replay annotations survive restoration in their own rules context', () => {
  const state = {
    fen: MINI_XIANGQI_START_FEN,
    variant: 'minixiangqi' as const,
    ply: 0,
    turn: 'red' as const,
    check: false,
    legalMoves: [],
    gameResult: '*',
  };
  const native = {
    ...replay('mini-one'),
    initialFen: state.fen,
    tree: createMoveTree(state),
    activePath: '',
  };
  const saved = clone(native);
  saved.tree.root.comments = [{ id: 'mini', by: { kind: 'unknown' }, text: 'Mini note' }];
  restoreReplayWorkspace([saved], native, false);
  assert.equal(native.tree.root.comments?.[0].text, 'Mini note');
  assert.equal(native.tree.root.state.variant, 'minixiangqi');
  assert.equal(native.tree.root.ruleset, 'minixiangqi-v1');
});
