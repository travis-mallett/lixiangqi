import type { DrawShape } from 'chessgroundx/draw';
import type { Key } from 'chessgroundx/types';

import { randomId } from 'lib/algo';
import { PikafishBrowserEngine, type EngineAnalysis, type PikafishStatus } from 'lib/ceval';
import { selectXiangqiNotation, type XiangqiNotationStyle } from 'lib/game';
import { ShowResizeHandle } from 'lib/prefs';
import { storage } from 'lib/storage';
import stepwiseScroll from 'lib/view/stepwiseScroll';

import { bindAnalysisInterfaceControls } from './analysisInterfaceControls';
import {
  applyInterfaceSettingsClasses,
  ENGINE_SETTINGS_KEY,
  loadEngineSettings,
  loadInterfaceSettings,
  type EngineSettings,
} from './analysisSettings';
import { AnalysisSuggestions, MAX_PV_MOVES } from './analysisSuggestions';
import {
  ANALYSIS_TABS_STORAGE_KEY,
  deserializeAnalysisTabs,
  MAX_ANALYSIS_TABS,
  serializeAnalysisTabs,
  type AnalysisTab,
} from './analysisTabs';
import { AnalysisTabsView } from './analysisTabsView';
import { AnalysisTreeView } from './analysisTreeView';
import { hydrateXiangqiState, requestXiangqi } from './api';
import { engineProgress } from './engineProgress';
import ExplorerCtrl from './explorer/explorerCtrl';
import type { ExplorerGame } from './explorer/interfaces';
import { annotationSourceLabel } from './gameCatalog';
import {
  legalMoveDests,
  makeXiangqiGround,
  setXiangqiGroundPending,
  uciMoveToCg,
  XIANGQI_START_FEN,
} from './index';
import { renderXiangqiNotation } from './notation';
import { recommendedArrowShapes } from './recommendedArrows';
import { bindServerAnalysis } from './serverAnalysis';
import { playXiangqiMoveSound, playXiangqiTransitionSound } from './sound';
import {
  addOrSelectChild,
  analysisStorageKey,
  createMoveTree,
  createMoveTreeFromImport,
  createMoveTreeFromStates,
  currentLineEndPath,
  deserializeMoveTree,
  getNodeList,
  mainlineEndPath,
  nodeAtPath,
  parentPath,
  siblingPath,
  type ImportedMoveTree,
  type RulesState,
  type ServerAnalysisInfo,
  type XiangqiMoveTree,
  type XiangqiPositionNode,
  type XiangqiTreeNode,
} from './tree';

interface MoveResponse extends RulesState {
  notation: string;
  chineseNotation: string;
}

interface AnalysisBootstrap {
  gameId?: string;
  title?: string;
  initialFen?: string;
  moves?: string[];
  notations?: string[];
  chineseNotations?: string[];
  notationStyle?: XiangqiNotationStyle;
  language?: string;
  states?: RulesState[];
  orientation?: 'white' | 'black';
  analysisInProgress?: boolean;
  analysisRequestUrl?: string;
  analysis?: {
    id: string;
    infos: ServerAnalysisInfo[];
  };
  explorerEndpoint?: string;
}

const boardElement = requiredElement('#xiangqi-board');
const statusElement = requiredElement('#xiangqi-status');
const moveListElement = requiredElement('#xiangqi-moves');
const saveStatusElement = requiredElement('#xiangqi-save-status');
const fenInput = requiredElement<HTMLTextAreaElement>('#xiangqi-fen');
const notationInput = requiredElement<HTMLTextAreaElement>('#xiangqi-notation');
const firstButton = requiredElement<HTMLButtonElement>('#xiangqi-first');
const previousButton = requiredElement<HTMLButtonElement>('#xiangqi-previous');
const nextButton = requiredElement<HTMLButtonElement>('#xiangqi-next');
const lastButton = requiredElement<HTMLButtonElement>('#xiangqi-last');
const evalElement = requiredElement('#xiangqi-eval');
const engineEnabledElement = requiredElement<HTMLInputElement>('#xiangqi-engine-enabled');
const analyseLineButton = requiredElement<HTMLButtonElement>('#xiangqi-analyse-line');
const engineStatusElement = requiredElement('#xiangqi-engine-status');
const engineLinesElement = requiredElement('#xiangqi-engine-lines');
const engineElement = requiredElement('.xiangqi-engine');
const engineProgressBarElement = requiredElement('.xiangqi-engine > .bar');
const engineProgressElement = requiredElement('.xiangqi-engine > .bar > span');
const moreLinesButton = requiredElement<HTMLButtonElement>('#xiangqi-more-lines');
const engineSettingsButton = requiredElement<HTMLButtonElement>('#xiangqi-engine-settings-button');
const engineSettingsElement = requiredElement('#xiangqi-engine-settings');
const engineUseCloudInput = requiredElement<HTMLInputElement>('#xiangqi-engine-use-cloud');
const engineLinesPreviewInput = requiredElement<HTMLInputElement>('#xiangqi-engine-lines-preview');
const engineDepthInput = requiredElement<HTMLInputElement>('#xiangqi-engine-depth');
const engineMultiPvInput = requiredElement<HTMLInputElement>('#xiangqi-engine-multipv');
const engineThreadsInput = requiredElement<HTMLInputElement>('#xiangqi-engine-threads');
const engineHashInput = requiredElement<HTMLInputElement>('#xiangqi-engine-hash');
const databaseExplorerElement = requiredElement('#xiangqi-explorer');
const databaseExplorerButton = requiredElement<HTMLButtonElement>('#xiangqi-explorer-toggle');
const analysisTabsElement = requiredElement('#xiangqi-analysis-tabs');

const analysisPageElement = requiredElement('.xiangqi-analysis-page');

export default function init(bootstrap: AnalysisBootstrap = {}): void {
  void main(bootstrap).catch(error => {
    statusElement.textContent = error instanceof Error ? error.message : String(error);
    statusElement.classList.add('error');
  });
}

if (!('site' in window)) init();

async function main(bootstrap: AnalysisBootstrap): Promise<void> {
  const chineseNotation = bootstrap.notationStyle === 'chinese';
  const notationOf = (move: MoveResponse): string =>
    selectXiangqiNotation(move.notation, move.chineseNotation, bootstrap.notationStyle || 'english');
  const urlParams = new URLSearchParams(location.search);
  const urlFen = urlParams.get('fen')?.trim();
  const catalogGameId = urlParams.get('game')?.trim();
  const catalogDatabase = urlParams.get('database')?.trim();
  let initialFen = urlFen || bootstrap.initialFen || XIANGQI_START_FEN;
  const nativeStates =
    !urlFen && bootstrap.states?.length === (bootstrap.moves?.length ?? 0) + 1 ? bootstrap.states : undefined;
  const authoritativeRoot =
    nativeStates?.[0] ??
    (await requestXiangqi<RulesState>('/api/analysis/position', {
      initialFen,
      moves: [],
    }));
  initialFen = authoritativeRoot.fen;
  const suggestions = new AnalysisSuggestions(
    initialFen,
    () => ground?.state.orientation ?? bootstrap.orientation ?? 'white',
  );
  let tree: XiangqiMoveTree = nativeStates
    ? createMoveTreeFromStates(
        nativeStates,
        bootstrap.moves ?? [],
        bootstrap.notations ?? [],
        bootstrap.chineseNotations ?? [],
        chineseNotation,
        bootstrap.analysis?.infos,
      )
    : createMoveTree(authoritativeRoot);
  let activePath = nativeStates ? mainlineEndPath(tree) : '';
  let tabs: AnalysisTab[] = [
    {
      id: createTabId(),
      title: bootstrap.title || 'Analysis 1',
      kind: bootstrap.gameId ? 'game' : 'analysis',
      ...(bootstrap.gameId ? { gameId: bootstrap.gameId } : {}),
      initialFen,
      tree,
      activePath,
    },
  ];
  let activeTabId = tabs[0].id;
  const currentNode = (): XiangqiPositionNode => nodeAtPath(tree, activePath) ?? tree.root;
  const currentState = (): RulesState => currentNode().state;
  let pending = false;
  const tabsView = new AnalysisTabsView({
    element: analysisTabsElement,
    tabs: () => tabs,
    activeId: () => activeTabId,
    pending: () => pending,
    select: id => activateTab(id),
    close: closeAnalysisTab,
    add: () => void addAnalysisTab(),
    rename: (tab, title) => {
      tab.title = title;
      saveDraft();
      saveStatusElement.textContent = `Renamed tab to ${title}`;
    },
  });
  let toolsFen = '';
  let toolsGeneration = 0;
  let explorerController: AbortController | undefined;
  let lineController: AbortController | undefined;
  let browserEngineStatus: PikafishStatus = { state: 'loading' };
  let engineProgressDepth = 0;
  let previousEngineProgressPercent = 0;
  let engineSettings = loadEngineSettings();
  let interfaceSettings = loadInterfaceSettings();
  const liveNotation = new Map<string, Promise<MoveResponse>>();
  const liveNotationValues = new Map<string, MoveResponse>();
  const hydratingPositions = new WeakMap<XiangqiPositionNode, Promise<void>>();
  const maxThreads = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));
  engineSettings.threads = Math.min(engineSettings.threads, maxThreads);
  engineThreadsInput.max = String(maxThreads);
  applyEngineSettingsInputs(engineSettings);
  suggestions.setPreviewEnabled(engineSettings.showLinesPreview);
  applyInterfaceSettingsClasses(interfaceSettings, analysisPageElement, evalElement);
  const treeView = new AnalysisTreeView({
    element: moveListElement,
    tree: () => tree,
    activePath: () => activePath,
    setActivePath: path => {
      activePath = path;
    },
    notationLayout: () => interfaceSettings.notationLayout,
    navigate,
    commit: () => {
      saveDraft(true);
      update();
    },
  });

  bindServerAnalysis({
    bootstrap,
    tree: () => tree,
    currentNode,
    renderTree: () => treeView.render(),
    renderEvaluation: node => suggestions.setEvaluation(node.evaluation?.score),
    save: saveDraft,
  });

  const browserEngine = new PikafishBrowserEngine(status => {
    browserEngineStatus = status;
    renderEngineProgress();
    if (!engineEnabledElement.checked || lineController) return;
    if (status.state === 'downloading') {
      const progress = status.total ? ` ${Math.round((status.bytes / status.total) * 100)}%` : '';
      engineStatusElement.textContent = `Downloading Pikafish network${progress}…`;
    } else if (status.state === 'error') {
      engineStatusElement.textContent = status.error;
      engineStatusElement.classList.add('error');
    }
  });

  function renderEngineProgress(): void {
    const progress = engineProgress(
      engineEnabledElement.checked,
      browserEngineStatus,
      engineProgressDepth,
      engineSettings.depth,
    );
    engineElement.classList.toggle('computing', progress.computing);
    engineProgressBarElement.hidden = !progress.visible;

    if (!progress.visible) {
      engineProgressElement.style.width = '0%';
      previousEngineProgressPercent = 0;
      return;
    }

    engineProgressElement.style.width = `${progress.percent}%`;
    if (previousEngineProgressPercent > progress.percent) {
      engineProgressElement.remove();
      engineProgressBarElement.append(engineProgressElement);
    }
    previousEngineProgressPercent = progress.percent;
  }

  restoreWorkspace();

  const color = (turn: RulesState['turn']) => (turn === 'red' ? 'white' : 'black');

  function restoreWorkspace(): void {
    if (!urlFen && !bootstrap.gameId) {
      try {
        const storedTabs = localStorage.getItem(ANALYSIS_TABS_STORAGE_KEY);
        if (storedTabs) {
          const restored = deserializeAnalysisTabs(JSON.parse(storedTabs), chineseNotation);
          tabs = restored.tabs;
          activeTabId = restored.activeId;
          const active = tabs.find(tab => tab.id === activeTabId) ?? tabs[0];
          initialFen = active.initialFen;
          tree = active.tree;
          activePath = active.activePath;
          saveStatusElement.textContent = `Restored ${tabs.length} analysis tab${tabs.length === 1 ? '' : 's'}`;
          return;
        }
      } catch (error) {
        localStorage.removeItem(ANALYSIS_TABS_STORAGE_KEY);
        saveStatusElement.textContent =
          error instanceof Error ? error.message : 'Saved analysis tabs were invalid';
        saveStatusElement.classList.add('error');
      }
    }

    try {
      const stored = localStorage.getItem(analysisStorageKey(initialFen));
      if (stored) {
        const restored = deserializeMoveTree(JSON.parse(stored), initialFen, chineseNotation);
        restored.tree.root.state = authoritativeRoot;
        tree = restored.tree;
        activePath = restored.activePath;
        saveStatusElement.textContent = 'Restored local draft in Analysis 1';
      }
      Object.assign(tabs[0], { initialFen, tree, activePath });
    } catch (error) {
      localStorage.removeItem(analysisStorageKey(initialFen));
      saveStatusElement.textContent = error instanceof Error ? error.message : 'Saved draft was invalid';
      saveStatusElement.classList.add('error');
    }
  }

  function syncActiveTab(): void {
    const active = tabs.find(tab => tab.id === activeTabId);
    if (active) Object.assign(active, { initialFen, tree, activePath });
  }

  function saveDraft(announce = false): void {
    try {
      syncActiveTab();
      localStorage.setItem(
        ANALYSIS_TABS_STORAGE_KEY,
        JSON.stringify(serializeAnalysisTabs(tabs, activeTabId)),
      );
      saveStatusElement.classList.remove('error');
      if (announce) saveStatusElement.textContent = 'Draft saved locally';
    } catch (error) {
      saveStatusElement.textContent = error instanceof Error ? error.message : 'Could not save draft';
      saveStatusElement.classList.add('error');
    }
  }

  function navigate(path: string): void {
    if (!tree.byPath.has(path)) return;
    const navigationTree = tree;
    const fromPath = activePath;
    activePath = path;
    const destination = currentNode();
    treeView.closeMenu();
    saveDraft();
    update();
    const playSound = () => {
      if (tree === navigationTree && activePath === path)
        playXiangqiTransitionSound(navigationTree, fromPath, path);
    };
    if (destination.state.needsHydration) void hydratePosition(destination).then(playSound);
    else playSound();
  }

  function update(syncPosition = true): void {
    const node = currentNode();
    const state = node.state;
    const lastMove = node.path ? (node as XiangqiTreeNode).uci : undefined;
    if (syncPosition)
      ground.set({
        fen: state.fen,
        turnColor: color(state.turn),
        check: state.check,
        lastMove: lastMove ? uciMoveToCg(lastMove) : undefined,
        movable: {
          free: false,
          color: pending || state.gameResult !== '*' ? undefined : color(state.turn),
          dests: pending ? new Map() : legalMoveDests(state.legalMoves),
        },
      });

    const turn = state.turn === 'red' ? 'Red' : 'Black';
    statusElement.textContent =
      state.gameResult === '*'
        ? `${turn} to move${state.check ? ' — check' : ''}`
        : `Game over: ${state.gameResult}`;
    statusElement.classList.remove('error');
    fenInput.value = state.fen;
    boardElement.dataset.turn = state.turn;
    boardElement.dataset.legalMoves = String(state.legalMoves.length);
    boardElement.dataset.path = activePath;
    boardElement.dataset.ply = String(getNodeList(tree, activePath).length - 1);
    treeView.render();
    renderSuggestionArrows();

    const nextPath = node.children[0]?.path;
    const endPath = currentLineEndPath(tree, activePath);
    firstButton.disabled = previousButton.disabled = pending || activePath === '';
    nextButton.disabled = pending || nextPath === undefined;
    lastButton.disabled = pending || activePath === endPath;
    if (document.activeElement !== notationInput)
      notationInput.value = renderXiangqiNotation(tree, initialFen);
    suggestions.setEvaluation(node.evaluation?.score);
    if (!pending && !lineController && toolsFen !== state.fen) {
      toolsFen = state.fen;
      void refreshTools(state, node);
    }
    if (state.needsHydration) void hydratePosition(node);
  }

  function hydratePosition(node: XiangqiPositionNode): Promise<void> {
    if (!node.state.needsHydration) return Promise.resolve();
    const existing = hydratingPositions.get(node);
    if (existing) return existing;
    const fen = node.state.fen;
    const hydration = (async () => {
      try {
        const state = await hydrateXiangqiState(node.state);
        if (node.state.fen !== fen) return;
        node.state = state;
        saveDraft();
        if (node === currentNode()) update();
      } catch (error) {
        if (node === currentNode()) {
          saveStatusElement.textContent =
            error instanceof Error ? error.message : 'Could not load legal moves for this position';
          saveStatusElement.classList.add('error');
        }
      } finally {
        hydratingPositions.delete(node);
      }
    })();
    hydratingPositions.set(node, hydration);
    return hydration;
  }

  async function refreshTools(state: RulesState, node: XiangqiPositionNode): Promise<void> {
    const generation = ++toolsGeneration;
    browserEngine.stop();
    explorerController?.abort();
    explorerController = new AbortController();
    const position = { fen: state.fen };
    databaseExplorer.setPosition(position);
    suggestions.setPosition(state.fen, moves => void onMoves(moves));
    engineProgressDepth = node.evaluation?.depth ?? 0;
    renderEngineProgress();

    if (engineEnabledElement.checked && state.gameResult === '*') {
      engineStatusElement.textContent = liveEngineStatus(node);
      engineStatusElement.classList.remove('error');
      browserEngine.start({
        fen: state.fen,
        depth: engineSettings.depth,
        multiPv: engineSettings.multiPv,
        threads: engineSettings.threads,
        hashSize: engineSettings.hashSize,
        emit: (result, final) => {
          if (generation !== toolsGeneration) return;
          engineProgressDepth = result.depth;
          renderEngineProgress();
          applyKnownLiveNotation(result, state.fen);
          node.evaluation = summarizeEvaluation(result);
          suggestions.renderEngine(result, moves => void onMoves(moves));
          treeView.render({ scrollToActive: !isMobileAnalysisLayout() });
          void hydrateLiveNotation(result, state.fen, generation, node);
          if (final) saveDraft();
        },
      });
    } else {
      browserEngine.stop();
      engineProgressDepth = node.evaluation?.depth ?? 0;
      renderEngineProgress();
      engineStatusElement.textContent = engineEnabledElement.checked ? 'Game over' : 'Engine disabled';
      suggestions.setEvaluation(node.evaluation?.score);
    }
  }

  async function onMove(move: string): Promise<void> {
    await onMoves([move]);
  }

  async function onMoves(moves: string[]): Promise<void> {
    if (pending) return;
    pending = true;
    setXiangqiGroundPending(ground);
    update(false);
    let failure: unknown;
    let created = false;
    try {
      for (const move of moves) {
        const next = await requestXiangqi<MoveResponse>('/api/analysis/move', {
          initialFen: currentState().fen,
          moves: [],
          move,
        });
        playXiangqiMoveSound(next);
        const added = addOrSelectChild(tree, activePath, {
          uci: move,
          notation: notationOf(next) || move,
          wxfNotation: next.notation || move,
          chineseNotation: next.chineseNotation,
          state: next,
        });
        activePath = added.path;
        created ||= added.created;
      }
      saveDraft(created);
    } catch (error) {
      ground.set({ fen: currentState().fen });
      failure = error;
    } finally {
      pending = false;
      update();
      if (failure) showError(failure);
    }
  }

  async function loadFen(fen: string): Promise<void> {
    if (pending) return;
    pending = true;
    update();
    let failure: unknown;
    try {
      const state = await requestXiangqi<RulesState>('/api/analysis/position', {
        initialFen: fen,
        moves: [],
      });
      initialFen = state.fen;
      tree = createMoveTree(state);
      activePath = '';
      setFenUrl(initialFen);
      toolsFen = '';
      saveDraft(true);
    } catch (error) {
      failure = error;
    } finally {
      pending = false;
      update();
      if (failure) showError(failure);
    }
  }

  async function importNotation(): Promise<void> {
    if (pending) return;
    const notation = notationInput.value;
    pending = true;
    update();
    let failure: unknown;
    try {
      const imported = await requestXiangqi<ImportedMoveTree>('/api/analysis/import', {
        initialFen,
        notation,
      });
      initialFen = imported.initialFen;
      tree = createMoveTreeFromImport(imported, chineseNotation);
      activePath = mainlineEndPath(tree);
      setFenUrl(initialFen);
      toolsFen = '';
      saveDraft(true);
    } catch (error) {
      failure = error;
    } finally {
      pending = false;
      update();
      if (failure) showError(failure);
    }
  }

  function activateTab(tabId: string, announcement?: string): void {
    if (tabId === activeTabId || pending) return;
    const selected = tabs.find(tab => tab.id === tabId);
    if (!selected) return;
    syncActiveTab();
    browserEngine.stop();
    engineProgressDepth = 0;
    renderEngineProgress();
    explorerController?.abort();
    explorerController = undefined;
    lineController?.abort();
    lineController = undefined;
    analyseLineButton.textContent = 'Analyse line';
    toolsGeneration += 1;
    treeView.closeMenu();
    activeTabId = selected.id;
    initialFen = selected.initialFen;
    tree = selected.tree;
    activePath = selected.activePath;
    toolsFen = '';
    suggestions.clearResults();
    suggestions.resetEvaluation();
    setFenUrl(initialFen);
    tabsView.render();
    saveDraft();
    if (announcement) saveStatusElement.textContent = announcement;
    else
      saveStatusElement.textContent = selected.kind === 'game' ? `Viewing ${selected.title}` : selected.title;
    update();
  }

  async function addAnalysisTab(): Promise<void> {
    if (pending) return;
    if (tabs.length >= MAX_ANALYSIS_TABS) {
      showError(`Close an analysis tab before opening more than ${MAX_ANALYSIS_TABS}`);
      return;
    }
    pending = true;
    tabsView.render();
    update();
    let failure: unknown;
    try {
      const state = await requestXiangqi<RulesState>('/api/analysis/position', {
        initialFen: XIANGQI_START_FEN,
        moves: [],
      });
      syncActiveTab();
      const newTab: AnalysisTab = {
        id: createTabId(),
        title: nextAnalysisTitle(),
        kind: 'analysis',
        initialFen: state.fen,
        tree: createMoveTree(state),
        activePath: '',
      };
      tabs.push(newTab);
      pending = false;
      activateTab(newTab.id, `Created ${newTab.title}`);
    } catch (error) {
      failure = error;
    } finally {
      pending = false;
      tabsView.render();
      update();
      if (failure) showError(failure);
    }
  }

  function closeAnalysisTab(tabId: string): void {
    if (pending || tabs.length === 1) return;
    const index = tabs.findIndex(tab => tab.id === tabId);
    if (index < 0) return;
    syncActiveTab();
    const [closed] = tabs.splice(index, 1);
    if (tabId === activeTabId) {
      const next = tabs[Math.max(0, index - 1)];
      activeTabId = '';
      activateTab(next.id, `Closed ${closed.title}`);
    } else {
      tabsView.render();
      saveDraft();
      saveStatusElement.textContent = `Closed ${closed.title}`;
    }
  }

  function nextAnalysisTitle(): string {
    const used = new Set(
      tabs
        .map(tab => /^Analysis (\d+)$/.exec(tab.title)?.[1])
        .filter((value): value is string => value !== undefined)
        .map(Number),
    );
    let number = 1;
    while (used.has(number)) number += 1;
    return `Analysis ${number}`;
  }

  async function loadExplorerGame(game: ExplorerGame): Promise<boolean> {
    if (pending) return false;
    const existing = tabs.find(tab => tab.kind === 'game' && tab.gameId === game.id);
    if (existing) {
      activateTab(existing.id, `Viewing ${existing.title}`);
      return true;
    }
    if (tabs.length >= MAX_ANALYSIS_TABS) {
      showError(`Close an analysis tab before opening more than ${MAX_ANALYSIS_TABS}`);
      return false;
    }
    pending = true;
    tabsView.render();
    update();
    let failure: unknown;
    try {
      const gameInitialFen = game.initialFen || XIANGQI_START_FEN;
      const imported = await requestXiangqi<ImportedMoveTree>('/api/analysis/import', {
        initialFen: gameInitialFen,
        notation: game.notation?.trim() || game.moves.join(' '),
      });
      syncActiveTab();
      const importedTree = createMoveTreeFromImport(imported, chineseNotation);
      const mainline = getNodeList(importedTree, mainlineEndPath(importedTree));
      const nodeAtUciPath = (path: string): XiangqiPositionNode | undefined => {
        let node: XiangqiPositionNode = importedTree.root;
        for (const move of path.split(/\s+/).filter(Boolean)) {
          const child: XiangqiTreeNode | undefined = node.children.find(candidate => candidate.uci === move);
          if (!child) return undefined;
          node = child;
        }
        return node;
      };
      game.witnesses?.forEach(witness =>
        witness.annotations.forEach(layer =>
          layer.annotations.forEach(annotation => {
            if (!annotation.body) return;
            const target = annotation.path?.trim()
              ? nodeAtUciPath(annotation.path)
              : annotation.anchor === 'root' || annotation.anchor === 'record'
                ? importedTree.root
                : annotation.ply !== undefined
                  ? mainline[annotation.ply]
                  : undefined;
            if (!target) return;
            (target.comments ??= []).push({
              text: annotation.body,
              source: annotationSourceLabel(witness.collection, witness.collectionName),
              author: layer.annotator,
              language: layer.language,
            });
          }),
        ),
      );
      const title = `${game.red.name} – ${game.black.name}`;
      const gameTab: AnalysisTab = {
        id: createTabId(),
        title,
        kind: 'game',
        gameId: game.id,
        initialFen: gameInitialFen,
        tree: importedTree,
        activePath: mainlineEndPath(importedTree),
      };
      tabs.push(gameTab);
      const result = game.winner === 'red' ? '1-0' : game.winner === 'black' ? '0-1' : '½-½';
      pending = false;
      activateTab(gameTab.id, `Opened ${title}, ${result}`);
      return true;
    } catch (error) {
      failure = error;
      return false;
    } finally {
      pending = false;
      tabsView.render();
      update();
      if (failure) showError(failure);
    }
  }

  async function loadCatalogGame(gameId: string): Promise<void> {
    if (!gameId || gameId.length > 160) {
      showError('Invalid games database entry');
      return;
    }
    try {
      const game = await requestXiangqi<ExplorerGame>(
        `${(bootstrap.explorerEndpoint || '').replace(/\/$/, '')}/games/game`,
        {
          id: gameId,
          language: bootstrap.language || 'en',
          ...(catalogDatabase ? { database: catalogDatabase } : {}),
        },
      );
      if (await loadExplorerGame(game)) {
        const url = new URL(location.href);
        url.searchParams.delete('game');
        url.searchParams.delete('database');
        history.replaceState(null, '', url);
      }
    } catch (error) {
      showError(error);
    }
  }

  async function analyseCurrentLine(): Promise<void> {
    if (lineController) {
      lineController.abort();
      return;
    }
    lineController = new AbortController();
    browserEngine.stop();
    renderEngineProgress();
    const targetPath = currentLineEndPath(tree, activePath || mainlineEndPath(tree));
    const nodes = getNodeList(tree, targetPath);
    analyseLineButton.textContent = 'Cancel';
    suggestions.showPlaceholders(
      Math.max(engineLinesElement.childElementCount, suggestions.configuredRowCount()),
    );
    try {
      for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index];
        if (node.state.gameResult !== '*') continue;
        engineStatusElement.textContent = `Analysing selected line ${index + 1}/${nodes.length}…`;
        const result = await analyseWithBrowser(node.state.fen, lineController.signal, snapshot => {
          node.evaluation = summarizeEvaluation(snapshot);
          if (node.path === activePath) {
            suggestions.renderEngine(snapshot, moves => void onMoves(moves));
            suggestions.setEvaluation(snapshot.score);
          }
          treeView.render({ scrollToActive: !isMobileAnalysisLayout() });
        });
        node.evaluation = summarizeEvaluation(result);
        if (node.path === activePath) {
          suggestions.renderEngine(result, moves => void onMoves(moves));
          suggestions.setEvaluation(result.score);
        }
        treeView.render({ scrollToActive: !isMobileAnalysisLayout() });
        saveDraft();
      }
      saveStatusElement.textContent = `Saved evaluations for ${nodes.length} positions`;
    } catch (error) {
      if (!isAbort(error)) showError(error);
    } finally {
      lineController = undefined;
      analyseLineButton.textContent = 'Analyse line';
      toolsFen = '';
      update();
    }
  }

  function analyseWithBrowser(
    fen: string,
    signal: AbortSignal,
    onSnapshot: (analysis: EngineAnalysis) => void,
  ): Promise<EngineAnalysis> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        browserEngine.stop();
        reject(new DOMException('Analysis cancelled', 'AbortError'));
      };
      signal.addEventListener('abort', abort, { once: true });
      browserEngine.start({
        fen,
        depth: Math.min(engineSettings.depth, 18),
        multiPv: 1,
        threads: engineSettings.threads,
        hashSize: engineSettings.hashSize,
        emit: (analysis, final) => {
          if (signal.aborted) return;
          onSnapshot(analysis);
          if (final) {
            signal.removeEventListener('abort', abort);
            resolve(analysis);
          }
        },
      });
    });
  }

  function setFenUrl(fen: string): void {
    const url = new URL(location.href);
    if (fen === XIANGQI_START_FEN) url.searchParams.delete('fen');
    else url.searchParams.set('fen', fen);
    history.replaceState(null, '', url);
  }

  function showError(error: unknown): void {
    statusElement.textContent = error instanceof Error ? error.message : String(error);
    statusElement.classList.add('error');
  }

  const ground = makeXiangqiGround(boardElement, {
    fen: currentState().fen,
    orientation: bootstrap.orientation,
    turnColor: color(currentState().turn),
    movableColor: color(currentState().turn),
    legalMoves: currentState().legalMoves,
    coordinates: interfaceSettings.coordinates,
    resizeHandle: ShowResizeHandle.Always,
    ply: 0,
    onMove,
  });
  if (!('ontouchstart' in window) && storage.boolean('scrollMoves').getOrDefault(true))
    boardElement.addEventListener(
      'wheel',
      stepwiseScroll(
        event => {
          if (event.deltaY > 0) {
            const next = currentNode().children[0];
            if (next) navigate(next.path);
          } else if (event.deltaY < 0) navigate(parentPath(activePath));
        },
        () => pending,
      ),
      { passive: false },
    );
  const databaseExplorer = new ExplorerCtrl(
    databaseExplorerElement,
    databaseExplorerButton,
    move => void onMove(move),
    game => void loadExplorerGame(game),
    bootstrap.explorerEndpoint || '',
  );
  function renderSuggestionArrows(): void {
    const shapes: DrawShape[] = [];
    if (interfaceSettings.bestArrow) {
      const cloudMove = suggestions.explorerResult?.available
        ? suggestions.explorerResult.moves[0]?.move
        : undefined;
      const engineLine = suggestions.engineResult?.lines[0]?.pvMoves ?? [];
      const recommendedMoves = cloudMove
        ? engineLine[0] === cloudMove
          ? engineLine
          : [cloudMove]
        : engineLine;
      shapes.push(...recommendedArrowShapes(recommendedMoves, currentState().turn, ground.state.orientation));
    }
    const variationMoves: Array<{ move: string; brush: string }> = [];
    if (interfaceSettings.variationArrows) {
      currentNode()
        .children.slice(0, 5)
        .forEach(child => variationMoves.push({ move: child.uci, brush: 'paleGrey' }));
    }
    const seen = new Set<string>();
    ground.setAutoShapes(
      shapes.concat(
        variationMoves
          .filter(entry => !seen.has(entry.move) && seen.add(entry.move))
          .map(entry => {
            const [orig, dest] = uciMoveToCg(entry.move);
            return { orig: orig as Key, dest, brush: entry.brush };
          }),
      ),
    );
  }
  suggestions.setArrowRenderer(renderSuggestionArrows);
  renderSuggestionArrows();
  Object.assign(window, { lixiangqiGround: ground });
  Object.defineProperty(window, 'lixiangqiTree', { configurable: true, get: () => tree });
  setFenUrl(initialFen);
  tabsView.render();
  bindAnalysisInterfaceControls({
    page: analysisPageElement,
    eval: evalElement,
    ground,
    treeView,
    fenInput,
    saveStatus: saveStatusElement,
    settings: () => interfaceSettings,
    updateSettings: settings => {
      interfaceSettings = settings;
    },
    currentFen: () => currentState().fen,
    loadFen: fen => void loadFen(fen),
    renderArrows: renderSuggestionArrows,
  });

  firstButton.addEventListener('click', () => navigate(''));
  previousButton.addEventListener('click', () => navigate(parentPath(activePath)));
  nextButton.addEventListener('click', () => {
    const next = currentNode().children[0];
    if (next) navigate(next.path);
  });
  lastButton.addEventListener('click', () => navigate(currentLineEndPath(tree, activePath)));
  analyseLineButton.addEventListener('click', () => void analyseCurrentLine());
  engineEnabledElement.addEventListener('change', () => {
    toolsFen = '';
    update();
  });
  engineSettingsButton.addEventListener('click', () => {
    const open = engineSettingsElement.hidden;
    engineSettingsElement.hidden = !open;
    engineSettingsButton.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('pointerdown', event => {
    if (
      engineSettingsElement.hidden ||
      engineSettingsElement.contains(event.target as Node) ||
      engineSettingsButton.contains(event.target as Node)
    )
      return;
    engineSettingsElement.hidden = true;
    engineSettingsButton.setAttribute('aria-expanded', 'false');
  });
  const engineRangeInputs = [engineDepthInput, engineMultiPvInput, engineThreadsInput, engineHashInput];
  engineRangeInputs.forEach(input => {
    input.addEventListener('input', updateEngineSettingOutputs);
  });
  const engineInputs = [engineUseCloudInput, ...engineRangeInputs];
  engineInputs.forEach(input => {
    input.addEventListener('change', () => {
      engineSettings = engineSettingsFromInputs();
      localStorage.setItem(ENGINE_SETTINGS_KEY, JSON.stringify(engineSettings));
      toolsFen = '';
      update();
    });
  });
  engineLinesPreviewInput.addEventListener('change', () => {
    suggestions.setPreviewEnabled(engineLinesPreviewInput.checked);
    engineSettings = engineSettingsFromInputs();
    localStorage.setItem(ENGINE_SETTINGS_KEY, JSON.stringify(engineSettings));
  });
  moreLinesButton.addEventListener('click', () => {
    suggestions.toggleExpanded();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      browserEngine.stop();
      renderEngineProgress();
    } else {
      toolsFen = '';
      update();
    }
  });
  window.addEventListener(
    'pagehide',
    () => {
      saveDraft();
      browserEngine.destroy();
    },
    { once: true },
  );
  requiredElement('#xiangqi-reset').addEventListener('click', () => void loadFen(XIANGQI_START_FEN));
  requiredElement('#xiangqi-load-fen').addEventListener('click', () => void loadFen(fenInput.value.trim()));
  requiredElement('#xiangqi-copy-fen').addEventListener(
    'click',
    () => void navigator.clipboard.writeText(currentState().fen),
  );
  requiredElement('#xiangqi-import-notation').addEventListener('click', () => void importNotation());
  requiredElement('#xiangqi-copy-notation').addEventListener('click', () => {
    const notation = renderXiangqiNotation(tree, initialFen);
    notationInput.value = notation;
    void navigator.clipboard.writeText(notation);
  });
  requiredElement('#xiangqi-clear-draft').addEventListener('click', () => {
    localStorage.removeItem(analysisStorageKey(initialFen));
    tree = createMoveTree(tree.root.state);
    activePath = '';
    toolsFen = '';
    saveStatusElement.textContent = 'Saved draft cleared';
    saveDraft();
    update();
  });
  document.addEventListener('keydown', event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    let destination: string | undefined;
    if (event.shiftKey && event.key === 'ArrowLeft') destination = siblingPath(tree, activePath, -1);
    else if (event.shiftKey && event.key === 'ArrowRight') destination = siblingPath(tree, activePath, 1);
    else if (event.key === 'ArrowLeft') destination = parentPath(activePath);
    else if (event.key === 'ArrowRight') destination = currentNode().children[0]?.path;
    else if (event.key === 'Home') destination = '';
    else if (event.key === 'End') destination = currentLineEndPath(tree, activePath);
    if (destination === undefined || destination === activePath) return;
    event.preventDefault();
    navigate(destination);
  });
  if (new URLSearchParams(location.search).has('automation')) {
    const moveButton = document.createElement('button');
    moveButton.type = 'button';
    moveButton.dataset.testid = 'automation-h1g3';
    moveButton.textContent = 'Test H2+3';
    moveButton.addEventListener('click', () => {
      ground.selectSquare('h1');
      ground.selectSquare('g3');
    });
    document.body.append(moveButton);
  }
  update();
  if (catalogGameId) await loadCatalogGame(catalogGameId);

  function liveEngineStatus(node: XiangqiPositionNode): string {
    if (browserEngineStatus.state === 'downloading') {
      const progress = browserEngineStatus.total
        ? ` ${Math.round((browserEngineStatus.bytes / browserEngineStatus.total) * 100)}%`
        : '';
      return `Downloading Pikafish network${progress}…`;
    }
    if (browserEngineStatus.state === 'loading') return 'Starting browser Pikafish…';
    if (browserEngineStatus.state === 'error') return browserEngineStatus.error;
    return node.evaluation ? 'Refreshing cached Pikafish evaluation…' : 'Pikafish is calculating…';
  }

  function applyKnownLiveNotation(result: EngineAnalysis, fen: string): void {
    result.lines.forEach(line => {
      let moveFen = fen;
      line.wxfMoves = [];
      for (const move of line.pvMoves.slice(0, MAX_PV_MOVES)) {
        const response = liveNotationValues.get(`${moveFen}|${move}`);
        if (!response) break;
        line.wxfMoves.push(notationOf(response) || move);
        moveFen = response.fen;
      }
    });
  }

  async function hydrateLiveNotation(
    result: EngineAnalysis,
    fen: string,
    generation: number,
    node: XiangqiPositionNode,
  ): Promise<void> {
    await Promise.all(
      result.lines.map(async line => {
        let moveFen = fen;
        const notations: string[] = [];
        for (const move of line.pvMoves.slice(0, MAX_PV_MOVES)) {
          const key = `${moveFen}|${move}`;
          let response = liveNotationValues.get(key);
          if (!response) {
            let pendingNotation = liveNotation.get(key);
            if (!pendingNotation) {
              pendingNotation = requestXiangqi<MoveResponse>('/api/analysis/move', {
                initialFen: moveFen,
                moves: [],
                move,
              }).catch(error => {
                liveNotation.delete(key);
                throw error;
              });
              liveNotation.set(key, pendingNotation);
            }
            response = await pendingNotation;
            liveNotationValues.set(key, response);
          }
          notations.push(notationOf(response) || move);
          moveFen = response.fen;
        }
        line.wxfMoves = notations;
      }),
    ).catch(() => undefined);
    if (generation !== toolsGeneration || node.evaluation?.depth !== result.depth) return;
    suggestions.renderEngine(result, moves => void onMoves(moves));
  }
}

function applyEngineSettingsInputs(settings: EngineSettings): void {
  engineUseCloudInput.checked = settings.useCloud;
  engineLinesPreviewInput.checked = settings.showLinesPreview;
  engineDepthInput.value = String(settings.depth);
  engineMultiPvInput.value = String(settings.multiPv);
  engineThreadsInput.value = String(settings.threads);
  engineHashInput.value = String(settings.hashSize);
  updateEngineSettingOutputs();
}

function updateEngineSettingOutputs(): void {
  requiredElement('#xiangqi-engine-depth-value').textContent = engineDepthInput.value;
  requiredElement('#xiangqi-engine-multipv-value').textContent = `${engineMultiPvInput.value} / 5`;
  requiredElement('#xiangqi-engine-threads-value').textContent = engineThreadsInput.value;
  requiredElement('#xiangqi-engine-hash-value').textContent = `${engineHashInput.value} MB`;
}

function engineSettingsFromInputs(): EngineSettings {
  return {
    useCloud: engineUseCloudInput.checked,
    showLinesPreview: engineLinesPreviewInput.checked,
    depth: Number(engineDepthInput.value),
    multiPv: Number(engineMultiPvInput.value),
    threads: Number(engineThreadsInput.value),
    hashSize: Number(engineHashInput.value),
  };
}

function summarizeEvaluation(result: EngineAnalysis) {
  return { engine: result.engine, depth: result.depth, nodes: result.nodes, score: result.score };
}

function isMobileAnalysisLayout(): boolean {
  return window.matchMedia('(max-width: 799px)').matches;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function requiredElement<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing Xiangqi analysis element: ${selector}`);
  return element;
}

function createTabId(): string {
  return `tab-${randomId()}`;
}
