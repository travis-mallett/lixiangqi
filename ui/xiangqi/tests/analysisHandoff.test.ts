import assert from 'node:assert/strict';
import test from 'node:test';

import { addOrSelectChild } from 'lib/tree/native';

import { createAnalysisUrl, readAnalysisUrl, replayPath } from '../src/analysisHandoff.ts';
import {
  mergeAnalysisHandoff,
  MAX_ANALYSIS_TABS,
  deserializeAnalysisTabs,
  restoreAnalysisWorkspace,
  serializeAnalysisTabs,
  type AnalysisTab,
} from '../src/analysisTabs.ts';
import { fixtureTree } from './treeFixtures';

const initialFen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

test('native replay links preserve the selected ply and safely ignore unrelated fragments', () => {
  const tree = fixtureTree(initialFen, ['a4a5', 'a7a6']);
  assert.equal(replayPath(tree, '#0'), '');
  assert.equal(replayPath(tree, '#1'), tree.root.children[0].path);
  const end = tree.root.children[0].children[0].path;
  for (const hash of ['', '#analysis', '#99', '#1oops']) assert.equal(replayPath(tree, hash), end);
  const custom = fixtureTree(initialFen.replace('0 1', '0 12'), ['a4a5']);
  assert.equal(replayPath(custom, '#22'), '');
  assert.equal(replayPath(custom, '#23'), custom.root.children[0].path);
});

test('analysis links preserve the complete tree and orientation from the root', () => {
  const tree = fixtureTree(initialFen, ['a4a5', 'a7a6']);
  const failed = fixtureTree(initialFen, ['c4c5']);
  const { uci, notation, state } = failed.root.children[0];
  addOrSelectChild(tree, '', { uci, notation, state });
  tree.root.children[1].forceVariation = true;
  const url = createAnalysisUrl(tree, 'black');
  const imported = readAnalysisUrl(url.slice(url.indexOf('#')))!;
  assert.equal(imported.initialFen, initialFen);
  assert.equal(imported.orientation, 'black');
  assert.deepEqual(
    imported.tree.root.children.map(node => node.uci),
    ['a4a5', 'c4c5'],
  );
  assert.equal(imported.tree.root.children[0].children[0].uci, 'a7a6');
  assert.equal(imported.tree.root.children[1].forceVariation, true);
  assert.equal(imported.tree.root.path, '');
  assert.deepEqual(imported.tree.root.state, tree.root.state);
});

test('unrelated fragments are ignored and malformed analysis links fail clearly', () => {
  assert.equal(readAnalysisUrl('#practice'), undefined);
  assert.throws(() => readAnalysisUrl('#analysis=%'), URIError);
  assert.throws(() => readAnalysisUrl('#analysis=%7B%7D'), /Invalid analysis link/);
  const payload = { orientation: 'red', draft: { initialFen } };
  assert.throws(
    () => readAnalysisUrl(`#analysis=${encodeURIComponent(JSON.stringify(payload))}`),
    /incompatible format/,
  );
});

test('analysis handoff opens the selected puzzle position', () => {
  const tree = fixtureTree(initialFen, ['a4a5', 'a7a6']);
  const selected = tree.root.children[0].children[0].path;
  const url = createAnalysisUrl(tree, 'red', selected);
  const handoff = readAnalysisUrl(url.slice(url.indexOf('#')))!;
  assert.equal(handoff.activePath, selected);
  assert.ok(handoff.id);
  assert.equal(readAnalysisUrl(url.slice(url.indexOf('#')))?.id, handoff.id);
});

test('puzzle handoff adds one tab without replacing or duplicating saved analysis tabs', () => {
  const savedTree = fixtureTree(initialFen, ['a4a5']);
  const puzzleTree = fixtureTree(initialFen, ['a4a5', 'a7a6']);
  const saved: AnalysisTab = {
    id: 'saved-tab',
    title: 'My analysis',
    kind: 'analysis',
    initialFen,
    tree: savedTree,
    activePath: savedTree.root.children[0].path,
  };
  const handoff: AnalysisTab = {
    id: 'puzzle-handoff',
    title: 'Analysis 2',
    kind: 'analysis',
    initialFen,
    tree: puzzleTree,
    activePath: puzzleTree.root.children[0].children[0].path,
  };
  const first = mergeAnalysisHandoff([saved], saved.id, handoff);
  assert.deepEqual(
    first.tabs.map(tab => tab.id),
    ['saved-tab', 'puzzle-handoff'],
  );
  assert.equal(first.activeId, handoff.id);
  const reload = mergeAnalysisHandoff(first.tabs, first.activeId, handoff);
  assert.equal(reload.tabs.length, 2);
  assert.equal(reload.activeId, handoff.id);
  assert.equal(reload.tabs[0], saved);
  const legacyDraft = { ...saved, id: 'legacy-draft', title: 'Analysis 1' };
  const legacyRestore = mergeAnalysisHandoff([], '', handoff, legacyDraft);
  assert.deepEqual(
    legacyRestore.tabs.map(tab => tab.id),
    ['legacy-draft', 'puzzle-handoff'],
  );
  assert.equal(legacyRestore.activeId, handoff.id);
  assert.equal(mergeAnalysisHandoff(legacyRestore.tabs, handoff.id, handoff).tabs.length, 2);
  const full = Array.from({ length: MAX_ANALYSIS_TABS }, (_, index) => ({
    ...saved,
    id: `saved-${index}`,
  }));
  const refused = mergeAnalysisHandoff(full, full[0].id, handoff);
  assert.equal(refused.tabs, full);
  assert.equal(refused.activeId, full[0].id);
});

test('workspace restoration merges a puzzle handoff when its FEN differs from the saved active tab', () => {
  const otherFen = initialFen.replace(' w ', ' b ');
  const savedTree = fixtureTree(otherFen, ['a4a5']);
  const handoffTree = fixtureTree(initialFen, ['a4a5', 'a7a6']);
  const saved: AnalysisTab = {
    id: 'saved-tab',
    title: 'My analysis',
    kind: 'analysis',
    initialFen: otherFen,
    tree: savedTree,
    activePath: savedTree.root.children[0].path,
  };
  const handoff: AnalysisTab = {
    id: 'puzzle-handoff',
    title: 'Puzzle analysis',
    kind: 'analysis',
    initialFen,
    tree: handoffTree,
    activePath: handoffTree.root.children[0].children[0].path,
  };

  const restored = restoreAnalysisWorkspace([saved], saved.id, initialFen, true, handoff)!;

  assert.deepEqual(
    restored.tabs.map(tab => tab.id),
    [saved.id, handoff.id],
  );
  assert.equal(restored.tabs[0], saved);
  assert.equal(restored.activeId, handoff.id);
  assert.equal(restored.tabs.find(tab => tab.id === restored.activeId)?.tree, handoffTree);
  assert.equal(restoreAnalysisWorkspace([saved], saved.id, initialFen, true), undefined);
});

test('a full workspace refuses the handoff without replacing tabs on save', () => {
  const savedTree = fixtureTree(initialFen, ['a4a5']);
  const handoffTree = fixtureTree(initialFen, ['a4a5', 'a7a6']);
  const savedTabs: AnalysisTab[] = Array.from({ length: MAX_ANALYSIS_TABS }, (_, index) => ({
    id: `saved-${index}`,
    title: `Saved ${index + 1}`,
    kind: 'analysis',
    initialFen,
    tree: savedTree,
    activePath: savedTree.root.children[0].path,
  }));
  const activeId = savedTabs[7].id;
  const handoff: AnalysisTab = {
    id: 'puzzle-handoff',
    title: 'Puzzle analysis',
    kind: 'analysis',
    initialFen,
    tree: handoffTree,
    activePath: handoffTree.root.children[0].children[0].path,
  };

  const restored = restoreAnalysisWorkspace(savedTabs, activeId, initialFen, false, handoff)!;
  const savedAfterPageHide = serializeAnalysisTabs(restored.tabs, restored.activeId);
  const reloaded = deserializeAnalysisTabs(savedAfterPageHide);

  assert.deepEqual(
    reloaded.tabs.map(tab => tab.id),
    savedTabs.map(tab => tab.id),
  );
  assert.equal(reloaded.activeId, activeId);
  assert.ok(
    reloaded.tabs.every(
      tab => tab.tree.root.children[0].uci === 'a4a5' && tab.tree.root.children[0].children.length === 0,
    ),
  );
});
