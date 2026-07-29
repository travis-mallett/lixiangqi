import type { Api } from 'chessgroundx/api';
import type { Key } from 'chessgroundx/types';
import { requestXiangqi, type RulesState, uciMoveToCg } from 'xiangqi';

import { makeAppleShape } from '../apple';
import { hashNavigate } from '../hashRouting';
import type { LearnOpts } from '../learn';
import { COMPLETION_SCORE } from '../score';
import { type Level, type Stage, byId as stageById, list as stages } from '../stage/list';

export class RunCtrl {
  ground?: Api;
  fen = '';
  step = 0;
  completed = false;
  failed = false;
  validation: 'loading' | 'ready' | 'invalid' = 'loading';
  validationError = '';
  private validatedPositions: RulesState[] = [];
  private validationGeneration = 0;
  private completionTimer?: number;

  constructor(
    readonly opts: LearnOpts,
    readonly redraw: () => void,
  ) {
    this.initializeLevel();
  }

  get stage(): Stage {
    return stageById[this.opts.stageId ?? 1];
  }

  get level(): Level {
    return this.stage.levels[(this.opts.levelId ?? 1) - 1];
  }

  initializeLevel = () => {
    window.clearTimeout(this.completionTimer);
    const generation = ++this.validationGeneration;
    this.step = 0;
    this.completed = false;
    this.failed = false;
    this.validation = 'loading';
    this.validationError = '';
    this.validatedPositions = [];
    this.fen = '';
    this.ground?.stop();
    void this.validateLevel(generation);
  };

  setGround = (ground: Api) => {
    this.ground = ground;
    this.syncGround();
  };

  destroyGround = () => {
    this.ground?.destroy();
    this.ground = undefined;
  };

  legalMoves = () =>
    this.validation !== 'ready' || this.completed || this.level.reading
      ? []
      : this.level.moves.slice(this.step, this.step + 1);

  target = () => {
    const move = this.legalMoves()[0];
    return move ? /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(move)?.[2] : undefined;
  };

  onMove = (move: string) => {
    const expected = this.level.moves[this.step];
    if (move !== expected) {
      this.failed = true;
      this.syncGround();
      this.redraw();
      return;
    }
    this.step += 1;
    this.fen = this.validatedPositions[this.step]?.fen ?? this.fen;
    this.failed = false;
    this.syncGround(move);
    if (this.step >= this.level.moves.length) {
      this.completionTimer = window.setTimeout(this.complete, 250);
    }
    this.redraw();
  };

  completeReading = () => this.complete();

  complete = () => {
    if (this.completed) return;
    this.completed = true;
    this.opts.storage.saveScore(this.stage, this.level, COMPLETION_SCORE);
    this.ground?.stop();
    this.redraw();
  };

  restart = () => {
    this.step = 0;
    this.completed = false;
    this.failed = false;
    this.fen = this.validatedPositions[0]?.fen ?? '';
    this.syncGround();
    this.redraw();
  };

  retryValidation = () => {
    this.initializeLevel();
    this.redraw();
  };

  score = (level: Level) => this.opts.storage.data.stages[this.stage.key]?.scores[level.id - 1] ?? 0;

  stageCompleted = () => this.stage.levels.every(level => this.score(level) > 0);

  next = () => {
    if (this.level.id < this.stage.levels.length) hashNavigate(this.stage.id, this.level.id + 1);
    else {
      const index = stages.findIndex(stage => stage.id === this.stage.id);
      const nextStage = stages.slice(index + 1).find(stage => !stage.comingSoon);
      hashNavigate(nextStage?.id);
    }
  };

  back = () => {
    if (this.level.id > 1) hashNavigate(this.stage.id, this.level.id - 1);
    else hashNavigate();
  };

  private syncGround(lastMove?: string) {
    if (!this.ground || !this.level || this.validation !== 'ready') return;
    const color = this.level.color === 'red' ? 'white' : 'black';
    this.ground.set({
      fen: this.fen,
      orientation: color,
      turnColor: color,
      lastMove: lastMove ? uciMoveToCg(lastMove) : undefined,
      movable: {
        color: this.completed || this.level.reading ? undefined : color,
        dests: legalMoveDests(this.legalMoves()),
      },
    });
    const move = this.legalMoves()[0];
    this.ground.setShapes(
      move
        ? [
            {
              orig: uciMoveToCg(move)[0] as Key,
              dest: uciMoveToCg(move)[1],
              brush: 'green',
            },
            makeAppleShape(uciMoveToCg(move)[1]),
          ]
        : [],
    );
  }

  private async validateLevel(generation: number) {
    try {
      const result = await requestXiangqi<LessonValidation>('/learn/validate', {
        initialFen: this.level.fen,
        moves: this.level.moves,
      });
      if (generation !== this.validationGeneration) return;
      if (result.positions.length !== this.level.moves.length + 1)
        throw new Error('The native Xiangqi rules boundary returned an incomplete lesson line');
      this.validatedPositions = result.positions;
      this.fen = result.positions[0].fen;
      this.validation = 'ready';
      this.redraw();
    } catch (error) {
      if (generation !== this.validationGeneration) return;
      this.validation = 'invalid';
      this.validationError =
        error instanceof Error ? error.message : 'The native Xiangqi rules boundary rejected this lesson';
      this.redraw();
    }
  }
}

interface LessonValidation {
  positions: RulesState[];
  notations: string[];
}

function legalMoveDests(moves: string[]) {
  const dests = new Map();
  for (const move of moves) {
    const [orig, dest] = uciMoveToCg(move);
    dests.set(orig, [...(dests.get(orig) ?? []), dest]);
  }
  return dests;
}
