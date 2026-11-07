import { boardImageSvg, threeKingdoms, type BoardView } from '@lixiangqi/board';
import {
  position,
  interaction,
  playbackTransition,
  el,
  button,
  download,
  errorText,
  request,
  loadRules,
  Engine,
  Tree,
  colors,
  balanceShares,
  terminalShares,
  type Bootstrap,
  type Color,
  type Rules,
  type EngineResult,
  type Game,
} from 'threeKingdoms';

import {
  createXiangqiBoard,
  makeBoardResizable,
  websiteBoardPresentation,
  type BoardPreferences,
} from 'lib/board';

import { createArrowCadence } from './analysisArrowCadence';
import { bindAnalysisInterfaceControls } from './analysisInterfaceControls';
import { bindAnalysisKeyboard } from './analysisKeyboard';
import { syncAnalysisLayout } from './analysisLayout';
import { loadInterfaceSettings, type InterfaceSettings } from './analysisSettings';
import { MAX_ANALYSIS_TABS } from './analysisTabs';
import { AnalysisTabsView } from './analysisTabsView';
import { kingdomArrows } from './analysisThreeKingdomsArrows';
import { KingdomEngineView } from './analysisThreeKingdomsEngine';
import { KingdomAnalysisChart, renderKingdomBalance } from './analysisThreeKingdomsEvaluation';
import {
  loadKingdomTabs,
  saveKingdomTabs,
  newKingdomTab,
  type KingdomTab,
  findKingdomGameTab,
} from './analysisThreeKingdomsTabs';
import { KingdomAnalysisTree, kingdomTreePresentation, type KingdomNode } from './analysisThreeKingdomsTree';
import { AnalysisTreeView } from './analysisTreeView';
import { analysisVariantPicker } from './analysisVariant';

const required = <T extends HTMLElement = HTMLElement>(selector: string): T =>
  document.querySelector<T>(selector)!;

export async function initThreeKingdomsAnalysis(preferences: BoardPreferences): Promise<void> {
  try {
    const rules = await loadRules();
    const query = new URLSearchParams(location.search);
    let tree: Tree | undefined;
    let sourceGameId: string | undefined;
    if (query.has('game')) {
      const id = (sourceGameId = query.get('game')!);
      const game = id.startsWith('local-')
        ? ([
            ...JSON.parse(localStorage.getItem('threeKingdoms.localHistory') ?? '[]'),
            JSON.parse(localStorage.getItem('threeKingdoms.localGame') ?? 'null'),
          ].find((g: Game | null) => g?.id === id) as Game | undefined)
        : await request<Game>(`game/${encodeURIComponent(id)}?history=true`);
      if (!game) throw new Error('gameNotFound');
      tree = Tree.fromEvents(rules, game.initial, game.events);
    } else if (query.has('position')) tree = new Tree(rules, query.get('position')!);

    new Analysis(
      tree,
      rules,
      { mode: query.has('editor') ? 'editor' : 'analysis', me: null, preferences },
      sourceGameId,
    );
  } catch (error) {
    required('#xiangqi-status').textContent = errorText(error);
  }
}

class Analysis {
  private tree: Tree;
  private displayed?: { tree: Tree; node: Tree['current'] };
  private readonly board: BoardView;
  private readonly perspective: Color =
    colors.find(color => color === new URLSearchParams(location.search).get('color')) ?? 'red';
  private readonly engine = new Engine();
  private readonly engineView: KingdomEngineView;
  private readonly chart: KingdomAnalysisChart;
  private readonly gauge = required('#xiangqi-eval');
  private readonly results = new WeakMap<Tree['current'], EngineResult>();
  private readonly cadence = createArrowCadence<EngineResult>(3, 4, 1);
  private arrowPosition = '';
  private lineRun?: { tree: Tree; request: number };
  private readonly moves = required('#xiangqi-moves');
  private readonly message = required('#xiangqi-status');
  private readonly encoded = required<HTMLTextAreaElement>('#xiangqi-fen');
  private readonly comment = el('textarea');
  private model: KingdomAnalysisTree;
  private readonly treeView: AnalysisTreeView<KingdomNode>;
  private readonly tabsView: AnalysisTabsView<KingdomTab>;
  private readonly tabs: KingdomTab[];
  private activeId: string;
  private engineRequest = 0;
  private settings: InterfaceSettings = loadInterfaceSettings();

  constructor(
    tree: Tree | undefined,
    private readonly rules: Rules,
    private readonly bootstrap: Bootstrap,
    sourceGameId?: string,
  ) {
    const t = i18n.threeKingdoms;
    const stored = loadKingdomTabs(rules);
    this.tabs = stored.tabs;
    this.activeId = stored.activeId;
    if (tree) {
      const existing = sourceGameId && findKingdomGameTab(this.tabs, sourceGameId, tree);
      if (existing) this.activeId = existing.id;
      else {
        if (this.tabs.length >= MAX_ANALYSIS_TABS) throw new Error('Too many analysis tabs');
        const tab = newKingdomTab(tree, sourceGameId);
        this.tabs.push(tab);
        this.activeId = tab.id;
      }
    }
    this.tree = this.tabs.find(tab => tab.id === this.activeId)!.tree;
    const page = required('.xiangqi-analysis-page');
    page.classList.add('xiangqi-analysis-page--three-players');
    const element = required('#xiangqi-board');
    element.className = '';
    element.parentElement!.classList.remove('xiangqi9x10');
    this.board = createXiangqiBoard(element, position(this.tree.current.state), {
      ...websiteBoardPresentation(bootstrap.preferences, 'replay', this.perspective),
      coordinates: this.settings.coordinates,
    });
    makeBoardResizable(this.board);
    this.board.onMarksChange(marks => {
      this.tree.current.marks = marks;
      this.save();
    });
    this.engineView = new KingdomEngineView(rules, {
      changed: search => {
        if (search) {
          this.cancelLine();
          this.analyze();
        } else {
          this.cadence.configure(this.engineView.settings.depth, this.engineView.settings.arrowUpdates);
          this.engineView.refresh();
          this.renderArrows();
        }
      },
      analyseLine: () => void this.analyseLine(),
      play: moves => this.playMoves(moves),
      arrows: () => this.renderArrows(),
    });
    const engine = this.engineView.element;
    required('.xiangqi-engine').replaceWith(engine);
    required('.xiangqi-analysis-surface').append(this.gauge);
    this.chart = new KingdomAnalysisChart(required('#xiangqi-analysis-chart'), index => this.go(index));
    const mobile = window.matchMedia('(max-width: 799px)');
    const layout = () =>
      syncAnalysisLayout(
        {
          page,
          engine,
          panel: required('.xiangqi-analysis-panel'),
          board: required('.xiangqi-analysis-board'),
        },
        mobile.matches,
      );
    mobile.addEventListener('change', layout);
    layout();
    analysisVariantPicker('threeKingdoms', variant => {
      this.save();
      location.href = '/analysis/' + variant;
    });
    this.model = new KingdomAnalysisTree(this.tree);
    const guide = el('details', 'kingdom-notation-help');
    guide.append(el('summary', '', t.notationGuide));
    for (const text of [t.notationCoordinates, t.notationLocal, t.notationCrossing])
      guide.append(el('p', '', text));
    this.moves.before(guide);
    this.treeView = new AnalysisTreeView<KingdomNode>({
      element: this.moves,
      tree: () => this.model,
      activePath: () => this.model.pathFor(this.tree.cursor),
      setActivePath: path => {
        this.tree.cursor = this.model.nodeAtPath(path).index;
      },
      navigate: path => this.go(this.model.nodeAtPath(path).index),
      commit: () => {
        this.cancelLine();
        this.model.flush();
        this.go(this.tree.cursor);
        this.save();
      },
      notationLayout: () => 'compact',
      ...kingdomTreePresentation(),
      emptyText: t.analysis,
    });
    this.tabsView = new AnalysisTabsView<KingdomTab>({
      element: required('#xiangqi-analysis-tabs'),
      tabs: () => this.tabs,
      activeId: () => this.activeId,
      pending: () => false,
      select: id => {
        this.activeId = id;
        this.tree = this.tabs.find(tab => tab.id === id)!.tree;
        this.go(this.tree.cursor);
      },
      close: id => {
        if (this.tabs.length === 1) return;
        this.tabs.splice(
          this.tabs.findIndex(tab => tab.id === id),
          1,
        );
        if (id === this.activeId) {
          this.activeId = this.tabs[0].id;
          this.tree = this.tabs[0].tree;
        }
        this.go(this.tree.cursor);
        this.save();
      },
      add: () => {
        if (this.tabs.length >= MAX_ANALYSIS_TABS) return;
        const tab = newKingdomTab(new Tree(rules, rules.initial()));
        this.tabs.push(tab);
        this.activeId = tab.id;
        this.tree = tab.tree;
        this.go(0);
        this.save();
      },
      rename: (tab, title) => {
        tab.title = title;
        this.save();
      },
    });
    required('#xiangqi-first').onclick = () => this.go(0);
    required('#xiangqi-previous').onclick = () => this.go(this.tree.current.parent);
    required('#xiangqi-next').onclick = () => this.go(this.tree.children()[0] ?? this.tree.cursor);
    required('#xiangqi-last').onclick = () => this.go(this.tree.last());
    required('#xiangqi-explorer-toggle').hidden = true;
    this.comment.setAttribute('aria-label', i18n.study.commentThisPosition);
    this.comment.maxLength = 10000;
    this.comment.addEventListener('input', () => {
      this.tree.current.comment = this.comment.value;
      this.save();
    });
    const underboard = required('.xiangqi-analysis__underboard');
    required('.xiangqi-analysis__fen label').textContent = t.position;
    required('#xiangqi-copy-fen').textContent = t.share;
    required('#xiangqi-copy-fen').onclick = () => void this.share();
    required('#xiangqi-load-fen').onclick = () => {
      try {
        this.replaceTree(new Tree(rules, this.encoded.value.trim()));
      } catch (error) {
        this.message.textContent = errorText(error);
      }
    };
    required('#xiangqi-reset').onclick = () => this.replaceTree(new Tree(rules, rules.initial()));
    required('.xiangqi-analysis__notation label').textContent = t.import;
    const record = required<HTMLTextAreaElement>('#xiangqi-notation');
    record.placeholder = '';
    required('#xiangqi-import-notation').onclick = () => {
      try {
        this.replaceTree(Tree.import(rules, record.value));
      } catch (error) {
        this.message.textContent = errorText(error);
      }
    };
    required('#xiangqi-copy-notation').textContent = t.export;
    required('#xiangqi-copy-notation').onclick = () =>
      download(JSON.stringify(this.tree.export()), 'three-kingdoms-analysis.json');
    required('#xiangqi-clear-draft').onclick = () => {
      this.replaceTree(new Tree(rules, this.tree.initial));
    };
    required('.xiangqi-note').textContent = t.engineDescription;
    const file = el('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.setAttribute('aria-label', t.import);
    file.addEventListener('change', () => {
      const selected = file.files?.[0];
      if (selected && selected.size <= 2_000_000)
        void selected
          .text()
          .then(value => this.replaceTree(Tree.import(rules, value)))
          .catch(error => {
            this.message.textContent = errorText(error);
          });
    });
    underboard.append(
      this.comment,
      file,
      button(t.downloadImage, () => void this.image()),
    );
    bindAnalysisInterfaceControls({
      page,
      eval: required('#xiangqi-eval'),
      ground: this.board,
      treeView: this.treeView,
      fenInput: this.encoded,
      saveStatus: required('#xiangqi-save-status'),
      perspectives: colors,
      settings: () => this.settings,
      fixedSettings: {
        gaugeDock: 'bottom',
        notationLayout: 'compact',
        lockPanels: true,
        inline: false,
      },
      updateSettings: value => {
        this.settings = value;
      },
      currentFen: () => this.tree.current.state.position,
      loadFen: value => this.replaceTree(new Tree(rules, value)),
      renderBoardOverlays: () => this.renderArrows(),
      share: () => void this.share(),
      edit: () => this.edit(),
    });
    this.go(this.tree.cursor);
    bindAnalysisKeyboard(
      () => this.model,
      () => this.model.pathFor(this.tree.cursor),
      path => this.go(this.model.nodeAtPath(path).index),
    );
    window.addEventListener(
      'pagehide',
      () => {
        this.save();
        this.cancelLine();
        this.engine.stop();
        this.engineView.hidePreview();
        this.board.destroy();
        this.treeView.closeMenu();
        mobile.removeEventListener('change', layout);
      },
      { once: true },
    );
    if (bootstrap.mode === 'editor') this.edit();
  }

  private replaceTree(tree: Tree): void {
    this.cancelLine();
    this.tree = tree;
    this.tabs.find(tab => tab.id === this.activeId)!.tree = tree;
    this.go(tree.cursor);
    this.save();
  }

  private go(index: number): void {
    if (index < 0 || index >= this.tree.nodes.length) return;
    if (this.lineRun && this.lineRun.tree !== this.tree) this.cancelLine();
    this.tree.cursor = index;
    const node = this.tree.current;
    const previous = this.displayed;
    const sameTree = previous?.tree === this.tree;
    const direction =
      sameTree && this.tree.nodes[node.parent] === previous.node
        ? 'forward'
        : sameTree && this.tree.nodes[previous.node.parent] === node
          ? 'backward'
          : 'jump';
    this.board.display(
      position(node.state),
      previous
        ? playbackTransition(previous.node.state, node.state, direction, `analysis:${index}`)
        : { kind: 'initial' },
    );
    this.displayed = { tree: this.tree, node };
    try {
      this.board.setMarks(node.marks);
    } catch {
      node.marks = [];
      this.board.setMarks([]);
    }
    this.board.setInteraction(
      interaction(node.state, move => this.play(move), node.state.turn, this.bootstrap.preferences),
    );
    this.encoded.value = node.state.position;
    this.comment.value = node.comment;
    this.message.textContent = i18n.threeKingdoms.turn(i18n.threeKingdoms[node.state.turn]);
    this.model = new KingdomAnalysisTree(this.tree);
    this.treeView.render();
    this.tabsView.render();
    this.analyze();
    this.chart.render(this.tree);
  }

  private play(move: string): void {
    this.playMoves([move]);
  }

  private playMoves(moves: string[]): void {
    this.cancelLine();
    try {
      for (const move of moves) this.tree.play(move);
      this.save();
      this.go(this.tree.cursor);
    } catch (error) {
      this.message.textContent = errorText(error);
    }
  }

  private analyze(): void {
    this.engineView.clear();
    this.cadence.reset(this.engineView.settings.depth, this.engineView.settings.arrowUpdates);
    this.arrowPosition = this.tree.current.state.position;
    this.renderArrows();
    this.renderBalance();
    if (this.lineRun) {
      const cached = this.results.get(this.tree.current);
      if (cached) this.evaluation(this.tree.current, cached, true);
      return;
    }
    const request = ++this.engineRequest;
    this.engine.stop();
    if (!this.engineView.enabled || this.tree.current.state.ending) return;
    const node = this.tree.current;
    this.engineView.thinking();
    this.engine
      .analyze(node.state.position, {
        ...this.engineView.search(),
        emit: (result, final) => {
          if (request === this.engineRequest) this.evaluation(node, result, final);
        },
      })
      .then(() => {
        if (request === this.engineRequest) this.save();
      })
      .catch(error => {
        if (request === this.engineRequest && error.name !== 'AbortError')
          this.engineView.error(() => this.analyze());
      });
  }

  private renderBalance(): void {
    const node = this.tree.current;
    renderKingdomBalance(this.gauge, node.state, terminalShares(node.state) ?? node.evaluation?.shares);
  }

  private evaluation(node: Tree['current'], result: EngineResult, final: boolean): void {
    this.results.set(node, result);
    if (result.depth > 0 && result.lines.length)
      node.evaluation = { depth: result.depth, shares: balanceShares(result.lines[0]) };
    if (this.tree.current === node) {
      this.engineView.render(node.state, result, final);
      this.renderBalance();
      if (this.arrowPosition === node.state.position) this.cadence.accept(result, final);
      this.renderArrows();
    }
    this.chart.render(this.tree);
  }

  private cancelLine(): void {
    if (!this.lineRun) return;
    this.lineRun = undefined;
    ++this.engineRequest;
    this.engine.stop();
    this.engineView.lineButton.textContent = i18n.threeKingdoms.analyseLine;
    this.save();
  }

  private async analyseLine(): Promise<void> {
    if (this.lineRun) {
      this.cancelLine();
      this.analyze();
      return;
    }
    this.engine.stop();
    const run = (this.lineRun = { tree: this.tree, request: ++this.engineRequest });
    const nodes = this.chart.line(this.tree).map(i => this.tree.nodes[i]);
    this.engineView.lineButton.textContent = i18n.threeKingdoms.cancel;
    this.engineView.clear();
    try {
      for (const [index, node] of nodes.entries()) {
        if (this.lineRun !== run) return;
        required('#xiangqi-save-status').textContent = i18n.threeKingdoms.analysisProgress(
          index + 1,
          nodes.length,
        );
        const terminal = terminalShares(node.state);
        if (terminal) node.evaluation = { shares: terminal, depth: 0 };
        else {
          this.engineView.progress(true, 0);
          this.cadence.reset(this.engineView.settings.depth, this.engineView.settings.arrowUpdates);
          this.arrowPosition = node.state.position;
          this.renderArrows();
          await this.engine.analyze(node.state.position, {
            ...this.engineView.search(),
            emit: (result, final) => {
              if (this.lineRun === run) this.evaluation(node, result, final);
            },
          });
        }
        this.chart.render(this.tree);
        if (index % 10 === 9) this.save();
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError' && this.lineRun === run)
        this.message.textContent = i18n.threeKingdoms.engineUnavailable;
    } finally {
      if (this.lineRun === run) {
        this.lineRun = undefined;
        this.engineView.lineButton.textContent = i18n.threeKingdoms.analyseLine;
        this.save();
        this.analyze();
      }
    }
  }

  private edit(): void {
    location.href =
      '/editor?' +
      new URLSearchParams({
        variant: 'threeKingdoms',
        fen: this.tree.current.state.position,
        color: this.board.getPresentation().perspective,
      });
  }

  private renderArrows(): void {
    this.board.setMarks(
      kingdomArrows(
        this.rules,
        this.tree.current.state,
        this.board.getPresentation().perspective,
        this.settings.bestArrow && this.arrowPosition === this.tree.current.state.position
          ? this.cadence.published
          : undefined,
        this.settings.variationArrows ? this.tree.children().map(i => this.tree.nodes[i].action) : [],
        this.engineView.previewMove,
      ),
      'annotation',
    );
  }

  private save(): void {
    try {
      saveKingdomTabs(this.tabs, this.activeId);
      required('#xiangqi-save-status').textContent = i18n.threeKingdoms.saved;
    } catch (error) {
      this.message.textContent = errorText(error);
    }
  }
  private async share(): Promise<void> {
    try {
      const url = new URL('/analysis/threeKingdoms', location.origin);
      url.searchParams.set('position', this.tree.current.state.position);
      await navigator.clipboard.writeText(url.href);
      this.message.textContent = i18n.threeKingdoms.copied;
    } catch (error) {
      this.message.textContent = errorText(error);
    }
  }
  private async image(): Promise<void> {
    try {
      const options = {
        definition: threeKingdoms,
        position: this.board.position(),
        perspective: this.board.getPresentation().perspective,
        theme: document.body.dataset.board,
        pieceSet: document.body.dataset.pieceSet,
        marks: this.tree.current.marks,
        coordinates: this.board.getPresentation().coordinates,
      };
      const assets = new Set<string>();
      boardImageSvg(options, path => {
        assets.add(path);
        return path;
      });
      const embedded = new Map(
        await Promise.all(
          [...assets].map(async path => {
            const response = await fetch(site.asset.url(path));
            if (!response.ok) throw new Error('Image unavailable');
            const blob = await response.blob();
            const url = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onerror = reject;
              reader.onload = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
            });
            return [path, url] as const;
          }),
        ),
      );
      download(
        boardImageSvg(options, path => embedded.get(path)!),
        'three-kingdoms.svg',
        'image/svg+xml',
      );
    } catch (error) {
      this.message.textContent = errorText(error);
    }
  }
}
