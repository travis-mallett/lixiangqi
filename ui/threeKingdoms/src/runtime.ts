import { resetTrialStorage } from './trialReset';
import type { EngineResult, Rules, SearchOptions } from './types';

let rulesPromise: Promise<Rules> | undefined;
export function loadRules(
  moduleUrl: string = site.asset.url('three-kingdoms-engine/main.js'),
): Promise<Rules> {
  if (typeof localStorage !== 'undefined') resetTrialStorage();
  return (rulesPromise ??= import(moduleUrl)
    .then(module => module.ThreeKingdoms as Rules)
    .catch(error => {
      rulesPromise = undefined;
      throw error;
    }));
}

/** Worker termination cancels obsolete analysis immediately, including during a search. */
export class Engine {
  private worker?: Worker;
  private reject?: (error: Error) => void;
  private timer?: ReturnType<typeof setTimeout>;

  analyze(position: string, options: SearchOptions | number = 3): Promise<EngineResult> {
    const search: SearchOptions =
      typeof options === 'number'
        ? {
            depth: options < 3 ? 2 : options < 5 ? 3 : 4,
            nodes: [100, 400, 1600, 5000, 12000][Math.min(4, Math.max(0, options - 1))],
          }
        : options;
    this.stop();
    return new Promise((resolve, reject) => {
      let latest: EngineResult | undefined;
      this.reject = reject;
      const worker = (this.worker = new Worker(
        site.asset.url('three-kingdoms-engine/worker.js', { documentOrigin: true }),
        { type: 'module' },
      ));
      const finish = () => {
        clearTimeout(this.timer);
        this.reject = undefined;
        worker.terminate();
        if (this.worker === worker) this.worker = undefined;
      };
      worker.onerror = event => {
        if (this.worker !== worker) return;
        finish();
        reject(new Error(event.message));
      };
      worker.onmessage = ({ data }) => {
        if (this.worker !== worker) return;
        if (!data.error && !data.final) {
          latest = data.result as EngineResult;
          search.emit?.(data.result as EngineResult, false);
          return;
        }
        finish();
        if (data.error) reject(new Error(data.error));
        else {
          search.emit?.(data.result as EngineResult, true);
          resolve(data.result as EngineResult);
        }
      };
      this.timer = setTimeout(() => {
        finish();
        if (latest) {
          search.emit?.(latest, true);
          resolve(latest);
        } else reject(new Error('Engine timeout'));
      }, 60000);
      worker.postMessage({
        id: 1,
        position,
        moduleUrl: site.asset.url('three-kingdoms-engine/main.js', { documentOrigin: true }),
        depth: search.depth,
        nodes: search.nodes,
        multiPv: search.multiPv ?? 1,
      });
    });
  }

  stop(): void {
    clearTimeout(this.timer);
    this.worker?.terminate();
    this.worker = undefined;
    this.reject?.(new DOMException('Search cancelled', 'AbortError'));
    this.reject = undefined;
  }
}
