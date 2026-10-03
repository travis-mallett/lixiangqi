import assert from 'node:assert/strict';
import test from 'node:test';

import { applyServerAnalysis, getNodeList, mainlineEndPath } from 'lib/tree/native';

import { AnalysisChart, chartNodes } from '../src/analysisChart.ts';
import { fixtureTree } from './treeFixtures';

const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

test('chart adapter keeps zero, missing and terminal evaluations distinct', () => {
  const tree = fixtureTree(fen, ['a4a5', 'a7a6', 'c4c5']);
  applyServerAnalysis(
    tree,
    [
      { ply: 1, cp: 0, variation: [] },
      { ply: 3, mate: 0, variation: [] },
    ],
    20,
  );
  const nodes = chartNodes(getNodeList(tree, mainlineEndPath(tree)));
  assert.equal(nodes[1].eval?.cp, 0);
  assert.equal(nodes[2].eval, undefined);
  assert.equal(nodes[3].eval?.mate, 0);
});

test('late chart loading selects the active game and navigation uses that game', async () => {
  document.body.innerHTML = '<div id="chart"><canvas></canvas></div>';
  const container = document.querySelector<HTMLElement>('#chart')!;
  const canvas = container.querySelector('canvas')!;
  const first = fixtureTree(fen, ['a4a5']);
  const second = fixtureTree(fen, ['c4c5', 'c7c6']);
  applyServerAnalysis(first, [{ ply: 1, cp: 50, variation: [] }], 20);
  applyServerAnalysis(
    second,
    [
      { ply: 1, cp: -60, variation: [] },
      { ply: 2, mate: 0, variation: [] },
    ],
    20,
  );
  let resolve!: (module: any) => void;
  const originalAsset = site.asset;
  let rendered: any[] = [];
  let select!: (ply: number) => void;
  let selected: number | undefined;
  let navigated: string | undefined;
  let destroyed = 0;
  site.asset = {
    loadEsm: () =>
      new Promise(done => {
        resolve = done;
      }),
  } as any;
  try {
    const chart = new AnalysisChart(
      container,
      canvas,
      path => {
        navigated = path;
      },
      error => {
        throw error;
      },
    );
    chart.render(first, mainlineEndPath(first));
    chart.render(second, mainlineEndPath(second));
    resolve({
      acpl: async (_canvas: unknown, _data: unknown, nodes: any[], options: any) => {
        rendered = nodes;
        select = options.onSelect;
        return {
          selectPly: (ply: number) => {
            selected = ply;
          },
          destroy: () => {
            destroyed++;
          },
          updateData: (_data: unknown, nodes: any[]) => {
            rendered = nodes;
          },
        };
      },
    });
    await new Promise(done => setTimeout(done, 0));
    assert.equal(rendered.length, 3);
    assert.equal(rendered[1].eval.cp, -60);
    assert.equal(selected, 2);
    select(1);
    assert.equal(navigated, second.root.children[0].path);
    chart.render(fixtureTree(fen, ['e4e5']), '');
    assert.equal(container.hidden, true);
    assert.equal(destroyed, 1);
  } finally {
    site.asset = originalAsset;
  }
});
