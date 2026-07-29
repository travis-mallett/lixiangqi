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
import { analysisGameUrl, countedSourceLabel, isCatalogSource, resultLabel } from '../src/gameCatalog.ts';
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

test('builds safe native analysis links for catalog games', () => {
  assert.equal(analysisGameUrl('dpxq:1122'), '/analysis?game=dpxq%3A1122');
  assert.equal(analysisGameUrl('source/id?x=1'), '/analysis?game=source%2Fid%3Fx%3D1');
  assert.equal(resultLabel(1), '1-0');
  assert.equal(resultLabel(0), '½-½');
  assert.equal(resultLabel(-1), '0-1');
  assert.equal(isCatalogSource('k'), true);
  assert.equal(isCatalogSource('x'), false);
});

test('formats database source quantities with thousands separators', () => {
  assert.equal(countedSourceLabel('Master Games', 141279), 'Master Games (141,279)');
  assert.equal(countedSourceLabel('DPXQ Online Games', 35455), 'DPXQ Online Games (35,455)');
  assert.equal(countedSourceLabel('Top Blitz Games', 1245), 'Top Blitz Games (1,245)');
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

test('keeps the destination underlay locked to the animated piece through redraws', () => {
  const originalBounds = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = () => ({
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

  const element = document.createElement('div');
  document.body.append(element);
  const ground = makeXiangqiGround(element, { viewOnly: true });
  const assertLocked = () => {
    const destination = element.querySelector<HTMLElement>('square.last-move-destination');
    const movedPiece = [...element.querySelectorAll<HTMLElement>('piece')].find(
      piece => (piece as HTMLElement & { cgKey?: string }).cgKey === 'g3',
    );
    assert.ok(destination);
    assert.ok(movedPiece);
    assert.equal(destination.style.transform, movedPiece.style.transform);
  };

  try {
    ground.move('h1', 'g3');
    assertLocked();

    const animation = ground.state.animation.current?.plan.anims.get('g3');
    assert.ok(animation);
    animation[2] = 0.4;
    animation[3] = -1.2;
    ground.state.dom.redrawNow();
    assertLocked();

    ground.redrawAll();
    assertLocked();
  } finally {
    ground.destroy();
    element.remove();
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
  const stored = serializeMoveTree(tree, initialFen, child.path);
  stored.nextId = 1;
  const restored = deserializeMoveTree(JSON.parse(JSON.stringify(stored)), initialFen);

  assert.equal(restored.activePath, child.path);
  assert.deepEqual(movesToPath(restored.tree, child.path), ['a4a5']);
  assert.equal(restored.tree.root.children[0].notation, 'P9+1');
  assert.equal(restored.tree.root.children[0].wxfNotation, 'P9+1');
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
