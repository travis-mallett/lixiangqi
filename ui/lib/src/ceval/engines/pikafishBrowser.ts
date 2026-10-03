import { defer } from '../../async';
import { bigFileStorage } from '../../bigFileStorage';
import { requestXiangqi } from '../../game/xiangqiApi';
import { replayXiangqiVariation, type RulesState, type RulesPosition } from '../../game/xiangqiNotation';
import {
  type EngineAnalysis,
  PikafishProtocol,
  type PikafishWork,
  type PikafishOptions,
} from './pikafishProtocol';

interface PikafishModule {
  listen: (data: string) => void;
  onError: (message: string) => void;
  uci: (command: string) => void;
  setNnueBuffer: (buffer: Uint8Array<ArrayBuffer>) => void;
  getRecommendedNnue: () => string | undefined;
}

type ModuleFactory = (options: {
  wasmMemory: WebAssembly.Memory;
  locateFile: (file: string) => string;
  mainScriptUrlOrBlob: string;
}) => Promise<PikafishModule>;

export type PikafishStatus =
  | { state: 'loading' }
  | { state: 'downloading'; bytes: number; total: number }
  | { state: 'initializing' }
  | { state: 'ready' }
  | { state: 'computing' }
  | { state: 'error'; error: string };

export class PikafishBrowserEngine {
  readonly protocol: PikafishProtocol;

  private module?: PikafishModule;
  private destroyed = false;
  private failure?: Error;
  private readonly readiness = defer<void>();
  private readonly download = new AbortController();
  private startupTimer?: ReturnType<typeof setTimeout>;
  private searchGeneration = 0;
  private validation?: AbortController;
  private validationTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly status: (status: PikafishStatus) => void,
    options?: PikafishOptions,
  ) {
    this.protocol = new PikafishProtocol(
      computing => {
        if (this.module && !this.disposed) this.status({ state: computing ? 'computing' : 'ready' });
      },
      () => {
        if (this.disposed) return;
        clearTimeout(this.startupTimer);
        this.readiness.resolve();
        this.status({ state: 'ready' });
      },
      options,
    );
    // Analysis callers can queue work without awaiting preparation themselves.
    void this.readiness.promise.catch(() => {});
    this.progress({ state: 'loading' });
    void this.boot();
  }

  prepare(): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.destroyed) return Promise.reject(new Error('Pikafish engine has been destroyed'));
    return this.readiness.promise;
  }

  start(work: Omit<PikafishWork, 'stopRequested'>): void {
    if (this.destroyed) throw new Error('Pikafish engine has been destroyed');
    if (this.failure) throw this.failure;
    this.cancelValidation();
    const generation = ++this.searchGeneration;
    let pendingEvaluation: { analysis: EngineAnalysis; final: boolean } | undefined;
    let validating = false;
    const abort = (this.validation = new AbortController());
    if (!work.history?.ruleset)
      throw new Error('Native engine analysis requires a root position, move history, and ruleset');
    const position: RulesPosition = {
      ...work.history,
      ruleset: work.history.ruleset,
      moves: [...work.history.moves],
    };
    const scheduleValidation = () => {
      if (!pendingEvaluation || abort.signal.aborted) return;
      clearTimeout(this.validationTimer);
      this.validationTimer = setTimeout(() => void validate(), pendingEvaluation.final ? 0 : 700);
    };
    const start = (legalMoves: readonly string[]) => {
      if (generation !== this.searchGeneration || abort.signal.aborted) return;
      this.protocol.compute({
        ...work,
        legalMoves,
        stopRequested: false,
        emit: (analysis, final) => {
          pendingEvaluation = { analysis, final };
          scheduleValidation();
        },
      });
    };
    const validate = async (): Promise<void> => {
      if (validating || !pendingEvaluation || abort.signal.aborted) return;
      const candidate = pendingEvaluation;
      pendingEvaluation = undefined;
      validating = true;
      try {
        await Promise.all(
          candidate.analysis.lines.map(line =>
            replayXiangqiVariation(
              position.initialFen,
              position.moves,
              position.ruleset,
              line.pvMoves,
              abort.signal,
            ),
          ),
        );
        if (generation === this.searchGeneration && !abort.signal.aborted)
          work.emit(candidate.analysis, candidate.final);
      } catch (error) {
        if (!abort.signal.aborted && candidate.final)
          this.status({ state: 'error', error: error instanceof Error ? error.message : String(error) });
      } finally {
        validating = false;
        scheduleValidation();
      }
    };
    if (work.legalMoves) start(work.legalMoves);
    else
      void requestXiangqi<RulesState>('/api/analysis/position', position, abort.signal)
        .then(state => {
          if (state.fen !== work.fen)
            throw new Error('Engine position differs from its native branch history');
          start(state.legalMoves);
        })
        .catch(error => {
          if (!abort.signal.aborted) this.status({ state: 'error', error: String(error) });
        });
  }

  stop(): void {
    this.searchGeneration++;
    this.cancelValidation();
    this.protocol.compute(undefined);
  }

  private cancelValidation(): void {
    this.validation?.abort();
    this.validation = undefined;
    clearTimeout(this.validationTimer);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelValidation();
    this.dispose(new Error('Pikafish engine has been destroyed'));
  }

  isComputing(): boolean {
    return this.protocol.isComputing();
  }

  private async boot(): Promise<void> {
    try {
      if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined')
        throw new Error('Browser Pikafish requires cross-origin isolation and shared memory');
      const root = 'pikafish-web';
      // Content hashes keep compatible assets fresh without invalidating the
      // large cached network every time the application server restarts.
      const scriptUrl = site.asset.url(`${root}/pikafish.js`, {
        documentOrigin: true,
      });
      const imported = (await import(scriptUrl)) as { default: ModuleFactory };
      if (this.disposed) return;
      const module = await imported.default({
        wasmMemory: sharedWasmMemory(1024),
        locateFile: file => site.asset.url(`${root}/${file}`),
        mainScriptUrlOrBlob: scriptUrl,
      });
      if (this.disposed) {
        module.uci('quit');
        return;
      }
      this.module = module;
      module.listen = data => {
        if (!this.disposed) this.protocol.received(data);
      };
      const network = module.getRecommendedNnue() ?? 'pikafish.nnue';
      const networkUrl = site.asset.url(`${root}/${network}`);
      module.onError = message => {
        if (this.disposed) return;
        if (message === 'Pikafish could not initialize the NNUE network')
          void bigFileStorage()
            .delete(networkUrl)
            .catch(() => {})
            .then(() => this.fail(message));
        else this.fail(message);
      };
      const buffer = await bigFileStorage().get(networkUrl, {
        signal: this.download.signal,
        onProgress: (bytes, total) => this.progress({ state: 'downloading', bytes, total }),
      });
      if (this.disposed) return;
      this.progress({ state: 'initializing' });
      module.setNnueBuffer(buffer);
      if (this.disposed) return;
      this.protocol.connected(command => module.uci(command));
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private fail(message: string): void {
    if (this.disposed) return;
    this.failure = new Error(message);
    this.dispose(this.failure);
    this.status({ state: 'error', error: message });
  }

  private get disposed(): boolean {
    return this.destroyed || !!this.failure;
  }

  private progress(status: PikafishStatus): void {
    if (this.disposed) return;
    clearTimeout(this.startupTimer);
    // A healthy transfer may take minutes. Only a minute without progress is
    // a stall; native startup and cache access are bounded independently.
    this.startupTimer = setTimeout(() => this.fail(`Pikafish ${status.state} timed out`), 60_000);
    this.status(status);
  }

  private dispose(error: Error): void {
    clearTimeout(this.startupTimer);
    this.download.abort(error);
    this.readiness.reject(error);
    try {
      this.protocol.compute(undefined);
      this.module?.uci('quit');
    } catch {
      // An aborted WASM runtime may no longer accept commands.
    }
    this.protocol.disconnected();
    this.module = undefined;
  }
}

function sharedWasmMemory(initial: number, maximum = 32767): WebAssembly.Memory {
  let shrink = 4;
  while (true) {
    try {
      return new WebAssembly.Memory({ shared: true, initial, maximum });
    } catch (error) {
      if (maximum <= initial || !(error instanceof RangeError)) throw error;
      maximum = Math.max(initial, Math.ceil(maximum - maximum / shrink));
      shrink = shrink === 4 ? 3 : 4;
    }
  }
}
