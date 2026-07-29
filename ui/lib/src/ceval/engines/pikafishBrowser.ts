import { bigFileStorage } from '../../bigFileStorage';
import { PikafishProtocol, type PikafishWork } from './pikafishProtocol';

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
  | { state: 'ready' }
  | { state: 'computing' }
  | { state: 'error'; error: string };

export class PikafishBrowserEngine {
  readonly protocol: PikafishProtocol;

  private module?: PikafishModule;

  constructor(private readonly status: (status: PikafishStatus) => void) {
    this.protocol = new PikafishProtocol(computing => {
      if (this.module) this.status({ state: computing ? 'computing' : 'ready' });
    });
    this.status({ state: 'loading' });
    void this.boot();
  }

  start(work: Omit<PikafishWork, 'stopRequested'>): void {
    this.protocol.compute({ ...work, stopRequested: false });
  }

  stop(): void {
    this.protocol.compute(undefined);
  }

  destroy(): void {
    this.stop();
    this.module?.uci('quit');
    this.module = undefined;
  }

  isComputing(): boolean {
    return this.protocol.isComputing();
  }

  private async boot(): Promise<void> {
    try {
      if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined')
        throw new Error('Browser Pikafish requires cross-origin isolation and shared memory');
      const root = 'pikafish-web';
      // These large engine assets are not part of the compiled manifest. Put
      // them behind the deployment asset version so a rebuilt WASM/NNUE bridge
      // cannot be hidden by an older immutable browser-cache entry.
      const scriptUrl = site.asset.url(`${root}/pikafish.js`, {
        documentOrigin: true,
        pathVersion: true,
      });
      const imported = (await import(scriptUrl)) as { default: ModuleFactory };
      const module = await imported.default({
        wasmMemory: sharedWasmMemory(1024),
        locateFile: file => site.asset.url(`${root}/${file}`, { pathVersion: true }),
        mainScriptUrlOrBlob: scriptUrl,
      });
      module.listen = data => this.protocol.received(data);
      module.onError = message => this.fail(message);
      const network = module.getRecommendedNnue() ?? 'pikafish.nnue';
      const networkUrl = site.asset.url(`${root}/${network}`, { pathVersion: true });
      module.setNnueBuffer(
        await bigFileStorage().get(networkUrl, (bytes, total) =>
          this.status({ state: 'downloading', bytes, total }),
        ),
      );
      this.module = module;
      this.protocol.connected(command => module.uci(command));
      this.status({ state: 'ready' });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private fail(message: string): void {
    this.status({ state: 'error', error: message });
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
