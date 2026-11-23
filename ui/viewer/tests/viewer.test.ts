import {
  miniXiangqi,
  positionFromFen,
  positionToFen,
  recordedPosition,
  standardXiangqi,
} from '@lixiangqi/board';
import assert from 'node:assert/strict';
import { afterEach, test, mock } from 'node:test';

import { JIEQI_START_FEN } from 'lib/game/jieqi';
import { MINI_XIANGQI_START_FEN } from 'lib/game/minixiangqi';
import { XIANGQI_START_FEN } from 'lib/game/xiangqi';
import type { ImportedMoveTree, RulesState } from 'lib/game/xiangqiNotation';

import { importedViewerTree, loadViewerTree } from '../src/model';
import { mountViewer } from '../src/mount';
import { embedCode, embedUrl } from '../src/sharing';
import { GameViewer, type ViewerLabels } from '../src/viewer';
import { initModule } from '../src/viewer.embed';

globalThis.Image = window.Image;
site.manifest = { css: {}, js: {}, hashed: { 'piece/default-wood/bK.svg': 'testhash' } };
Object.defineProperty(Image.prototype, 'decode', {
  configurable: true,
  writable: true,
  value: async () => {},
});
globalThis.AbortController = window.AbortController;
window.matchMedia = globalThis.matchMedia;
const viewers: GameViewer[] = [];
afterEach(() => {
  viewers.splice(0).forEach(viewer => {
    viewer.destroy();
    viewer.element.remove();
  });
  mock.restoreAll();
});
const labels = Object.fromEntries(
  ['first', 'previous', 'next', 'last', 'moves', 'moveAnnotations', 'start', 'analysis'].map(key => [
    key,
    key,
  ]),
) as unknown as ViewerLabels;
labels.captures = { capturedPieces: 'Captures', concealedPiece: 'Hidden', roles: { horse: 'Horse' } };
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
    ruleset: 'unrestricted-v1',
    state: state(XIANGQI_START_FEN, 0),
    annotations: { comments: [{ text: '<img src=x onerror=alert(1)>' }], shapes: [] },
    children: [
      {
        move: 'a4a5',
        notation: 'P9+1',
        annotations: { comments: [], shapes: [] },
        state: state(positionToFen(first, standardXiangqi), 1),
        children: [
          {
            move: 'a7a6',
            notation: 'p1+1',
            state: state(positionToFen(second, standardXiangqi), 2),
            annotations: { comments: [{ text: 'Main continuation' }], shapes: [] },
            children: [],
          },
        ],
      },
      {
        move: 'c4c5',
        notation: 'P7+1',
        glyphs: [1],
        annotations: { comments: [{ text: 'Alternative' }], shapes: [] },
        state: state(positionToFen(variation, standardXiangqi), 1),
        children: [],
      },
    ],
  };
}
function miniFixture(): ImportedMoveTree {
  const start = positionFromFen(MINI_XIANGQI_START_FEN, miniXiangqi);
  const first = recordedPosition(start, 'a2a3', 'black');
  const firstFen = positionToFen(first, miniXiangqi);
  return {
    initialFen: MINI_XIANGQI_START_FEN,
    ruleset: 'minixiangqi-v1',
    state: state(MINI_XIANGQI_START_FEN, 0),
    annotations: { comments: [], shapes: [] },
    children: [
      {
        move: 'a2a3',
        notation: 'P7+1',
        annotations: { comments: [], shapes: [] },
        state: state(firstFen, 1),
        children: [],
      },
    ],
  };
}
function mountTree(root: Awaited<ReturnType<typeof loadViewerTree>>) {
  mock.method(Image.prototype, 'decode', async () => {});
  const element = document.createElement('div');
  document.body.append(element);
  const viewer = new GameViewer(element, {
    root,
    labels,
    services: { assetUrl: path => `/assets/${path}`, reducedMotion: () => true },
  });
  viewers.push(viewer);
  return viewer;
}
function mount() {
  return mountTree(importedViewerTree(fixture()));
}

test('Jieqi replay widgets share the capture tray, concealment styling, and ply navigation', () => {
  const tree = fixture();
  tree.initialFen = JIEQI_START_FEN;
  tree.state = { ...state(JIEQI_START_FEN, 0), variant: 'jieqi', captures: [] };
  tree.children[0].state = {
    ...tree.children[0].state,
    variant: 'jieqi',
    captures: [{ side: 'black', square: 'b10', role: 'horse', concealed: true, ply: 1 }],
  };
  const viewer = mountTree(importedViewerTree(tree));
  assert.equal(viewer.element.querySelectorAll('.jieqi-captures').length, 2);
  assert.equal(viewer.element.querySelector('.jieqi-captures piece'), null);
  viewer.navigate('next');
  assert.equal(viewer.element.querySelectorAll('.jieqi-captures__piece--concealed piece.n-piece').length, 1);
  viewer.navigate('first');
  assert.equal(viewer.element.querySelector('.jieqi-captures piece'), null);
});

test('viewer renders the replay panel without per-board settings', () => {
  const viewer = mount();
  assert.equal(viewer.element.querySelector('details'), null);
  assert.equal(viewer.element.querySelector('select'), null);
  assert.deepEqual(
    [...viewer.element.querySelectorAll('.xiangqi-viewer__controls [data-act]')].map(element =>
      element.getAttribute('data-act'),
    ),
    ['first', 'prev', 'next', 'last'],
  );
  assert.equal(
    viewer.element.querySelector('.xiangqi-viewer__moves .tview2-column move[data-node]')?.textContent,
    'P9+1',
  );
});

test('populated viewers use supplied replay labels without a global i18n catalog', () => {
  const i18nDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'i18n');
  const bodyChildren = new Set(document.body.children);
  try {
    Reflect.deleteProperty(globalThis, 'i18n');
    const viewer = mount();
    assert.deepEqual(
      [...viewer.element.querySelectorAll('.xiangqi-viewer__controls button')].map(button =>
        button.getAttribute('aria-label'),
      ),
      ['first', 'previous', 'next', 'last'],
    );
  } finally {
    if (i18nDescriptor) Object.defineProperty(globalThis, 'i18n', i18nDescriptor);
    [...document.body.children].filter(child => !bodyChildren.has(child)).forEach(child => child.remove());
  }
});

test('populated Mini viewers render replay controls without a global i18n catalog', () => {
  const i18nDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'i18n');
  const bodyChildren = new Set(document.body.children);
  try {
    Reflect.deleteProperty(globalThis, 'i18n');
    const viewer = mountTree(importedViewerTree(miniFixture()));
    assert.equal(viewer.board.getDefinition().id, 'minixiangqi');
    assert.equal(viewer.position().children.length, 1);
    assert.deepEqual(
      [...viewer.element.querySelectorAll('.xiangqi-viewer__controls button')].map(button =>
        button.getAttribute('aria-label'),
      ),
      ['first', 'previous', 'next', 'last'],
    );
  } finally {
    if (i18nDescriptor) Object.defineProperty(globalThis, 'i18n', i18nDescriptor);
    [...document.body.children].filter(child => !bodyChildren.has(child)).forEach(child => child.remove());
  }
});

test('viewer navigates variations, shows safe comments, and treats sibling moves as jumps', () => {
  const viewer = mount();
  assert.equal(viewer.element.querySelector('.xiangqi-viewer__comments img'), null);
  assert.match(viewer.element.textContent, /<img src=x/);
  const notes = [...viewer.element.querySelectorAll('move .xiangqi-viewer__note')];
  assert.equal(notes.length, 2);
  assert.ok(notes.every(note => note.getAttribute('aria-hidden') === 'true'));
  notes
    .find(note => note.closest('move')?.getAttribute('aria-label') === 'P7+1!, moveAnnotations')!
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(viewer.position().move, 'c4c5');
  assert.equal(viewer.element.querySelector('.xiangqi-viewer__comments')?.textContent, 'Alternative');
  viewer.navigate('first');
  assert.deepEqual(
    notes.map(note => note.closest('move')?.getAttribute('aria-label')).sort(),
    ['P7+1!, moveAnnotations', 'p1+1, moveAnnotations'].sort(),
  );
  const transitions = mock.method(viewer.board, 'display');
  const root = viewer.position(),
    first = root.children[0],
    alternative = root.children[1];
  viewer.element
    .querySelector<HTMLElement>('.xiangqi-viewer__moves move[data-node]')!
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(viewer.position(), first);
  assert.equal(
    viewer.element.querySelector('.xiangqi-viewer__moves move.active')?.getAttribute('aria-current'),
    'step',
  );
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
  const control = (action: string) =>
    viewer.element.querySelector<HTMLElement>(`.xiangqi-viewer__controls [data-act="${action}"]`)!;
  assert.equal(control('prev').hasAttribute('disabled'), false);
  assert.equal(control('next').hasAttribute('disabled'), true);
  viewer.destroy();
  assert.equal(viewer.element.children.length, 0);
});

test('an annotated example keeps its note box in place between moves', () => {
  const viewer = mount();
  assert.equal(viewer.element.classList.contains('xiangqi-viewer--annotated'), true);
  viewer.go(viewer.position().children[0]);
  assert.equal(viewer.element.querySelector('.xiangqi-viewer__comments')?.textContent, '');
  assert.equal(viewer.element.querySelector('.xiangqi-viewer__feedback')?.isConnected, true);
  assert.equal(viewer.element.querySelector('.xiangqi-viewer__moves')?.isConnected, true);
});

test('a viewer mounts only after its selected board, faces and shadows are ready', async () => {
  const gate = Promise.withResolvers<void>();
  const urls: string[] = [];
  const requested = Promise.withResolvers<void>();
  mock.method(Image.prototype, 'decode', function (this: HTMLImageElement) {
    urls.push(`url("${new URL(this.src).pathname}")`);
    requested.resolve();
    return gate.promise;
  });
  const element = document.createElement('div');
  const bodyTheme = document.body.dataset.board;
  const mounting = mountViewer(
    element,
    { tree: fixture() },
    { labels, services: { assetUrl: path => `/readiness/${path}` } },
  );
  await requested.promise;
  assert.equal(element.children.length, 0);
  gate.resolve();
  viewers.push(await mounting);
  assert.match(element.style.getPropertyValue('---board-image-xiangqi-9x10'), /^url\("\/readiness\//);
  for (const variable of [
    '---board-image',
    '---black-general',
    '---red-soldier',
    '--xiangqi-rest-shadow-image',
    '--xiangqi-airborne-shadow-image',
  ])
    assert.ok(urls.includes(element.style.getPropertyValue(variable)));
  assert.equal(element.style.getPropertyValue('---board-image-minixiangqi-7x7'), '');
  assert.equal(document.body.dataset.board, bodyTheme);
});

test('initial ply mounts directly and renders its notes and replay state', () => {
  const root = importedViewerTree(fixture());
  const element = document.createElement('div');
  const onPosition = mock.fn();
  const viewer = new GameViewer(element, {
    root,
    labels,
    initialPly: 1,
    services: { assetUrl: path => `/assets/${path}` },
    onPosition,
  });
  viewers.push(viewer);
  assert.equal(viewer.position(), root.children[0]);
  assert.equal(viewer.board.position().pieces.has('a5'), true);
  assert.equal(element.querySelector('move[aria-current="step"]')?.textContent, 'P9+1');
  assert.equal(onPosition.mock.callCount(), 1);
  viewer.go(viewer.position());
  assert.equal(onPosition.mock.callCount(), 1);
});

test('an embedded viewer reannounces its height and preserves replay on a persisted page restore', async () => {
  const element = document.createElement('div');
  element.id = 'xiangqi-embed';
  document.body.append(element);
  const postMessage = mock.fn();
  const previousParent = Object.getOwnPropertyDescriptor(window, 'parent')!;
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(window, 'parent', { configurable: true, value: { postMessage } });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: window.location });
  mock.method(document.body, 'getBoundingClientRect', () => ({ height: 413.2 }));
  const resizeObserver = Object.getOwnPropertyDescriptor(window, 'ResizeObserver');
  const globalResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  const disconnect = mock.fn();
  // Offscreen frames can render before ResizeObserver delivers a callback.
  class DeferredObserver {
    private target?: Element;
    observe(target: Element) {
      this.target = target;
    }
    disconnect() {
      if (this.target === document.body) disconnect();
    }
  }
  for (const scope of [window, globalThis])
    Object.defineProperty(scope, 'ResizeObserver', { configurable: true, value: DeferredObserver });
  try {
    const tree = fixture();
    await initModule({
      labels,
      ruleset: tree.ruleset,
      moves: ['a4a5'],
      states: [tree.state, tree.children[0].state],
    });
    assert.deepEqual(
      postMessage.mock.calls.map(call => call.arguments),
      [[{ type: 'xiangqi-embed:height', height: 414 }, '*']],
    );
    assert.equal(element.style.getPropertyValue('---black-general'), 'url("/assets/hashed/bK.testhash.svg")');
    element.querySelector<HTMLButtonElement>('button[data-act="next"]')!.click();
    const active = element.querySelector('move[aria-current="step"]');
    assert.ok(active);
    postMessage.mock.resetCalls();
    window.dispatchEvent(new window.PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));
    assert.equal(element.querySelector('move[aria-current="step"]'), active);
    assert.deepEqual(
      postMessage.mock.calls.map(call => call.arguments),
      [[{ type: 'xiangqi-embed:height', height: 414 }, '*']],
    );
  } finally {
    window.dispatchEvent(new window.PageTransitionEvent('pagehide'));
    assert.equal(element.children.length, 0);
    assert.equal(disconnect.mock.callCount(), 1);
    element.remove();
    if (resizeObserver) Object.defineProperty(window, 'ResizeObserver', resizeObserver);
    else Reflect.deleteProperty(window, 'ResizeObserver');
    if (globalResizeObserver) Object.defineProperty(globalThis, 'ResizeObserver', globalResizeObserver);
    else Reflect.deleteProperty(globalThis, 'ResizeObserver');
    Object.defineProperty(window, 'parent', previousParent);
    if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation);
    else Reflect.deleteProperty(globalThis, 'location');
  }
});

test('embedded content stays in a URL fragment, HTML is escaped, and invalid move collections fail before requesting rules', async () => {
  const source = { initialFen: XIANGQI_START_FEN, moves: ['a4a5'], caption: '<script>alert(1)</script>' };
  const url = new URL(embedUrl(source, 'https://lixiangqi.com'));
  assert.equal(url.pathname, '/embed/xiangqi');
  assert.deepEqual(JSON.parse(decodeURIComponent(url.hash.slice(1))), source);
  assert.doesNotMatch(embedCode(source, 'https://lixiangqi.com'), /<script>/);
  await assert.rejects(loadViewerTree({ moves: ['a0a9'] }), /Invalid recorded/);
  await assert.rejects(loadViewerTree({ moves: 'a4a5' as unknown as string[] }), /Invalid recorded/);
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
  assert.match(root.marks[1].svg, /<rect/);
});

test('a diagram with nothing to replay shows the board alone', async () => {
  const viewer = mountTree(await loadViewerTree({ initialFen: '9/9/9/9/9/9/9/9/9/9 w' }));
  assert.equal(viewer.element.classList.contains('xiangqi-viewer--solo'), true);
  assert.equal(viewer.element.querySelector('.xiangqi-viewer__moves'), null);
  assert.equal(viewer.element.querySelector('.xiangqi-viewer__controls'), null);
});

test('a diagram keeps its note beside the board', async () => {
  const viewer = mountTree(
    await loadViewerTree({ initialFen: '9/9/9/9/9/9/9/9/9/9 w', annotations: { '0': 'Red to move.' } }),
  );
  assert.equal(viewer.element.classList.contains('xiangqi-viewer--solo'), false);
  assert.equal(viewer.element.querySelector('.xiangqi-viewer__comments')?.textContent, 'Red to move.');
  assert.equal(viewer.element.querySelector('.xiangqi-viewer__controls'), null);
});
