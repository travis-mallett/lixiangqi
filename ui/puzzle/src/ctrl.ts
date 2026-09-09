import { Result } from '@badrap/result';
import type { DrawShape } from '@lichess-org/chessground/draw';
import { uciToMove } from '@lichess-org/chessground/util';
import { Chess, normalizeMove } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { parseFen, makeFen } from 'chessops/fen';
import { makeSanAndPlay } from 'chessops/san';
import type { Role, Move, Outcome } from 'chessops/types';
import { parseSquare, parseUci, makeSquare, makeUci, opposite } from 'chessops/util';
import { ctrl as makeKeyboardMove, type KeyboardMove, type KeyboardMoveRootCtrl } from 'keyboard-move';
import { makeVoiceMove, type VoiceMove } from 'voice';
import {
  hydrateXiangqiState,
  legalMoveDests,
  playXiangqiMoveSound,
  requestXiangqi,
  uciMoveToCg,
  uciToCg,
  type RulesState,
  type XiangqiGroundOptions,
} from 'xiangqi';

import { prop, type Prop, propWithEffect, type Toggle, toggle, requestIdleCallbackSafe, myUserId } from 'lib';
import { type Deferred, defer, throttle } from 'lib/async';
import { CevalCtrl } from 'lib/ceval';
import type { CevalHandler } from 'lib/ceval/types';
import { selectXiangqiNotation } from 'lib/game';
import { plyColor } from 'lib/game/chess';
import { type WithGround } from 'lib/game/ground';
import { PromotionCtrl } from 'lib/game/promotion';
import { playMoveNavigationSound } from 'lib/game/replay/moveNavigationSound';
import { pubsub } from 'lib/pubsub';
import { type StoredProp, storedBooleanProp, storedBooleanPropWithEffect, storage } from 'lib/storage';
import { makeTree, treeOps, treePath, type TreeWrapper } from 'lib/tree';
import { completeNode } from 'lib/tree/node';
import { last } from 'lib/tree/ops';
import type { TreeNode, TreePath } from 'lib/tree/types';
import { alert } from 'lib/view';
import { toggleZenMode } from 'lib/view/zen';

import computeAutoShapes from './autoShape';
import type {
  PuzzleOpts,
  PuzzleData,
  MoveTest,
  ThemeKey,
  ReplayEnd,
  PuzzleRound,
  RoundThemes,
  XiangqiMoveTest,
} from './interfaces';
import keyboard from './keyboard';
import moveTest from './moveTest';
import { pgnToTree, mergeSolution, nextCorrectMove } from './moveTree';
import Report from './report';
import PuzzleSession from './session';
import PuzzleStreak from './streak';
import * as xhr from './xhr';
import {
  buildXiangqiTree,
  makeXiangqiNode,
  nextXiangqiMove,
  splitXiangqiUci,
  type XiangqiPuzzleNode,
} from './xiangqi';
import {
  adjudicateAlternative,
  hasUsableScore,
  isEfficientMate,
  makeObjective,
  playerMoveAllowance,
  storedLineProgress,
  terminalDecision,
  winningContinuation,
  type PuzzleObjective,
  type PuzzleFailure,
} from './xiangqiAdjudication';
import XiangqiPuzzleEngine from './xiangqiPuzzleEngine';

interface XiangqiMoveResponse extends RulesState {
  notation: string;
  chineseNotation: string;
}

export default class PuzzleCtrl implements CevalHandler {
  data: PuzzleData;
  next: Deferred<PuzzleData | ReplayEnd> = defer<PuzzleData>();
  tree: TreeWrapper;
  ceval: CevalCtrl;
  autoNext: StoredProp<boolean>;
  rated: StoredProp<boolean>;
  ground: Prop<CgApi> = prop<CgApi | undefined>(undefined) as Prop<CgApi>;
  threatMode: Toggle = toggle(false);
  streak?: PuzzleStreak;
  streakFailStorage = storage.make('puzzle.streak.fail');
  session: PuzzleSession;
  menu: Toggle;
  flipped = toggle(false);
  googlyEyes?: () => DrawShape[];
  keyboardMove?: KeyboardMove;
  voiceMove?: VoiceMove;
  promotion: PromotionCtrl;
  keyboardHelp: Prop<boolean>;
  cgConfig?: CgConfig;
  path: TreePath;
  node: TreeNode;
  nodeList: TreeNode[];
  mainline: TreeNode[];
  initialPath: TreePath;
  initialNode: TreeNode;
  pov: Color;
  mode: 'play' | 'view' | 'try';
  round?: PuzzleRound;
  resultSent: boolean;
  lastFeedback: 'init' | 'fail' | 'win' | 'good' | 'retry';
  canViewSolution = toggle(false);
  showHint = toggle(false);
  hintHasBeenShown = toggle(false);
  voted?: boolean;
  autoScrollRequested: boolean;
  autoScrollNow: boolean;
  isDaily: boolean;
  blindfolded: StoredProp<boolean>;
  cgVersion = 1;
  isXiangqi = false;
  private xiangqiBusy = false;
  xiangqiEvaluating = false;
  xiangqiFailure?: PuzzleFailure;
  xiangqiBestMove = true;
  solvedMoves = 0;
  xiangqiEngineError = false;
  private xiangqiObjective?: PuzzleObjective;
  private xiangqiAllowance = 0;
  private xiangqiReady = false;
  xiangqiContinuation: string[] = [];
  private xiangqiEngine?: XiangqiPuzzleEngine;
  private xiangqiGeneration = 0;
  private xiangqiReplyPending = false;
  xiangqiRetry?: () => void;
  private readonly xiangqiHydrations = new WeakMap<TreeNode, Promise<void>>();

  private report: Report;

  constructor(
    readonly opts: PuzzleOpts,
    readonly redraw: Redraw,
  ) {
    this.pref = opts.pref;
    this.allThemes = opts.themes && {
      dynamic: opts.themes.dynamic.split(' '),
      static: new Set(opts.themes.static.split(' ')),
    };
    this.rated = storedBooleanPropWithEffect('puzzle.rated', true, this.redraw);
    this.autoNext = storedBooleanProp(
      `puzzle.autoNext${opts.data.streak ? '.streak' : ''}`,
      !!opts.data.streak,
    );
    this.blindfolded = storedBooleanProp(`puzzle.${myUserId() || 'anon'}.blindfolded`, false);
    this.streak = opts.data.streak ? new PuzzleStreak(opts.data) : undefined;
    if (this.streak) {
      opts.data = { ...opts.data, ...this.streak.data.current };
      this.streakFailStorage.listen(_ => this.failStreak(this.streak!));
    }
    this.session = new PuzzleSession(opts.data.angle.key, myUserId(), !!opts.data.streak);
    this.menu = toggle(false, redraw);

    this.initiate(opts.data);
    this.promotion = new PromotionCtrl(
      this.withGround,
      () => this.withGround(g => g.set(this.cgConfig!)),
      redraw,
    );

    this.ceval = new CevalCtrl({
      redraw: this.redraw,
      variant: {
        short: 'Std',
        name: 'Standard',
        key: 'standard',
      },
      externalEngines:
        this.data.externalEngines?.map(engine => ({
          ...engine,
          endpoint: this.opts.externalEngineEndpoint,
        })) || [],
      initialFen: undefined, // always standard starting position
      emit: (ev, meta) => {
        this.tree.updateAt(meta.path, node => {
          if (meta.threatMode) {
            const threat = ev;
            if (!node.threat || node.threat.depth <= threat.depth) node.threat = threat;
          } else if (!node.ceval || node.ceval.depth <= ev.depth) node.ceval = ev;
          if (meta.path === this.path) {
            this.report.checkForMultipleSolutions(ev, this, meta.threatMode);
            this.setAutoShapes();
            this.redraw();
          }
        });
      },
      onUciHover: this.setAutoShapes,
    });

    this.keyboardHelp = propWithEffect(location.hash === '#keyboard', this.redraw);
    keyboard(this);
    this.report = new Report();

    // If the page loads while being hidden (like when changing settings),
    // chessground is not displayed, and the first move is not fully applied.
    // Make sure chessground is fully shown when the page goes back to being visible.
    document.addEventListener('visibilitychange', () =>
      requestIdleCallbackSafe(() => this.jump(this.path), 500),
    );

    pubsub.on('zen', toggleZenMode);
    window.addEventListener('pagehide', () => {
      this.cancelXiangqiWork();
      this.xiangqiEngine?.destroy();
      this.xiangqiEngine = undefined;
    });
    $('body').addClass('playing'); // for zen
    $('#zentog').on('click', () => pubsub.emit('zen'));
    (window as any).lichess.puzzle = {
      playUci: (uci: Uci) => this.playUci(uci),
    };
    (window as any).lichess.chessground = this.ground;
  }

  private readonly loadSound = (name: string, volume?: number) => {
    site.sound.load(name);
    return () => site.sound.play(name, volume);
  };
  sound = {
    good: this.loadSound('puzzleStormGood', 0.7),
    end: this.loadSound('puzzleStormEnd', 1),
  };

  setPath = (path: TreePath): void => {
    this.path = path;
    this.nodeList = this.tree.getNodeList(path);
    this.node = treeOps.last(this.nodeList)!;
    this.mainline = treeOps.mainlineNodeList(this.tree.root);
    this.showHint(false);
  };

  setChessground = (cg: CgApi): void => {
    this.ground(cg);
    if (this.isXiangqi) {
      requestAnimationFrame(() => this.redraw());
      return;
    }
    const makeRoot = (): KeyboardMoveRootCtrl => ({
      data: {
        game: { variant: { key: 'standard' } },
        player: { color: this.pov },
      },
      pluginMove: this.pluginMove,
      redraw: this.redraw,
      flipNow: this.flip,
      userJumpPlyDelta: this.userJumpPlyDelta,
      nextPuzzle: this.nextPuzzle,
      vote: this.vote,
      solve: this.viewSolution,
      blindfold: this.blindfold,
    });
    const up = { fen: this.node.fen, canMove: true, cg };
    if (this.opts.pref.voiceMove) {
      if (this.voiceMove) this.voiceMove.update(up);
      else this.voiceMove = makeVoiceMove(makeRoot(), up);
    }
    if (this.opts.pref.keyboardMove) {
      if (!this.keyboardMove) this.keyboardMove = makeKeyboardMove(makeRoot());
      this.keyboardMove.update(up);
    }
    requestAnimationFrame(() => this.redraw());
    pubsub.on('board.change', () => {
      this.withGround(g => {
        g.redrawAll();
      });
      this.setAutoShapes();
    });

    this.googlyEyesAuto();
  };

  googlyEyesStart: () => void = () => {
    if (!this.googlyEyes)
      this.withGround(cg => {
        site.asset
          .loadEsm('bits.googlyHorsey', {
            init: { cg, redraw: this.setAutoShapes },
          })
          .then(({ makeGooglyShapes }: { makeGooglyShapes: () => DrawShape[] }) => {
            this.googlyEyes = makeGooglyShapes;
            this.setAutoShapes();
          });
      });
  };

  private readonly googlyEyesAuto = () => {
    if (this.isDaily && new Date().getMonth() === 3 && new Date().getDate() === 1) this.googlyEyesStart();
  };

  pref: PuzzleOpts['pref'];

  withGround: WithGround = f => {
    const g = this.ground();
    return g ? f(g) : undefined;
  };

  initiate = (fromData: PuzzleData): void => {
    this.cancelXiangqiWork();
    this.xiangqiObjective = undefined;
    this.xiangqiFailure = undefined;
    this.xiangqiBestMove = true;
    this.solvedMoves = 0;
    this.xiangqiEngineError = false;
    this.data = fromData;
    this.xiangqiContinuation = [...fromData.puzzle.solution];
    this.isXiangqi = fromData.variant === 'xiangqi';
    this.xiangqiReady = !this.isXiangqi || this.xiangqiMatingPuzzle();
    this.xiangqiAllowance = playerMoveAllowance(this.data.puzzle.solution, this.xiangqiMatingPuzzle());
    this.tree = makeTree(
      this.isXiangqi
        ? buildXiangqiTree(this.data, this.pref.notationStyle)
        : pgnToTree(this.data.game.pgn.split(' ')),
    );
    const initialPath = treePath.fromNodeList(treeOps.mainlineNodeList(this.tree.root));
    this.mode = 'play';
    this.next = defer();
    this.round = undefined;
    this.resultSent = false;
    this.lastFeedback = 'init';
    this.initialPath = initialPath;
    this.initialNode = this.tree.nodeAtPath(initialPath);
    if (this.isXiangqi && this.xiangqiMatingPuzzle())
      this.xiangqiObjective = makeObjective(this.initialNode.fen, this.data.puzzle.solution, undefined, true);
    this.pov = this.isXiangqi
      ? (this.initialNode as XiangqiPuzzleNode).xiangqi.turn === 'black'
        ? 'black'
        : 'white'
      : plyColor(this.initialNode.ply);
    this.isDaily = !!this.data.isDaily;
    this.hintHasBeenShown(false);
    this.canViewSolution(false);
    this.report = new Report();
    this.voted = undefined;

    this.setPath(site.blindMode ? initialPath : treePath.init(initialPath));
    const generation = this.xiangqiGeneration;
    setTimeout(
      () => {
        if (generation !== this.xiangqiGeneration) return;
        this.jump(initialPath);
        this.redraw();
      },
      this.opts.pref.animation.duration > 0 ? 500 : 0,
    );

    // just to delay button display
    setTimeout(
      () => {
        if (generation !== this.xiangqiGeneration) return;
        this.canViewSolution(true);
        this.redraw();
      },
      this.rated() ? 4000 : 2000,
    );

    this.withGround(g => {
      g.selectSquare(null);
      g.setAutoShapes([]);
      g.setShapes([]);
      this.showGround(g);
    });
    if (this.isXiangqi && (this.node as XiangqiPuzzleNode).xiangqi.needsHydration)
      void this.hydrateXiangqiPosition(initialPath);
    if (!this.xiangqiReady) void this.prepareXiangqiObjective();
  };

  private readonly loadXiangqiObjective = async (): Promise<PuzzleObjective> => {
    const initialFen = this.initialNode.fen;
    const solution = this.data.puzzle.solution;
    const mating = this.xiangqiMatingPuzzle();
    const starting = await (this.xiangqiEngine ??= new XiangqiPuzzleEngine()).evaluate(initialFen, {
      initialFen: this.tree.root.fen,
      moves: this.tree
        .getNodeList(this.initialPath)
        .slice(1)
        .map(node => node.uci!),
    });
    return makeObjective(initialFen, solution, starting, mating);
  };

  // Metadata-less puzzles need their starting classification before any move.
  // Otherwise discovering mate later could shrink an already-used allowance.
  private readonly prepareXiangqiObjective = async (): Promise<void> => {
    const generation = this.xiangqiGeneration;
    this.xiangqiBusy = true;
    this.xiangqiEvaluating = true;
    this.xiangqiEngineError = false;
    this.xiangqiRetry = undefined;
    this.redraw();
    try {
      const objective = await this.loadXiangqiObjective();
      if (generation !== this.xiangqiGeneration) return;
      this.xiangqiObjective = objective;
      this.xiangqiAllowance = objective.allowance;
      this.xiangqiReady = true;
    } catch (error) {
      if (generation !== this.xiangqiGeneration) return;
      console.error(error);
      this.xiangqiEngineError = true;
      this.xiangqiRetry = () => {
        if (generation === this.xiangqiGeneration) void this.prepareXiangqiObjective();
      };
    } finally {
      if (generation === this.xiangqiGeneration) {
        this.xiangqiBusy = false;
        this.xiangqiEvaluating = false;
        this.withGround(this.showGround);
        this.redraw();
      }
    }
  };

  private readonly hydrateXiangqiPosition = (path: TreePath): Promise<void> => {
    const node = this.tree.nodeAtPath(path) as XiangqiPuzzleNode;
    if (!node.xiangqi.needsHydration) return Promise.resolve();
    const existing = this.xiangqiHydrations.get(node);
    if (existing) return existing;
    const fen = node.xiangqi.fen;
    const hydration = (async () => {
      try {
        const state = await hydrateXiangqiState(node.xiangqi);
        if (node.xiangqi.fen !== fen) return;
        node.xiangqi = state;
        node.fen = state.fen;
        node.ply = state.ply;
        node.dests = () => legalMoveDests(state.legalMoves) as Dests;
        node.check = () => state.check;
        if (this.path === path) this.withGround(this.showGround);
      } catch (error) {
        console.error('Could not hydrate Xiangqi puzzle position', error);
      } finally {
        this.xiangqiHydrations.delete(node);
      }
    })();
    this.xiangqiHydrations.set(node, hydration);
    return hydration;
  };

  private readonly playXiangqiSound = (path: TreePath): void => {
    const node = this.tree.nodeAtPath(path) as XiangqiPuzzleNode;
    const play = () => {
      if (this.path === path) playXiangqiMoveSound(node.xiangqi);
    };
    if (node.xiangqi.needsHydration) void this.hydrateXiangqiPosition(path).then(play);
    else play();
  };

  position = (): Chess => {
    const setup = parseFen(this.node.fen).unwrap();
    return Chess.fromSetup(setup).unwrap();
  };

  makeCgOpts = (): CgConfig => {
    const node = this.node;
    const color = plyColor(node.ply);
    const dests = chessgroundDests(this.position());
    const nextNode = this.node.children[0];
    const canMove = this.mode === 'view' || (color === this.pov && (!nextNode || nextNode.puzzle === 'fail'));
    const movable = canMove
      ? {
          color: dests.size > 0 ? color : undefined,
          dests,
        }
      : {
          color: undefined,
          dests: new Map(),
        };

    const config = {
      fen: node.fen,
      orientation: this.flipped() ? opposite(this.pov) : this.pov,
      turnColor: color,
      movable,
      premovable: {
        enabled: false,
      },
      check: node.check(),
      lastMove: uciToMove(node.uci),
    };
    if (node.ply >= this.initialNode.ply) {
      if (this.mode !== 'view' && color !== this.pov && !nextNode) {
        config.movable.color = this.pov;
        config.premovable.enabled = true;
      }
    }
    this.cgConfig = config;
    return config;
  };

  makeXiangqiGroundOpts = (): XiangqiGroundOptions => {
    const node = this.node as XiangqiPuzzleNode;
    const state =
      this.path === this.initialPath && this.data.puzzle.state ? this.data.puzzle.state : node.xiangqi;
    const color: Color = state.turn === 'black' ? 'black' : 'white';
    const canMove =
      !this.xiangqiBusy &&
      (this.mode === 'view' || (this.xiangqiReady && !this.moveAllowanceExceeded() && color === this.pov));
    return {
      fen: state.fen,
      orientation: this.flipped() ? opposite(this.pov) : this.pov,
      turnColor: color,
      movableColor: canMove && state.legalMoves.length ? color : undefined,
      legalMoves: canMove ? state.legalMoves : [],
      lastMove: node.uci,
      coordinates: true,
      animationDuration: this.pref.animation.duration,
      moveEvent: this.pref.moveEvent,
      highlight: this.pref.highlight,
      viewOnly: false,
      ply: node.ply,
    };
  };

  showGround = (g: CgApi): void => {
    if (this.isXiangqi) {
      const opts = this.makeXiangqiGroundOpts();
      g.set({
        fen: opts.fen,
        orientation: opts.orientation,
        turnColor: opts.turnColor,
        lastMove: opts.lastMove ? uciMoveToCg(opts.lastMove) : undefined,
        movable: {
          color: opts.movableColor,
          dests: legalMoveDests(opts.legalMoves || []),
        },
      } as CgConfig);
    } else g.set(this.makeCgOpts());
    this.setAutoShapes();
  };

  pluginMove = (orig: Key, dest: Key, role?: Role) => {
    if (role) this.playUserMove(orig, dest, role);
    else
      this.withGround(g => {
        g.move(orig, dest);
        g.state.movable.dests = undefined;
        g.state.turnColor = opposite(g.state.turnColor);
      });
  };

  pluginUpdate = (fen: string): void => {
    this.voiceMove?.update({ fen, canMove: true });
    this.keyboardMove?.update({ fen, canMove: true });
  };

  userMove = (orig: Key, dest: Key): void => {
    const isPromoting = this.promotion.start(orig, dest, {
      submit: this.playUserMove,
      show: this.voiceMove?.promotionHook(),
    });
    if (!isPromoting) this.playUserMove(orig, dest);
    this.pluginUpdate(this.node.fen);
  };

  playUci = (uci: Uci): void => {
    if (this.isXiangqi) void this.playXiangqiUciAt(this.path, uci);
    else this.sendMove(parseUci(uci)!);
  };

  playUciList = (uciList: Uci[]): void => uciList.forEach(this.playUci);

  playUserMove = (orig: Key, dest: Key, promotion?: Role): void =>
    this.sendMove({
      from: parseSquare(orig)!,
      to: parseSquare(dest)!,
      promotion,
    });

  sendMove = (move: Move): void => this.sendMoveAt(this.path, this.position(), move);

  userXiangqiMove = (uci: string): void => {
    if (!this.xiangqiBusy && !this.xiangqiReplyPending) void this.playXiangqiUciAt(this.path, uci);
  };

  private readonly cancelXiangqiWork = (): void => {
    this.xiangqiGeneration++;
    this.xiangqiEngine?.stop();
    this.xiangqiBusy = false;
    this.xiangqiEvaluating = false;
    this.xiangqiReplyPending = false;
    this.xiangqiRetry = undefined;
  };

  private readonly playXiangqiUciAt = async (path: TreePath, uci: string): Promise<void> => {
    if (this.xiangqiBusy || (this.mode !== 'view' && (!this.xiangqiReady || this.moveAllowanceExceeded())))
      return;
    this.xiangqiBusy = true;
    this.xiangqiEngineError = false;
    this.xiangqiRetry = undefined;
    const generation = this.xiangqiGeneration;
    const mode = this.mode;
    const parent = this.tree.nodeAtPath(path);
    try {
      const state = await requestXiangqi<XiangqiMoveResponse>('/api/analysis/move', {
        initialFen: this.tree.root.fen,
        moves: this.tree
          .getNodeList(path)
          .slice(1)
          .map(node => node.uci!),
        move: uci,
      });
      if (generation !== this.xiangqiGeneration || this.path !== path || this.mode !== mode) return;
      const notation = selectXiangqiNotation(state.notation, state.chineseNotation, this.pref.notationStyle);
      this.addNode(makeXiangqiNode(state, uci, notation || uci, parent.children.length), path);
      const playedNode = this.node as XiangqiPuzzleNode;
      playedNode.played ??= { notation: state.notation, chineseNotation: state.chineseNotation };
      await this.adjudicateXiangqi();
      if (mode !== 'view') playedNode.played.result = playedNode.puzzle;
    } catch (error) {
      if (generation !== this.xiangqiGeneration) return;
      console.error(error);
      if (this.mode === mode) this.jump(path);
      this.xiangqiEngineError = true;
      this.xiangqiRetry = () => {
        if (generation === this.xiangqiGeneration && this.mode === mode) {
          this.jump(path);
          void this.playXiangqiUciAt(path, uci);
        }
      };
    } finally {
      if (generation === this.xiangqiGeneration) {
        this.xiangqiBusy = false;
        this.xiangqiEvaluating = false;
        this.withGround(this.showGround);
        this.redraw();
      }
    }
  };

  private readonly adjudicateXiangqi = async (): Promise<void> => {
    if (this.mode === 'view' || !treePath.contains(this.path, this.initialPath)) return;
    const played = this.nodeList.slice(treePath.size(this.initialPath) + 1).map(node => node.uci!);
    const state = (this.node as XiangqiPuzzleNode).xiangqi;
    const stored = storedLineProgress(this.xiangqiContinuation, played);
    const playerMoved = played.length % 2 === 1;
    const terminal = terminalDecision(
      state,
      this.pov === 'white' ? 'red' : 'black',
      Math.ceil(played.length / 2),
      this.xiangqiAllowance,
    );
    if (terminal) {
      this.node.puzzle = terminal.result === 'win' ? 'win' : 'fail';
      this.xiangqiFailure = terminal.result === 'fail' ? terminal.reason : undefined;
      this.applyProgress(this.node.puzzle);
      return;
    }
    if (stored.kind !== 'alternative') {
      this.xiangqiFailure = undefined;
      if (stored.kind === 'win') {
        this.node.puzzle = 'win';
        this.applyProgress('win');
      } else if (stored.kind === 'reply') {
        this.xiangqiBestMove = true;
        this.node.puzzle = 'good';
        this.applyProgress({ uci: stored.uci, path: this.path });
      }
      return;
    }
    // Opponent moves are already selected by the adjudication search. Only terminal
    // replies require another decision; the next player move will be evaluated.
    if (!playerMoved && state.gameResult === '*') return;
    const generation = this.xiangqiGeneration;
    const path = this.path;
    const mode = this.mode;
    const current = () => generation === this.xiangqiGeneration && path === this.path && mode === this.mode;
    this.xiangqiEvaluating = true;
    this.redraw();
    const engine = (this.xiangqiEngine ??= new XiangqiPuzzleEngine());
    const objective = this.xiangqiObjective!;
    const evaluation =
      state.gameResult === '*'
        ? await engine.evaluate(state.fen, {
            initialFen: this.tree.root.fen,
            moves: this.nodeList.slice(1).map(node => node.uci!),
          })
        : undefined;
    if (!current()) return;
    if (!objective.mate && evaluation && !hasUsableScore(evaluation))
      throw new Error('Pikafish returned no usable puzzle score');
    const continuation =
      objective.mate && evaluation
        ? await winningContinuation(objective, state, evaluation, Math.ceil(played.length / 2), {
            initialFen: this.tree.root.fen,
            moves: this.nodeList.slice(1).map(node => node.uci!),
          })
        : undefined;
    if (!current()) return;
    const decision = adjudicateAlternative(
      objective,
      state,
      evaluation,
      Math.ceil(played.length / 2),
      continuation,
    );
    if (decision.result === 'continue') {
      const reply = continuation?.moves[0] ?? evaluation?.bestMove;
      if (!reply || !state.legalMoves.includes(reply)) throw new Error('Pikafish returned no legal reply');
      this.xiangqiFailure = undefined;
      this.xiangqiBestMove =
        !!continuation &&
        isEfficientMate(this.xiangqiContinuation, played, continuation, evaluation!.score, objective.player);
      if (continuation) this.xiangqiContinuation = [...played, ...continuation.moves];
      this.node.puzzle = 'good';
      this.applyProgress({ uci: reply, path });
    } else {
      this.node.puzzle = decision.result;
      this.xiangqiFailure = decision.result === 'fail' ? decision.reason : undefined;
      if (this.xiangqiFailure) site.sound.say(i18n.puzzle[this.xiangqiFailure]);
      this.applyProgress(decision.result);
    }
    this.reorderChildren(treePath.init(path));
  };

  private readonly xiangqiMatingPuzzle = (): boolean =>
    this.data.puzzle.mateIn !== undefined ||
    this.data.puzzle.themes.some(theme => theme.toLowerCase().includes('mate'));

  sendMoveAt = (path: TreePath, pos: Chess, move: Move): void => {
    move = normalizeMove(pos, move);
    const san = makeSanAndPlay(pos, move);
    this.addNode(
      completeNode('standard')({
        ply: 2 * (pos.fullmoves - 1) + (pos.turn === 'white' ? 0 : 1),
        fen: makeFen(pos.toSetup()),
        uci: makeUci(move),
        san,
        pos: () => Result.ok(pos),
      }),
      path,
    );
  };

  addNode = (node: TreeNode, path: TreePath): void => {
    const newPath = this.tree.addNode(node, path)!;
    this.jump(newPath);
    this.withGround(g => g.playPremove());

    const progress = this.isXiangqi ? undefined : moveTest(this);
    this.setAutoShapes();
    if (progress === 'fail') site.sound.say(i18n.puzzle.failed);
    if (progress) this.applyProgress(progress);
    this.reorderChildren(path);
    this.redraw();
  };

  reorderChildren = (path: TreePath, recursive?: boolean): void => {
    const node = this.tree.nodeAtPath(path);
    node.children.sort((c1, _) => {
      const p = c1.puzzle;
      if (p === 'fail') return 1;
      if (p === 'good' || p === 'win') return -1;
      return 0;
    });
    if (recursive) node.children.forEach(child => this.reorderChildren(path + child.id, true));
  };

  private readonly instantRevertUserMove = (): void => {
    this.withGround(g => {
      g.cancelPremove();
      g.selectSquare(null);
    });
    const afterOpponentReply =
      this.isXiangqi && (treePath.size(this.path) - treePath.size(this.initialPath)) % 2 === 0;
    this.jump(treePath.init(afterOpponentReply ? treePath.init(this.path) : this.path));
    this.redraw();
  };

  revertUserMove = (): void => {
    if (site.blindMode) this.instantRevertUserMove();
    else {
      const path = this.path;
      const generation = this.xiangqiGeneration;
      setTimeout(() => {
        if (this.path === path && generation === this.xiangqiGeneration) this.instantRevertUserMove();
      }, 300);
    }
  };

  applyProgress = (progress: undefined | 'fail' | 'win' | MoveTest | XiangqiMoveTest): void => {
    if (progress === 'fail') {
      this.lastFeedback = 'fail';
      if (!this.moveAllowanceExceeded()) this.revertUserMove();
      if (this.mode === 'play') {
        if (this.streak) {
          this.failStreak(this.streak);
          this.streakFailStorage.fire();
        } else {
          this.canViewSolution(true);
          this.mode = 'try';
          this.sendResult(false);
        }
      }
    } else if (progress === 'win') {
      this.solvedMoves = Math.ceil((treePath.size(this.path) - treePath.size(this.initialPath)) / 2);
      if (this.isXiangqi) site.sound.say(this.solvedMessage());
      if (this.streak) this.sound.good();
      this.lastFeedback = 'win';
      if (this.mode !== 'view') {
        const sent = this.mode === 'play' ? this.sendResult(true) : Promise.resolve();
        this.mode = 'view';
        this.withGround(this.showGround);
        sent.then(_ => (this.autoNext() ? this.nextPuzzle() : this.startCeval()));
      }
    } else if (progress) {
      this.lastFeedback = 'good';
      if (this.isXiangqi) (this.node as XiangqiPuzzleNode).puzzleBestMove = this.xiangqiBestMove;
      const generation = this.xiangqiGeneration;
      const mode = this.mode;
      if ('uci' in progress) this.xiangqiReplyPending = true;
      setTimeout(
        () => {
          if ('uci' in progress) {
            if (generation === this.xiangqiGeneration && mode === this.mode && this.path === progress.path) {
              this.xiangqiReplyPending = false;
              void this.playXiangqiUciAt(progress.path, progress.uci);
            }
          } else {
            const pos = Chess.fromSetup(parseFen(progress.fen).unwrap()).unwrap();
            this.sendMoveAt(progress.path, pos, progress.move);
          }
        },
        this.isXiangqi
          ? this.opts.pref.animation.duration
          : this.opts.pref.animation.duration * (this.autoNext() ? 1 : 1.5),
      );
    }
  };

  failStreak = (streak: PuzzleStreak): void => {
    this.mode = 'view';
    streak.onComplete(false);
    setTimeout(this.viewSolution, 500);
    this.sound.end();
  };

  sendResult = async (win: boolean): Promise<void> => {
    if (this.resultSent) return Promise.resolve();
    this.resultSent = true;
    this.session.complete(this.data.puzzle.id, win);
    const res = await xhr.complete(
      this.data.puzzle.id,
      this.data.angle.key,
      win,
      this.rated() && !this.hintHasBeenShown(),
      this.data.replay,
      this.streak,
      this.opts.settings.color,
    );
    const next = res.next;
    if (next?.user && this.data.user) {
      this.data.user.rating = next.user.rating;
      this.data.user.provisional = next.user.provisional;
      this.round = res.round;
      if (res.round?.ratingDiff) this.session.setRatingDiff(this.data.puzzle.id, res.round.ratingDiff);
    }
    if (win && !this.isXiangqi) site.sound.say(i18n.puzzle.puzzleSuccess);
    if (next) {
      this.next.resolve(this.data.replay && res.replayComplete ? this.data.replay : next);
      if (this.streak && win) this.streak.onComplete(true, res.next);
    }
    this.redraw();
    if (!next && !this.data.replay) {
      await alert('No more puzzles available! Try another theme.');
      site.redirect('/training/themes');
    }
  };

  private readonly isPuzzleData = (d: PuzzleData | ReplayEnd): d is PuzzleData => 'puzzle' in d;

  moveAllowanceExceeded = (): boolean => this.xiangqiFailure === 'moveAllowanceExceeded';

  solvedMessage = (): string =>
    `${i18n.puzzle.solvedInMoves(this.solvedMoves)} ${i18n.puzzle.efficientSolutionMoves(Math.ceil(this.data.puzzle.solution.length / 2))}`;

  retryPuzzle = (): void => {
    if (!this.isXiangqi || !this.moveAllowanceExceeded()) return;
    this.cancelXiangqiWork();
    this.ceval.reset();
    this.initialNode.children = [];
    this.xiangqiContinuation = [...this.data.puzzle.solution];
    this.xiangqiFailure = undefined;
    this.xiangqiEngineError = false;
    this.xiangqiBestMove = true;
    this.solvedMoves = 0;
    this.lastFeedback = 'init';
    this.mode = 'try';
    this.showHint(false);
    this.jump(this.initialPath);
    this.withGround(g => {
      g.cancelPremove();
      g.selectSquare(null);
      g.setShapes([]);
    });
    this.redraw();
  };

  nextPuzzle = (): void => {
    if (this.streak && this.lastFeedback !== 'win') {
      if (this.lastFeedback === 'fail') site.redirect(this.routerWithLang('/streak'));
      return;
    }
    if (this.mode !== 'view') return;

    this.ceval.reset();
    this.next.promise.then(n => {
      if (this.isPuzzleData(n)) {
        this.initiate(n);
        this.redraw();
      }
    });

    if (this.data.replay && this.round === undefined) {
      site.redirect(`/training/dashboard/${this.data.replay.days}`);
    }

    if (!this.streak && !this.data.replay) {
      const path = this.routerWithLang(`/training/${this.data.angle.key}`);
      if (location.pathname !== path) history.replaceState(null, '', path);
    }
  };

  setAutoShapes = (): void =>
    this.withGround(g => {
      if (this.isXiangqi) {
        const move = this.showHint() ? nextXiangqiMove(this) : undefined;
        const squares = move && splitXiangqiUci(move);
        g.setAutoShapes(
          squares ? ([{ orig: uciToCg(squares[0]) as Key, brush: 'green' }] as DrawShape[]) : [],
        );
      } else
        g.setAutoShapes(
          computeAutoShapes({
            ...this,
            node: this.node,
            hint: this.hintSquare(),
          }),
        );
    });

  hintSquare = () => {
    if (this.isXiangqi) return undefined;
    const hint = this.showHint() ? nextCorrectMove(this) : undefined;
    return hint?.from;
  };

  isCevalAllowed = (): boolean => !this.isXiangqi && this.mode === 'view';

  startCeval = (): void => {
    if (this.cevalEnabled()) this.doStartCeval();
  };

  private readonly doStartCeval = throttle(800, () => {
    this.ceval.reset();
    this.ceval.start(this.path, this.nodeList, this.data.puzzle.id, this.threatMode());
  });

  nextNodeBest = () => treeOps.withMainlineChild(this.node, n => n.eval?.best);

  cevalEnabledProp = storedBooleanProp('engine.enabled', false);
  cevalEnabled = (enable?: boolean) => {
    if (enable === undefined) return this.cevalEnabledProp() && this.isCevalAllowed();
    this.cevalEnabledProp(enable);
    if (enable && this.isCevalAllowed()) this.startCeval();
    else {
      this.threatMode(false);
      this.ceval.reset();
    }
    this.autoScrollRequested = true;
    this.setAutoShapes();
    this.ceval.showEnginePrefs(false);
    this.redraw();
    return enable;
  };

  clearCeval(): void {
    this.tree.removeCeval();
    this.ceval.reset();
    this.startCeval();
    this.redraw();
  }

  toggleThreatMode = (): void => {
    if (this.node.check()) return;
    if (!this.cevalEnabled()) return;
    this.threatMode.toggle();
    this.setAutoShapes();
    this.startCeval();
    this.redraw();
  };

  outcome = (): Outcome | undefined => (this.isXiangqi ? undefined : this.position().outcome());

  jump = (path: TreePath): void => {
    const pathChanged = path !== this.path;
    const previousPly = this.node.ply;
    this.setPath(path);
    this.withGround(this.showGround);
    if (pathChanged) {
      playMoveNavigationSound(previousPly, this.node.ply, () => {
        if (this.isXiangqi) this.playXiangqiSound(path);
        else {
          site.sound.saySan(this.node.san);
          site.sound.move({ san: this.node.san });
        }
      });
      this.threatMode(false);
      this.ceval.reset();
      this.startCeval();
    }
    if (!this.isXiangqi) this.promotion.cancel();
    this.autoScrollRequested = true;
    this.pluginUpdate(this.node.fen);
    pubsub.emit('ply', this.node.ply);
  };

  userJump = (path: TreePath): void => {
    if (this.isXiangqi && (this.xiangqiBusy || this.xiangqiReplyPending)) return;
    if (this.tree.nodeAtPath(path)?.puzzle === 'fail' && this.mode !== 'view') return;
    this.withGround(g => g.selectSquare(null));
    this.jump(path);
  };

  userJumpPlyDelta = (plyDelta: Ply) => {
    // ensure we are jumping to a valid ply
    let maxValidPly = this.mainline.length - 1;
    if (last(this.mainline)?.puzzle === 'fail' && this.mode !== 'view') maxValidPly -= 1;
    const newPly = Math.min(Math.max(this.node.ply + plyDelta, 0), maxValidPly);
    this.userJump(treePath.fromNodeList(this.mainline.slice(0, newPly + 1)));
  };

  toggleHint = (): void => {
    if (this.moveAllowanceExceeded()) return;
    if (!this.showHint()) {
      this.hintHasBeenShown(true);
      this.userJump(treePath.fromNodeList(this.mainline.filter(node => node.puzzle !== 'fail')));
    }
    this.showHint.toggle();
    this.setAutoShapes();
    if (this.isXiangqi) {
      const hint = this.showHint() && nextXiangqiMove(this);
      const squares = hint && splitXiangqiUci(hint);
      this.withGround(g => g.selectSquare(squares ? (uciToCg(squares[0]) as Key) : null));
    } else {
      const hint = this.hintSquare();
      this.withGround(g => g.selectSquare(hint ? makeSquare(hint) : null));
    }
    this.redraw();
  };

  viewSolution = (): void => {
    if (this.isXiangqi) {
      void this.viewXiangqiSolution();
      return;
    }
    this.sendResult(false);
    this.mode = 'view';
    mergeSolution(this.tree, this.initialPath, this.data.puzzle.solution, this.pov);
    this.reorderChildren(this.initialPath, true);

    // try to play the solution next move
    const next = this.node.children[0];
    if (next?.puzzle === 'good') this.userJump(this.path + next.id);
    else {
      const firstGoodPath = treeOps.takePathWhile(this.mainline, node => node.puzzle !== 'good');
      if (firstGoodPath) this.userJump(firstGoodPath + this.tree.nodeAtPath(firstGoodPath).children[0].id);
    }

    this.autoScrollRequested = true;
    this.redraw();
    this.startCeval();
  };

  private readonly viewXiangqiSolution = async (): Promise<void> => {
    this.cancelXiangqiWork();
    this.xiangqiEngineError = false;
    this.sendResult(false);
    this.mode = 'view';
    let path = this.initialPath;
    for (let index = 0; index < this.data.puzzle.solution.length; index++) {
      const uci = this.data.puzzle.solution[index];
      const parent = this.tree.nodeAtPath(path);
      let child = parent.children.find(node => node.uci === uci);
      if (!child) {
        const state = await requestXiangqi<XiangqiMoveResponse>('/api/analysis/move', {
          initialFen: parent.fen,
          moves: [],
          move: uci,
        });
        const notation = selectXiangqiNotation(
          state.notation,
          state.chineseNotation,
          this.pref.notationStyle,
        );
        child = makeXiangqiNode(state, uci, notation || uci, parent.children.length);
        this.tree.addNode(child, path);
      }
      if (index % 2 === 0) child.puzzle = index === this.data.puzzle.solution.length - 1 ? 'win' : 'good';
      path += child.id;
    }
    this.reorderChildren(this.initialPath, true);
    const first = this.tree
      .nodeAtPath(this.initialPath)
      .children.find(node => node.puzzle === 'good' || node.puzzle === 'win');
    if (first) this.userJump(this.initialPath + first.id);
    this.autoScrollRequested = true;
    this.redraw();
  };

  skip = () => {
    if (!this.streak || !this.streak.data.skip || this.mode !== 'play') return;
    this.streak.skip();
    this.userJump(treePath.fromNodeList(this.mainline));
    const moveIndex = treePath.size(this.path) - treePath.size(this.initialPath);
    const solution = this.data.puzzle.solution[moveIndex];
    this.playUci(solution);
    this.playBestMove();
  };

  flip = () => {
    this.flipped.toggle();
    this.cgVersion++;
    this.withGround(g => g.toggleOrientation());
    this.redraw();
  };

  vote = (v: boolean) => {
    xhr.vote(this.data.puzzle.id, v);
    this.voted = this.voted === v ? undefined : v;
    this.redraw();
  };

  voteTheme = (theme: ThemeKey, v: boolean) => {
    if (this.round) {
      this.round.themes = this.round.themes || ({} as RoundThemes);
      if (v === this.round.themes[theme]) {
        delete this.round.themes[theme];
        xhr.voteTheme(this.data.puzzle.id, theme, undefined);
      } else {
        if (v || this.data.puzzle.themes.includes(theme)) this.round.themes[theme] = v;
        else delete this.round.themes[theme];
        xhr.voteTheme(this.data.puzzle.id, theme, v);
      }
      this.redraw();
    }
  };
  blindfold = (v?: boolean): boolean => {
    if (v !== undefined && v !== this.blindfolded()) {
      this.blindfolded(v);
      this.redraw();
    }
    return this.blindfolded();
  };
  playBestMove = (): void => {
    const uci = this.isXiangqi
      ? nextXiangqiMove(this)
      : this.nextNodeBest() || this.node.ceval?.pvs[0].moves[0];
    if (uci) this.playUci(uci);
  };
  autoNexting = () => this.lastFeedback === 'win' && this.autoNext();
  showEvalGauge = () => this.showEvaluation() && this.isCevalAllowed() && !this.outcome();
  getOrientation = () => this.withGround(g => g.state.orientation)!;
  allThemes?: { dynamic: string[]; static: Set<string> };
  toggleRated = () => this.rated(!this.rated());
  getCeval = () => this.ceval;
  ongoing = false;
  getNode = () => this.node;
  showEvaluation = () => !this.isXiangqi && this.mode === 'view';
  routerWithLang = (path: string): string => {
    if (document.body.hasAttribute('data-user')) return path;
    const language = document.documentElement.lang.slice(0, 2);
    return language === 'en' ? path : `/${language}${path}`;
  };
}
