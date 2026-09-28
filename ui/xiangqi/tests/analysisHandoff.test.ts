import assert from 'node:assert/strict';
import test from 'node:test';

import { createAnalysisUrl, readAnalysisUrl, replayPath } from '../src/analysisHandoff.ts';
import { addOrSelectChild, createMoveTreeFromUciMainline } from '../src/tree.ts';

const initialFen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

test('native replay links preserve the selected ply and safely ignore unrelated fragments', () => {
  const tree = createMoveTreeFromUciMainline(initialFen, ['a4a5', 'a7a6']);
  assert.equal(replayPath(tree, '#0'), '');
  assert.equal(replayPath(tree, '#1'), tree.root.children[0].path);
  const end = tree.root.children[0].children[0].path;
  for (const hash of ['', '#analysis', '#99', '#1oops']) assert.equal(replayPath(tree, hash), end);
  const custom = createMoveTreeFromUciMainline(initialFen.replace('0 1', '0 12'), ['a4a5']);
  assert.equal(replayPath(custom, '#22'), '');
  assert.equal(replayPath(custom, '#23'), custom.root.children[0].path);
});

test('analysis links preserve the complete tree and orientation from the root', () => {
  const tree = createMoveTreeFromUciMainline(initialFen, ['a4a5', 'a7a6']);
  const failed = createMoveTreeFromUciMainline(initialFen, ['c4c5']);
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
  const payload = { orientation: 'white', draft: { initialFen } };
  assert.throws(
    () => readAnalysisUrl(`#analysis=${encodeURIComponent(JSON.stringify(payload))}`),
    /incompatible format/,
  );
});

test('analysis handoff opens the selected puzzle position', () => {
  const tree = createMoveTreeFromUciMainline(initialFen, ['a4a5', 'a7a6']);
  const selected = tree.root.children[0].children[0].path;
  const url = createAnalysisUrl(tree, 'white', selected);
  assert.equal(readAnalysisUrl(url.slice(url.indexOf('#')))!.activePath, selected);
});
