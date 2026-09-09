import assert from 'node:assert/strict';
import test from 'node:test';

import { createAnalysisUrl, readAnalysisUrl } from '../src/analysisHandoff.ts';
import { addOrSelectChild, createMoveTreeFromUciMainline } from '../src/tree.ts';

const initialFen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

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
