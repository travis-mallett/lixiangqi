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
      depth: searchDepth(work),
      multiPv: work.multiPv,
      threads: work.threads,
      hashSize: work.hashSize ?? 16,
      emit: analysis => {
        if (!this.started || work.stopRequested) return;
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
  readonly externalEngines: ExternalEngineInfo[] = [];
  private readonly info: BrowserEngineInfo;
  private activeEngine: EngineInfo;

  constructor(private readonly ctrl: CevalCtrl) {
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
      capabilities: ['staticAnalysis'],
    };
    this.activeEngine = this.info;
  }

  getEngine(_selector?: { id?: string; variant?: VariantKey; capability?: EngineTrust }): EngineInfo {
    return this.info;
  }

  active(): EngineInfo {
    return this.activeEngine;
  }

  setActive(_id: string): EngineInfo {
    this.activeEngine = this.info;
    return this.info;
  }

  get defaultId(): string {
    return this.info.id;
  }

  get external(): ExternalEngineInfo | undefined {
    return undefined;
  }

  async deleteExternal(_id: string): Promise<boolean> {
    return false;
  }

  supporting(
    variant: VariantKey,
    _capability?: EngineTrust,
    filter: 'browser' | 'external' | 'all' = 'all',
  ): EngineInfo[] {
    return filter === 'external' || !this.info.variants?.includes(variant) ? [] : [this.info];
  }

  makeEngine(_selector?: { id?: string; variant?: VariantKey }): CevalEngine {
    return new PikafishCevalEngine(this.info, status => {
      if (status?.error) this.ctrl.engineFailed(status.error);
      this.ctrl.download = status?.download;
      this.ctrl.opts.redraw();
    });
  }
}

function searchDepth(work: Work): number {
  if ('depth' in work.search) return Math.max(1, Math.min(99, work.search.depth));
  if ('nodes' in work.search) return 24;
  return work.search.movetime >= 3000 ? 24 : work.search.movetime >= 1000 ? 20 : 16;
}
