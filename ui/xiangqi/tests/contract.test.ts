import assert from 'node:assert/strict';
import test from 'node:test';

import { engineMoveToUi, parsePikafishInfo, PikafishProtocol } from 'lib/ceval';

import {
  ENGINE_SETTINGS_KEY,
  INTERFACE_SETTINGS_KEY,
  loadEngineSettings,
  loadInterfaceSettings,
} from '../src/analysisSettings.ts';
import {
  deserializeAnalysisTabs,
  MAX_ANALYSIS_TAB_TITLE_LENGTH,
  normalizeAnalysisTabTitle,
  serializeAnalysisTabs,
  type AnalysisTab,
} from '../src/analysisTabs.ts';
import { AnalysisTreeView } from '../src/analysisTreeView.ts';
import { hydrateXiangqiState, requestXiangqi } from '../src/api.ts';
import { engineProgress } from '../src/engineProgress.ts';
import { displayedEvaluation, formatEvaluation, NEUTRAL_EVALUATION } from '../src/evaluation.ts';
import {
  annotationSourceLabel,
  analysisGameUrl,
  countedSourceLabel,
  databaseEventUrl,
  databasePlayerUrl,
  isCatalogSource,
  resultLabel,
  sortSourceKeysByCount,
  sourceLabels,
} from '../src/gameCatalog.ts';
import { gaugeDockAtPoint, isGaugeDock } from '../src/gaugeDock.ts';
import { cgToUci, legalMoveDests, setXiangqiGroundPending, uciMoveToCg, uciToCg } from '../src/groundUtil.ts';
import { makeXiangqiGround, setXiangqiCoordinates } from '../src/index.ts';
import { renderXiangqiNotation, renderXiangqiMovetext } from '../src/notation.ts';
import { recommendedArrowShapes } from '../src/recommendedArrows.ts';
import { xiangqiMoveSound, xiangqiTransitionSound } from '../src/sound.ts';
import {
  addOrSelectChild,
  createMoveTree,
  createMoveTreeFromUciMainline,
  deleteNode,
  deserializeMoveTree,
  mainlineEndPath,
  movesToPath,
  pathIsMainline,
  promote,
  serializeMoveTree,
  type RulesState,
} from '../src/tree.ts';

const state = (fen: string, turn: 'red' | 'black', ply: number): RulesState => ({
  fen,
  turn,
  ply,
  legalMoves: [],
  check: false,
  gameResult: '*',
});

interface RecordedAnimation {
  element: HTMLElement;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
}

const fixedBoardBounds = (): DOMRect => ({
  bottom: 1000,
  height: 1000,
  left: 0,
  right: 900,
  top: 0,
  width: 900,
  x: 0,
  y: 0,
  toJSON: () => ({}),
});

function recordAnimations(settled = false): { calls: RecordedAnimation[]; restore: () => void } {
  const prototype = window.HTMLElement.prototype;
  const original = Object.getOwnPropertyDescriptor(prototype, 'animate');
  const calls: RecordedAnimation[] = [];

  Object.defineProperty(prototype, 'animate', {
    configurable: true,
    writable: true,
    value(
      this: HTMLElement,
      keyframes: Keyframe[] | PropertyIndexedKeyframes,
      options?: number | KeyframeAnimationOptions,
    ): Animation {
      assert.ok(Array.isArray(keyframes));
      const normalizedOptions = typeof options === 'number' ? { duration: options } : (options ?? {});
      calls.push({ element: this, keyframes, options: normalizedOptions });

      const animation = { cancel() {} } as Animation;
      Object.defineProperty(animation, 'finished', {
        value: settled ? Promise.resolve(animation) : new Promise<Animation>(() => {}),
      });
      return animation;
    },
  });

  return {
    calls,
    restore() {
      if (original) Object.defineProperty(prototype, 'animate', original);
      else delete (prototype as Partial<HTMLElement>).animate;
    },
  };
}

test('builds safe native analysis links for catalog games', () => {
  assert.equal(analysisGameUrl('dpxq:1122'), '/analysis?game=dpxq%3A1122');
  assert.equal(analysisGameUrl('source/id?x=1'), '/analysis?game=source%2Fid%3Fx%3D1');
  assert.equal(
    databasePlayerUrl('Wang Tianyi (王天一)'),
    '/games/database/player?player=Wang%20Tianyi%20(%E7%8E%8B%E5%A4%A9%E4%B8%80)',
  );
  assert.equal(
    databaseEventUrl('World Championship 2026'),
    '/games/database/event?event=World%20Championship%202026',
  );
  assert.equal(resultLabel(1), '1-0');
  assert.equal(resultLabel(0), '½-½');
  assert.equal(resultLabel(-1), '0-1');
  assert.equal(isCatalogSource('k'), true);
  assert.equal(isCatalogSource('am'), true);
  assert.equal(isCatalogSource('ec'), true);
  assert.equal(isCatalogSource('x'), false);
});

test('formats database source quantities with thousands separators', () => {
  assert.equal(countedSourceLabel('Master Games', 141279), 'Master Games (141,279)');
  assert.equal(countedSourceLabel('DPXQ Online Games', 35455), 'DPXQ Online Games (35,455)');
  assert.equal(countedSourceLabel('Top Blitz Games', 1245), 'Top Blitz Games (1,245)');
});

test('keeps ancient manual collection labels out of move annotations', () => {
  assert.equal(sourceLabels.am, 'Ancient Manuals');
  assert.equal(annotationSourceLabel('ancient_manuals', 'Ancient Manuals'), undefined);
  assert.equal(annotationSourceLabel('games', 'GDChess/01xq'), 'GDChess/01xq');
});

test('sorts database sources by dataset size with stable ties', () => {
  const sources = ['xqd', 'm', 'gd', 'ec'] as const;
  assert.deepEqual(sortSourceKeysByCount(sources, { m: 141279, gd: 87312, xqd: 20455, ec: 20455 }), [
    'm',
    'gd',
    'xqd',
    'ec',
  ]);
});

test('uses PyChess rank-10 encoding exactly', () => {
  assert.equal(uciToCg('a10a9'), 'a:a9');
  assert.equal(cgToUci('a:a9'), 'a10a9');
  assert.deepEqual(uciMoveToCg('i10h10'), ['i:', 'h:']);
});

test('renders the numbered tapered recommendation style and orthogonal horse route', () => {
  const shapes = recommendedArrowShapes(['h1e1', 'h10g8'], 'red');
  assert.equal(shapes.length, 2);
  assert.equal(shapes[0].orig, 'h1');
  assert.match(shapes[0].customSvg ?? '', /fill="#e04b4d"/);
  assert.match(shapes[0].customSvg ?? '', />1<\/text>/);
  assert.equal(shapes[1].orig, 'h:');
  assert.match(shapes[1].customSvg ?? '', /fill="#282828"/);
  assert.match(shapes[1].customSvg ?? '', /50,150/);
  assert.match(shapes[1].customSvg ?? '', />2<\/text>/);
  assert.match(shapes[1].customSvg ?? '', /fill="#77a718"/);
});

test('mirrors recommendation geometry with a flipped board', () => {
  const shape = recommendedArrowShapes(['h10g8'], 'black', 'black')[0];
  assert.match(shape.customSvg ?? '', /50,-50/);
});

test('groups Xiangqi UCI moves for ChessgroundX', () => {
  const dests = legalMoveDests(['a1a2', 'a1a3', 'a10a9']);
  assert.deepEqual(dests.get('a1'), ['a2', 'a3']);
  assert.deepEqual(dests.get('a:'), ['a9']);
});

test('renders traditional Xiangqi file numbers and redraws them when toggled or flipped', () => {
  const element = document.createElement('div');
  document.body.append(element);
  const ground = makeXiangqiGround(element, { viewOnly: true });

  assert.equal(element.querySelector('coords.top')?.textContent, '123456789');
  assert.equal(element.querySelector('coords.bottom')?.textContent, '一二三四五六七八九');
  assert.ok(element.querySelector('coords.bottom')?.classList.contains('backward'));
  assert.ok(element.classList.contains('orientation-white'));

  ground.toggleOrientation();
  assert.ok(element.classList.contains('orientation-black'));
  assert.equal(element.querySelectorAll('coords').length, 2);

  setXiangqiCoordinates(ground, false);
  assert.equal(element.querySelectorAll('coords').length, 0);

  setXiangqiCoordinates(ground, true);
  assert.equal(element.querySelectorAll('coords').length, 2);

  ground.destroy();
  element.remove();
});

test('distinguishes the origin and destination of the last move', () => {
  const element = document.createElement('div');
  document.body.append(element);
  const ground = makeXiangqiGround(element, { lastMove: 'h1g3', viewOnly: true });

  assert.equal(element.querySelectorAll('square.last-move').length, 2);
  assert.ok(element.querySelector('square.last-move-origin'));
  assert.ok(element.querySelector('square.last-move-destination'));

  ground.destroy();
  element.remove();
});

test('replaces Xiangqi selection and ghost feedback with the final lifted piece presentation', () => {
  const originalBounds = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = fixedBoardBounds;
  const animations = recordAnimations();

  const element = document.createElement('div');
  document.body.append(element);
  const ground = makeXiangqiGround(element, {
    movableColor: 'white',
    legalMoves: ['h1g3'],
  });

  try {
    ground.set({ draggable: { enabled: true, showGhost: true }, selectable: { enabled: false } });
    assert.equal(ground.state.draggable.enabled, false);
    assert.equal(ground.state.selectable.enabled, true);

    ground.selectSquare('h1');
    ground.state.dom.redrawNow();

    const selectedPiece = [...element.querySelectorAll<HTMLElement>('cg-board > piece')].find(
      piece => (piece as HTMLElement & { cgKey?: string }).cgKey === 'h1',
    );
    assert.ok(selectedPiece);
    assert.ok(selectedPiece.classList.contains('xiangqi-motion-piece'));
    assert.equal(selectedPiece.style.getPropertyValue('--xiangqi-piece-perspective'), '300px');
    assert.ok(selectedPiece.querySelector('.xiangqi-motion-shadow-near'));
    assert.ok(selectedPiece.querySelector('.xiangqi-motion-shadow-aerial-core'));
    assert.ok(selectedPiece.querySelector('.xiangqi-motion-shadow-far'));
    assert.ok(selectedPiece.querySelector('.xiangqi-motion-rim'));
    assert.ok(selectedPiece.querySelector('.xiangqi-motion-face'));

    assert.ok(element.querySelector('square.xiangqi-lift-origin'));
    assert.ok(element.querySelector('square.xiangqi-move-dest'));
    assert.equal(element.querySelector('square.selected'), null);
    assert.equal(element.querySelector('square.move-dest'), null);
    assert.equal(element.querySelector('piece.ghost'), null);

    const stack = selectedPiece.querySelector<HTMLElement>('.xiangqi-motion-stack');
    const lift = animations.calls.find(call => call.element === stack);
    assert.ok(lift);
    assert.equal(lift.options.duration, 33);
    assert.equal(lift.options.easing, 'linear');
    assert.equal(lift.options.fill, 'forwards');
    assert.deepEqual(
      lift.keyframes.map(frame => frame.transform),
      ['translate3d(0, 0%, 0.000px) rotateX(0deg)', 'translate3d(0, -7%, 45.763px) rotateX(27deg)'],
    );
  } finally {
    ground.destroy();
    element.remove();
    animations.restore();
    window.HTMLElement.prototype.getBoundingClientRect = originalBounds;
  }
});

test('uses the measured layered carry path and keeps its destination underlay attached', () => {
  const originalBounds = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = fixedBoardBounds;
  const animations = recordAnimations();

  const element = document.createElement('div');
  document.body.append(element);
  const ground = makeXiangqiGround(element, { viewOnly: true });

  try {
    ground.move('h1', 'g3');

    const destination = element.querySelector<HTMLElement>('square.last-move-destination');
    const movedPiece = [...element.querySelectorAll<HTMLElement>('cg-board > piece')].find(
      piece => (piece as HTMLElement & { cgKey?: string }).cgKey === 'g3',
    );
    assert.ok(destination);
    assert.ok(movedPiece);
    assert.equal(destination.style.transform, movedPiece.style.transform);
    assert.ok(movedPiece.classList.contains('xiangqi-motion-piece'));

    const carry = animations.calls.find(call => call.element === movedPiece);
    assert.ok(carry);
    assert.equal(carry.options.duration, 150);
    assert.equal(carry.options.easing, 'linear');
    assert.equal(carry.options.fill, 'forwards');
    assert.deepEqual(
      carry.keyframes.map(frame => [frame.offset, frame.transform]),
      [
        [0, 'translate3d(700px,900px,0)'],
        [0.2, 'translate3d(700px,900px,0)'],
        [0.4, 'translate3d(668px,836px,0)'],
        [0.6, 'translate3d(637px,774px,0)'],
        [0.8, 'translate3d(607px,714px,0)'],
        [1, 'translate3d(600px,700px,0)'],
      ],
    );

    const destinationCarry = animations.calls.find(call => call.element === destination);
    assert.ok(destinationCarry);
    assert.deepEqual(destinationCarry.keyframes, carry.keyframes);

    const stack = movedPiece.querySelector<HTMLElement>('.xiangqi-motion-stack');
    const pitch = animations.calls.find(call => call.element === stack);
    assert.ok(pitch);
    assert.deepEqual(
      pitch.keyframes.map(frame => [frame.offset, frame.transform]),
      [
        [0, 'translate3d(0, 0%, 0.000px) rotateX(0deg)'],
        [0.2, 'translate3d(0, -7%, 45.763px) rotateX(27deg)'],
        [1, 'translate3d(0, -10%, 69.231px) rotateX(27deg)'],
      ],
    );
  } finally {
    ground.destroy();
    element.remove();
    animations.restore();
    window.HTMLElement.prototype.getBoundingClientRect = originalBounds;
  }
});

test('carries a click-selected piece and preserves that motion through authoritative confirmation', () => {
  const originalBounds = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = fixedBoardBounds;
  const animations = recordAnimations();

  const element = document.createElement('div');
  document.body.append(element);
  const ground = makeXiangqiGround(element, {
    movableColor: 'white',
    legalMoves: ['h1g3'],
    onMove: () => undefined,
  });

  try {
    ground.selectSquare('h1');
    ground.state.dom.redrawNow();
    ground.selectSquare('g3');

    const movedPiece = [...element.querySelectorAll<HTMLElement>('cg-board > piece')].find(
      piece => (piece as HTMLElement & { cgKey?: string }).cgKey === 'g3',
    );
    assert.ok(movedPiece);
    assert.ok(movedPiece.classList.contains('xiangqi-motion-piece'));
    assert.ok(animations.calls.some(call => call.element === movedPiece && call.options.duration === 150));

    ground.set({
      fen: ground.getFen(),
      lastMove: ['h1', 'g3'],
      movable: { color: undefined, dests: new Map() },
    });

    assert.ok(movedPiece.classList.contains('xiangqi-motion-piece'));
  } finally {
    ground.destroy();
    element.remove();
    animations.restore();
    window.HTMLElement.prototype.getBoundingClientRect = originalBounds;
  }
});

test('uses the measured flat slide only when requested for reverse navigation', () => {
  const originalBounds = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = fixedBoardBounds;
  const animations = recordAnimations();

  const element = document.createElement('div');
  document.body.append(element);
  const initialFen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR';
  const ground = makeXiangqiGround(element, {
    fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C4NC1/9/RNBAKAB1R',
    movableColor: 'white',
    legalMoves: ['g3h1'],
  });

  try {
    ground.selectSquare('g3');
    ground.state.dom.redrawNow();
    assert.ok(element.querySelector('piece.xiangqi-motion-piece'));
    animations.calls.length = 0;

    ground.set({ fen: initialFen, lastMove: undefined }, { animation: 'slide' });

    const movedPiece = [...element.querySelectorAll<HTMLElement>('cg-board > piece')].find(
      piece => (piece as HTMLElement & { cgKey?: string }).cgKey === 'h1',
    );
    assert.ok(movedPiece);
    assert.equal(ground.state.selectable.selected, undefined);
    assert.equal(movedPiece.classList.contains('xiangqi-motion-piece'), false);
    assert.equal(movedPiece.querySelector('.xiangqi-motion-stack'), null);

    const slide = animations.calls.find(
      call => call.element === movedPiece && call.keyframes.length === 5 && call.keyframes[1].offset === 0.23,
    );
    assert.ok(slide);
    assert.ok(Math.abs(Number(slide.options.duration) - 120.601545) < 0.001);
    assert.equal(slide.options.easing, 'linear');
    assert.deepEqual(
      slide.keyframes.map(frame => [frame.offset, frame.transform]),
      [
        [0, 'translate3d(600px,700px,0)'],
        [0.23, 'translate3d(635px,770px,0)'],
        [0.47, 'translate3d(667px,834px,0)'],
        [0.75, 'translate3d(694px,888px,0)'],
        [1, 'translate3d(700px,900px,0)'],
      ],
    );
  } finally {
    ground.destroy();
    element.remove();
    animations.restore();
    window.HTMLElement.prototype.getBoundingClientRect = originalBounds;
  }
});

test('stacks the destination shadow below its glow and piece face', async () => {
  const originalBounds = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = fixedBoardBounds;
  const animations = recordAnimations(true);

  const element = document.createElement('div');
  document.body.append(element);
  const ground = makeXiangqiGround(element, { viewOnly: true });

  try {
    ground.move('h1', 'g3');
    await new Promise(resolve => setTimeout(resolve, 0));

    const movedPiece = [...element.querySelectorAll<HTMLElement>('cg-board > piece')].find(
      piece => (piece as HTMLElement & { cgKey?: string }).cgKey === 'g3',
    );
    assert.ok(movedPiece);
    assert.ok(movedPiece.classList.contains('xiangqi-last-move-piece'));
    assert.deepEqual(
      [...movedPiece.children].map(child => child.className),
      [
        'xiangqi-rest-shadow xiangqi-rest-shadow-far',
        'xiangqi-rest-shadow xiangqi-rest-shadow-near',
        'xiangqi-last-move-highlight',
        'xiangqi-rest-face',
      ],
    );
  } finally {
    ground.destroy();
    element.remove();
    animations.restore();
    window.HTMLElement.prototype.getBoundingClientRect = originalBounds;
  }
});

test('lands the layered piece with the final measured perspective sequence', async () => {
  const originalBounds = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = fixedBoardBounds;
  const animations = recordAnimations(true);

  const element = document.createElement('div');
  document.body.append(element);
  const ground = makeXiangqiGround(element, { viewOnly: true });

  try {
    ground.move('h1', 'g3');
    await new Promise(resolve => setTimeout(resolve, 0));

    const landing = animations.calls.find(
      call => call.element.classList.contains('xiangqi-motion-stack') && call.keyframes.length === 6,
    );
    assert.ok(landing);
    assert.equal(landing.options.duration, 150);
    assert.deepEqual(
      landing.keyframes.map(frame => [frame.offset, frame.transform]),
      [
        [0, 'translate3d(0, -10%, 69.231px) rotateX(27deg)'],
        [0.2, 'translate3d(0, -7.5%, 60.000px) rotateX(23deg)'],
        [0.4, 'translate3d(0, -5%, 45.763px) rotateX(17deg)'],
        [0.6, 'translate3d(0, -2.8%, 29.730px) rotateX(10deg)'],
        [0.8, 'translate3d(0, -0.8%, 11.538px) rotateX(3deg)'],
        [1, 'translate3d(0, 0%, 0.000px) rotateX(0deg)'],
      ],
    );
    assert.equal(element.querySelector('piece.xiangqi-motion-piece'), null);
  } finally {
    ground.destroy();
    element.remove();
    animations.restore();
    window.HTMLElement.prototype.getBoundingClientRect = originalBounds;
  }
});

test('locks an optimistic move without restoring a stale FEN', () => {
  const configs: Parameters<Parameters<typeof setXiangqiGroundPending>[0]['set']>[0][] = [];
  setXiangqiGroundPending({ set: config => configs.push(config) });

  assert.equal(configs.length, 1);
  assert.equal(configs[0].fen, undefined);
  assert.equal(configs[0].movable?.color, undefined);
  assert.deepEqual(configs[0].movable?.dests, new Map());
});

test('reports a failed non-JSON upstream response without leaking a JSON parser error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('Internal server error', { status: 503 });
  try {
    await assert.rejects(
      requestXiangqi('/api/analysis/position', { moves: [] }),
      /Native Xiangqi request failed \(503\)/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('hydrates sound-relevant position state while preserving transition capture metadata', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      fen: 'hydrated b - - 1 1',
      ply: 1,
      turn: 'black',
      legalMoves: [],
      check: true,
      gameResult: '1-0',
      immediateEnd: { ended: true, result: 1 },
    });
  try {
    const hydrated = await hydrateXiangqiState({
      fen: 'hydrated b - - 1 1',
      ply: 1,
      turn: 'black',
      legalMoves: [],
      check: false,
      capture: true,
      gameResult: '*',
      needsHydration: true,
    });
    assert.equal(hydrated.capture, true);
    assert.equal(hydrated.check, true);
    assert.equal(hydrated.immediateEnd?.ended, true);
    assert.equal(hydrated.needsHydration, undefined);
    assert.deepEqual(xiangqiMoveSound(hydrated), {
      capture: true,
      check: true,
      mate: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('normalizes Pikafish coordinates and side-to-move scores for the red evaluation bar', () => {
  assert.equal(engineMoveToUi('h0g2'), 'h1g3');
  assert.equal(engineMoveToUi('a9a8'), 'a10a9');
  const line = parsePikafishInfo(
    'info depth 8 seldepth 11 multipv 1 score cp 24 nodes 1234 nps 50000 time 25 pv h0g2 h9g7',
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 1',
  );
  assert.equal(line?.score.redCp, -24);
  assert.deepEqual(line?.pvMoves, ['h1g3', 'h10g8']);
  assert.deepEqual(line?.wxfMoves, []);
});

test('retains the displayed evaluation until the new position receives an engine score', () => {
  const previous = { redCp: 87 };
  assert.equal(displayedEvaluation(undefined, previous), previous);
  assert.deepEqual(displayedEvaluation(undefined), NEUTRAL_EVALUATION);

  const incoming = { redCp: -32 };
  assert.equal(displayedEvaluation(incoming, previous), incoming);
  assert.equal(formatEvaluation({ redCp: -32 }), '−0.32');
  assert.equal(formatEvaluation({ redMate: 3 }), '+M3');
});

test('renders analysis moves through the shared tree view boundary', () => {
  const tree = createMoveTree(state('root w - - 0 1', 'red', 0));
  const move = addOrSelectChild(tree, '', {
    uci: 'a4a5',
    notation: 'P9+1',
    state: state('next b - - 1 1', 'black', 1),
  });
  const element = document.createElement('div');
  let navigated = '';
  const view = new AnalysisTreeView({
    element,
    tree: () => tree,
    activePath: () => '',
    setActivePath: () => undefined,
    notationLayout: () => 'compact',
    navigate: path => {
      navigated = path;
    },
    commit: () => undefined,
  });

  view.render();
  const button = element.querySelector<HTMLButtonElement>('button.xiangqi-analysis__move');
  assert.equal(button?.querySelector('.move-notation')?.textContent, 'P9+1');
  button?.click();
  assert.equal(navigated, move.path);
});

test('emits only completed browser MultiPV depths and stops old work before replacement', () => {
  const commands: string[] = [];
  const depths: number[] = [];
  const computing: boolean[] = [];
  const protocol = new PikafishProtocol(value => computing.push(value));
  protocol.connected(command => commands.push(command));
  protocol.received('id name Pikafish 2026-01-02');
  protocol.received('uciok');
  protocol.received('readyok');
  protocol.compute({
    fen: 'test w - - 0 1',
    depth: 20,
    multiPv: 2,
    threads: 2,
    hashSize: 64,
    stopRequested: false,
    emit: result => depths.push(result.depth),
  });
  protocol.received('info depth 5 multipv 1 score cp 12 nodes 100 nps 1000 time 10 pv h0g2');
  assert.deepEqual(depths, []);
  protocol.received('info depth 5 multipv 2 score cp 8 nodes 120 nps 1000 time 12 pv b0c2');
  assert.deepEqual(depths, [5]);
  assert.deepEqual(computing, [true]);
  protocol.received('bestmove h0g2');
  assert.deepEqual(computing, [true, false]);
  assert.ok(commands.includes('go depth 20'));
});

test('matches Lichess progress semantics for Pikafish depth, completion, and downloads', () => {
  assert.deepEqual(engineProgress(true, { state: 'computing' }, 5, 20), {
    computing: true,
    percent: 25,
    visible: true,
  });
  assert.equal(engineProgress(true, { state: 'ready' }, 5, 20).percent, 100);
  assert.equal(engineProgress(false, { state: 'ready' }, 0, 20).visible, false);
  assert.deepEqual(engineProgress(false, { state: 'downloading', bytes: 2, total: 5 }, 0, 20), {
    computing: false,
    percent: 40,
    visible: true,
  });
});

test('selects dock edges by pointer direction and rejects distant drops', () => {
  const board = { left: 100, top: 50, right: 550, bottom: 550, width: 450, height: 500 };
  assert.equal(gaugeDockAtPoint(325, 60, board), 'top');
  assert.equal(gaugeDockAtPoint(540, 300, board), 'right');
  assert.equal(gaugeDockAtPoint(325, 540, board), 'bottom');
  assert.equal(gaugeDockAtPoint(110, 300, board), 'left');
  assert.equal(gaugeDockAtPoint(900, 300, board), undefined);
  assert.equal(isGaugeDock('bottom'), true);
  assert.equal(isGaugeDock('center'), false);
});

test('normalizes persisted analysis settings at their storage boundary', () => {
  localStorage.setItem(
    ENGINE_SETTINGS_KEY,
    JSON.stringify({
      useCloud: false,
      showLinesPreview: false,
      depth: 99,
      multiPv: -2,
      threads: 3.6,
      hashSize: 70,
    }),
  );
  localStorage.setItem(
    INTERFACE_SETTINGS_KEY,
    JSON.stringify({ gaugeDock: 'middle', notationLayout: 'wide', coordinates: false }),
  );

  try {
    assert.deepEqual(loadEngineSettings(), {
      useCloud: false,
      showLinesPreview: false,
      depth: 30,
      multiPv: 1,
      threads: 4,
      hashSize: 64,
    });
    assert.equal(loadInterfaceSettings().gaugeDock, 'left');
    assert.equal(loadInterfaceSettings().notationLayout, 'two-column');
    assert.equal(loadInterfaceSettings().coordinates, false);
  } finally {
    localStorage.removeItem(ENGINE_SETTINGS_KEY);
    localStorage.removeItem(INTERFACE_SETTINGS_KEY);
  }
});

test('creates, selects, promotes, and deletes stable variation paths', () => {
  const root = state('root w - - 0 1', 'red', 0);
  const tree = createMoveTree(root);
  const redMain = addOrSelectChild(tree, '', {
    uci: 'a4a5',
    notation: 'P9+1',
    state: state('after-red b - - 1 1', 'black', 1),
  });
  const blackMain = addOrSelectChild(tree, redMain.path, {
    uci: 'a7a6',
    notation: 'P1+1',
    state: state('after-black w - - 2 2', 'red', 2),
  });
  const blackVariation = addOrSelectChild(tree, redMain.path, {
    uci: 'b10c8',
    notation: 'H2+3',
    state: state('after-horse w - - 2 2', 'red', 2),
  });

  assert.equal(mainlineEndPath(tree), blackMain.path);
  assert.deepEqual(movesToPath(tree, blackVariation.path), ['a4a5', 'b10c8']);
  assert.equal(pathIsMainline(tree, blackVariation.path), false);
  assert.equal(
    addOrSelectChild(tree, redMain.path, {
      uci: 'b10c8',
      notation: 'H2+3',
      state: state('ignored w - - 2 2', 'red', 2),
    }).path,
    blackVariation.path,
  );

  promote(tree, blackVariation.path, true);
  assert.equal(mainlineEndPath(tree), blackVariation.path);
  assert.equal(pathIsMainline(tree, blackVariation.path), true);
  assert.equal(deleteNode(tree, blackVariation.path), redMain.path);
  assert.equal(tree.byPath.has(blackVariation.path), false);
});

test('builds a database game locally without waiting for server-side notation import', () => {
  const initialFen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
  const tree = createMoveTreeFromUciMainline(initialFen, ['h1g3', 'h10g8', 'g3e2'], ['H2+3', 'H8+7', 'H3-5']);
  const nodes = [...tree.byPath.values()];

  assert.equal(nodes.length, 4);
  assert.equal(nodes[1].state.fen, 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C4NC1/9/RNBAKAB1R b - - 1 1');
  assert.equal(nodes[2].state.fen, 'rnbakab1r/9/1c4nc1/p1p1p1p1p/9/9/P1P1P1P1P/1C4NC1/9/RNBAKAB1R w - - 2 2');
  assert.equal(nodes[3].state.turn, 'black');
  assert.equal(nodes[3].state.needsHydration, true);
  assert.deepEqual(
    nodes.slice(1).map(node => (node as { notation?: string }).notation),
    ['H2+3', 'H8+7', 'H3-5'],
  );
});

test('keeps capture metadata and derives transition sounds from the destination position', () => {
  const ordinaryAdvance = {
    ...state('after-advance b - - 1 1', 'black', 1),
    notation: 'H2+3',
  };
  assert.deepEqual(xiangqiMoveSound(ordinaryAdvance), {
    capture: false,
    check: false,
    mate: false,
  });

  const captureFen = '4k4/9/9/9/4p4/9/9/9/p8/R3K4 w - - 0 1';
  const captureTree = createMoveTreeFromUciMainline(captureFen, ['a1a2']);
  const capture = captureTree.root.children[0];

  assert.equal(capture.state.capture, true);
  capture.state.check = true;
  assert.deepEqual(xiangqiTransitionSound(captureTree, '', capture.path), {
    capture: true,
    check: true,
    mate: false,
  });
  assert.deepEqual(xiangqiTransitionSound(captureTree, capture.path, ''), {
    capture: false,
    check: false,
    mate: false,
  });
  assert.equal(xiangqiTransitionSound(captureTree, capture.path, capture.path), undefined);
  assert.deepEqual(xiangqiMoveSound({ ...capture.state, checkmate: true }), {
    capture: true,
    check: true,
    mate: true,
  });
});

test('round-trips the canonical versioned move-tree document', () => {
  const initialFen = 'root w - - 0 1';
  const tree = createMoveTree(state(initialFen, 'red', 0));
  const child = addOrSelectChild(tree, '', {
    uci: 'a4a5',
    notation: 'P9+1',
    chineseNotation: '兵九进一',
    state: state('after b - - 1 1', 'black', 1),
  });
  tree.root.comments = [{ text: 'Manual introduction', source: 'Ancient manual' }];
  tree.root.children[0].comments = [
    { text: 'Preferred continuation', author: 'Manual author', language: 'zh' },
  ];
  const stored = serializeMoveTree(tree, initialFen, child.path);
  stored.nextId = 1;
  const restored = deserializeMoveTree(JSON.parse(JSON.stringify(stored)), initialFen);

  assert.equal(restored.activePath, child.path);
  assert.deepEqual(movesToPath(restored.tree, child.path), ['a4a5']);
  assert.equal(restored.tree.root.children[0].notation, 'P9+1');
  assert.equal(restored.tree.root.children[0].wxfNotation, 'P9+1');
  assert.equal(restored.tree.root.comments?.[0].text, 'Manual introduction');
  assert.equal(restored.tree.root.children[0].comments?.[0].author, 'Manual author');
  const restoredChinese = deserializeMoveTree(JSON.parse(JSON.stringify(stored)), initialFen, true);
  assert.equal(restoredChinese.tree.root.children[0].notation, '兵九进一');
  assert.equal(restoredChinese.tree.root.children[0].wxfNotation, 'P9+1');
  const sibling = addOrSelectChild(restored.tree, '', {
    uci: 'c4c5',
    notation: 'P7+1',
    state: state('other b - - 1 1', 'black', 1),
  });
  assert.notEqual(sibling.path, child.path);
});

test('round-trips independent analysis tabs without merging their move trees', () => {
  const firstTree = createMoveTree(state('first w - - 0 1', 'red', 0));
  const firstMove = addOrSelectChild(firstTree, '', {
    uci: 'a4a5',
    notation: 'P9+1',
    state: state('first-after b - - 1 1', 'black', 1),
  });
  const secondTree = createMoveTree(state('second w - - 0 1', 'red', 0));
  const tabs: AnalysisTab[] = [
    {
      id: 'tab-analysis',
      title: 'Analysis 1',
      kind: 'analysis',
      initialFen: 'first w - - 0 1',
      tree: firstTree,
      activePath: firstMove.path,
    },
    {
      id: 'tab-game',
      title: 'Red – Black',
      kind: 'game',
      gameId: '141802',
      initialFen: 'second w - - 0 1',
      tree: secondTree,
      activePath: '',
    },
  ];

  const restored = deserializeAnalysisTabs(
    JSON.parse(JSON.stringify(serializeAnalysisTabs(tabs, 'tab-game'))),
  );
  assert.equal(restored.activeId, 'tab-game');
  assert.equal(restored.tabs[1].gameId, '141802');
  assert.deepEqual(movesToPath(restored.tabs[0].tree, restored.tabs[0].activePath), ['a4a5']);
  assert.equal(restored.tabs[1].tree.root.children.length, 0);
});

test('normalizes inline analysis tab titles', () => {
  assert.equal(normalizeAnalysisTabTitle('  Opening ideas  '), 'Opening ideas');
  assert.equal(normalizeAnalysisTabTitle('   '), undefined);
  assert.equal(normalizeAnalysisTabTitle('a'.repeat(MAX_ANALYSIS_TAB_TITLE_LENGTH + 1)), undefined);
});

test('exports recursive WXF variations using PGN-style parentheses', () => {
  const initialFen = 'root w - - 0 1';
  const tree = createMoveTree(state(initialFen, 'red', 0));
  const red = addOrSelectChild(tree, '', {
    uci: 'a4a5',
    notation: 'P9+1',
    state: state('after-red b - - 1 1', 'black', 1),
  });
  addOrSelectChild(tree, red.path, {
    uci: 'a7a6',
    notation: 'P1+1',
    state: state('after-main w - - 2 2', 'red', 2),
  });
  addOrSelectChild(tree, red.path, {
    uci: 'b10c8',
    notation: 'H2+3',
    state: state('after-var w - - 2 2', 'red', 2),
  });

  assert.equal(renderXiangqiMovetext(tree), '1. P9+1 P1+1 (1... H2+3)');
  assert.match(renderXiangqiNotation(tree, initialFen), /\[Variant "Xiangqi"\]/);
  assert.match(renderXiangqiNotation(tree, initialFen), /P1\+1 \(1\.\.\. H2\+3\) \*$/);
});
