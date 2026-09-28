import assert from 'node:assert/strict';
import test from 'node:test';

import { bindServerAnalysis } from '../src/serverAnalysis.ts';
import {
  applyServerAnalysis,
  addOrSelectChild,
  createMoveTreeFromUciMainline,
  getNodeList,
  mainlineEndPath,
  recordedPositions,
} from '../src/tree.ts';

const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

test('published scores, mate values, best moves, variations, and depth reach the analysis tree', () => {
  const tree = createMoveTreeFromUciMainline(fen, ['a4a5', 'a7a6']);
  applyServerAnalysis(
    tree,
    [
      { ply: 1, cp: -35, best: 'b1c3', variation: ['H8+7'] },
      { ply: 2, mate: 3, variation: [] },
    ],
    30,
  );
  const nodes = getNodeList(tree, mainlineEndPath(tree));
  assert.equal(nodes[1].evaluation?.score.redCp, -35);
  assert.equal(nodes[2].evaluation?.score.redMate, 3);
  assert.equal(nodes[1].evaluation?.depth, 30);
  assert.deepEqual(nodes[1].evaluation?.variation, ['H8+7']);
  assert.equal(nodes[1].evaluation?.best, 'b1c3');
});

test('an arriving analysis follows the recorded line after a different variation is promoted', () => {
  const tree = createMoveTreeFromUciMainline(fen, ['a4a5']);
  const original = getNodeList(tree, mainlineEndPath(tree));
  const alternative = addOrSelectChild(tree, '', {
    uci: 'c4c5',
    notation: 'P7+1',
    wxfNotation: 'P7+1',
    state: { ...original[1].state },
  });
  tree.root.children.reverse();
  const recorded = recordedPositions(tree, fen, ['a4a5']);
  applyServerAnalysis(tree, [{ ply: 1, cp: 42, variation: [] }], 20, recorded);
  assert.equal(recorded[1].evaluation?.score.redCp, 42);
  assert.equal(tree.byPath.get(alternative.path)?.evaluation, undefined);
  assert.deepEqual(recordedPositions(tree, fen.replace(' 0 1', ' 0 2'), ['a4a5']), []);
});

test('catalog analysis is applied only to its game when the active tab changes during download', async () => {
  document.body.innerHTML =
    '<div id="xiangqi-server-analysis" hidden><span id="xiangqi-server-analysis-status"></span><button id="xiangqi-request-analysis"></button></div>';
  const catalog = createMoveTreeFromUciMainline(fen, ['a4a5']);
  const other = createMoveTreeFromUciMainline(fen, ['c4c5']);
  let active = catalog;
  let resolve!: (value: Response) => void;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    new Promise<Response>(done => {
      resolve = done;
    });
  try {
    const binding = bindServerAnalysis({
      bootstrap: {},
      tree: () => active,
      currentNode: () => active.root,
      renderTree: () => {},
      renderEvaluation: () => {},
      save: () => {},
      catalogPositions: async tree => recordedPositions(tree, fen, ['a4a5']),
    });
    const pending = binding.loadCatalog(catalog, 'catalog-id');
    active = other;
    resolve(
      new Response(JSON.stringify({ analysis: { depth: 30, infos: [{ ply: 1, cp: -35, variation: [] }] } })),
    );
    await pending;
    assert.equal(catalog.root.children[0].evaluation?.depth, 30);
    assert.equal(other.root.children[0].evaluation, undefined);
    binding.refresh();
    assert.equal(document.querySelector<HTMLElement>('#xiangqi-server-analysis')!.hidden, true);
    active = catalog;
    binding.refresh();
    assert.equal(document.querySelector<HTMLElement>('#xiangqi-server-analysis')!.hidden, false);
    assert.equal(document.querySelector<HTMLButtonElement>('#xiangqi-request-analysis')!.hidden, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a catalog game without analysis is checked again when revisited after publication', async () => {
  document.body.innerHTML =
    '<div id="xiangqi-server-analysis" hidden><span id="xiangqi-server-analysis-status"></span><button id="xiangqi-request-analysis"></button></div>';
  const tree = createMoveTreeFromUciMainline(fen, ['a4a5']);
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        analysis: ++requests === 1 ? null : { depth: 20, infos: [{ ply: 1, cp: 0, variation: [] }] },
      }),
    );
  try {
    const binding = bindServerAnalysis({
      bootstrap: {},
      tree: () => tree,
      currentNode: () => tree.root,
      renderTree: () => {},
      renderEvaluation: () => {},
      save: () => {},
      catalogPositions: async tree => recordedPositions(tree, fen, ['a4a5']),
    });
    await binding.loadCatalog(tree, 'catalog-id');
    assert.equal(tree.root.children[0].evaluation, undefined);
    await binding.loadCatalog(tree, 'catalog-id');
    assert.equal(tree.root.children[0].evaluation?.score.redCp, 0);
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
