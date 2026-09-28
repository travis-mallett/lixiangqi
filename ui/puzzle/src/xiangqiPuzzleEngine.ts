import { PikafishBrowserEngine, type PikafishStatus } from 'lib/ceval/engines/pikafishBrowser';
import type { EngineAnalysis, PikafishHistory, PikafishWork } from 'lib/ceval/engines/pikafishProtocol';

export const XIANGQI_PUZZLE_ENGINE_MOVETIME_MS = 4_000;
export const XIANGQI_PUZZLE_CONFIRM_DEPTH = 20;
export const XIANGQI_PUZZLE_CONFIRM_MOVETIME_MS = 2_000;
export const XIANGQI_PUZZLE_MAX_SEARCH_MS = 15_000;
export const XIANGQI_PUZZLE_ENGINE_MULTIPV = 1;
export const puzzleEngineThreads = (cpus = globalThis.navigator?.hardwareConcurrency ?? 2): number =>
  Math.max(1, Math.floor(cpus / 2));
export const XIANGQI_PUZZLE_ENGINE_HASH_SIZE = 16;
export const XIANGQI_PUZZLE_ENGINE_TIMEOUT_MS = 60_000;

export interface XiangqiPuzzleEngineLike {
  prepare(): Promise<void>;
  start(work: Omit<PikafishWork, 'stopRequested'>): void;
  stop(): void;
  destroy(): void;
}

export type XiangqiPuzzleEngineFactory = (
  status: (status: PikafishStatus) => void,
) => XiangqiPuzzleEngineLike;

export interface PuzzleSearchPolicy {
  extend: (analysis: EngineAnalysis) => boolean;
  needsConfirmation: (analysis: EngineAnalysis) => boolean;
}

type Pending = {
  fen: string;
  history?: PikafishHistory;
  policy?: PuzzleSearchPolicy;
  onProgress?: (analysis: EngineAnalysis) => void;
  resolve: (analysis: EngineAnalysis) => void;
  reject: (error: Error) => void;
};

const defaultFactory: XiangqiPuzzleEngineFactory = status =>
  new PikafishBrowserEngine(status, {
    threads: puzzleEngineThreads(),
    hashSize: XIANGQI_PUZZLE_ENGINE_HASH_SIZE,
  });

/** A single, sequential, bounded Pikafish evaluator for puzzle adjudication. */
export default class XiangqiPuzzleEngine {
  private engine?: XiangqiPuzzleEngineLike;
  private readonly queue: Pending[] = [];
  private active?: Pending;
  private timer?: ReturnType<typeof setTimeout>;
  private finishActive?: (error?: Error, analysis?: EngineAnalysis) => void;
  private generation = 0;
  private destroyed = false;
  private engineGeneration = 0;
  private preparation?: Promise<void>;

  constructor(
    private readonly factory: XiangqiPuzzleEngineFactory = defaultFactory,
    private readonly onStatus: (status: PikafishStatus) => void = () => {},
  ) {}

  prepare(): Promise<void> {
    if (this.destroyed) return Promise.reject(new Error('Pikafish puzzle engine is destroyed'));
    if (this.preparation) return this.preparation;
    const generation = ++this.engineGeneration;
    try {
      this.engine = this.factory(status => {
        // A failed constructor can notify before the factory returns.
        queueMicrotask(() => {
          if (generation === this.engineGeneration) this.handleStatus(status);
        });
      });
      this.preparation = this.engine.prepare().catch(error => {
        if (generation === this.engineGeneration) this.handleStatus({ state: 'error', error: String(error) });
        throw error;
      });
      return this.preparation;
    } catch (error) {
      this.handleStatus({ state: 'error', error: String(error) });
      return Promise.reject(error);
    }
  }

  evaluate(
    fen: string,
    history?: PikafishHistory,
    policy?: PuzzleSearchPolicy,
    onProgress?: (analysis: EngineAnalysis) => void,
  ): Promise<EngineAnalysis> {
    if (this.destroyed) return Promise.reject(new Error('Pikafish puzzle engine is destroyed'));
    const promise = new Promise<EngineAnalysis>((resolve, reject) => {
      this.queue.push({
        fen,
        history: history && { ...history, moves: [...history.moves] },
        policy,
        onProgress,
        resolve,
        reject,
      });
    });
    this.runNext();
    return promise;
  }

  stop(): void {
    this.generation++;
    this.clearTimer();
    this.engine?.stop();
    const error = new Error('Pikafish puzzle evaluation cancelled');
    this.active?.reject(error);
    this.active = undefined;
    this.finishActive = undefined;
    this.queue.splice(0).forEach(request => request.reject(error));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.stop();
    this.destroyed = true;
    this.engineGeneration++;
    this.engine?.destroy();
    this.engine = undefined;
    this.preparation = undefined;
  }

  private runNext(): void {
    if (this.active || !this.queue.length || this.destroyed) return;
    this.active = this.queue.shift();
    const request = this.active!;
    const generation = this.generation;
    this.clearTimer();

    const finish = (error?: Error, analysis?: EngineAnalysis): void => {
      if (generation !== this.generation || this.active !== request) return;
      this.clearTimer();
      this.active = undefined;
      this.finishActive = undefined;
      if (error) request.reject(error);
      else if (!analysis) request.reject(new Error('Pikafish returned no puzzle analysis'));
      else request.resolve(analysis);
      this.runNext();
    };
    this.finishActive = finish;
    void this.prepare()
      .then(() => {
        if (generation !== this.generation || this.active !== request) return;
        this.timer = setTimeout(() => {
          // A hung native search cannot safely service the next request.
          this.handleStatus({ state: 'error', error: 'Pikafish puzzle evaluation timed out' });
        }, XIANGQI_PUZZLE_ENGINE_TIMEOUT_MS);
        this.engine!.start({
          fen: request.fen,
          history: request.history,
          search: {
            movetime: XIANGQI_PUZZLE_ENGINE_MOVETIME_MS,
            extension: {
              minMovetime: XIANGQI_PUZZLE_CONFIRM_MOVETIME_MS,
              maxMovetime: XIANGQI_PUZZLE_MAX_SEARCH_MS - XIANGQI_PUZZLE_ENGINE_MOVETIME_MS,
              needed: analysis => request.policy?.extend(analysis) ?? false,
              complete: analysis => !request.policy?.needsConfirmation(analysis),
            },
          },
          multiPv: XIANGQI_PUZZLE_ENGINE_MULTIPV,
          threads: puzzleEngineThreads(),
          hashSize: XIANGQI_PUZZLE_ENGINE_HASH_SIZE,
          emit: (analysis, final) => {
            if (generation !== this.generation || this.active !== request) return;
            if (final) finish(undefined, analysis);
            else request.onProgress?.(analysis);
          },
        });
      })
      .catch(error => {
        finish(error instanceof Error ? error : new Error(String(error)));
      });
  }

  private readonly handleStatus = (status: PikafishStatus): void => {
    if (status.state === 'error') {
      this.engineGeneration++;
      this.engine?.destroy();
      this.engine = undefined;
      this.preparation = undefined;
    }
    this.onStatus(status);
    if (status.state === 'error') this.finishActive?.(new Error(status.error));
  };

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
