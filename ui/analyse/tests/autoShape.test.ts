import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analysisBoardArrows, type AnalysisBoardArrowState } from 'xiangqi';

import { compute } from '../src/autoShape';
import type AnalyseCtrl from '../src/ctrl';

const multiPv = [
  ['h1e1', 'h10g8'],
  ['b1c3', 'b10c8'],
  ['c4c5', 'c7c6'],
];

function makeCtrl(
  options: {
    pvs?: string[][];
    best?: string;
    turn?: 'red' | 'black';
    orientation?: 'red' | 'black';
    hovering?: string;
    children?: string[];
    threat?: string[];
    variationArrows?: boolean;
  } = {},
): { ctrl: AnalyseCtrl; state: AnalysisBoardArrowState } {
  const {
    pvs = multiPv,
    best,
    turn = 'red',
    orientation = 'red',
    hovering,
    children = [],
    threat = [],
    variationArrows = true,
  } = options;
  const node = {
    fen: 'root w - - 0 1',
    ceval: pvs.length ? { pvs: pvs.map(moves => ({ moves })) } : undefined,
    eval: best ? { best } : undefined,
    threat: threat.length ? { pvs: threat.map(moves => ({ moves: [moves] })) } : undefined,
    glyphs: [],
  };
  const state: AnalysisBoardArrowState = {
    engineLines: pvs.length ? pvs : best ? [[best]] : [],
    turn,
    orientation,
    children,
    previewMove: hovering,
    threatMoves: threat,
  };
  const ctrl = {
    node,
    path: '',
    settings: { showLiveAnnotations: false },
    liveAnnotate: { get: () => undefined },
    explorer: { hovering: () => (hovering ? { fen: node.fen, uci: hovering } : undefined) },
    fork: { hover: () => undefined, selectedIndex: 0 },
    practice: undefined,
    retro: undefined,
    ceval: { hovering: () => undefined, search: { multiPv: 3 } },
    motif: { any: () => false },
    motifEnabled: () => false,
    turnColor: () => turn,
    getOrientation: () => orientation,
    nextNodeBest: () => undefined,
    isCevalAllowed: () => true,
    showBestMoveArrows: () => true,
    showEvaluation: () => true,
    showMoveAnnotations: () => false,
    showVariationArrows: () => variationArrows,
    threatMode: () => threat.length > 0,
    visibleChildren: () => children.map(uci => ({ uci })),
  } as unknown as AnalyseCtrl;
  return { ctrl, state };
}

test('study board draws only the shared analysis arrows', () => {
  const { ctrl, state } = makeCtrl({ children: ['a1a2', 'd1d2'] });
  const shapes = compute(ctrl);
  // The study board must not reimplement arrow rendering: what it draws for the
  // same state is exactly what the shared analysis module produces.
  assert.deepEqual(shapes, analysisBoardArrows(state));
  assert.equal(shapes.length, 8, 'six engine arrows plus two variations');
  for (const shape of shapes) assert.equal(shape.brush, undefined, 'no legacy brush arrows');
});

test('study board leaves continuations the engine lines already draw to those arrows', () => {
  const { ctrl } = makeCtrl({ children: ['b1c3', 'c4c5'] });
  assert.equal(compute(ctrl).length, 6, 'both continuations are engine line moves');
});

test('study board numbers every engine line by ply', () => {
  const { ctrl } = makeCtrl();
  const shapes = compute(ctrl);
  assert.equal(shapes.length, 6);
  assert.deepEqual(
    shapes.map(shape => /<text[^>]*>(\d+)<\/text>/.exec(shape.svg ?? '')?.[1]),
    ['1', '2', '1', '2', '1', '2'],
  );
  const [faintest, , , , primary] = shapes.map(shape => shape.svg ?? '');
  assert.match(primary, /opacity="1"/);
  assert.match(primary, />1<\/text>/);
  assert.doesNotMatch(primary, /dashed/);
  assert.match(faintest, />1<\/text>/);
  assert.match(faintest, /opacity="0.4"/);
  assert.match(faintest, /xiangqi-recommended-arrow--dashed/);
});

test('study board falls back to the known best move as a single numbered pair', () => {
  const fallback = makeCtrl({ pvs: [], best: 'h1e1' });
  assert.deepEqual(compute(fallback.ctrl), analysisBoardArrows(fallback.state));
  assert.equal(compute(fallback.ctrl).length, 1);
  assert.deepEqual(compute(makeCtrl({ pvs: [], best: '(none)' }).ctrl), []);
});

test('study board mirrors the shared arrows when red is not at the bottom', () => {
  const { ctrl, state } = makeCtrl({ pvs: [['b10c8', 'h1e1']], turn: 'black', orientation: 'black' });
  const shapes = compute(ctrl);
  assert.deepEqual(shapes, analysisBoardArrows(state));
  assert.match(shapes[0].svg ?? '', /50,-50/);
  // Black moves first, so black is 1 and red the reply is 2.
  assert.match(shapes[0].svg ?? '', />1<\/text>/);
  assert.match(shapes[0].svg ?? '', /fill="#282828"/);
  assert.match(shapes[1].svg ?? '', />2<\/text>/);
  assert.match(shapes[1].svg ?? '', /fill="#e04b4d"/);
});

test('study board previews and continuations use the shared arrow style too', () => {
  const hovering = compute(makeCtrl({ hovering: 'h1e1' }).ctrl);
  assert.equal(hovering.length, 7, 'the hover preview joins the engine lines');
  const preview = hovering[6].svg ?? '';
  assert.match(preview, /opacity="0.6"/);
  assert.match(preview, /fill="#003088"/);
  assert.doesNotMatch(preview, /<text/, 'support arrows are unnumbered');

  const single = compute(makeCtrl({ children: ['a1a2'] }).ctrl);
  assert.equal(single.length, 6, 'a lone continuation is the main line, not a variation');
  const variations = compute(makeCtrl({ children: ['a1a2', 'd1d2'] }).ctrl);
  assert.equal(variations.length, 8);
  for (const shape of variations.slice(0, 2)) {
    assert.match(shape.svg ?? '', /fill="#4a4a4a"/);
    assert.doesNotMatch(shape.svg ?? '', /<text/);
  }

  const threats = compute(makeCtrl({ threat: ['h10g8'] }).ctrl);
  assert.match(threats[0].svg ?? '', /fill="#882020"/);
});
