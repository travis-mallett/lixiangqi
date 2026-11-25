import { PikafishBrowserEngine, type PikafishStatus } from 'lib/ceval/engines/pikafishBrowser';
import type { PikafishWork } from 'lib/ceval/engines/pikafishProtocol';
import { analyseBanqiPosition } from 'lib/game/banqi';
import type { TreeNode } from 'lib/tree/types';

export interface Evaluation {
  cp?: number;
  mate?: number;
  depth: number;
  variation: string[];
}
export interface AnalysisBatch {
  initialFen: string;
  ruleset: string;
  moves: string[];
  evaluations: Evaluation[];
}
export interface ChapterEngine {
  prepare(): Promise<void>;
  start(work: Omit<PikafishWork, 'stopRequested'>): void;
  destroy(): void;
}

// One bounded search per position, including the root. Keep full history for repetition rules.
export class LocalAnalysisRun {
  private engine?: ChapterEngine;
  private reject?: (error: Error) => void;
  private readonly abort = new AbortController();
  private cancelled = false;
  constructor(
    private readonly makeEngine = (status: (s: PikafishStatus) => void): ChapterEngine =>
      new PikafishBrowserEngine(status, { threads: 1, hashSize: 32 }),
  ) {}

  cancel = () => {
    this.cancelled = true;
    this.abort.abort();
    this.reject?.(new Error('Cancelled'));
    this.engine?.destroy();
  };

  async run(
    nodes: readonly TreeNode[],
    ruleset: string,
    progress: (done: number, status?: PikafishStatus) => void,
  ): Promise<AnalysisBatch> {
    const banqi = nodes[0].state.variant === 'banqi';
    const batch: AnalysisBatch = {
      initialFen: nodes[0].fen,
      ruleset,
      moves: nodes.slice(1).map(n => (banqi ? n.id : n.uci!)),
      evaluations: [],
    };

    const engine = (this.engine = banqi
      ? undefined
      : this.makeEngine(status => {
          if (status.state === 'error') this.reject?.(new Error(status.error));
          progress(batch.evaluations.length, status);
        }));
    try {
      if (engine) await this.bounded(() => engine.prepare(), 120000);
      for (const [index, node] of nodes.entries()) {
        if (this.cancelled) throw new Error('Cancelled');
        const outcome = node.outcome();
        const evaluation = outcome
          ? {
              ...(outcome.winner ? { mate: outcome.winner === 'red' ? 1 : -1 } : { cp: 0 }),
              depth: 0,
              variation: [],
            }
          : !engine
            ? await this.bounded(async () => {
                const analysis = await analyseBanqiPosition(
                  nodes.slice(0, index + 1).map(n => n.fen),
                  node.state.legalMoves,
                  1,
                  this.abort.signal,
                );
                const action = analysis.bestMove!;
                // A flip has no single continuation until its face is revealed.
                return {
                  cp: analysis.score.redCp,
                  depth: analysis.depth,
                  variation: action.slice(0, 2) === action.slice(2) ? [] : [action],
                };
              }, 30000)
            : await this.bounded(
                () =>
                  new Promise<Evaluation>(resolve => {
                    engine.start({
                      fen: node.fen,
                      history: { initialFen: batch.initialFen, ruleset, moves: batch.moves.slice(0, index) },
                      legalMoves: node.state.legalMoves,
                      search: { movetime: 2000 },
                      multiPv: 1,
                      threads: 1,
                      hashSize: 32,
                      emit: (analysis, final) => {
                        if (!final) return;
                        const score = analysis.score;
                        if (score.redCp === undefined && score.redMate === undefined) {
                          this.reject?.(new Error('Pikafish returned no evaluation'));
                          return;
                        }
                        resolve({
                          cp: score.redCp,
                          mate: score.redMate,
                          depth: analysis.depth,
                          variation: analysis.lines[0]?.pvMoves.slice(0, 12) ?? [],
                        });
                      },
                    });
                  }),
                30000,
              );
        batch.evaluations.push(evaluation);
        progress(batch.evaluations.length);
      }
      return batch;
    } finally {
      this.abort.abort();
      engine?.destroy();
      this.engine = undefined;
    }
  }

  private bounded<T>(work: () => Promise<T>, milliseconds: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    return new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Pikafish timed out')), milliseconds);
      this.reject = reject;
      Promise.resolve().then(work).then(resolve, reject);
    }).finally(() => {
      clearTimeout(timer);
      this.reject = undefined;
    });
  }
}
