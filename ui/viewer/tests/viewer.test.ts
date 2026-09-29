import { positionFromFen, positionToFen, recordedPosition, standardXiangqi } from '@lixiangqi/board';
import assert from 'node:assert/strict';
import { afterEach, test, mock } from 'node:test';

import { XIANGQI_START_FEN } from 'lib/game/xiangqi';
import type { ImportedMoveTree, RulesState } from 'lib/game/xiangqiNotation';

import { applyViewerAppearance } from '../src/appearance';
import { importedViewerTree, loadViewerTree } from '../src/model';
import { embedCode, embedUrl } from '../src/sharing';
import { GameViewer, type ViewerLabels } from '../src/viewer';

globalThis.Image = window.Image;
Object.defineProperty(Image.prototype, 'decode', { configurable: true, value: async () => {} });
globalThis.AbortController = window.AbortController;
const viewers: GameViewer[] = [];
afterEach(() => {
  viewers.splice(0).forEach(viewer => {
    viewer.destroy();
    viewer.element.remove();
  });
  mock.restoreAll();
});
const labels = Object.fromEntries(
  ['first', 'previous', 'next', 'last', 'flip', 'board', 'pieces', 'sound', 'moves', 'start', 'analysis'].map(
    key => [key, key],
  ),
) as unknown as ViewerLabels;
const state = (fen: string, ply: number): RulesState => ({
  fen,
  ply,
  turn: ply % 2 ? 'black' : 'red',
  legalMoves: [],
  check: false,
  gameResult: '*',
});
function fixture(): ImportedMoveTree {
  const start = positionFromFen(XIANGQI_START_FEN, standardXiangqi);
  const first = recordedPosition(start, 'a4a5', 'black');
  const second = recordedPosition(first, 'a7a6', 'red');
  const variation = recordedPosition(start, 'c4c5', 'black');
  return {
    initialFen: XIANGQI_START_FEN,
    state: state(XIANGQI_START_FEN, 0),
    comments: ['<img src=x onerror=alert(1)>'],
    children: [
      {
        move: 'a4a5',
        notation: 'P9+1',
        state: state(positionToFen(first, standardXiangqi), 1),
        children: [
          {
            move: 'a7a6',
            notation: 'p1+1',
            state: state(positionToFen(second, standardXiangqi), 2),
            comments: ['Main continuation'],
            children: [],
          },
        ],
      },
      {
        move: 'c4c5',
        notation: 'P7+1',
        glyphs: [1],
        comments: ['Alternative'],
        state: state(positionToFen(variation, standardXiangqi), 1),
        children: [],
      },
    ],
  };
}
function mount() {
  mock.method(Image.prototype, 'decode', async () => {});
  const element = document.createElement('div');
  document.body.append(element);
  const viewer = new GameViewer(element, {
    root: importedViewerTree(fixture()),
    labels,
    services: { assetUrl: path => `/assets/${path}`, reducedMotion: () => true },
  });
  viewers.push(viewer);
  return viewer;
}

test('viewer navigates variations, shows safe comments, and treats sibling moves as jumps', () => {
  const viewer = mount();
  assert.equal(viewer.element.querySelector('.xiangqi-viewer__comments img'), null);
  assert.match(viewer.element.textContent, /<img src=x/);
  const transitions = mock.method(viewer.board, 'display');
  const root = viewer.position(),
    first = root.children[0],
    alternative = root.children[1];
  viewer.go(first);
  viewer.go(alternative);
  viewer.navigate('previous');
  assert.deepEqual(
    transitions.mock.calls.map(call => call.arguments[1]?.kind),
    ['forward', 'jump', 'backward'],
  );
  assert.equal(viewer.position(), root);
  viewer.navigate('last');
  assert.equal(viewer.position().ply, 2);
  assert.equal(viewer.board.position().pieces.has('a6'), true);
  assert.match(viewer.element.textContent, /P7\+1!/);
  const previous = viewer.element.querySelector<HTMLButtonElement>('button[title="previous"]')!;
  viewer.destroy();
  previous.click();
  assert.equal(viewer.element.children.length, 0);
});

test('theme changes stay within a widget and disposal cancels an outstanding appearance update', async () => {
  mock.method(Image.prototype, 'decode', async () => {});
  const first = document.createElement('div'),
    second = document.createElement('div');
  const bodyTheme = document.body.dataset.board;
  await applyViewerAppearance(first, path => `/assets/${path}`);
  const original = first.style.cssText;
  const abort = new AbortController();
  abort.abort();
  await applyViewerAppearance(second, path => `/assets/${path}`, undefined, undefined, abort.signal);
  assert.equal(first.style.cssText, original);
  assert.equal(second.style.cssText, '');
  assert.equal(document.body.dataset.board, bodyTheme);
});

test('embedded content stays in a URL fragment, HTML is escaped, and invalid move collections fail before requesting rules', async () => {
  const source = { initialFen: XIANGQI_START_FEN, moves: ['a4a5'], caption: '<script>alert(1)</script>' };
  const url = new URL(embedUrl(source, 'https://lixiangqi.com'));
  assert.equal(url.pathname, '/embed/xiangqi');
  assert.deepEqual(JSON.parse(decodeURIComponent(url.hash.slice(1))), source);
  assert.doesNotMatch(embedCode(source, 'https://lixiangqi.com'), /<script>/);
  await assert.rejects(loadViewerTree({ moves: ['a0a9'] }), /Invalid recorded/);
  await assert.rejects(loadViewerTree({ pgn: 'x'.repeat(500001) }), /too large/);
});

test('teaching diagrams can omit generals and retain square/circle annotations without rules requests', async () => {
  const root = await loadViewerTree({
    initialFen: '9/9/9/9/9/9/9/9/9/9 w',
    moves: [],
    marks: { circles: ['c9'], squares: ['b9'] },
  });
  assert.equal(root.position.pieces.size, 0);
  assert.equal(root.children.length, 0);
  assert.equal(root.marks[0].brush, 'blue');
  assert.match(root.marks[1].svg!, /<rect/);
});
