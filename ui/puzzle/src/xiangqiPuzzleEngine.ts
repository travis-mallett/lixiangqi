import { PikafishBrowserEngine, type PikafishStatus } from 'lib/ceval/engines/pikafishBrowser';
import type { EngineAnalysis, PikafishHistory } from 'lib/ceval/engines/pikafishProtocol';

export const XIANGQI_PUZZLE_ENGINE_DEPTH = 18;
export const XIANGQI_PUZZLE_ENGINE_MULTIPV = 1;
export const XIANGQI_PUZZLE_ENGINE_THREADS = 1;
export const XIANGQI_PUZZLE_ENGINE_HASH_SIZE = 16;
export const XIANGQI_PUZZLE_ENGINE_TIMEOUT_MS = 60_000;

export interface XiangqiPuzzleEngineLike {
  start(work: {
    fen: string;
    history?: PikafishHistory;
    depth: number;
    multiPv: number;
    threads: number;
    hashSize: number;
    emit: (analysis: EngineAnalysis, final: boolean) => void;
  }): void;
  stop(): void;
  destroy(): void;
}

export type XiangqiPuzzleEngineFactory = (
  status: (status: PikafishStatus) => void,
) => XiangqiPuzzleEngineLike;

type Pending = {
  fen: string;
  history?: PikafishHistory;
  resolve: (analysis: EngineAnalysis) => void;
  reject: (error: Error) => void;
};

const defaultFactory: XiangqiPuzzleEngineFactory = status => new PikafishBrowserEngine(status);

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

  constructor(private readonly factory: XiangqiPuzzleEngineFactory = defaultFactory) {}

  evaluate(fen: string, history?: PikafishHistory): Promise<EngineAnalysis> {
    if (this.destroyed) return Promise.reject(new Error('Pikafish puzzle engine is destroyed'));
    const promise = new Promise<EngineAnalysis>((resolve, reject) => {
      this.queue.push({
        fen,
        history: history && { ...history, moves: [...history.moves] },
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
    this.timer = setTimeout(() => {
      this.engine?.stop();
      finish(new Error('Pikafish puzzle evaluation timed out'));
    }, XIANGQI_PUZZLE_ENGINE_TIMEOUT_MS);

    try {
      if (!this.engine) {
        const engineGeneration = ++this.engineGeneration;
        this.engine = this.factory(status => {
          // Boot may fail inside the constructor, before the factory returns.
          queueMicrotask(() => {
            if (engineGeneration === this.engineGeneration) this.handleStatus(status);
          });
        });
      }
      this.engine.start({
        fen: request.fen,
        history: request.history,
        depth: XIANGQI_PUZZLE_ENGINE_DEPTH,
        multiPv: XIANGQI_PUZZLE_ENGINE_MULTIPV,
        threads: XIANGQI_PUZZLE_ENGINE_THREADS,
        hashSize: XIANGQI_PUZZLE_ENGINE_HASH_SIZE,
        emit: (analysis, final) => {
          if (final) finish(undefined, analysis);
        },
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private readonly handleStatus = (status: PikafishStatus): void => {
    if (status.state !== 'error') return;
    this.engineGeneration++;
    this.engine?.destroy();
    this.engine = undefined;
    this.finishActive?.(new Error(status.error));
  };

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
