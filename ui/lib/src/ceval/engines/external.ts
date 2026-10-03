import { randomId } from '../../algo';
import { ids } from '../../tree/path';
import type { LocalEval, PvData } from '../../tree/types';
import { readNdJson } from '../../xhr';
import {
  CevalState,
  type CevalEngine,
  type ExternalEngineInfo,
  type EngineNotifier,
  type Work,
} from '../types';

interface ExternalAnalysis {
  error?: string;
  time: number;
  depth: number;
  nodes: number;
  pvs: PvData[];
}

/** Native external engine transport. Scores are from Red's point of view. */
export class ExternalEngine implements CevalEngine {
  private state = CevalState.Idle;
  private abort?: AbortController;
  private readonly session = randomId();

  constructor(
    private readonly info: ExternalEngineInfo,
    private readonly notify: EngineNotifier,
  ) {}

  getInfo(): ExternalEngineInfo {
    return this.info;
  }
  getState(): CevalState {
    return this.state;
  }
  stop(): void {
    this.abort?.abort();
    this.abort = undefined;
    this.state = CevalState.Idle;
  }
  destroy(): void {
    this.stop();
  }

  start(work: Work): void {
    this.stop();
    const abort = (this.abort = new AbortController());
    this.state = CevalState.Computing;
    const run = async () => {
      const response = await fetch(
        `${this.info.endpoint.replace(/\/$/, '')}/api/external-engine/${encodeURIComponent(this.info.id)}/analyse`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'omit',
          signal: abort.signal,
          body: JSON.stringify({
            clientSecret: this.info.clientSecret,
            work: {
              sessionId: work.gameId ?? this.session,
              threads: Math.min(work.threads, this.info.maxThreads),
              hash: Math.min(work.hashSize ?? 16, this.info.maxHash),
              multiPv: work.multiPv,
              initialFen: work.initialFen,
              moves: work.moves,
              ruleset: work.ruleset,
              ...('movetime' in work.search && !Number.isFinite(work.search.movetime)
                ? { depth: 255 }
                : work.search),
            },
          }),
        },
      );
      await readNdJson<ExternalAnalysis>(response, update => {
        if (abort.signal.aborted || work.stopRequested) return;
        if (update.error) throw new Error(update.error);
        if (
          !Number.isFinite(update.time) ||
          !Number.isInteger(update.depth) ||
          !Number.isFinite(update.nodes) ||
          !Array.isArray(update.pvs)
        )
          throw new Error('External engine returned invalid analysis');
        const pvs = update.pvs.slice(0, work.multiPv).map(pv => {
          if (
            !Array.isArray(pv.moves) ||
            !pv.moves.length ||
            pv.moves.length > 256 ||
            (pv.cp === undefined) === (pv.mate === undefined)
          )
            throw new Error('External engine returned an invalid variation');
          pv.moves.forEach(move => {
            if (ids(move).length !== 1) throw new Error('Invalid external engine move identity');
          });
          return pv;
        });
        if (!pvs.length) return;
        const evaluation: LocalEval = {
          fen: work.currentFen,
          depth: update.depth,
          nodes: update.nodes,
          millis: update.time,
          pvs,
          cp: pvs[0].cp,
          mate: pvs[0].mate,
        };
        work.emit(evaluation, work);
      });
      if (this.abort === abort) {
        this.state = CevalState.Idle;
        this.notify();
      }
    };
    void run().catch(error => {
      if (abort.signal.aborted) return;
      this.state = CevalState.Failed;
      this.notify({ error: error.message });
    });
  }
}
