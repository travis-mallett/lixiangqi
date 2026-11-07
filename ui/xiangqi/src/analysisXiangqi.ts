import { ExplorerCtrl, type ExplorerGame } from '@lixiangqi/explorer';
import { embedCode } from '@lixiangqi/viewer';
import { init as initVdom, attributesModule, type VNode } from 'snabbdom';

import { randomId } from 'lib/algo';
import {
  makeBoardResizable,
  createXiangqiBoard,
  websiteBoardPresentation,
  xiangqiPosition,
  xiangqiPlay,
  type BoardPreferences,
} from 'lib/board';
import { PikafishBrowserEngine, type EngineAnalysis, type PikafishStatus } from 'lib/ceval';
import { engineProgress, engineLoadingText, enginePreparing } from 'lib/ceval/engineProgress';
import { type XiangqiNotationStyle } from 'lib/game';
import { formatMs } from 'lib/game/clock/clockWidget';
import { jieqiObservation, jieqiOutcomeSuffix, revealChoices, JIEQI_START_FEN } from 'lib/game/jieqi';
import { MANCHU_START_FEN } from 'lib/game/manchu';
import { MINI_XIANGQI_START_FEN } from 'lib/game/minixiangqi';
import { playMoveNavigationSound } from 'lib/game/replay/moveNavigationSound';
import { isRecordedClockTimeline, type RecordedClockTimeline } from 'lib/game/replay/recordedClockPlayback';
import { capturedPieces } from 'lib/game/view/captures';
import { chooseReveal } from 'lib/game/view/reveal';
import { requestXiangqi } from 'lib/game/xiangqiApi';
import { storage } from 'lib/storage';
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
  recordedPositions,
  type ImportedMoveTree,
  type RulesState,
  type ServerAnalysisInfo,
  type XiangqiMoveTree,
  type XiangqiPositionNode,
  type XiangqiTreeNode,
} from 'lib/tree/native';
import { updateProgressBar } from 'lib/view/progressBar';
import stepwiseScroll from 'lib/view/stepwiseScroll';

import { createArrowCadence } from './analysisArrowCadence';
import { analysisBoardArrows } from './analysisArrows';
import { AnalysisChart } from './analysisChart';
import { AnalysisCloud } from './analysisCloud';
import { showEmbedDialog } from './analysisDialogs';
import { analysisEngineConfig } from './analysisEngineConfig';
import {
  createAnalysisEngineView,
  createAnalysisGauge,
  createAnalysisSettings,
  createJieqiEngineSelection,
  bindEngineSettings,
  analysisSuggestionElements,
  updateAnalysisEngineIdentity,
} from './analysisEngineView';
import { readAnalysisUrl, replayPath } from './analysisHandoff';
import { bindAnalysisInterfaceControls } from './analysisInterfaceControls';
import { bindAnalysisKeyboard } from './analysisKeyboard';
import { syncAnalysisLayout } from './analysisLayout';
import {
  applyInterfaceSettingsClasses,
  engineSettingsKey,
  loadEngineSettings,
  loadInterfaceSettings,
  type EngineSettings,
} from './analysisSettings';
import { AnalysisSuggestions } from './analysisSuggestions';
import {
  ANALYSIS_TABS_STORAGE_KEY,
  deserializeAnalysisTabs,
  mergeAnalysisHandoff,
  MAX_ANALYSIS_TABS,
  restoreAnalysisWorkspace,
  serializeAnalysisTabs,
  type AnalysisTab,
  type AnalysisEditorState,
} from './analysisTabs';
import { AnalysisTabsView } from './analysisTabsView';
import { AnalysisTreeView } from './analysisTreeView';
import { analysisVariantPicker, bindAnalysisStartReset, useNativeReplay } from './analysisVariant';
import { annotationSourceLabel } from './gameCatalog';
import { XIANGQI_START_FEN } from './index';
import { renderXiangqiNotation } from './notation';
import { bindServerAnalysis } from './serverAnalysis';
import { playXiangqiMoveSound, playXiangqiTransitionSound } from './sound';

interface MoveResponse extends RulesState {
  notation: string;
  chineseNotation: string;
}

export interface AnalysisBootstrap extends BoardPreferences {
  gameId?: string;
  variant?: 'xiangqi' | 'jieqi' | 'minixiangqi' | 'manchu';
  ruleset?: string;
  title?: string;
  headers?: Record<string, string>;
  initialFen?: string;
  moves?: string[];
  notations?: string[];
  chineseNotations?: string[];
  notationStyle?: XiangqiNotationStyle;
  language?: string;
  states?: RulesState[];
  orientation?: 'red' | 'black';
  analysisInProgress?: boolean;
  analysisRequestUrl?: string;
  analysis?: {
    id: string;
    depth?: number;
    infos: ServerAnalysisInfo[];
  };
  recordedClock?: RecordedClockTimeline;
  explorerEndpoint?: string;
}

const engineMount = requiredElement('.xiangqi-engine');
const sharedEngine = createAnalysisEngineView();
const sharedSettings = createAnalysisSettings([
  { name: 'use-cloud', label: 'Use Cloud Database', type: 'checkbox', value: true },
  { name: 'lines-preview', label: 'Show engine lines preview', type: 'checkbox', value: true },
  { name: 'depth', label: 'Search depth', type: 'range', min: 10, max: 30, value: 20 },
  { name: 'arrow-updates', label: i18n.site.arrowUpdates, type: 'range', min: 1, max: 4, value: 4 },
  {
    name: 'multipv',
    label: i18n.site.multipleLines,
    type: 'range',
    min: 1,
    max: 5,
    value: 3,
    format: value => value + ' / 5',
  },
  { name: 'threads', label: i18n.site.threads, type: 'range', min: 1, max: 8, value: 2 },
  {
    name: 'hash',
    label: i18n.site.memory,
    type: 'range',
    min: 16,
    max: 256,
    step: 16,
    value: 64,
    format: value => value + ' MB',
  },
]);
sharedSettings.id = 'xiangqi-engine-settings';
for (const input of sharedSettings.querySelectorAll<HTMLInputElement>('input')) {
  input.id = 'xiangqi-engine-' + input.dataset.setting;
  const value = input.parentElement!.querySelector('.xiangqi-engine-settings__value');
  if (value) value.id = input.id + '-value';
}
const analyseLine = document.createElement('button');
analyseLine.id = 'xiangqi-analyse-line';
analyseLine.className = 'button button-empty';
analyseLine.type = 'button';
analyseLine.textContent = 'Analyse selected line';
sharedSettings.append(analyseLine);
sharedEngine.querySelector('.xiangqi-engine-settings')!.replaceWith(sharedSettings);
for (const [selector, id] of Object.entries({
  '.xiangqi-engine__switch input': 'xiangqi-engine-enabled',
  '.xiangqi-engine__headline-score': 'xiangqi-engine-score',
  '.xiangqi-analysis__substatus': 'xiangqi-engine-status',
  '.xiangqi-cloud-badge': 'xiangqi-cloud-badge',
  '.xiangqi-icon-button': 'xiangqi-engine-settings-button',
  '.xiangqi-engine__lines': 'xiangqi-engine-lines',
  '.xiangqi-engine__more': 'xiangqi-more-lines',
}))
  sharedEngine.querySelector(selector)!.id = id;
engineMount.replaceWith(sharedEngine);

const boardElement = requiredElement('#xiangqi-board');
const statusElement = requiredElement('#xiangqi-status');
const moveListElement = requiredElement('#xiangqi-moves');
const saveStatusElement = requiredElement('#xiangqi-save-status');
const fenInput = requiredElement<HTMLTextAreaElement>('#xiangqi-fen');
const notationInput = requiredElement<HTMLTextAreaElement>('#xiangqi-notation');
const fenError = requiredElement('#xiangqi-fen-error');
const notationError = requiredElement('#xiangqi-notation-error');
const firstButton = requiredElement<HTMLButtonElement>('#xiangqi-first');
const previousButton = requiredElement<HTMLButtonElement>('#xiangqi-previous');
const nextButton = requiredElement<HTMLButtonElement>('#xiangqi-next');
const lastButton = requiredElement<HTMLButtonElement>('#xiangqi-last');
const recordedClocksElement = requiredElement('#xiangqi-recorded-clocks');
const recordedRedClockElement = requiredElement('#xiangqi-recorded-clock-red');
const recordedBlackClockElement = requiredElement('#xiangqi-recorded-clock-black');
const evalElement = createAnalysisGauge();
evalElement.id = 'xiangqi-eval';
evalElement.querySelector('.xiangqi-eval__red')!.id = 'xiangqi-eval-fill';
evalElement.querySelector('.xiangqi-eval__score')!.id = 'xiangqi-eval-score';
requiredElement('#xiangqi-eval').replaceWith(evalElement);
const engineEnabledElement = requiredElement<HTMLInputElement>('#xiangqi-engine-enabled');
const analyseLineButton = requiredElement<HTMLButtonElement>('#xiangqi-analyse-line');
const engineStatusElement = requiredElement('#xiangqi-engine-status');
const engineElement = requiredElement('.xiangqi-engine');
const engineProgressBarElement = requiredElement('.xiangqi-engine > .bar');
const moreLinesButton = requiredElement<HTMLButtonElement>('#xiangqi-more-lines');
const engineSettingsButton = requiredElement<HTMLButtonElement>('#xiangqi-engine-settings-button');
const engineSettingsElement = requiredElement('#xiangqi-engine-settings');
const engineUseCloudInput = requiredElement<HTMLInputElement>('#xiangqi-engine-use-cloud');
const engineLinesPreviewInput = requiredElement<HTMLInputElement>('#xiangqi-engine-lines-preview');
const engineDepthInput = requiredElement<HTMLInputElement>('#xiangqi-engine-depth');
const engineArrowUpdatesInput = requiredElement<HTMLInputElement>('#xiangqi-engine-arrow-updates');
const engineMultiPvInput = requiredElement<HTMLInputElement>('#xiangqi-engine-multipv');
const engineThreadsInput = requiredElement<HTMLInputElement>('#xiangqi-engine-threads');
const engineHashInput = requiredElement<HTMLInputElement>('#xiangqi-engine-hash');
const databaseExplorerElement = requiredElement('#xiangqi-explorer');
const databaseExplorerButton = requiredElement<HTMLButtonElement>('#xiangqi-explorer-toggle');
const analysisTabsElement = requiredElement('#xiangqi-analysis-tabs');

const analysisPageElement = requiredElement('.xiangqi-analysis-page');
const analysisPanelElement = requiredElement('.xiangqi-analysis-panel');
const analysisBoardElement = requiredElement('.xiangqi-analysis-board');

export default function init(bootstrap: AnalysisBootstrap = {}): void {
  const mobileLayout = window.matchMedia('(max-width: 799px)');
  const layout = {
    page: analysisPageElement,
    engine: engineElement,
    panel: analysisPanelElement,
    board: analysisBoardElement,
  };
  syncAnalysisLayout(layout, mobileLayout.matches);
  mobileLayout.addEventListener('change', event => syncAnalysisLayout(layout, event.matches));
  void main(bootstrap).catch(error => {
    statusElement.textContent = error instanceof Error ? error.message : String(error);
    statusElement.classList.add('error');
  });
}

if (!('site' in window)) init();

async function main(bootstrap: AnalysisBootstrap): Promise<void> {
  const handoff = readAnalysisUrl(location.hash);
  const orientation = handoff?.orientation ?? bootstrap.orientation ?? 'red';

  const urlParams = new URLSearchParams(location.search);
  const urlFen = urlParams.get('fen')?.trim();
  const catalogGameId = urlParams.get('game')?.trim();
  const catalogDatabase = urlParams.get('database')?.trim();
  let initialFen = handoff?.initialFen || urlFen || bootstrap.initialFen || XIANGQI_START_FEN;
  const nativeStates = useNativeReplay(
    bootstrap.states,
    bootstrap.moves,
    !!handoff,
    !!urlFen,
    !!bootstrap.gameId,
  )
    ? bootstrap.states
    : undefined;
  const authoritativeRoot =
    handoff?.tree.root.state ??
    nativeStates?.[0] ??
    (await requestXiangqi<RulesState>('/api/analysis/position', {
      initialFen,
      moves: [],
    }));
  initialFen = authoritativeRoot.fen;
  let settingsVariant = analysisEngineConfig(authoritativeRoot.variant).variant;
  let engineSettings = loadEngineSettings(settingsVariant);
  const engineConfig = () => analysisEngineConfig(currentState().variant, engineSettings.jieqiEngine);
  const saveEngineSettings = () =>
    localStorage.setItem(
      engineSettingsKey(settingsVariant),
      JSON.stringify({ ...engineSettings, jieqiEngine: undefined }),
    );
  const suggestions = new AnalysisSuggestions(
    initialFen,
    () => (ground.getPresentation().perspective === 'red' ? 'red' : 'black'),
    () => Math.min(engineSettings.multiPv, engineConfig().maxMultiPv),
    analysisSuggestionElements(sharedEngine, evalElement),
    () => bootstrap.notationStyle ?? 'english',
  );
  let tree: XiangqiMoveTree =
    handoff?.tree ??
    (nativeStates
      ? createMoveTreeFromStates(
          nativeStates,
          bootstrap.moves ?? [],
          bootstrap.notations ?? [],
          bootstrap.chineseNotations ?? [],
          bootstrap.analysis?.infos,
          bootstrap.analysis?.depth ?? 0,
          bootstrap.ruleset,
        )
      : createMoveTree(authoritativeRoot, bootstrap.ruleset));
  let activePath = handoff?.activePath ?? (nativeStates ? replayPath(tree, location.hash) : '');
  if (nativeStates) tree.root.metadata = bootstrap.headers;
  let tabs: AnalysisTab[] = [
    {
      id: handoff?.id ?? createTabId(),
      title: bootstrap.title || 'Analysis 1',
      kind: bootstrap.gameId ? 'game' : 'analysis',
      ...(bootstrap.gameId ? { gameId: bootstrap.gameId } : {}),
      initialFen,
      tree,
      activePath,
    },
  ];
  let activeTabId = tabs[0].id;
  let editor: AnalysisEditorState = {};
  fenInput.addEventListener('input', () => {
    editor.fen = fenInput.value;
    delete editor.fenError;
    renderEditorErrors();
  });
  notationInput.addEventListener('input', () => {
    editor.notation = notationInput.value;
    delete editor.notationError;
    renderEditorErrors();
  });
  const recordedClock = isRecordedClockTimeline(bootstrap.recordedClock)
    ? bootstrap.recordedClock
    : undefined;
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
  const analysisCloud = new AnalysisCloud();
  let lineController: AbortController | undefined;
  let browserEngineStatus: PikafishStatus = { state: 'loading' };
  let engineProgressDepth = 0;
  const arrowCadence = createArrowCadence(engineSettings.depth, engineSettings.arrowUpdates);
  let arrowPositionFen = '';
  let interfaceSettings = loadInterfaceSettings();
  const maxThreads = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));
  engineSettings.threads = Math.min(engineSettings.threads, maxThreads);
  engineThreadsInput.max = String(maxThreads);
  applyEngineSettingsInputs(engineSettings);
  suggestions.setPreviewEnabled(engineSettings.showLinesPreview);
  applyInterfaceSettingsClasses(interfaceSettings, analysisPageElement, evalElement);
  const treeView = new AnalysisTreeView({
    notationStyle: () => bootstrap.notationStyle ?? 'english',
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

  const chart = new AnalysisChart(
    requiredElement('#xiangqi-analysis-chart'),
    requiredElement<HTMLCanvasElement>('#xiangqi-analysis-chart canvas'),
    navigate,
    showError,
  );
  const catalogGames = new WeakMap<XiangqiMoveTree, ExplorerGame>();
  const serverAnalysis = bindServerAnalysis({
    bootstrap,
    tree: () => tree,
    currentNode,
    renderTree: () => {
      treeView.render();
      chart.render(tree, activePath);
    },
    renderEvaluation: node =>
      suggestions.setEvaluation(
        node.evaluation ? { redCp: node.evaluation.cp, redMate: node.evaluation.mate } : undefined,
      ),
    save: saveDraft,
    catalogPositions: async (tree, id) => {
      let game = catalogGames.get(tree);
      if (!game) {
        game = await requestXiangqi<ExplorerGame>(
          `${(bootstrap.explorerEndpoint || '').replace(/\/$/, '')}/games/game`,
          { id, language: bootstrap.language || 'en' },
        );
        catalogGames.set(tree, game);
      }
      return recordedPositions(tree, game.initialFen || XIANGQI_START_FEN, game.moves);
    },
  });

  let browserEngine: PikafishBrowserEngine | undefined;
  let selectedJieqiEngine: EngineSettings['jieqiEngine'];
  let engineVariant: ReturnType<typeof analysisEngineConfig>['variant'] | undefined;
  function engineForState(): PikafishBrowserEngine {
    const variant = engineConfig().variant;
    if (browserEngine && engineVariant === variant && selectedJieqiEngine === engineSettings.jieqiEngine)
      return browserEngine;
    browserEngine?.destroy();
    engineVariant = variant;
    selectedJieqiEngine = engineSettings.jieqiEngine;
    browserEngine = new PikafishBrowserEngine(
      status => {
        browserEngineStatus = status;
        renderEngineProgress();
        if (!engineEnabledElement.checked || lineController || suggestions.explorerResult?.available) return;
        if (enginePreparing(status)) engineStatusElement.textContent = engineLoadingText(status);
        else if (status.state === 'error') {
          engineStatusElement.textContent = status.error;
          engineStatusElement.classList.add('error');
        }
      },
      undefined,
      variant,
      selectedJieqiEngine,
    );
    return browserEngine;
  }

  function renderEngineProgress(): void {
    if (suggestions.explorerResult?.available) {
      engineElement.classList.remove('computing');
      updateProgressBar(engineProgressBarElement, {
        percent: 100,
        active: false,
        visible: engineEnabledElement.checked,
        label: i18n.site.cloudAnalysis,
      });
      return;
    }
    const progress = engineProgress(
      engineEnabledElement.checked,
      browserEngineStatus,
      engineProgressDepth,
      engineSettings.depth,
    );
    engineElement.classList.toggle('computing', browserEngineStatus.state === 'computing');
    updateProgressBar(engineProgressBarElement, progress);
  }

  restoreWorkspace();

  function restoreWorkspace(): void {
    const incomingHandoff = handoff ? tabs[0] : undefined;
    // A native replay must never be replaced by a draft sharing its starting FEN.
    if (bootstrap.gameId) return;
    {
      try {
        const storedTabs = localStorage.getItem(ANALYSIS_TABS_STORAGE_KEY);
        if (storedTabs) {
          const restored = deserializeAnalysisTabs(JSON.parse(storedTabs));
          const workspace = restoreAnalysisWorkspace(
            restored.tabs,
            restored.activeId,
            initialFen,
            !!(urlFen || bootstrap.initialFen),
            incomingHandoff,
          );
          if (!workspace) return;
          tabs = workspace.tabs;
          activeTabId = workspace.activeId;
          const active = tabs.find(tab => tab.id === activeTabId) ?? tabs[0];
          initialFen = active.initialFen;
          tree = active.tree;
          activePath = active.activePath;
          if (incomingHandoff && !workspace.tabs.some(tab => tab.id === incomingHandoff.id)) {
            saveStatusElement.textContent = 'Close an analysis tab before opening this puzzle';
            saveStatusElement.classList.add('error');
            return;
          }
          saveStatusElement.textContent = `Restored ${tabs.length} analysis tab${tabs.length === 1 ? '' : 's'}`;
          return;
        }
      } catch (error) {
        const original = localStorage.getItem(ANALYSIS_TABS_STORAGE_KEY);
        if (original) localStorage.setItem(ANALYSIS_TABS_STORAGE_KEY + '.recovery.' + Date.now(), original);
        saveStatusElement.textContent =
          error instanceof Error ? error.message : 'Saved analysis tabs were invalid';
        saveStatusElement.classList.add('error');
      }
    }

    try {
      const stored = localStorage.getItem(analysisStorageKey(initialFen));
      if (stored) {
        const restored = deserializeMoveTree(JSON.parse(stored), initialFen);
        restored.tree.root.state = authoritativeRoot;
        if (incomingHandoff) {
          const legacyDraft: AnalysisTab = {
            id: createTabId(),
            title: 'Analysis 1',
            kind: 'analysis',
            initialFen,
            tree: restored.tree,
            activePath: restored.activePath,
          };
          const importedHandoff = { ...incomingHandoff, title: 'Analysis 2' };
          const merged = mergeAnalysisHandoff([], '', importedHandoff, legacyDraft);
          tabs = merged.tabs;
          activeTabId = merged.activeId;
        } else {
          tree = restored.tree;
          activePath = restored.activePath;
        }
        saveStatusElement.textContent = 'Restored local draft in Analysis 1';
      }
      if (incomingHandoff) {
        const active = tabs.find(tab => tab.id === activeTabId)!;
        initialFen = active.initialFen;
        tree = active.tree;
        activePath = active.activePath;
      } else Object.assign(tabs[0], { initialFen, tree, activePath });
    } catch (error) {
      const key = analysisStorageKey(initialFen);
      const original = localStorage.getItem(key);
      if (original) localStorage.setItem(key + '.recovery.' + Date.now(), original);
      saveStatusElement.textContent = error instanceof Error ? error.message : 'Saved draft was invalid';
      saveStatusElement.classList.add('error');
    }
  }

  function syncActiveTab(): void {
    const active = tabs.find(tab => tab.id === activeTabId);
    if (active) Object.assign(active, { initialFen, tree, activePath, editor });
  }

  function renderEditorErrors(): void {
    for (const [input, message, error] of [
      [fenInput, fenError, editor.fenError],
      [notationInput, notationError, editor.notationError],
    ] as const) {
      message.textContent = error ?? '';
      message.hidden = !error;
      input.setAttribute('aria-invalid', String(!!error));
    }
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
    if (!tree.pathExists(path)) return;
    const navigationTree = tree;
    const fromPath = activePath;
    const origin = currentNode();
    const backwards = getNodeList(tree, path).length < getNodeList(tree, fromPath).length;
    activePath = path;
    const destination = currentNode();
    treeView.closeMenu();
    saveDraft();
    update(true, backwards);
    const playSound = () => {
      if (tree === navigationTree && activePath === path)
        playMoveNavigationSound(origin.state.ply, destination.state.ply, () =>
          playXiangqiTransitionSound(ground, navigationTree, fromPath, path),
        );
    };
    playSound();
  }

  function update(syncPosition = true, slide = false): void {
    const node = currentNode();
    const state = node.state;
    variantSelect.value = state.variant ?? 'xiangqi';
    variantSelect.disabled = pending;
    renderCaptures(state);
    const lastMove = node.path ? node.uci : undefined;
    if (syncPosition) {
      const position = xiangqiPosition(state.fen, lastMove, state.check);
      if (ground.getDefinition().id !== position.board) {
        const presentation = ground.getPresentation();
        ground.destroy();
        ground = createXiangqiBoard(boardElement, position, presentation);
        makeBoardResizable(ground);
      }
      ground.display(position, {
        kind: slide ? 'backward' : 'forward',
      });
      ground.setInteraction(
        xiangqiPlay(
          ground,
          state.turn,
          state.legalMoves,
          onMove,
          bootstrap,
          !pending && state.gameResult === '*',
        ),
      );
    }

    const turn = state.turn === 'red' ? 'Red' : 'Black';
    statusElement.textContent =
      state.gameResult === '*'
        ? `${turn} to move${state.check ? ' — check' : ''}`
        : `Game over: ${state.gameResult}`;
    statusElement.classList.remove('error');
    fenInput.value = editor.fen ?? state.fen;
    requiredElement('#xiangqi-edit-position span').textContent = i18n.site.boardEditor;
    renderEditorErrors();
    boardElement.dataset.turn = state.turn;
    boardElement.dataset.legalMoves = String(state.legalMoves.length);
    boardElement.dataset.path = activePath;
    boardElement.dataset.ply = String(getNodeList(tree, activePath).length - 1);
    treeView.render();
    chart.render(tree, activePath);
    renderSuggestionArrows();

    const nextPath = node.children[0]?.path;
    const endPath = currentLineEndPath(tree, activePath);
    firstButton.disabled = previousButton.disabled = pending || activePath === '';
    nextButton.disabled = pending || nextPath === undefined;
    lastButton.disabled = pending || activePath === endPath;
    renderRecordedClocks();
    if (document.activeElement !== notationInput)
      notationInput.value = editor.notation ?? renderXiangqiNotation(tree, initialFen);
    suggestions.setEvaluation(
      node.evaluation ? { redCp: node.evaluation.cp, redMate: node.evaluation.mate } : undefined,
    );
    if (!pending && toolsFen !== state.fen) {
      toolsFen = state.fen;
      if (lineController) {
        arrowCadence.reset(engineConfig().arrowBudget(engineSettings, true), engineSettings.arrowUpdates);
        arrowPositionFen = state.fen;
        suggestions.setPosition(state.fen, tree.positionAt(node.path), moves => void onMoves(moves));
        suggestions.setEvaluation(
          node.evaluation ? { redCp: node.evaluation.cp, redMate: node.evaluation.mate } : undefined,
        );
      } else void refreshTools(state, node);
    }
  }

  async function refreshTools(state: RulesState, node: XiangqiPositionNode): Promise<void> {
    const generation = ++toolsGeneration;
    browserEngine?.stop();
    explorerController?.abort();
    explorerController = new AbortController();
    const position = { fen: state.fen, ...tree.positionAt(node.path) };
    const jieqi = state.variant === 'jieqi';
    databaseExplorerButton.hidden = state.variant !== 'xiangqi';
    databaseExplorerElement.hidden = databaseExplorerButton.hidden || !databaseExplorer.enabled;
    let config = engineConfig();
    if (settingsVariant !== config.variant) {
      settingsVariant = config.variant;
      engineSettings = loadEngineSettings(settingsVariant);
      engineSettings.threads = Math.min(engineSettings.threads, maxThreads);
      applyEngineSettingsInputs(engineSettings);
      config = engineConfig();
    }
    engineSelection.hidden = !jieqi;
    engineSelection.querySelector('select')!.value = engineSettings.jieqiEngine ?? 'abjchess';
    updateAnalysisEngineIdentity(sharedEngine, evalElement, config);
    suggestions.setPreviewEnabled(!jieqi && engineSettings.showLinesPreview);
    if (state.variant === 'xiangqi') databaseExplorer.setPosition(position);
    arrowCadence.reset(engineConfig().arrowBudget(engineSettings), engineSettings.arrowUpdates);
    arrowPositionFen = state.fen;
    suggestions.setPosition(state.fen, tree.positionAt(node.path), moves => void onMoves(moves));
    suggestions.setEvaluation(
      node.evaluation ? { redCp: node.evaluation.cp, redMate: node.evaluation.mate } : undefined,
    );
    engineProgressDepth = node.evaluation?.depth ?? 0;
    renderEngineProgress();

    if (engineEnabledElement.checked && state.gameResult === '*') {
      if (engineSettings.useCloud && state.variant === 'xiangqi') {
        engineStatusElement.textContent = i18n.site.cloudAnalysis;
        const cloud = await analysisCloud.get(position, explorerController.signal);
        if (generation !== toolsGeneration) return;
        if (cloud?.available) {
          suggestions.renderExplorer(cloud, moves => void onMoves(moves));
          renderEngineProgress();
          return;
        }
      }
      engineStatusElement.textContent = liveEngineStatus(node);
      engineStatusElement.classList.remove('error');
      engineForState().start({
        fen: state.fen,
        history: tree.positionAt(node.path),
        legalMoves: node.state.legalMoves,
        observation: jieqi ? jieqiObservation(state) : undefined,
        search: config.search(engineSettings),
        multiPv: engineSettings.multiPv,
        threads: engineConfig().threads(engineSettings),
        hashSize: engineSettings.hashSize,
        emit: (result, final) => {
          if (generation !== toolsGeneration) return;
          engineProgressDepth = result.depth;
          renderEngineProgress();
          arrowCadence.accept(result, final);
          rememberEvaluation(node, result);
          suggestions.renderEngine(result, moves => void onMoves(moves), final);
          treeView.render({ scrollToActive: !isMobileAnalysisLayout() });
          chart.render(tree, activePath);
          if (final) saveDraft();
        },
      });
    } else {
      browserEngine?.stop();
      engineProgressDepth = node.evaluation?.depth ?? 0;
      renderEngineProgress();
      engineStatusElement.textContent = engineEnabledElement.checked ? 'Game over' : 'Engine disabled';
      suggestions.setEvaluation(
        node.evaluation ? { redCp: node.evaluation.cp, redMate: node.evaluation.mate } : undefined,
      );
    }
  }

  async function onMove(move: string): Promise<void> {
    await onMoves([move]);
  }

  async function onMoves(moves: string[]): Promise<void> {
    if (pending) return;
    pending = true;
    ground.setInteraction({ mode: 'display' });
    update(false);
    let failure: unknown;
    let created = false;
    try {
      for (const move of moves) {
        const choices = currentState().variant === 'jieqi' ? revealChoices(currentState(), move) : [];
        const reveal = choices.length ? await chooseReveal(choices, currentState().turn) : undefined;
        if (choices.length && !reveal) break;
        const captureChoices =
          currentState().variant === 'jieqi' ? revealChoices(currentState(), move, true) : [];
        const captureReveal = captureChoices.length
          ? await chooseReveal(captureChoices, currentState().turn === 'red' ? 'black' : 'red')
          : undefined;
        if (captureChoices.length && !captureReveal) break;
        const next = await requestXiangqi<MoveResponse>('/api/analysis/move', {
          ...tree.positionAt(activePath),
          move,
          reveal,
          captureReveal,
        });
        playXiangqiMoveSound(ground, next);
        const added = addOrSelectChild(tree, activePath, {
          uci: move,
          notation: next.notation,
          chineseNotation: next.chineseNotation,
          state: next,
        });
        activePath = added.path;
        created ||= added.created;
      }
      saveDraft(created);
    } catch (error) {
      ground.display(xiangqiPosition(currentState().fen), { kind: 'correction' });
      failure = error;
    } finally {
      pending = false;
      update();
      if (failure) showError(failure);
    }
  }

  async function loadFen(fen: string): Promise<void> {
    if (pending) return;
    delete editor.fenError;
    pending = true;
    update();
    let failure: unknown;
    try {
      const state = await requestXiangqi<RulesState>('/api/analysis/position', {
        initialFen: fen,
        moves: [],
      });
      delete editor.fen;
      initialFen = state.fen;
      tree = createMoveTree(state);
      activePath = '';
      setFenUrl(initialFen);
      toolsFen = '';
      saveDraft(true);
    } catch (error) {
      editor.fenError = error instanceof Error ? error.message : String(error);
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
    delete editor.notationError;
    pending = true;
    update();
    let failure: unknown;
    try {
      const imported = await requestXiangqi<ImportedMoveTree>('/api/analysis/import', {
        initialFen,
        notation,
      });
      delete editor.notation;
      initialFen = imported.initialFen;
      tree = createMoveTreeFromImport(imported);
      activePath = mainlineEndPath(tree);
      setFenUrl(initialFen);
      toolsFen = '';
      saveDraft(true);
    } catch (error) {
      editor.notationError = error instanceof Error ? error.message : String(error);
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
    browserEngine?.stop();
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
    editor = selected.editor ?? {};
    notationInput.value = editor.notation ?? renderXiangqiNotation(tree, initialFen);
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
    refreshServerAnalysis();
  }

  async function addAnalysisTab(variant = 'xiangqi'): Promise<void> {
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
        initialFen:
          variant === 'jieqi'
            ? JIEQI_START_FEN
            : variant === 'minixiangqi'
              ? MINI_XIANGQI_START_FEN
              : variant === 'manchu'
                ? MANCHU_START_FEN
                : XIANGQI_START_FEN,
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
      const importedTree = createMoveTreeFromImport(imported);
      catalogGames.set(importedTree, game);
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
              id: randomId(),
              by: layer.annotator ? { kind: 'external', name: layer.annotator } : { kind: 'unknown' },
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
    toolsGeneration++;
    explorerController?.abort();
    suggestions.clearResults();
    browserEngine?.stop();
    renderEngineProgress();
    const targetPath = currentLineEndPath(tree, activePath || mainlineEndPath(tree));
    const nodes = getNodeList(tree, targetPath);
    analyseLineButton.textContent = 'Cancel';
    suggestions.showPlaceholders();
    try {
      for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index];
        if (node.state.gameResult !== '*') continue;
        arrowCadence.reset(engineConfig().arrowBudget(engineSettings, true), engineSettings.arrowUpdates);
        arrowPositionFen = node.state.fen;
        renderSuggestionArrows();
        engineStatusElement.textContent = `Analysing selected line ${index + 1}/${nodes.length}…`;
        const result = await analyseWithBrowser(node, lineController.signal, (snapshot, final) => {
          engineProgressDepth = snapshot.depth;
          renderEngineProgress();
          if (node.path === activePath) arrowCadence.accept(snapshot, final);
          rememberEvaluation(node, snapshot);
          if (node.path === activePath) {
            suggestions.renderEngine(snapshot, moves => void onMoves(moves), final);
            suggestions.setEvaluation(snapshot.score);
          }
          treeView.render({ scrollToActive: !isMobileAnalysisLayout() });
          chart.render(tree, activePath);
        });
        rememberEvaluation(node, result);
        if (node.path === activePath) {
          suggestions.renderEngine(result, moves => void onMoves(moves), true);
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
    node: XiangqiPositionNode,
    signal: AbortSignal,
    onSnapshot: (analysis: EngineAnalysis, final: boolean) => void,
  ): Promise<EngineAnalysis> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        browserEngine?.stop();
        reject(new DOMException('Analysis cancelled', 'AbortError'));
      };
      signal.addEventListener('abort', abort, { once: true });
      engineForState().start({
        fen: node.fen,
        history: tree.positionAt(node.path),
        legalMoves: node.state.legalMoves,
        observation: node.state.variant === 'jieqi' ? jieqiObservation(node.state) : undefined,
        search: analysisEngineConfig(node.state.variant).search(engineSettings, true),
        multiPv: 1,
        threads: engineConfig().threads(engineSettings),
        hashSize: engineSettings.hashSize,
        emit: (analysis, final) => {
          if (signal.aborted) return;
          onSnapshot(analysis, final);
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
    if (handoff) url.hash = '';
    if (fen === XIANGQI_START_FEN) url.searchParams.delete('fen');
    else url.searchParams.set('fen', fen);
    history.replaceState(null, '', url);
  }

  function showError(error: unknown): void {
    statusElement.textContent = error instanceof Error ? error.message : String(error);
    statusElement.classList.add('error');
  }

  let ground = createXiangqiBoard(boardElement, xiangqiPosition(currentState().fen), {
    ...websiteBoardPresentation(bootstrap, 'interactive', orientation === 'red' ? 'red' : 'black'),
    coordinates: interfaceSettings.coordinates,
  });
  const variantSelect = analysisVariantPicker(bootstrap.variant ?? 'xiangqi', variant => {
    if (variant === 'threeKingdoms') location.href = '/analysis/threeKingdoms';
    else void addAnalysisTab(variant);
  });
  const patchCaptures = initVdom([attributesModule]);
  const topCaptures = document.createElement('div');
  const bottomCaptures = document.createElement('div');
  const boardFrame = boardElement.closest('.main-board')!;
  boardFrame.before(topCaptures);
  boardFrame.after(bottomCaptures);
  let captureNodes: [HTMLElement | VNode, HTMLElement | VNode] = [topCaptures, bottomCaptures];
  function renderCaptures(state: RulesState): void {
    const bottom = ground.getPresentation().perspective === 'red' ? 'red' : 'black';
    const ledger = state.variant === 'jieqi' ? (state.captures ?? []) : [];
    captureNodes = [
      patchCaptures(captureNodes[0], capturedPieces(ledger, bottom, state.ply)),
      patchCaptures(captureNodes[1], capturedPieces(ledger, bottom === 'red' ? 'black' : 'red', state.ply)),
    ];
    for (const node of captureNodes) ((node as VNode).elm as HTMLElement).hidden = state.variant !== 'jieqi';
  }
  makeBoardResizable(ground);
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
    { initiallyEnabled: true },
  );
  function renderSuggestionArrows(): void {
    const engineLines: string[][] = [];
    if (interfaceSettings.bestArrow) {
      const cloudLines =
        arrowPositionFen === currentState().fen && suggestions.explorerResult?.available
          ? suggestions.explorerResult.moves.slice(0, engineSettings.multiPv).map(move => move.pvMoves)
          : undefined;
      const publishedLines =
        arrowPositionFen === currentState().fen
          ? (arrowCadence.published?.lines ?? []).map(line => line.pvMoves)
          : [];
      const recommendedLines = cloudLines ?? publishedLines;
      engineLines.push(...recommendedLines);
    }
    ground.setMarks(
      analysisBoardArrows({
        engineLines,
        turn: currentState().turn,
        orientation: ground.getPresentation().perspective === 'red' ? 'red' : 'black',
        children: interfaceSettings.variationArrows
          ? currentNode().children.flatMap(child => (child.uci ? [child.uci] : []))
          : [],
      }),
      'annotation',
    );
  }
  suggestions.setArrowRenderer(renderSuggestionArrows);
  renderSuggestionArrows();
  Object.defineProperty(window, 'lixiangqiGround', { configurable: true, get: () => ground });
  Object.defineProperty(window, 'lixiangqiTree', { configurable: true, get: () => tree });
  setFenUrl(initialFen);
  tabsView.render();
  bindAnalysisInterfaceControls({
    page: analysisPageElement,
    eval: evalElement,
    get ground() {
      return ground;
    },
    treeView,
    fenInput,
    saveStatus: saveStatusElement,
    settings: () => interfaceSettings,
    updateSettings: settings => {
      interfaceSettings = settings;
    },
    currentFen: () => currentState().fen,
    edit: () => {
      const state = currentState();
      location.href = `/editor?${new URLSearchParams({
        fen: state.fen,
        variant: state.variant ?? 'xiangqi',
        color: ground.getPresentation().perspective,
      })}`;
    },
    loadFen: fen => void loadFen(fen),
    renderBoardOverlays: () => {
      renderSuggestionArrows();
      renderCaptures(currentState());
    },
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
  window.matchMedia('(max-width: 799px)').addEventListener('change', () => {
    toolsFen = '';
    applyEngineSettingsInputs(engineSettings);
    treeView.render();
    update();
  });
  bindEngineSettings(engineSettingsButton, engineSettingsElement);
  const engineSelection = createJieqiEngineSelection(id => {
    lineController?.abort();
    engineSettings.jieqiEngine = id;
    saveEngineSettings();
    browserEngine?.destroy();
    browserEngine = undefined;
    toolsGeneration++;
    toolsFen = '';
    update();
  });
  engineSelection.hidden = settingsVariant !== 'jieqi';
  engineSelection.querySelector('select')!.value = engineSettings.jieqiEngine ?? 'abjchess';
  engineSettingsElement.prepend(engineSelection);
  const engineRangeInputs = [engineDepthInput, engineMultiPvInput, engineThreadsInput, engineHashInput];
  engineRangeInputs.forEach(input => {
    input.addEventListener('input', updateEngineSettingOutputs);
  });
  const engineInputs = [engineUseCloudInput, engineDepthInput, engineThreadsInput, engineHashInput];
  engineInputs.forEach(input => {
    input.addEventListener('change', () => {
      engineSettings = engineSettingsFromInputs(engineSettings);
      saveEngineSettings();
      toolsFen = '';
      update();
    });
  });
  engineMultiPvInput.addEventListener('change', () => {
    engineSettings = engineSettingsFromInputs(engineSettings, true);
    saveEngineSettings();
    toolsFen = '';
    update();
  });
  engineArrowUpdatesInput.addEventListener('input', updateEngineSettingOutputs);
  engineArrowUpdatesInput.addEventListener('change', () => {
    engineSettings.arrowUpdates = Number(engineArrowUpdatesInput.value);
    arrowCadence.configure(
      engineConfig().arrowBudget(engineSettings, !!lineController),
      engineSettings.arrowUpdates,
    );
    saveEngineSettings();
  });
  engineLinesPreviewInput.addEventListener('change', () => {
    suggestions.setPreviewEnabled(engineLinesPreviewInput.checked);
    engineSettings = engineSettingsFromInputs(engineSettings);
    saveEngineSettings();
  });
  moreLinesButton.addEventListener('click', () => {
    suggestions.toggleExpanded();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      browserEngine?.stop();
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
      browserEngine?.destroy();
      databaseExplorer.destroy();
      ground.destroy();
    },
    { once: true },
  );
  bindAnalysisStartReset(requiredElement('#xiangqi-reset'), () => currentState().variant, loadFen);
  requiredElement('#xiangqi-load-fen').addEventListener('click', () => void loadFen(fenInput.value.trim()));
  requiredElement('#xiangqi-copy-fen').addEventListener(
    'click',
    () => void navigator.clipboard.writeText(currentState().fen),
  );
  requiredElement('#xiangqi-import-notation').addEventListener('click', () => void importNotation());
  const embedButton = document.createElement('button');
  embedButton.type = 'button';
  embedButton.textContent = i18n.site.embedGame;
  requiredElement('#xiangqi-copy-notation').after(embedButton);
  embedButton.addEventListener('click', () => {
    const code = embedCode({ pgn: renderXiangqiNotation(tree, initialFen) });
    showEmbedDialog(code);
    void navigator.clipboard.writeText(code).catch(() => {});
  });
  requiredElement('#xiangqi-copy-notation').addEventListener('click', () => {
    const notation = renderXiangqiNotation(tree, initialFen);
    delete editor.notation;
    delete editor.notationError;
    renderEditorErrors();
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
  bindAnalysisKeyboard(
    () => tree,
    () => activePath,
    navigate,
  );
  if (new URLSearchParams(location.search).has('automation')) {
    const moveButton = document.createElement('button');
    moveButton.type = 'button';
    moveButton.dataset.testid = 'automation-h1g3';
    moveButton.textContent = 'Test H2+3';
    moveButton.addEventListener('click', () => {
      ground.select('h1');
      ground.select('g3');
    });
    document.body.append(moveButton);
  }
  update();
  if (catalogGameId) await loadCatalogGame(catalogGameId);
  refreshServerAnalysis();

  function refreshServerAnalysis(): void {
    if (currentState().variant !== 'xiangqi') return;
    serverAnalysis.refresh();
    const selected = tabs.find(tab => tab.id === activeTabId);
    if (selected?.kind === 'game' && selected.gameId && selected.gameId !== bootstrap.gameId)
      void serverAnalysis.loadCatalog(selected.tree, selected.gameId).catch(showError);
  }

  function recordedPositionAtPath(path: string): number | undefined {
    if (!bootstrap.gameId || tabs.find(tab => tab.id === activeTabId)?.gameId !== bootstrap.gameId) return;
    const nodes = getNodeList(tree, path).slice(1);
    if (nodes.length > (bootstrap.moves?.length ?? 0)) return;
    return nodes.every((node, index) => {
      const recorded = bootstrap.states?.[index + 1];
      return (
        node.uci === bootstrap.moves?.[index] &&
        !!recorded &&
        jieqiOutcomeSuffix(node.state) === jieqiOutcomeSuffix(recorded)
      );
    })
      ? nodes.length
      : undefined;
  }

  function renderRecordedClocks(): void {
    const position = recordedPositionAtPath(activePath);
    const clockPosition = position === undefined ? undefined : recordedClock?.positions[position];
    if (!clockPosition) {
      recordedClocksElement.hidden = true;
      return;
    }
    recordedClocksElement.hidden = false;
    renderRecordedClock(clockPosition);
  }

  function renderRecordedClock(position: { white: number; black: number }): void {
    recordedRedClockElement.textContent = formatMs(position.white * 10);
    recordedBlackClockElement.textContent = formatMs(position.black * 10);
  }

  function liveEngineStatus(node: XiangqiPositionNode): string {
    if (enginePreparing(browserEngineStatus)) return engineLoadingText(browserEngineStatus);
    if (browserEngineStatus.state === 'error') return browserEngineStatus.error;
    return node.evaluation
      ? i18n.site.engineRefreshing(engineConfig().name)
      : i18n.site.engineCalculating(engineConfig().name);
  }
}

function applyEngineSettingsInputs(settings: EngineSettings): void {
  engineUseCloudInput.checked = settings.useCloud;
  engineLinesPreviewInput.checked = settings.showLinesPreview;
  engineDepthInput.value = String(settings.depth);
  engineArrowUpdatesInput.value = String(settings.arrowUpdates);
  engineMultiPvInput.value = String(settings.multiPv);
  engineThreadsInput.value = String(settings.threads);
  engineHashInput.value = String(settings.hashSize);
  updateEngineSettingOutputs();
}

function updateEngineSettingOutputs(): void {
  requiredElement('#xiangqi-engine-depth-value').textContent = engineDepthInput.value;
  requiredElement('#xiangqi-engine-arrow-updates-value').textContent = engineArrowUpdatesInput.value;
  requiredElement('#xiangqi-engine-multipv-value').textContent = `${engineMultiPvInput.value} / 5`;
  requiredElement('#xiangqi-engine-threads-value').textContent = engineThreadsInput.value;
  requiredElement('#xiangqi-engine-hash-value').textContent = `${engineHashInput.value} MB`;
}

function engineSettingsFromInputs(previous: EngineSettings, includeMultiPv = false): EngineSettings {
  return {
    jieqiEngine: previous.jieqiEngine,
    useCloud: engineUseCloudInput.checked,
    showLinesPreview: engineLinesPreviewInput.checked,
    depth: Number(engineDepthInput.value),
    arrowUpdates: Number(engineArrowUpdatesInput.value),
    multiPv: includeMultiPv ? Number(engineMultiPvInput.value) : previous.multiPv,
    threads: Number(engineThreadsInput.value),
    hashSize: Number(engineHashInput.value),
  };
}

function rememberEvaluation(node: XiangqiPositionNode, result: EngineAnalysis): void {
  if (
    !node.evaluation ||
    node.evaluation.engine !== result.engine ||
    result.depth >= (node.evaluation.depth ?? 0)
  )
    node.evaluation = {
      engine: result.engine,
      depth: result.depth,
      nodes: result.nodes,
      cp: result.score.redCp,
      mate: result.score.redMate,
    };
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
