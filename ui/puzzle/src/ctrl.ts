import type {
  BoardView,
  BoardPosition,
  BoardPresentation,
  BoardMark,
  BoardTransition,
} from '@lixiangqi/board';
import { playXiangqiTransitionSound, requestXiangqi, type RulesState } from 'xiangqi';

import { prop, type Prop, propWithEffect, type Toggle, toggle, requestIdleCallbackSafe, myUserId } from 'lib';
import { type Deferred, defer } from 'lib/async';
import { makeBoardResizable, websiteBoardPresentation, xiangqiPosition, xiangqiPlay } from 'lib/board';
import type { PikafishStatus } from 'lib/ceval/engines/pikafishBrowser';
import { pubsub } from 'lib/pubsub';
import { type StoredProp, storedBooleanProp, storedBooleanPropWithEffect, storage } from 'lib/storage';
import { trafficActivity, trafficAttemptId, trackTraffic } from 'lib/traffic';
import { makeTree, treeOps, treePath, type TreeWrapper } from 'lib/tree';
import { last } from 'lib/tree/ops';
import type { TreeNode, TreePath } from 'lib/tree/types';
import { alert } from 'lib/view';
import { toggleZenMode } from 'lib/view/zen';

import { evaluateAlternative, type AlternativeResult } from './alternative';
import { evaluationPercent } from './evaluationProgress';
import type { PuzzleOpts, PuzzleData, ThemeKey, ReplayEnd, PuzzleRound, XiangqiMoveTest } from './interfaces';
import keyboard from './keyboard';
import PuzzleSession from './session';
import { PuzzleSolutions, defenderDelay } from './solutions';
import PuzzleStreak from './streak';
import { parsePuzzleVariant } from './variant';
import * as xhr from './xhr';
import {
  buildXiangqiTree,
  buildSolutionTree,
  makeXiangqiNode,
  nextXiangqiMove,
  splitXiangqiUci,
  type XiangqiPuzzleNode,
} from './xiangqi';
import {
  isEfficientMate,
  makeObjective,
  terminalDecision,
  type PuzzleObjective,
  type PuzzleFailure,
  type PuzzleDecision,
} from './xiangqiAdjudication';
import XiangqiPuzzleEngine from './xiangqiPuzzleEngine';

interface XiangqiMoveResponse extends RulesState {
  notation: string;
  chineseNotation: string;
}

type PuzzleGround = BoardView;
type WithGround = <A>(f: (ground: PuzzleGround) => A) => A | undefined;

export default class PuzzleCtrl {
  private trafficAttempt = trafficAttemptId();
  private trafficStarted = false;
  data: PuzzleData;
  next: Deferred<PuzzleData | ReplayEnd> = defer<PuzzleData>();
  tree: TreeWrapper;
  autoNext: StoredProp<boolean>;
  rated: StoredProp<boolean>;
  ground: Prop<PuzzleGround> = prop<PuzzleGround | undefined>(undefined) as Prop<PuzzleGround>;
  streak?: PuzzleStreak;
  streakFailStorage = storage.make('puzzle.streak.fail');
  session: PuzzleSession;
  menu: Toggle;
  flipped = toggle(false);
  googlyEyes?: () => BoardMark[];
  keyboardHelp: Prop<boolean>;
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
  completed = false;
  showHint = toggle(false);
  hintHasBeenShown = toggle(false);
  voted?: boolean;
  autoScrollRequested: boolean;
  autoScrollNow: boolean;
  isDaily: boolean;
  blindfolded: StoredProp<boolean>;
  cgVersion = 1;
  private xiangqiBusy = false;
  viewingSolution = false;
  private readonly alternatives = new Map<string, AlternativeResult & { bestMove: boolean }>();
  xiangqiEvaluating = false;
  moveEvaluationDepth?: number;
  moveEvaluationPercent = 0;
  xiangqiFailure?: PuzzleFailure;
  xiangqiBestMove = true;
  solvedMoves = 0;
  xiangqiEngineError = false;
  engineStatus: PikafishStatus = { state: 'loading' };
  private xiangqiObjective?: PuzzleObjective;
  private xiangqiAllowance = 0;
  solutions: PuzzleSolutions;
  private readonly xiangqiHints = new Map<string, string>();
  private xiangqiPlayerMoveAt = 0;
  private xiangqiFailedPath?: TreePath;
  xiangqiFailureDetail?: { needed: number; remaining: number };
  private xiangqiEngine?: XiangqiPuzzleEngine;
  private xiangqiGeneration = 0;
  private xiangqiReplyPending = false;
  xiangqiRetry?: () => void;

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
    this.keyboardHelp = propWithEffect(location.hash === '#keyboard', this.redraw);
    keyboard(this);

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
      this.engineStatus = { state: 'loading' };
    });
    window.addEventListener('pageshow', event => {
      if (event.persisted) void this.prepareXiangqiEngine();
    });
    $('body').addClass('playing'); // for zen
    $('#zentog').on('click', () => pubsub.emit('zen'));
    (window as any).lichess.puzzle = {
      playUci: (uci: string) => this.playUci(uci),
    };
    (window as any).lichess.chessground = this.ground;
    void this.prepareXiangqiEngine();
  }

  engineReady = (): boolean => ['ready', 'computing'].includes(this.engineStatus.state);

  private readonly getXiangqiEngine = (): XiangqiPuzzleEngine =>
    (this.xiangqiEngine ??= new XiangqiPuzzleEngine(undefined, status => {
      const wasReady = this.engineReady();
      this.engineStatus = status;
      if (wasReady !== this.engineReady()) this.withGround(this.showGround);
      this.redraw();
    }));

  private readonly prepareXiangqiEngine = async (): Promise<void> => {
    this.engineStatus = { state: 'loading' };
    this.withGround(this.showGround);
    this.redraw();
    const engine = this.getXiangqiEngine();
    try {
      await engine.prepare();
      if (engine !== this.xiangqiEngine) return;
      this.engineStatus = { state: 'ready' };
    } catch (error) {
      if (engine !== this.xiangqiEngine) return;
      console.error(error);
      this.engineStatus = { state: 'error', error: String(error) };
    }
    this.withGround(this.showGround);
    this.redraw();
  };

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

  setBoard = (cg: PuzzleGround): void => {
    this.ground(cg);
    makeBoardResizable(cg);
    this.showGround(cg);
    requestAnimationFrame(() => this.redraw());
    pubsub.on('board.change', () => {
      this.withGround(g => {
        g.redraw();
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
            init: { board: cg, redraw: this.setAutoShapes },
          })
          .then(({ makeGooglyShapes }: { makeGooglyShapes: () => BoardMark[] }) => {
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
    this.trafficAttempt = trafficAttemptId();
    this.trafficStarted = false;
    trafficActivity('puzzle.solve', this.trafficAttempt, { theme: fromData.angle.key });
    trackTraffic('puzzle.presented', {}, {}, this.trafficAttempt);
    this.cancelXiangqiWork();
    this.xiangqiObjective = undefined;
    this.viewingSolution = false;
    this.alternatives.clear();
    this.xiangqiFailure = undefined;
    this.xiangqiBestMove = true;
    this.solvedMoves = 0;
    this.xiangqiEngineError = false;
    this.data = fromData;
    parsePuzzleVariant(fromData.variant);
    this.solutions = new PuzzleSolutions(fromData.puzzle.playback.solutions);
    this.xiangqiHints.clear();
    this.xiangqiFailedPath = undefined;
    this.xiangqiFailureDetail = undefined;
    this.tree = makeTree(buildXiangqiTree(this.data, this.pref.notationStyle));
    const initialPath = treePath.fromNodeList(treeOps.mainlineNodeList(this.tree.root));
    this.mode = 'play';
    this.next = defer();
    this.round = undefined;
    this.resultSent = false;
    this.lastFeedback = 'init';
    this.initialPath = initialPath;
    this.initialNode = this.tree.nodeAtPath(initialPath);
    this.xiangqiObjective = makeObjective(
      this.initialNode.fen,
      this.data.puzzle.playback.solutions[0],
      this.data.puzzle.playback,
      this.data.puzzle.solutionStates,
    );
    this.xiangqiAllowance = this.xiangqiObjective.allowance;
    this.pov = (this.initialNode as XiangqiPuzzleNode).state.turn === 'black' ? 'black' : 'white';
    this.isDaily = !!this.data.isDaily;
    this.hintHasBeenShown(false);
    this.completed = false;
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

    this.withGround(g => {
      g.select();
      g.setMarks([], 'annotation');
      g.setMarks([]);
      this.showGround(g);
    });
  };

  private readonly playXiangqiSound = (fromPath: TreePath, toPath: TreePath): void => {
    const play = () => {
      if (this.path === toPath)
        this.withGround(board => playXiangqiTransitionSound(board, this.tree, fromPath, toPath));
    };
    play();
  };

  boardSetup = (): {
    position: BoardPosition;
    presentation: BoardPresentation;
    legalMoves: readonly string[];
    canMove: boolean;
  } => {
    const node = this.node as XiangqiPuzzleNode;
    const state =
      this.path === this.initialPath && this.data.puzzle.state ? this.data.puzzle.state : node.state;
    const color: Color = state.turn === 'black' ? 'black' : 'white';
    const canMove =
      this.engineReady() &&
      !this.xiangqiBusy &&
      !this.viewingSolution &&
      (this.mode === 'view' || (!this.xiangqiFailure && !this.xiangqiReplyPending && color === this.pov));
    const orientation = this.flipped() ? (this.pov === 'white' ? 'black' : 'white') : this.pov;
    return {
      position: xiangqiPosition(state.fen, node.uci, state.check),
      presentation: websiteBoardPresentation(
        {
          animationDuration: this.pref.animation.duration,
          moveEvent: this.pref.moveEvent,
          highlight: this.pref.highlight,
        },
        'interactive',
        orientation === 'white' ? 'red' : 'black',
      ),
      legalMoves: canMove ? state.legalMoves : [],
      canMove,
    };
  };

  showGround = (g: PuzzleGround, transition: BoardTransition = { kind: 'jump' }): void => {
    const setup = this.boardSetup();
    g.setPresentation(setup.presentation);
    g.display(setup.position, transition);
    g.setInteraction(
      xiangqiPlay(
        g,
        setup.position.active,
        setup.legalMoves,
        this.userXiangqiMove,
        { moveEvent: this.pref.moveEvent },
        setup.canMove,
      ),
    );
    this.setAutoShapes();
  };

  playUci = (uci: string): void => {
    if (!this.xiangqiReplyPending) void this.playXiangqiUciAt(this.path, uci);
  };

  playUciList = (uciList: string[]): void => uciList.forEach(this.playUci);

  userXiangqiMove = (uci: string): void => {
    if (!this.trafficStarted && (this.mode === 'play' || this.mode === 'try')) {
      this.trafficStarted = true;
      trackTraffic('puzzle.started', {}, {}, this.trafficAttempt);
    }
    if (!this.xiangqiBusy && !this.xiangqiReplyPending) void this.playXiangqiUciAt(this.path, uci);
  };

  private readonly cancelXiangqiWork = (): void => {
    this.xiangqiGeneration++;
    this.xiangqiEngine?.stop();
    this.xiangqiBusy = false;
    this.xiangqiEvaluating = false;
    this.moveEvaluationDepth = undefined;
    this.xiangqiReplyPending = false;
    this.xiangqiRetry = undefined;
  };

  private readonly playXiangqiUciAt = async (
    path: TreePath,
    uci: string,
    failure?: Extract<PuzzleDecision, { result: 'fail' }>,
  ): Promise<void> => {
    if (
      !this.engineReady() ||
      this.xiangqiBusy ||
      this.viewingSolution ||
      (this.mode !== 'view' && this.xiangqiFailure)
    )
      return;
    this.xiangqiBusy = true;
    this.xiangqiEngineError = false;
    this.xiangqiRetry = undefined;
    const generation = this.xiangqiGeneration;
    const mode = this.mode;
    const parent = this.tree.nodeAtPath(path);
    if ((treePath.size(path) - treePath.size(this.initialPath)) % 2 === 0)
      this.xiangqiPlayerMoveAt = performance.now();
    try {
      const state = await requestXiangqi<XiangqiMoveResponse>('/api/analysis/move', {
        initialFen: this.tree.root.fen,
        moves: this.tree
          .getNodeList(path)
          .slice(1)
          .map(node => node.uci!),
        move: uci,
        ruleset: this.data.game.ruleset,
      });
      if (generation !== this.xiangqiGeneration || this.path !== path || this.mode !== mode) return;
      this.addNode(makeXiangqiNode(state, uci, state.notation), path);
      const playedNode = this.node as XiangqiPuzzleNode;
      playedNode.notation = state.notation;
      playedNode.chineseNotation = state.chineseNotation;
      if (failure) this.revealXiangqiFailure(failure, parent, true);
      else await this.adjudicateXiangqi();
    } catch (error) {
      if (generation !== this.xiangqiGeneration) return;
      console.error(error);
      if (this.mode === mode) this.jump(path);
      this.xiangqiReplyPending = false;
      this.xiangqiEngineError = true;
      this.xiangqiRetry = () => {
        if (generation === this.xiangqiGeneration && this.mode === mode) {
          this.jump(path);
          void this.playXiangqiUciAt(path, uci, failure);
        }
      };
    } finally {
      if (generation === this.xiangqiGeneration) {
        this.xiangqiBusy = false;
        this.xiangqiEvaluating = false;
        this.moveEvaluationDepth = undefined;
        this.withGround(this.showGround);
        this.redraw();
      }
    }
  };

  private readonly adjudicateXiangqi = async (): Promise<void> => {
    if (this.mode === 'view' || !treePath.contains(this.path, this.initialPath)) return;
    const played = this.nodeList.slice(treePath.size(this.initialPath) + 1).map(node => node.uci!);
    const state = (this.node as XiangqiPuzzleNode).state;
    const stored = this.solutions.at(played);
    const playerMoved = played.length % 2 === 1;
    const terminal = terminalDecision(
      state,
      this.pov === 'white' ? 'red' : 'black',
      Math.ceil(played.length / 2),
      this.xiangqiAllowance,
    );
    if (terminal) {
      if (terminal.result === 'fail')
        this.revealXiangqiFailure(
          terminal,
          playerMoved ? this.node : this.tree.nodeAtPath(treePath.init(this.path)),
          !playerMoved,
        );
      else {
        this.node.puzzle = 'win';
        this.applyProgress('win');
      }
      return;
    }
    if (stored && !this.alternatives.has(played.join(' '))) {
      this.xiangqiFailure = undefined;
      if (stored.complete) {
        this.node.puzzle = 'win';
        this.applyProgress('win');
      } else if (playerMoved) {
        this.xiangqiBestMove = true;
        this.node.puzzle = 'good';
        this.applyProgress({ uci: this.solutions.next(played)!, path: this.path });
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
    const engine = this.getXiangqiEngine();
    const objective = this.xiangqiObjective!;
    const key = played.join(' ');
    let alternative = this.alternatives.get(key);
    if (!alternative) {
      this.moveEvaluationDepth = 1;
      this.moveEvaluationPercent = 0;
      this.redraw();
      const result = await evaluateAlternative(
        engine,
        objective,
        state,
        Math.ceil(played.length / 2),
        {
          initialFen: this.tree.root.fen,
          moves: this.nodeList.slice(1).map(node => node.uci!),
          ruleset: this.data.game.ruleset,
        },
        current,
        analysis => {
          if (!current()) return;
          const depth = Math.max(this.moveEvaluationDepth ?? 1, analysis.depth);
          const percent = Math.max(this.moveEvaluationPercent, evaluationPercent(analysis.timeMs));
          if (depth === this.moveEvaluationDepth && percent === this.moveEvaluationPercent) return;
          this.moveEvaluationDepth = depth;
          this.moveEvaluationPercent = percent;
          this.redraw();
        },
      );
      if (!result || !current()) return;
      this.moveEvaluationDepth = undefined;
      const reply = result.evaluation.bestMove;
      if (!reply || !state.legalMoves.includes(reply)) throw new Error('Pikafish returned no legal reply');
      alternative = {
        ...result,
        bestMove:
          !!result.continuation &&
          isEfficientMate(
            (this.solutions.at(played.slice(0, -1))?.remaining ?? Infinity) - 1,
            result.evaluation.score,
            objective.player,
          ),
      };
      this.alternatives.set(key, alternative);
    }
    const { evaluation, continuation, decision } = alternative;
    if (decision.result === 'continue') {
      const reply = continuation?.moves[0] ?? evaluation?.bestMove;
      if (!reply || !state.legalMoves.includes(reply)) throw new Error('Pikafish returned no legal reply');
      this.xiangqiFailure = undefined;
      this.xiangqiBestMove = alternative.bestMove;
      if (continuation) this.solutions.add([...played, ...continuation.moves]);
      const recommendation = evaluation?.lines[0]?.pvMoves[1];
      if (recommendation) this.xiangqiHints.set([...played, reply].join(' '), recommendation);
      this.node.puzzle = 'good';
      this.applyProgress({ uci: reply, path });
    } else if (decision.result === 'fail') {
      const reply = evaluation?.bestMove;
      if (!reply || !state.legalMoves.includes(reply)) throw new Error('Pikafish returned no legal defense');
      this.xiangqiFailedPath = treePath.init(path);
      this.queueXiangqiReply({ uci: reply, path }, decision);
    } else {
      this.node.puzzle = 'win';
      this.applyProgress('win');
    }
  };

  nextSolutionMove = (): string | undefined => {
    const played = this.nodeList.slice(treePath.size(this.initialPath) + 1).map(node => node.uci!);
    return this.solutions.next(played) ?? this.xiangqiHints.get(played.join(' '));
  };

  private readonly revealXiangqiFailure = (
    decision: Extract<PuzzleDecision, { result: 'fail' }>,
    culprit: TreeNode,
    afterReply: boolean,
  ): void => {
    const generation = this.xiangqiGeneration;
    const path = this.path;
    const mode = this.mode;
    const reveal = () => {
      if (generation !== this.xiangqiGeneration || this.path !== path || this.mode !== mode) return;
      this.xiangqiReplyPending = false;
      culprit.puzzle = 'fail';
      this.setXiangqiFailure(decision);
      this.applyProgress('fail');
      this.withGround(this.showGround);
      this.redraw();
    };
    if (afterReply) {
      this.xiangqiReplyPending = true;
      setTimeout(reveal, this.pref.animation.duration);
    } else reveal();
  };

  private readonly setXiangqiFailure = (decision: Extract<PuzzleDecision, { result: 'fail' }>): void => {
    this.xiangqiFailure = decision.reason;
    this.xiangqiFailureDetail =
      decision.needed !== undefined && decision.remaining !== undefined
        ? { needed: decision.needed, remaining: decision.remaining }
        : undefined;
    const afterReply = (treePath.size(this.path) - treePath.size(this.initialPath)) % 2 === 0;
    this.xiangqiFailedPath ??= treePath.init(afterReply ? treePath.init(this.path) : this.path);
    site.sound.say(this.failureMessage());
  };

  failureMessage = (): string =>
    this.xiangqiFailureDetail
      ? i18n.puzzle.mateAllowanceDetail(this.xiangqiFailureDetail.remaining, this.xiangqiFailureDetail.needed)
      : this.xiangqiFailure
        ? i18n.puzzle[this.xiangqiFailure]
        : i18n.puzzle.notTheMove;

  private readonly queueXiangqiReply = (
    progress: XiangqiMoveTest,
    failure?: Extract<PuzzleDecision, { result: 'fail' }>,
  ): void => {
    const generation = this.xiangqiGeneration;
    const mode = this.mode;
    this.xiangqiReplyPending = true;
    setTimeout(
      () => {
        if (generation !== this.xiangqiGeneration || mode !== this.mode || this.path !== progress.path)
          return;
        this.xiangqiReplyPending = false;
        void this.playXiangqiUciAt(progress.path, progress.uci, failure);
      },
      Math.max(
        0,
        defenderDelay(this.pref.animation.duration) - (performance.now() - this.xiangqiPlayerMoveAt),
      ),
    );
  };

  addNode = (node: TreeNode, path: TreePath): void => {
    if (this.mode !== 'view') this.tree.nodeAtPath(path).children = [];
    const newPath = this.tree.addNode(node, path)!;
    this.jump(newPath);
    this.withGround(g => g.playPremove());

    this.setAutoShapes();
    this.redraw();
  };

  canUseActions = (): boolean =>
    this.engineReady() && this.completed && !this.xiangqiBusy && !this.xiangqiReplyPending;

  canHint = (): boolean =>
    this.engineReady() &&
    !this.completed &&
    !this.xiangqiBusy &&
    !this.xiangqiReplyPending &&
    this.mode !== 'view' &&
    treePath.contains(this.path, this.initialPath) &&
    (this.node as XiangqiPuzzleNode).state.turn === (this.pov === 'white' ? 'red' : 'black');

  canRetry = (): boolean =>
    !this.xiangqiBusy &&
    !this.xiangqiReplyPending &&
    (this.engineStatus.state === 'error' ||
      (this.engineReady() &&
        (!!this.xiangqiRetry || (this.completed && this.xiangqiFailedPath !== undefined))));

  retryFailedMove = (): void => {
    if (!this.canRetry()) return;
    if (this.engineStatus.state === 'error') {
      void this.prepareXiangqiEngine().then(() => {
        if (this.engineReady()) {
          this.xiangqiEngineError = false;
          this.xiangqiRetry?.();
          this.redraw();
        }
      });
      return;
    }
    if (this.xiangqiRetry) return this.xiangqiRetry();
    if (this.xiangqiFailedPath === undefined || this.xiangqiBusy) return;
    const path = this.xiangqiFailedPath;
    this.cancelXiangqiWork();
    this.xiangqiBusy = true;
    const generation = this.xiangqiGeneration;
    const finish = () => {
      if (generation !== this.xiangqiGeneration) return;
      this.jump(path);
      this.tree.nodeAtPath(path).children = [];
      this.setPath(path);
      this.xiangqiBusy = false;
      this.xiangqiFailure = undefined;
      this.xiangqiFailureDetail = undefined;
      this.xiangqiFailedPath = undefined;
      this.lastFeedback = 'init';
      this.withGround(this.showGround);
      this.redraw();
    };
    // Navigation may have moved away from the failure. Rewind from wherever
    // the board currently is, never replay a failed move just to undo it.
    if (treePath.contains(this.path, path) && treePath.size(this.path) > treePath.size(path) + 1) {
      this.jump(treePath.init(this.path));
      this.redraw();
      setTimeout(finish, 250);
    } else finish();
  };

  applyProgress = (progress: undefined | 'fail' | 'win' | XiangqiMoveTest): void => {
    if (progress === 'fail' || progress === 'win')
      trafficActivity('puzzle.review', this.trafficAttempt, { theme: this.data.angle.key });
    if (progress === 'fail') {
      this.completed = true;
      this.lastFeedback = 'fail';
      if (this.mode === 'play') {
        if (this.streak) {
          this.failStreak(this.streak);
          this.streakFailStorage.fire();
        } else {
          this.mode = 'try';
          this.sendResult(false);
        }
      }
    } else if (progress === 'win') {
      this.completed = true;
      this.solvedMoves = Math.ceil((treePath.size(this.path) - treePath.size(this.initialPath)) / 2);
      site.sound.say(this.solvedMessage());
      if (this.streak) this.sound.good();
      this.lastFeedback = 'win';
      if (this.mode !== 'view') {
        const sent = this.mode === 'play' ? this.sendResult(true) : Promise.resolve();
        this.mode = 'view';
        this.withGround(this.showGround);
        sent.then(_ => this.autoNext() && this.nextPuzzle());
      }
    } else if (progress) {
      this.lastFeedback = 'good';
      this.queueXiangqiReply(progress);
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
    trafficActivity('puzzle.review', this.trafficAttempt, { theme: this.data.angle.key });
    trackTraffic('puzzle.review', { outcome: win ? 'won' : 'failed' }, {}, this.trafficAttempt);
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
      this.trafficAttempt,
    );
    const next = res.next;
    if (next?.user && this.data.user) {
      this.data.user.rating = next.user.rating;
      this.data.user.provisional = next.user.provisional;
      this.round = res.round;
      if (res.round?.ratingDiff) this.session.setRatingDiff(this.data.puzzle.id, res.round.ratingDiff);
    }
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

  solvedMessage = (): string =>
    `${i18n.puzzle.solvedInMoves(this.solvedMoves)} ${i18n.puzzle.referenceSolutionMoves(Math.ceil(this.data.puzzle.playback.solutions[0].length / 2))}`;

  retryPuzzle = (): void => {
    if (!this.completed) return;
    this.trafficAttempt = trafficAttemptId();
    this.trafficStarted = false;
    trafficActivity('puzzle.solve', this.trafficAttempt, { theme: this.data.angle.key, mode: 'practice' });
    trackTraffic('puzzle.retry', {}, {}, this.trafficAttempt);
    this.cancelXiangqiWork();
    this.viewingSolution = false;
    this.tree = makeTree(buildXiangqiTree(this.data, this.pref.notationStyle));
    this.initialPath = treePath.fromNodeList(treeOps.mainlineNodeList(this.tree.root));
    this.initialNode = this.tree.nodeAtPath(this.initialPath);
    this.solutions = new PuzzleSolutions(this.data.puzzle.playback.solutions);
    this.xiangqiHints.clear();
    this.xiangqiFailedPath = undefined;
    this.xiangqiFailureDetail = undefined;
    this.xiangqiFailure = undefined;
    this.xiangqiEngineError = false;
    this.xiangqiBestMove = true;
    this.solvedMoves = 0;
    this.lastFeedback = 'init';
    this.mode = this.resultSent ? 'try' : 'play';
    this.showHint(false);
    this.jump(this.initialPath);
    this.withGround(g => {
      g.cancelPremove();
      g.select();
      g.setMarks([]);
    });
    this.redraw();
  };

  nextPuzzle = (): void => {
    trackTraffic('puzzle.next', {}, {}, this.trafficAttempt);
    if (!this.completed) return;
    if (this.streak && this.lastFeedback !== 'win') {
      if (this.lastFeedback === 'fail') site.redirect(this.routerWithLang('/streak'));
      return;
    }
    if (this.mode !== 'view') {
      this.cancelXiangqiWork();
      this.sendResult(false);
      this.mode = 'view';
    }

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
      const move = this.showHint() ? nextXiangqiMove(this) : undefined;
      const squares = move && splitXiangqiUci(move);
      g.setMarks(
        [...(this.googlyEyes?.() ?? []), ...(squares ? [{ from: squares[0], brush: 'green' }] : [])],
        'annotation',
      );
    });

  jump = (path: TreePath): void => {
    const pathChanged = path !== this.path;
    const previousPath = this.path;
    this.setPath(path);
    const forward = pathChanged && treePath.init(path) === previousPath;
    const backward = pathChanged && treePath.init(previousPath) === path;
    this.withGround(g =>
      this.showGround(g, {
        kind: forward ? 'forward' : backward ? 'backward' : 'jump',
        ...(backward ? { effects: [] } : {}),
      }),
    );
    if (forward) this.playXiangqiSound(previousPath, path);
    this.autoScrollRequested = true;
    pubsub.emit('ply', this.node.ply);
  };

  userJump = (path: TreePath): void => {
    if (this.xiangqiBusy || this.xiangqiReplyPending) return;
    this.withGround(g => g.select());
    this.jump(path);
  };

  userJumpPlyDelta = (plyDelta: Ply) => {
    // ensure we are jumping to a valid ply
    let maxValidPly = this.mainline.length - 1;
    if (last(this.mainline)?.puzzle === 'fail' && this.mode !== 'view') maxValidPly -= 1;
    const newPly = Math.min(Math.max(this.node.ply + plyDelta, 0), maxValidPly);
    this.userJump(treePath.fromNodeList(this.mainline.slice(0, newPly + 1)));
  };

  toggleHint = (): void => void this.prepareHint();

  private readonly prepareHint = async (): Promise<void> => {
    if (!this.canHint()) return;
    if (!this.showHint()) {
      this.hintHasBeenShown(true);
    }
    if (!this.showHint() && !nextXiangqiMove(this)) {
      const generation = this.xiangqiGeneration;
      const path = this.path;
      this.xiangqiBusy = true;
      this.xiangqiEvaluating = true;
      this.xiangqiEngineError = false;
      this.redraw();
      try {
        const evaluation = await this.getXiangqiEngine().evaluate(this.node.fen, {
          initialFen: this.tree.root.fen,
          moves: this.nodeList.slice(1).map(node => node.uci!),
          ruleset: this.data.game.ruleset,
        });
        if (generation !== this.xiangqiGeneration || path !== this.path) return;
        if (
          !evaluation.bestMove ||
          !(this.node as XiangqiPuzzleNode).state.legalMoves.includes(evaluation.bestMove)
        )
          throw new Error('Pikafish returned no legal hint');
        const played = this.nodeList.slice(treePath.size(this.initialPath) + 1).map(node => node.uci!);
        this.xiangqiHints.set(played.join(' '), evaluation.bestMove);
      } catch (error) {
        if (generation === this.xiangqiGeneration) {
          console.error(error);
          this.xiangqiEngineError = true;
          this.xiangqiRetry = this.toggleHint;
        }
        return;
      } finally {
        if (generation === this.xiangqiGeneration) {
          this.xiangqiBusy = false;
          this.xiangqiEvaluating = false;
          this.withGround(this.showGround);
          this.redraw();
        }
      }
    }
    this.showHint.toggle();
    this.setAutoShapes();
    const hint = this.showHint() && nextXiangqiMove(this);
    const squares = hint && splitXiangqiUci(hint);
    this.withGround(g => g.select(squares ? squares[0] : undefined));
    this.redraw();
  };

  viewSolution = (): void => {
    trackTraffic('puzzle.revealed', {}, {}, this.trafficAttempt);
    trafficActivity('puzzle.review', this.trafficAttempt, { theme: this.data.angle.key });
    if (this.canUseActions()) void this.viewXiangqiSolution();
  };

  private readonly viewXiangqiSolution = async (): Promise<void> => {
    this.cancelXiangqiWork();
    this.xiangqiEngineError = false;
    this.xiangqiFailure = undefined;
    this.xiangqiFailureDetail = undefined;
    this.xiangqiFailedPath = undefined;
    this.sendResult(false);
    this.mode = 'view';
    this.viewingSolution = true;
    this.xiangqiBusy = true;
    const generation = this.xiangqiGeneration;
    const current = () => generation === this.xiangqiGeneration;
    this.redraw();
    try {
      const root = await buildSolutionTree(this.data, this.pref.notationStyle, current);
      if (!root || !current()) return;
      this.tree = makeTree(root);
      this.initialPath = treePath.root;
      this.initialNode = root;
      this.jump(treePath.root);
    } catch (error) {
      if (!current()) return;
      console.error(error);
      this.xiangqiEngineError = true;
      this.xiangqiRetry = this.viewSolution;
    } finally {
      if (current()) {
        this.xiangqiBusy = false;
        this.withGround(this.showGround);
        this.redraw();
      }
    }
  };

  skip = () => {
    if (!this.streak || !this.streak.data.skip || this.mode !== 'play') return;
    this.streak.skip();
    this.userJump(treePath.fromNodeList(this.mainline));
    const moveIndex = treePath.size(this.path) - treePath.size(this.initialPath);
    const solution = this.data.puzzle.playback.solutions[0][moveIndex];
    this.playUci(solution);
    this.playBestMove();
  };

  flip = () => {
    this.flipped.toggle();
    this.cgVersion++;
    this.withGround(g =>
      g.setPresentation({
        ...g.getPresentation(),
        perspective: g.getPresentation().perspective === 'red' ? 'black' : 'red',
      }),
    );
    this.redraw();
  };

  vote = (v: boolean) => {
    xhr.vote(this.data.puzzle.id, v);
    this.voted = this.voted === v ? undefined : v;
    this.redraw();
  };

  voteTheme = (theme: ThemeKey, v: boolean) => {
    if (this.round) {
      this.round.themes = this.round.themes || {};
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
    const uci = nextXiangqiMove(this);
    if (uci) this.playUci(uci);
  };
  autoNexting = () => this.lastFeedback === 'win' && this.autoNext();
  getOrientation = () =>
    this.withGround(g => (g.getPresentation().perspective === 'red' ? 'white' : 'black'))!;
  allThemes?: { dynamic: string[]; static: Set<string> };
  toggleRated = () => this.rated(!this.rated());
  getNode = () => this.node;
  routerWithLang = (path: string): string => {
    if (document.body.hasAttribute('data-user')) return path;
    const language = document.documentElement.lang.slice(0, 2);
    return language === 'en' ? path : `/${language}${path}`;
  };
}
