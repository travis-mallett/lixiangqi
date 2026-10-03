import {
  type BoardView,
  type BoardTransition,
  coordinateMove,
  positionToFen,
  standardXiangqi,
} from '@lixiangqi/board';
import { type ArrowKey, type KeyboardMove, ctrl as makeKeyboardMove } from 'keyboard-move';

import {
  defined,
  prop,
  toggle,
  debounce,
  throttle,
  requestIdleCallbackSafe,
  propWithEffect,
  type Prop,
  type Toggle,
} from 'lib';
import { xiangqiPosition } from 'lib/board';
import { CevalCtrl, isFirstEvalBetter, type CevalHandler, type CevalOpts } from 'lib/ceval';
import { ChatCtrl } from 'lib/chat/chatCtrl';
import { displayColumns } from 'lib/device';
import { playable, playedTurns, isXiangqiCapture, validUci } from 'lib/game';
import { type XiangqiSide as Color, oppositeSide as opposite } from 'lib/game/xiangqi';
import { requestXiangqi } from 'lib/game/xiangqiApi';
import { pubsub } from 'lib/pubsub';
import { storedBooleanProp } from 'lib/storage';
import { makeTree, treePath, treeOps, type TreeWrapper } from 'lib/tree';
import { completeNode } from 'lib/tree/node';
import type { ClientEval, LocalEval, ServerEval, TreeNode, TreePath } from 'lib/tree/types';
import { confirm } from 'lib/view';

import { Autoplay, type AutoplayDelay } from './autoplay';
import { compute as computeAutoShapes } from './autoShape';
import * as ground from './board';
import EvalCache from './evalCache';
import ExplorerCtrl from './explorer/explorerCtrl';
import ForecastCtrl from './forecast/forecastCtrl';
import { ForkCtrl } from './fork';
import { IdbTree } from './idbTree';
import type { AnalyseOpts, AnalyseData, ServerEvalData, NvuiPlugin } from './interfaces';
import * as keyboard from './keyboard';
import LiveAnnotate from './liveAnnotate';
import MotifCtrl from './motif/motifCtrl';
import Navigate from './navigate';
import { nextGlyphSymbol } from './nodeFinder';
import notationImport from './notationImport';
import { make as makePractice, type PracticeCtrl } from './practice/practiceCtrl';
import { make as makeRetro, type RetroCtrl } from './retrospect/retroCtrl';
import { SettingsCtrl } from './settingsCtrl';
import { make as makeSocket, type Socket } from './socket';
import { studyMarks, storedStudyLocation } from './study/boardMarks';
import type GamebookPlayCtrl from './study/gamebook/gamebookPlayCtrl';
import type { AnaMove } from './study/interfaces';
import type StudyCtrl from './study/studyCtrl';
import { TreeView } from './treeView/treeView';
import { plural } from './view/util';
import wikiTheory, { wikiClear, type WikiTheory } from './wiki';

export default class AnalyseCtrl implements CevalHandler {
  data: AnalyseData;
  element: HTMLElement;
  tree: TreeWrapper;
  socket: Socket;
  board: BoardView;
  private boardTransition: BoardTransition = { kind: 'initial' };
  ceval: CevalCtrl;
  evalCache: EvalCache;
  liveAnnotate = new LiveAnnotate();
  navigate: Navigate;
  idbTree: IdbTree = new IdbTree(this);
  actionMenu: Toggle = toggle(false);
  isEmbed: boolean;

  // current tree state, cursor, and denormalized node lists
  path: TreePath;
  node: TreeNode;
  nodeList: TreeNode[];
  mainline: TreeNode[];

  // sub controllers
  autoplay: Autoplay;
  explorer: ExplorerCtrl;
  forecast?: ForecastCtrl;
  retro?: RetroCtrl;
  fork: ForkCtrl;
  practice?: PracticeCtrl;
  study?: StudyCtrl;
  chatCtrl?: ChatCtrl;
  wiki?: WikiTheory;
  motif: MotifCtrl;

  // state flags
  justPlayed?: string; // pos
  redirecting = false;
  onMainline = true;
  synthetic: boolean; // false if coming from a real game
  ongoing: boolean; // true if real game is ongoing
  private readonly cevalEnabledProp = storedBooleanProp('engine.enabled', false);

  // display flags
  flipped = false;
  showComments = true; // whether to display comments in the move tree
  settings: SettingsCtrl;
  private readonly showCevalProp: Prop<boolean> = storedBooleanProp(
    'analyse.show-engine',
    this.cevalEnabledProp(),
  );
  keyboardHelp: boolean = location.hash === '#keyboard';
  threatMode: Prop<boolean> = prop(false);

  treeView: TreeView;
  cgVersion = {
    js: 1, // increment to recreate chessground
    dom: 1,
  };

  // underboard inputs
  fenInput?: string;
  pgnInput?: string;
  pgnError?: string;

  // other paths
  initialPath: TreePath;
  contextMenuPath?: TreePath;
  gamePath?: TreePath;
  pendingCopyPath: Prop<TreePath | null>;
  pendingDeletionPath: Prop<TreePath | null>;

  // misc
  requestInitialPly?: number; // start ply from the URL location hash
  nvui?: NvuiPlugin;
  pvUciQueue: Uci[] = [];
  keyboardMove?: KeyboardMove;

  constructor(
    readonly opts: AnalyseOpts,
    readonly redraw: Redraw,
    makeStudy?: typeof StudyCtrl,
  ) {
    this.data = opts.data;
    this.element = opts.element;
    this.isEmbed = !!opts.embed;
    this.settings = new SettingsCtrl(() => {
      this.setAutoShapes();
      this.redraw();
    });
    this.treeView = new TreeView(this);
    this.navigate = new Navigate(this);
    this.motif = new MotifCtrl(this.settings, () => {
      this.setAutoShapes();
      this.redraw();
    });

    if (this.data.forecast) this.forecast = new ForecastCtrl(this.data.forecast, this.data, redraw);
    if (this.opts.wiki) this.wiki = wikiTheory(this.opts.explorer.endpoint);
    if (site.blindMode)
      site.asset.loadEsm<NvuiPlugin>('analyse.nvui', { init: this }).then(nvui => {
        this.nvui = nvui;
        this.redraw();
      });

    this.instanciateEvalCache();

    if (opts.inlinePgn) void this.changePgn(opts.inlinePgn, true);

    this.initialize(this.data, false);
    this.initCeval();
    this.pendingCopyPath = propWithEffect(null, this.redraw);
    this.pendingDeletionPath = propWithEffect(null, this.redraw);
    this.initialPath = this.makeInitialPath();
    this.setPath(this.initialPath);

    this.showGround();
    this.resetAutoShapes();
    this.explorer.setNode();
    this.study =
      opts.study && makeStudy
        ? new makeStudy(opts.study, this, (opts.tagTypes || '').split(','), opts.relay)
        : undefined;

    if (location.hash === '#practice' || this.study?.data.chapter.practice) this.togglePractice();
    else if (location.hash === '#menu') requestIdleCallbackSafe(this.actionMenu.toggle, 500);
    this.setCevalPracticeOpts();
    this.startCeval();
    keyboard.bind(this);

    const urlEngine = new URLSearchParams(location.search).get('engine');
    if (urlEngine) {
      try {
        this.ceval.selectEngine(urlEngine);
        this.cevalEnabled(true);
        this.threatMode(false);
      } catch (e) {
        console.info(e);
      }
      site.redirect('/analysis');
    }
    if (this.opts.chat && !this.isEmbed) {
      this.chatCtrl = new ChatCtrl(
        { ...this.opts.chat, enhance: { plies: true, boards: !!this.study?.relay } },
        this.redraw,
      );
    }
    pubsub.on('jump', (ply: string) => {
      this.jumpToMain(parseInt(ply));
      this.redraw();
    });

    pubsub.on('ply.trigger', () =>
      pubsub.emit('ply', this.node.ply, this.tree.lastMainlineNode(this.path).ply === this.node.ply),
    );
    pubsub.on('analysis.chart.click', index => {
      this.jumpToIndex(index);
      this.redraw();
    });
    pubsub.on('board.change', () => {
      if (this.board) {
        this.board.redraw();
        redraw();
      }
    });
    this.mergeIdbThenShowTreeView();
    (window as any).lichess.analysis = {
      playUci: this.playUci,
      navigate: this.navigate,
    };
    (window as any).lixiangqiBoard = () => this.board;
  }

  initialize(data: AnalyseData, merge: boolean): void {
    this.data = data;
    this.synthetic = data.game.id === 'synthetic';
    this.ongoing = !this.synthetic && playable(data);
    this.treeView.hidden = true;
    const prevTree = merge && this.tree.root;
    this.tree = makeTree(completeNode(this.data.tree));
    if (prevTree) this.tree.merge(prevTree);
    treeOps.updateAll(this.tree.root, this.ensureServerEvalNodes);
    const mainline = treeOps.mainlineNodeList(this.tree.root);

    this.autoplay = new Autoplay(this);
    this.socket ??= makeSocket(this.opts.socketSend, this);
    if (this.explorer) this.explorer.destroy();
    this.explorer = new ExplorerCtrl(this, this.opts.explorer, this.explorer);
    this.gamePath = this.synthetic || this.ongoing ? undefined : treePath.fromNodeList(mainline);
    this.fork = new ForkCtrl(this);

    site.sound.preloadBoardSounds();
  }

  get variantKey(): VariantKey {
    return this.data.game.variant.key;
  }

  private readonly makeInitialPath = (): TreePath => {
    // if correspondence, always use latest actual move to set 'current' style
    if (this.ongoing) return treePath.fromNodeList(treeOps.mainlineNodeList(this.tree.root));
    const loc = window.location,
      hashPly = loc.hash === '#last' ? this.tree.lastPly() : parseInt(loc.hash.slice(1)),
      startPly = hashPly >= 0 ? hashPly : this.opts.inlinePgn ? this.tree.lastPly() : undefined;
    if (defined(startPly)) {
      // remove location hash - https://stackoverflow.com/questions/1397329/how-to-remove-the-hash-from-window-location-with-javascript-without-page-refresh/5298684#5298684
      window.history.replaceState(null, '', loc.pathname + loc.search);
      this.requestInitialPly = startPly;
      const mainline = treeOps.mainlineNodeList(this.tree.root);
      return treeOps.takePathWhile(mainline, n => n.ply <= startPly);
    } else return treePath.root;
  };

  enableWiki = (v: boolean) => {
    this.wiki = v ? wikiTheory(this.opts.explorer.endpoint) : undefined;
    if (this.wiki) this.wiki(this.nodeList);
    else wikiClear();
  };

  private readonly setPath = (path: TreePath): void => {
    this.path = path;
    this.nodeList = this.tree.getNodeList(path);
    this.node = treeOps.last(this.nodeList) as TreeNode;
    this.mainline = treeOps.mainlineNodeList(this.tree.root);
    this.onMainline = this.tree.pathIsMainline(path);
    this.fenInput = undefined;
    this.pgnInput = undefined;
    if (this.wiki) this.wiki(this.nodeList);
    this.idbTree.saveMoves();
    this.idbTree.revealNode();
  };

  flip = () => {
    if (this.study?.onFlip(!this.flipped) === false) return;
    this.flipped = !this.flipped;
    this.board?.setPresentation(ground.presentation(this));
    if (this.retro) this.retro = makeRetro(this, this.bottomColor());
    if (this.practice) this.startCeval();
    this.explorer.onFlip();
    this.onChange();
    this.redraw();
  };

  topColor(): Color {
    return opposite(this.bottomColor());
  }

  bottomColor(): Color {
    return this.flipped ? opposite(this.data.orientation) : this.data.orientation;
  }

  bottomIsRed = () => this.bottomColor() === 'red';

  getOrientation(): Color {
    return this.bottomColor();
  }

  getNode(): TreeNode {
    return this.node;
  }

  turnColor(): Color {
    return this.node.state.turn;
  }

  togglePlay(delay: AutoplayDelay): void {
    this.autoplay.toggle(delay);
    this.actionMenu(false);
  }

  private showGround(): void {
    this.withBoard(board => {
      board.setPresentation(ground.presentation(this));
      board.display(xiangqiPosition(this.node.fen, this.node.uci, this.node.check()), this.boardTransition);
      this.boardTransition = { kind: 'jump' };
      board.setInteraction(ground.interaction(this));
      board.setMarks(studyMarks(this.node.shapes));
      this.setAutoShapes();
      board.playPremove();
    });
    this.pluginUpdate(this.node.fen);
    this.onChange();
  }

  serverMainline = () => this.mainline.slice(0, playedTurns(this.data) + 1);

  setBoard = (board: BoardView) => {
    this.board = board;
    this.cgVersion.dom = this.cgVersion.js;
    if (this.data.pref.keyboardMove && !this.study?.relay) {
      this.keyboardMove ??= makeKeyboardMove({
        ...this,
        data: { game: this.data.game, player: { color: 'both' as const } },
        flipNow: this.flip,
        resolveNotation: async notation => {
          const path = this.path,
            tree = this.tree;
          const result = await requestXiangqi<{ move: string }>('/api/analysis/notation-move', {
            ...tree.positionAt(path),
            notation,
          });
          return this.path === path && this.tree === tree ? result.move : undefined;
        },
      });
      this.keyboardMove.update({ fen: this.node.fen, canMove: true, board });
      requestAnimationFrame(() => this.redraw());
    }
    this.showGround();
  };

  private readonly onChange: () => void = throttle(300, () => {
    pubsub.emit('analysis.change', this.node.fen, this.path);
  });

  private readonly updateHref: () => void = debounce(() => {
    if (!this.opts.study) window.history.replaceState(null, '', '#' + this.node.ply);
  }, 750);

  playedLastMoveMyself = () =>
    !!this.justPlayed && !!this.node.uci && this.node.uci.startsWith(this.justPlayed);

  jump(path: TreePath): void {
    const pathChanged = path !== this.path;
    const previousNode = this.node;
    if (this.path !== path)
      this.treeView.requestAutoScroll(treeOps.distance(this.path, path) > 8 ? 'instant' : 'smooth');
    this.setPath(path);
    if (pathChanged) {
      if (this.study) this.study.setPath(path, this.node);
      if (this.retro) this.retro.onJump();
      const distance = this.node.ply - previousNode.ply;
      this.boardTransition =
        Math.abs(distance) === 1
          ? {
              kind: distance > 0 ? 'forward' : 'backward',
              id: this.path,
              effects: [
                ...(isXiangqiCapture(previousNode.fen, this.node.fen) ? ['capture' as const] : []),
                ...(this.node.check() ? ['check' as const] : []),
              ],
            }
          : { kind: 'jump' };
      this.threatMode(false);
      this.ceval?.reset();
      this.startCeval();
      site.sound.saySan(this.node.notation, true);
    }
    this.justPlayed = undefined;
    this.explorer.setNode();
    this.updateHref();
    if (pathChanged) {
      if (this.practice) this.practice.onJump();
      if (this.study) this.study.onJump();
    }
    pubsub.emit('ply', this.node.ply, this.tree.lastMainlineNode(this.path).ply === this.node.ply);
    this.showGround();
  }

  userJump = (path: TreePath): void => {
    this.autoplay.stop();
    if (!this.gamebookPlay()) this.withBoard(cg => cg.select());
    if (this.practice) {
      const prev = this.path;
      this.practice.preUserJump(prev, path);
      this.jump(path);
      this.withBoard(cg => cg.cancelPremove());
      this.practice.postUserJump(prev, this.path);
    } else this.jump(path);
  };

  canJumpTo = (path: TreePath): boolean => !this.study || this.study.canJumpTo(path);

  userJumpIfCan(path: TreePath, sideStep = false): void {
    if (path === this.path || !this.canJumpTo(path)) return;
    if (sideStep) {
      // when stepping lines, anchor the chessground animation at the parent
      this.node = this.tree.nodeAtPath(treePath.init(path));
      this.board?.display(xiangqiPosition(this.node.fen), { kind: 'jump' });
    }
    this.userJump(path);
  }

  mainlinePlyToPath(ply: Ply): TreePath {
    return treeOps.takePathWhile(this.mainline, n => n.ply <= ply);
  }

  jumpToMain = (ply: Ply): void => {
    this.userJump(this.mainlinePlyToPath(ply));
  };

  jumpToIndex = (index: number): void => {
    this.jumpToMain(index + 1 + this.tree.root.ply);
  };

  jumpToGlyphSymbol(color: Color, symbol: string): void {
    const node = nextGlyphSymbol(color, symbol, this.mainline, this.node.ply);
    if (node) this.jumpToMain(node.ply);
    this.redraw();
  }

  reloadData(data: AnalyseData, merge: boolean): void {
    this.initialize(data, merge);
    this.redirecting = false;
    this.setPath(treePath.root);
    this.initCeval();
    this.instanciateEvalCache();
    this.startCeval();
    this.cgVersion.js++;
    this.mergeIdbThenShowTreeView();
  }

  private pgnRequest = 0;

  async changePgn(pgn: string, andReload: boolean): Promise<AnalyseData | undefined> {
    const request = ++this.pgnRequest;
    this.pgnError = '';
    try {
      const data: AnalyseData = {
        ...(await notationImport(pgn)),
        orientation: this.bottomColor(),
        pref: this.data.pref,
        externalEngines: this.data.externalEngines,
      } as AnalyseData;
      if (request !== this.pgnRequest) return;
      if (andReload) {
        this.reloadData(data, false);
        this.userJump(this.mainlinePlyToPath(this.tree.lastPly()));
        this.redraw();
      }
      return data;
    } catch (err) {
      if (request !== this.pgnRequest) return;
      this.pgnError = (err as Error).message;
      requestAnimationFrame(this.redraw);
    }
    return undefined;
  }

  changeFen(fen: FEN): void {
    this.redirecting = true;
    window.location.href =
      '/analysis/' +
      this.data.game.variant.key +
      '/' +
      encodeURIComponent(fen).replace(/%20/g, '_').replace(/%2F/g, '/');
  }

  userMove = (orig: string, dest: string): void => {
    this.justPlayed = orig;
    this.board.setInteraction({ mode: 'display' });
    this.sendMove(orig, dest);
  };

  sendMove = (orig: string, dest: string): void => {
    const move: AnaMove = {
      orig: storedStudyLocation(orig),
      dest: storedStudyLocation(dest),
      path: this.path,
    };
    if (this.practice) this.practice.onUserMove();
    this.socket.sendAnaMove(move);
  };

  onPremoveSet = () => {
    this.study?.onPremoveSet();
  };

  addNode(node: TreeNode, path: TreePath) {
    this.idbTree.onAddNode(node, path);
    const newPath = this.tree.addNode(node, path);
    if (!newPath) {
      console.log("Can't addNode", node, path);
      return this.redraw();
    }

    const relayPath = this.study?.data.chapter.relayPath;
    if (relayPath && relayPath === path) this.forceVariation(newPath, true);
    else this.jump(newPath);

    this.redraw();
    const queuedUci = this.pvUciQueue.shift();
    if (queuedUci) this.playUci(queuedUci, this.pvUciQueue);
    else this.board.playPremove();
  }

  async deleteNode(path: TreePath): Promise<void> {
    this.pendingDeletionPath(null);
    const node = this.tree.nodeAtPath(path);
    if (!node) return;
    const count = treeOps.countChildrenAndComments(node);
    if (
      (count.nodes >= 10 || count.comments > 0) &&
      !(await confirm(
        'Delete ' +
          plural('move', count.nodes) +
          (count.comments ? ' and ' + plural('comment', count.comments) : '') +
          '?',
      ))
    )
      return;
    this.tree.deleteNodeAt(path);
    if (treePath.contains(this.path, path)) this.userJump(treePath.init(path));
    else this.jump(this.path);
    if (this.study) this.study.deleteNode(path);
    this.redraw();
  }

  allowedEval(node: TreeNode = this.node): ClientEval | ServerEval | false | undefined {
    return (this.cevalEnabled() && node.ceval) || (this.settings.showStaticAnalysis && node.eval);
  }

  motifAllowed = (): boolean => this.study?.isCevalAllowed() !== false && !this.retro?.isSolving();
  motifEnabled = (): boolean => this.motifAllowed();

  promote(path: TreePath, toMainline: boolean): void {
    this.tree.promoteAt(path, toMainline);
    this.jump(path);
    if (this.study) this.study.promote(path, toMainline);
  }

  forceVariation(path: TreePath, force: boolean): void {
    this.tree.forceVariationAt(path, force);
    this.jump(path);
    if (this.study) this.study.forceVariation(path, force);
  }

  visibleChildren(node = this.node): TreeNode[] {
    return treeOps
      .mainlineFirst(node.children)
      .filter(
        kid =>
          !kid.comp ||
          (this.settings.showStaticAnalysis && !this.retro?.hideComputerLine(kid)) ||
          (treeOps.contains(kid, this.node) && !this.retro?.forceCeval()),
      );
  }

  reset(): void {
    this.showGround();
    this.redraw();
  }

  encodeNodeFen(): FEN {
    return this.node.fen.replace(/\s/g, '_');
  }

  nextNodeBest() {
    return treeOps.withMainlineChild(this.node, (n: TreeNode) => validUci(n.eval?.best));
  }

  setAutoShapes = (): void => {
    if (!site.blindMode) this.board?.setMarks(computeAutoShapes(this), 'annotation');
  };

  private readonly onNewCeval = (ev: ClientEval, path: TreePath, isThreat?: boolean): void => {
    this.tree.updateAt(path, (node: TreeNode) => {
      if (node.fen !== ev.fen && !isThreat) return;

      if (isThreat) {
        const threat = ev as LocalEval;
        if (!node.threat || isFirstEvalBetter(threat, node.threat, this.ceval.search.multiPv))
          node.threat = threat;
      } else if (
        (!node.ceval || isFirstEvalBetter(ev, node.ceval, this.ceval.search.multiPv)) &&
        !(ev.cloud && this.ceval.engines.external)
      ) {
        node.ceval = ev;
      } else if (!ev.cloud) {
        if (node.ceval?.cloud && this.ceval.isDeeper()) node.ceval = ev;
      }

      if (!isThreat) this.liveAnnotate?.onNewCeval(path, node, this.tree);

      if (path === this.path) {
        this.setAutoShapes();
        if (!isThreat) {
          this.retro?.onCeval();
          this.practice?.onCeval();
          this.study?.multiCloudEval?.onLocalCeval(this.tree.positionAt(path), ev);
          this.evalCache.onLocalCeval();
        }
        if (!(site.blindMode && this.retro)) this.redraw();
      }
    });
  };

  initCeval(mergeOpts?: Partial<CevalOpts>): void {
    const opts: CevalOpts = {
      variant: this.data.game.variant,
      initialFen: this.tree.root.fen,
      ruleset: this.tree.root.ruleset!,
      notationStyle: this.data.pref.notationStyle,
      emit: (ev, meta) => this.onNewCeval(ev, meta.path, meta.threatMode),
      onUciHover: this.setAutoShapes,
      redraw: this.redraw,
      externalEngines:
        this.data.externalEngines?.map(engine => ({
          ...engine,
          endpoint: this.opts.externalEngineEndpoint,
        })) || [],
      onSelectEngine: () => {
        this.initCeval();
        this.redraw();
      },
      hideErrors: this.isEmbed,
      ...mergeOpts,
    };
    if (this.ceval) this.ceval.init(opts);
    else this.ceval = new CevalCtrl(opts);
  }

  isCevalAllowed = () =>
    !this.ongoing &&
    (!this.study || this.study.isCevalAllowed()) &&
    (this.synthetic || !playable(this.data)) &&
    !location.search.includes('evals=0');

  cevalEnabled = (enable?: boolean): boolean | 'force' => {
    const force = Boolean(this.practice || this.retro?.forceCeval());
    const unforcedState = this.cevalEnabledProp() && this.isCevalAllowed() && !this.ceval.wasUnloaded;

    if (enable === undefined) return force ? 'force' : unforcedState;
    if (!force) {
      this.showCevalProp(enable);
      this.cevalEnabledProp(enable);
    }
    if (enable && this.ceval.wasUnloaded) this.ceval.reset();
    if (enable !== unforcedState) {
      if (enable) this.startCeval();
      else {
        this.threatMode(false);
        this.ceval.reset();
      }
      this.setAutoShapes();
      this.ceval.showEnginePrefs(false);
      this.redraw();
    }
    return force ? 'force' : enable;
  };

  startCeval = () => {
    if (this.study?.localAnalysis.running) return;
    if (!this.ceval.download) this.ceval.reset();
    if (!this.cevalEnabled() || this.node.outcome()) return;
    this.ceval.start(this.path, this.nodeList, undefined, this.threatMode());
    this.evalCache.fetch(this.path, this.ceval.search.multiPv);
  };

  clearCeval(): void {
    this.tree.removeCeval();
    this.evalCache.clear();
    this.startCeval();
  }

  showVariationArrows() {
    if (!this.allowLines() || !this.settings.showVariationArrows) return false;
    return Boolean(this.node.children.filter(x => !x.comp || this.settings.showStaticAnalysis).length);
  }

  showEvaluation() {
    return this.settings.showStaticAnalysis || (this.cevalEnabled() && this.isCevalAllowed());
  }

  showMoveGlyphs = (): boolean => (this.study && !this.study.relay) || this.settings.showStaticAnalysis;

  showMoveAnnotations = (): boolean =>
    this.settings.showMoveAnnotationsOnBoard && !this.retro?.isSolving() && this.showMoveGlyphs();

  showEvalGauge(): boolean {
    return (
      this.settings.showGauge &&
      displayColumns() > 1 &&
      this.showEvaluation() &&
      this.isCevalAllowed() &&
      (this.cevalEnabled() || !!this.node.eval || !!this.node.ceval) &&
      !this.node.outcome()
    );
  }

  showCeval = (show?: boolean) => {
    const barMode = this.activeControlMode();
    if (show === undefined) return displayColumns() > 1 || barMode === 'ceval' || barMode === 'practice';
    this.ceval.showEnginePrefs(false);
    this.showCevalProp(show);
    if (show) this.cevalEnabled(true);
    return show;
  };

  activeControlMode = () =>
    this.practice ? 'practice' : this.retro ? 'retro' : this.showCevalProp() ? 'ceval' : false;

  activeControlBarTool() {
    return this.actionMenu() ? 'action-menu' : this.explorer.enabled() ? 'opening-explorer' : false;
  }

  allowLines() {
    const chap = this.study?.data.chapter;
    return (
      !chap?.practice && chap?.conceal === undefined && !this.study?.gamebookPlay && !this.retro?.isSolving()
    );
  }

  toggleDiscloseOf(path = treePath.init(this.path)) {
    const disclose = this.idbTree.discloseOf(this.tree.nodeAtPath(path), this.tree.pathIsMainline(path));
    if (disclose) this.idbTree.setCollapsed(path, disclose === 'expanded');
    return Boolean(disclose);
  }

  toggleThreatMode = (v = !this.threatMode()) => {
    if (v === this.threatMode()) return;
    if (this.node.check() || !this.showEvaluation()) return;
    if (!this.cevalEnabled()) return;
    this.threatMode(v);
    if (this.threatMode() && this.practice) this.togglePractice();
    this.setAutoShapes();
    this.startCeval();
    this.redraw();
  };

  toggleActionMenu = () => {
    if (!this.actionMenu() && this.explorer.enabled()) this.explorer.toggle();
    this.actionMenu.toggle();
  };

  toggleRetro = (): void => {
    if (this.retro) this.retro = undefined;
    else {
      this.closeTools();
      this.retro = makeRetro(this, this.bottomColor());
    }
    this.setAutoShapes();
  };

  toggleExplorer = (): void => {
    if (!this.explorer.allowed()) return;
    if (!this.explorer.enabled()) {
      this.retro = undefined;
      this.actionMenu(false);
    }
    this.explorer.toggle();
  };

  togglePractice = (enable = !this.practice) => {
    if (enable === !!this.practice) return;
    this.practice = undefined;
    if (!enable || !this.isCevalAllowed()) {
      this.setCevalPracticeOpts();
      this.showGround();
    } else {
      this.closeTools();
      this.threatMode(false);
      this.practice = makePractice(this);
      this.setCevalPracticeOpts();
      this.setAutoShapes();
      this.startCeval();
    }
  };

  private setCevalPracticeOpts() {
    this.initCeval({ custom: this.practice?.customCeval });
  }

  gamebookPlay = (): GamebookPlayCtrl | undefined => this.study?.gamebookPlay;

  isGamebook = (): boolean => !!this.study?.data.chapter.gamebook;

  private readonly closeTools = () => {
    this.retro = undefined;
    this.togglePractice(false);
    if (this.explorer.enabled()) this.explorer.toggle();
    this.actionMenu(false);
  };

  withBoard = <A>(f: (board: BoardView) => A): A | undefined =>
    this.board && this.cgVersion.js === this.cgVersion.dom ? f(this.board) : undefined;

  hasFullComputerAnalysis = (): boolean => {
    return Object.keys(this.mainline[0].eval || {}).length > 0;
  };

  mergeAnalysisData(data: ServerEvalData) {
    if (this.study && this.study.data.chapter.id !== data.ch) return;
    const tree = completeNode(data.tree);
    this.tree.merge(tree);
    this.data.tree = this.tree.root;
    treeOps.mainlineNodeList(this.tree.root).forEach(this.ensureServerEvalNodes);
    this.data.analysis = data.analysis;
    if (data.analysis) data.analysis.partial = !!treeOps.findInMainline(tree, this.partialAnalysisCallback);
    if (data.division) this.data.game.division = data.division;
    if (this.retro) this.retro.onMergeAnalysisData();
    pubsub.emit('analysis.server.progress', this.data);
    this.redraw();
  }

  partialAnalysisCallback(n: TreeNode) {
    return !n.eval && !!n.children.length && n.ply <= 300 && n.ply > 0;
  }

  private readonly canEvalGet = (): boolean => this.opts.study !== undefined || this.node.ply < 15;

  private readonly instanciateEvalCache = () => {
    if (this.evalCache) this.evalCache.destroy();
    this.evalCache = new EvalCache({
      getPosition: (path = this.path) =>
        this.tree?.pathExists(path) ? this.tree.positionAt(path) : undefined,
      canGet: this.canEvalGet,
      canPut: () =>
        !!(
          this.ceval?.isCacheable &&
          this.canEvalGet() &&
          // if not in study, only put decent opening moves
          (this.opts.study || (!this.node.ceval!.mate && Math.abs(this.node.ceval!.cp!) < 99))
        ),
      getNode: () => this.node,
      send: this.opts.socketSend,
      receive: this.onNewCeval,
      upgradable: this.evalCache?.upgradable(),
    });
  };

  playUci = (uci: Uci, uciQueue?: Uci[]) => {
    this.pvUciQueue = uciQueue ?? [];
    const [from, to] = coordinateMove(uci);
    if (this.board.allowsMove(from, to)) this.sendMove(from, to);
  };

  playUciList(uciList: Uci[]): void {
    this.pvUciQueue = uciList;
    const firstUci = this.pvUciQueue.shift();
    if (firstUci) this.playUci(firstUci, this.pvUciQueue);
  }

  explorerMove(uci: Uci): void {
    this.playUci(uci);
  }

  playBestMove(): void {
    const uci = this.node.ceval?.pvs[0].moves[0] || this.nextNodeBest();
    if (uci) this.playUci(uci);
  }

  pluginMove = (orig: string, dest: string): void => {
    if (this.board.allowsMove(orig, dest)) this.sendMove(orig, dest);
  };

  handleArrowKey = (arrowKey: ArrowKey): void => {
    if (arrowKey === 'ArrowUp') {
      if (this.fork.select('prev')) this.setAutoShapes();
      else this.navigate.first();
    } else if (arrowKey === 'ArrowDown') {
      if (this.fork.select('next')) this.setAutoShapes();
      else this.navigate.last();
    } else if (arrowKey === 'ArrowLeft') this.navigate.prev();
    else if (arrowKey === 'ArrowRight') this.navigate.next();
    this.redraw();
  };

  private readonly pluginUpdate = (fen: FEN) => {
    // If controller and chessground board states differ, ignore this update. Once the chessground
    // state is updated to match, pluginUpdate will be called again.
    if (!this.board || !fen.startsWith(positionToFen(this.board.position(), standardXiangqi).split(' ')[0]))
      return;
    this.keyboardMove?.update({ fen, canMove: true, board: this.board });
  };

  showBestMoveArrows = () => this.settings.showBestMoveArrows && !this.retro?.hideComputerLine(this.node);

  private readonly resetAutoShapes = () => {
    if (
      this.showBestMoveArrows() ||
      this.settings.showMoveAnnotationsOnBoard ||
      this.settings.showVariationArrows ||
      (this.motifEnabled() && this.motif.any())
    )
      this.setAutoShapes();
    else this.board?.setMarks([], 'annotation');
  };

  private readonly ensureServerEvalNodes = (node: TreeNode) => {
    if (node.eval && !node.eval.knodes && this.data.analysis?.nodesPerMove)
      node.eval.knodes = this.data.analysis.nodesPerMove / 1000;
  };
  private async mergeIdbThenShowTreeView() {
    await this.idbTree.merge();
    this.treeView.hidden = false;
    this.idbTree.revealNode();
    this.redraw();
  }
}
