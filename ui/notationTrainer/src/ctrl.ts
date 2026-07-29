import { sparkline } from '@fnando/sparkline';
import type { Api as GroundApi } from 'chessgroundx/api';
import type { Color } from 'chessgroundx/types';
import { legalMoveDests, setXiangqiCoordinates, uciMoveToCg } from 'xiangqi';

import { type Prop, myUserId, withEffect } from 'lib';
import { pubsub } from 'lib/pubsub';
import { storedBooleanProp, storedProp } from 'lib/storage';
import { toggleZenMode } from 'lib/view/zen';
import { text as xhrText, form as xhrForm } from 'lib/xhr';

import type {
  BoardPerspective,
  Mode,
  ModeScores,
  MoveSide,
  NotationExercise,
  NotationSystem,
  NotationTrainerConfig,
  Redraw,
  TimeControl,
} from './interfaces';
import { isCorrectNotation, notationFor } from './notation';

export const DURATION = 30 * 1000;
const TICK_DELAY = 50;
const NEXT_EXERCISE_DELAY = 450;

const groundColor = (turn: NotationExercise['turn']): Color => (turn === 'red' ? 'white' : 'black');
const perspectiveColor = (perspective: Exclude<BoardPerspective, 'both'>): Color =>
  perspective === 'red' ? 'white' : 'black';

export default class NotationTrainerCtrl {
  ground?: GroundApi;
  exercise?: NotationExercise;
  hasPlayed = false;
  isAuth = !!myUserId();
  keyboardInput?: HTMLInputElement;
  modeScores: ModeScores = this.config.scores;
  playing = false;
  loading = false;
  answerReady = false;
  score = 0;
  timeAtStart = 0;
  timeLeft = DURATION;
  wrong = false;
  error?: string;
  private exerciseOrientation: Color = 'white';
  private nextBothOrientation: Color = Math.random() < 0.5 ? 'white' : 'black';
  private request?: AbortController;
  private wrongTimeout?: number;
  private nextTimeout?: number;

  constructor(
    readonly config: NotationTrainerConfig,
    readonly redraw: Redraw,
  ) {
    const initialPerspective = this.boardPerspective();
    this.exerciseOrientation = initialPerspective === 'both' ? 'white' : perspectiveColor(initialPerspective);
    pubsub.on('zen', () => toggleZenMode({ unconditional: true }));
    $('#zentog').on('click', () => pubsub.emit('zen'));
    site.mousetrap.bind('z', () => pubsub.emit('zen'));
    window.addEventListener('resize', () => requestAnimationFrame(this.updateCharts), true);
  }

  mode: Prop<Mode> = withEffect<Mode>(
    storedProp<Mode>(
      'notationTrainer.mode',
      window.location.hash === '#write' ? 'writeNotation' : 'moveFromNotation',
      value => (value === 'writeNotation' ? value : 'moveFromNotation'),
    ),
    () => {
      window.location.hash = this.mode() === 'writeNotation' ? '#write' : '#move';
      this.answerReady = false;
      this.redraw();
      this.updateCharts();
    },
  );

  notationSystem: Prop<NotationSystem> = withEffect<NotationSystem>(
    storedProp<NotationSystem>('notationTrainer.notationSystem', this.config.notationSystem, value =>
      value === 'chinese' || value === 'traditional' ? 'chinese' : 'wxf',
    ),
    () => {
      if (this.keyboardInput) this.keyboardInput.value = '';
      this.redraw();
    },
  );

  boardPerspective: Prop<BoardPerspective> = withEffect<BoardPerspective>(
    storedProp<BoardPerspective>('notationTrainer.boardPerspective', 'both', value =>
      value === 'red' || value === 'black' ? value : 'both',
    ),
    value => {
      this.exerciseOrientation = value === 'both' ? 'white' : perspectiveColor(value);
      this.syncGroundAppearance();
      this.redraw();
    },
  );

  moveSide: Prop<MoveSide> = withEffect<MoveSide>(
    storedProp<MoveSide>('notationTrainer.moveSide', 'both', value =>
      value === 'red' || value === 'black' ? value : 'both',
    ),
    this.redraw,
  );

  showBoardCoordinates: Prop<boolean> = withEffect<boolean>(
    storedBooleanProp('notationTrainer.showBoardCoordinates', true),
    value => {
      if (this.ground) setXiangqiCoordinates(this.ground, value);
      this.redraw();
    },
  );

  timeControl: Prop<TimeControl> = withEffect(
    storedProp<TimeControl>(
      'notationTrainer.timeControl',
      document.body.classList.contains('kid') ? 'untimed' : 'thirtySeconds',
      value => (value === 'untimed' ? value : 'thirtySeconds'),
    ),
    this.redraw,
  );

  timeDisabled = () => this.timeControl() === 'untimed';

  notation = () => (this.exercise ? notationFor(this.exercise, this.notationSystem()) : '');

  orientation = (): Color => this.exerciseOrientation;

  notationPlaceholder = () =>
    this.notationSystem() === 'chinese'
      ? '炮二平五'
      : this.exercise?.turn === 'black' || (!this.exercise && this.moveSide() === 'black')
        ? 'c2=5'
        : 'C2=5';

  start = () => {
    if (this.playing || this.loading) return;
    this.playing = true;
    this.hasPlayed = true;
    this.score = 0;
    this.timeLeft = DURATION;
    this.timeAtStart = Date.now();
    this.error = undefined;
    this.redraw();
    void this.loadExercise();
    if (!this.timeDisabled()) this.tick();
  };

  stop = () => {
    if (!this.playing) return;
    this.playing = false;
    this.loading = false;
    this.answerReady = false;
    this.wrong = false;
    this.request?.abort();
    if (this.nextTimeout) clearTimeout(this.nextTimeout);
    if (this.keyboardInput) {
      this.keyboardInput.blur();
      this.keyboardInput.value = '';
    }
    if (this.timeControl() === 'thirtySeconds') {
      this.updateScoreList();
      if (this.isAuth)
        xhrText('/training/notation/score', {
          method: 'post',
          body: xhrForm({ mode: this.mode(), perspective: this.boardPerspective(), score: this.score }),
        });
    }
    this.setGroundPosition(false);
    this.redraw();
  };

  private readonly tick = () => {
    if (!this.playing) return;
    this.timeLeft = DURATION - Math.min(DURATION, Date.now() - this.timeAtStart);
    this.redraw();
    if (this.timeLeft > 0) setTimeout(this.tick, TICK_DELAY);
    else this.stop();
  };

  loadExercise = async () => {
    if (!this.playing) return;
    this.request?.abort();
    this.request = new AbortController();
    this.loading = true;
    this.answerReady = false;
    this.error = undefined;
    this.redraw();
    try {
      const response = await fetch(`/training/notation/exercise?turn=${this.moveSide()}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        signal: this.request.signal,
      });
      if (!response.ok) throw new Error(`Could not load a notation exercise (${response.status})`);
      this.exercise = (await response.json()) as NotationExercise;
      this.exerciseOrientation = this.orientationForNextExercise();
      this.loading = false;
      this.setGroundPosition(true);
      if (this.mode() === 'writeNotation') {
        this.nextTimeout = window.setTimeout(() => {
          if (!this.playing || !this.exercise) return;
          this.ground?.set({
            fen: this.exercise.resultFen,
            lastMove: uciMoveToCg(this.exercise.move),
            movable: { color: undefined, dests: new Map() },
          });
          this.answerReady = true;
          this.redraw();
          this.keyboardInput?.focus();
        }, 650);
      } else this.answerReady = true;
      this.redraw();
    } catch (error) {
      if (this.request.signal.aborted) return;
      this.loading = false;
      this.error = error instanceof Error ? error.message : 'Could not load a notation exercise';
      this.redraw();
    }
  };

  setGroundPosition = (interactive: boolean) => {
    if (!this.ground || !this.exercise) return;
    const color = groundColor(this.exercise.turn);
    if (this.ground.state.orientation !== this.orientation()) this.ground.toggleOrientation();
    this.ground.set({
      fen: this.exercise.fen,
      turnColor: color,
      lastMove: undefined,
      movable: {
        color: interactive && this.mode() === 'moveFromNotation' ? color : undefined,
        dests:
          interactive && this.mode() === 'moveFromNotation'
            ? legalMoveDests(this.exercise.legalMoves)
            : new Map(),
      },
    });
    setXiangqiCoordinates(this.ground, this.showBoardCoordinates());
  };

  private readonly orientationForNextExercise = (): Color => {
    const perspective = this.boardPerspective();
    if (perspective !== 'both') return perspectiveColor(perspective);
    const orientation = this.nextBothOrientation;
    this.nextBothOrientation = orientation === 'white' ? 'black' : 'white';
    return orientation;
  };

  private readonly syncGroundAppearance = () => {
    if (!this.ground) return;
    if (this.ground.state.orientation !== this.orientation()) this.ground.toggleOrientation();
    setXiangqiCoordinates(this.ground, this.showBoardCoordinates());
  };

  onMove = (move: string) => {
    if (!this.playing || this.loading || this.mode() !== 'moveFromNotation' || !this.exercise) return;
    if (move === this.exercise.move) this.handleCorrect();
    else {
      this.handleWrong();
      window.setTimeout(() => this.setGroundPosition(true), 350);
    }
  };

  submitNotation = () => {
    if (!this.playing || !this.answerReady || this.mode() !== 'writeNotation' || !this.keyboardInput) return;
    if (isCorrectNotation(this.keyboardInput.value, this.notation())) {
      this.keyboardInput.value = '';
      this.handleCorrect();
    } else {
      this.keyboardInput.select();
      this.handleWrong();
    }
  };

  onKeyboardInputKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!this.playing) this.start();
      else this.submitNotation();
    }
  };

  private readonly handleCorrect = () => {
    this.score++;
    this.answerReady = false;
    this.wrong = false;
    this.redraw();
    this.nextTimeout = window.setTimeout(() => void this.loadExercise(), NEXT_EXERCISE_DELAY);
  };

  private readonly handleWrong = () => {
    if (this.wrongTimeout) clearTimeout(this.wrongTimeout);
    this.wrong = true;
    this.redraw();
    this.wrongTimeout = window.setTimeout(() => {
      this.wrong = false;
      this.redraw();
    }, 600);
  };

  private readonly updateScoreList = () => {
    const perspective = this.boardPerspective();
    const scores = this.modeScores[this.mode()][perspective];
    if (scores.length >= 20) this.modeScores[this.mode()][perspective] = scores.slice(-19);
    this.modeScores[this.mode()][perspective].push(this.score);
    requestAnimationFrame(() => this.updateCharts());
  };

  updateCharts = () => {
    for (const perspective of ['red', 'black', 'both'] as BoardPerspective[]) {
      const svg = document.getElementById(`${perspective}-sparkline`);
      if (!(svg instanceof SVGSVGElement)) continue;
      const parent = svg.parentElement as HTMLDivElement;
      const values = this.modeScores[this.mode()][perspective];
      const tooltip = svg.nextElementSibling as HTMLSpanElement;
      svg.setAttribute('width', `${parent.offsetWidth}px`);
      sparkline(svg, values, {
        onmousemove(_: MouseEvent, datapoint: { index: number; x: number; y: number }) {
          tooltip.hidden = false;
          tooltip.textContent = values[datapoint.index].toString();
          tooltip.style.top = `${datapoint.y}px`;
          tooltip.style.left = `${datapoint.x}px`;
        },
        onmouseout() {
          tooltip.hidden = true;
        },
      });
    }
  };

  hasModeScores = () => Object.values(this.modeScores[this.mode()]).some(scores => scores.length > 0);
}
