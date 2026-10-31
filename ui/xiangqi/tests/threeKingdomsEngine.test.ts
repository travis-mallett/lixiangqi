import { boardPresentation, createBoard, graphPoint, threeKingdoms } from '@lixiangqi/board';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { position, Tree, type Rules, type EngineResult } from 'threeKingdoms';

import { createArrowCadence } from '../src/analysisArrowCadence';
import { loadEngineSettings, engineSettingsKey } from '../src/analysisSettings';
import { kingdomArrows } from '../src/analysisThreeKingdomsArrows';
import { KingdomAnalysisChart, renderKingdomBalance } from '../src/analysisThreeKingdomsEvaluation';

const rules: Rules = (
  await import(new URL('../../../public/three-kingdoms-engine/main.js', import.meta.url).href)
).ThreeKingdoms;
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
  i18n: {
    threeKingdoms: {
      red: 'Shu — red',
      black: 'Wei — black',
      green: 'Wu — green',
      positionBalance: 'Position balance',
      balanceHelp: 'Relative strength, not win probabilities',
      eliminatedPlayer: 'Eliminated',
      selectPosition: 'Select position',
      positionNumber: (n: number) => `Position ${n}`,
    },
  },
});

test('three-player cadence supports its actual depth range without changing the two-player defaults', () => {
  const cadence = createArrowCadence<EngineResult>(3, 3, 1);
  const result = (depth: number): EngineResult => ({
    depth,
    nodes: depth * 100,
    lines: [{ pvMoves: ['a'], scores: [0, 0, 0], active: ['red', 'green', 'black'], winners: null }],
  });
  assert.ok(cadence.accept(result(1), false));
  assert.ok(cadence.accept(result(2), false));
  assert.ok(cadence.accept(result(2), true));
  assert.equal(cadence.accept(result(2), true), undefined);
  cadence.reset(3, 1);
  assert.equal(cadence.accept(result(1), false), undefined);
  assert.ok(cadence.accept(result(2), true), 'early final results are always displayed');
  localStorage.clear();
  localStorage.setItem(engineSettingsKey('threeKingdoms'), JSON.stringify({ depth: 6, multiPv: 5 }));
  assert.equal(loadEngineSettings('threeKingdoms').depth, 6);
  assert.equal(loadEngineSettings().depth, 20);
  localStorage.clear();
});

test('graph arrows use the shared style, horse legs and all three actual movers, in every orientation', () => {
  const state = rules.inspect(rules.initial());
  const pvMoves: string[] = [];
  let next = state;
  for (let ply = 0; ply < 3; ply++) {
    const horse = next.moves.find(
      move => next.pieces.find(p => p.location === move.split('>')[0])?.role === 'horse',
    )!;
    pvMoves.push(horse);
    next = rules.inspect(rules.play(next.position, horse));
  }
  const result: EngineResult = {
    depth: 3,
    nodes: 100,
    lines: [{ pvMoves, scores: [0, 0, 0], active: ['red', 'green', 'black'], winners: null }],
  };
  assert.equal(rules.route(state.position, pvMoves[0]).length, 3);
  for (const perspective of ['red', 'green', 'black']) {
    const element = document.createElement('div');
    document.body.append(element);
    const board = createBoard(element, {
      definition: threeKingdoms,
      position: position(state),
      presentation: boardPresentation('preview', perspective),
      interaction: { mode: 'display' },
      services: { assetUrl: x => x },
    });
    const marks = kingdomArrows(rules, state, perspective, result);
    board.setMarks(marks, 'annotation');
    assert.equal(element.querySelectorAll('.xiangqi-recommended-arrow').length, 3);
    assert.deepEqual(
      [...element.querySelectorAll('.xiangqi-recommended-arrow text')].map(e => e.textContent),
      ['1', '2', '3'],
    );
    assert.match(marks[0].svg!, /#e04b4d/);
    assert.match(marks[1].svg!, /#27864a/);
    assert.match(marks[2].svg!, /#282828/);
    const points = element
      .querySelector('.xiangqi-recommended-arrow')!
      .getAttribute('data-route')!
      .split(' ')
      .map(p => p.split(',').map(Number));
    const from = graphPoint(threeKingdoms.geometry, pvMoves[0].split('>')[0], perspective);
    const to = graphPoint(threeKingdoms.geometry, pvMoves[0].split('>')[1], perspective);
    assert.ok(Math.abs((points.at(-1)![0] - 50) * 0.98 - (to[0] - from[0])) < 0.01);
    assert.ok(Math.abs((points.at(-1)![1] - 50) * 0.98 - (to[1] - from[1])) < 0.01);
    board.destroy();
    element.remove();
  }
});

test('a conquered army arrow belongs to the controlling player and no eliminated turn is invented', () => {
  const initial = rules.edit(rules.initial(), '4:0k,1d:1k,2m:2k,1m:2r,19:1n,d:0a', 'red');
  const state = rules.inspect(initial);
  const move = 'wu:4:1>wu:4:0';
  const duel = rules.inspect(rules.play(initial, move));
  const reply = duel.moves[0];
  const after = rules.inspect(rules.play(duel.position, reply));
  const result: EngineResult = {
    depth: 3,
    nodes: 10,
    lines: [
      { scores: [0, 0, 0], pvMoves: [move, reply, after.moves[0]], active: duel.active, winners: null },
    ],
  };
  const marks = kingdomArrows(rules, state, 'red', result);
  assert.equal(marks.length, 2);
  assert.match(marks[1].svg!, /#282828/);
});

test('cross-river routes follow the logical file and the horse leg across the frontier', () => {
  const initial = rules.initial();
  const move = 'shu:1:2>wei:7:4';
  assert.ok(rules.inspect(initial).moves.includes(move));
  assert.deepEqual(rules.route(initial, move), ['shu:1:2', 'shu:1:3', 'shu:1:4', 'wei:7:4']);
  const horse = rules.edit(initial, '4:0k,1d:1k,2m:2k,3l:2n', 'red');
  assert.deepEqual(rules.route(horse, 'shu:3:4>wei:4:3'), ['shu:3:4', 'wei:5:4', 'wei:4:3']);
});

test('evaluation graph follows the selected branch, preserves gaps and navigates exact event positions', () => {
  const tree = new Tree(rules, rules.initial());
  const alternatives = tree.current.state.moves.slice(0, 2);
  tree.play(alternatives[0]);
  tree.cursor = 0;
  tree.play(alternatives[1]);
  tree.play('resign', 'green');
  tree.current.evaluation = { depth: 2, shares: [50, 0, 50] };
  tree.nodes[0].evaluation = { depth: 1, shares: [100 / 3, 100 / 3, 100 / 3] };
  const element = document.createElement('div');
  let selected = -1;
  const chart = new KingdomAnalysisChart(element, i => {
    selected = i;
  });
  chart.render(tree);
  assert.equal(element.hidden, false);
  assert.equal(element.querySelectorAll('.kingdom-chart__curve').length, 3);
  assert.match(element.querySelector('.kingdom-chart__curve')!.getAttribute('d')!, /^M[^L]+M/);
  const slider = element.querySelector('input')!;
  assert.equal(slider.max, '2');
  slider.value = '1';
  slider.dispatchEvent(new window.Event('input'));
  assert.equal(selected, 2, 'graph position one is the selected variation, not the first branch');
  tree.cursor = 0;
  chart.render(tree);
  assert.deepEqual(chart.line(tree), [0, 2, 3], 'selecting an ancestor keeps the displayed variation');
  tree.cursor = 3;
  renderKingdomBalance(element, tree.current.state, [50, 0, 50]);
  assert.equal(element.querySelectorAll('.eliminated').length, 1);
  assert.equal(
    element.querySelector('.kingdom-balance__bar .kingdom-color--green')!.getAttribute('style'),
    'flex-grow: 0;',
  );
});
