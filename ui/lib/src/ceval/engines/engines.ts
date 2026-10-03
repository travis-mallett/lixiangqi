import { json } from '../../xhr';
import type { CevalCtrl } from '../ctrl';
import {
  CevalState,
  type BrowserEngineInfo,
  type CevalEngine,
  type EngineInfo,
  type EngineNotifier,
  type EngineTrust,
  type ExternalEngineInfo,
  type Work,
} from '../types';
import { ExternalEngine } from './external';
import { PikafishBrowserEngine, type PikafishStatus } from './pikafishBrowser';
import { toLocalEval } from './pikafishProtocol';

class PikafishCevalEngine implements CevalEngine {
  private state = CevalState.Loading;
  private started = false;
  private readonly engine: PikafishBrowserEngine;

  constructor(
    private readonly info: BrowserEngineInfo,
    private readonly status?: EngineNotifier,
  ) {
    this.engine = new PikafishBrowserEngine(this.onStatus);
  }

  getInfo(): BrowserEngineInfo {
    return this.info;
  }

  getState(): CevalState {
    return this.state;
  }

  start(work: Work): void {
    this.started = true;
    this.engine.start({
      fen: work.currentFen,
      legalMoves: work.legalMoves,
      history: { initialFen: work.initialFen, moves: work.moves, ruleset: work.ruleset },
      search: 'nodes' in work.search ? { nodes: work.search.nodes } : work.search,
      multiPv: work.multiPv,
      threads: work.threads,
      hashSize: work.hashSize ?? 16,
      emit: analysis => {
        if (!this.started || work.stopRequested || !analysis.lines.length) return;
        work.emit(toLocalEval(analysis, work.currentFen), work);
      },
    });
  }

  stop(): void {
    this.started = false;
    this.engine.stop();
    if (this.state !== CevalState.Failed && this.state !== CevalState.Loading) this.state = CevalState.Idle;
  }

  destroy(): void {
    this.started = false;
    this.engine.destroy();
  }

  private readonly onStatus = (status: PikafishStatus): void => {
    switch (status.state) {
      case 'loading':
      case 'initializing':
        this.state = CevalState.Loading;
        break;
      case 'downloading':
        this.state = CevalState.Loading;
        this.status?.({ download: { bytes: status.bytes, total: status.total } });
        break;
      case 'ready':
        this.state = CevalState.Idle;
        this.status?.();
        break;
      case 'computing':
        this.state = CevalState.Computing;
        this.status?.();
        break;
      case 'error':
        this.state = CevalState.Failed;
        this.status?.({ error: status.error });
        break;
    }
  };
}

export class Engines {
  readonly externalEngines: ExternalEngineInfo[];
  private readonly info: BrowserEngineInfo;
  private activeEngine: EngineInfo;

  constructor(private readonly ctrl: CevalCtrl) {
    this.externalEngines = (ctrl.opts.externalEngines ?? []).map(engine => ({
      ...engine,
      tech: 'EXTERNAL',
      capabilities: engine.officialPikafish ? ['staticAnalysis', 'cloudEval'] : ['staticAnalysis'],
    }));
    this.info = {
      id: 'pikafish-web',
      name: 'Pikafish',
      short: 'Pikafish',
      tech: 'NNUE',
      variants: [ctrl.opts.variant.key],
      requires: ['wasm', 'sharedMem'],
      assets: {
        root: 'pikafish-web',
        js: 'pikafish.js',
        wasm: 'pikafish.wasm',
        nnue: ['pikafish.nnue'],
      },
      minThreads: 1,
      maxThreads: 8,
      maxHash: 256,
      capabilities: ['staticAnalysis', 'cloudEval'],
    };
    this.activeEngine = this.info;
  }

  getEngine(selector?: { id?: string; variant?: VariantKey; capability?: EngineTrust }): EngineInfo {
    const engines = this.supporting(selector?.variant ?? 'xiangqi', selector?.capability);
    const engine = selector?.id ? engines.find(engine => engine.id === selector.id) : engines[0];
    if (!engine) throw new Error('Selected native engine is unavailable');
    return engine;
  }

  active(): EngineInfo {
    return this.activeEngine;
  }

  setActive(id: string): EngineInfo {
    this.activeEngine = this.getEngine({ id });
    return this.activeEngine;
  }

  get defaultId(): string {
    return this.info.id;
  }

  get external(): ExternalEngineInfo | undefined {
    return this.activeEngine.tech === 'EXTERNAL' ? this.activeEngine : undefined;
  }

  async deleteExternal(id: string): Promise<boolean> {
    await json(`/api/external-engine/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const index = this.externalEngines.findIndex(engine => engine.id === id);
    if (index >= 0) this.externalEngines.splice(index, 1);
    if (this.activeEngine.id === id) this.ctrl.selectEngine(this.defaultId);
    return true;
  }

  supporting(
    variant: VariantKey,
    capability?: EngineTrust,
    filter: 'browser' | 'external' | 'all' = 'all',
  ): EngineInfo[] {
    const engines =
      filter === 'browser'
        ? [this.info]
        : filter === 'external'
          ? this.externalEngines
          : [this.info, ...this.externalEngines];
    return engines.filter(
      engine =>
        engine.variants?.includes(variant) && (!capability || engine.capabilities?.includes(capability)),
    );
  }

  makeEngine(selector?: { id?: string; variant?: VariantKey }): CevalEngine {
    const info = this.getEngine(selector);
    const notify: EngineNotifier = status => {
      if (status?.error) this.ctrl.engineFailed(status.error);
      this.ctrl.download = status?.download;
      this.ctrl.opts.redraw();
    };
    return info.tech === 'EXTERNAL'
      ? new ExternalEngine(info, notify)
      : new PikafishCevalEngine(info, notify);
  }
}
