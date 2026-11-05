import {
  PikafishProtocol,
  parsePikafishInfo,
  type EngineAnalysis,
  type EngineLine as UciLine,
} from '../../../lib/src/ceval/engines/pikafishProtocol';
import { clamp } from '../random';
import type { EngineAdapter, EngineEvidence, EngineLine, EngineQuery } from '../types';
import type { XiangqiAdapter, XiangqiPosition } from './rules';

interface Module {
  listen: (line: string) => void;
  onError: (message: string) => void;
  uci(command: string): void;
  setNnueBuffer(buffer: Uint8Array<ArrayBuffer>): void;
}
export interface PikafishAssets {
  moduleUrl: string;
  network: Uint8Array<ArrayBuffer>;
  networkSha256: string;
  version: string;
  wasmUrl?: string;
}
/** Preserve the last completed scored iteration when a budget stop reports a
 * new bestmove before its score was published. Never invent that missing score. */
export function scoredPikafishLines(
  analysis: EngineAnalysis,
  current: ReadonlyMap<string, UciLine>,
): UciLine[] {
  const complete = analysis.lines.filter(line => !line.score.bound);
  if (complete[0]?.pvMoves[0] === analysis.bestMove) return complete;
  const newer = analysis.bestMove && current.get(analysis.bestMove);
  if (newer) return [newer];
  if (complete.length) return complete;
  throw new Error('Pikafish finished without any scored principal variation');
}
/** One single-threaded engine per playing client. No site globals, HTTP rules calls,
 * subprocesses or platform-specific logic: Node and browsers run the same WASM. */
export class PikafishEngine implements EngineAdapter<XiangqiPosition> {
  private readonly protocol: PikafishProtocol;
  private module?: Module;
  private dead = false;
  private busy = false;
  private failure?: (error: Error) => void;
  private ready?: () => void;
  private resetReady?: () => void;
  private currentFen?: string;
  private readonly currentLines = new Map<string, UciLine>();
  private reportedNodes = 0;
  readonly memory: WebAssembly.Memory;
  get closed(): boolean {
    return this.dead;
  }
  private constructor(
    readonly version: string,
    private readonly rules: XiangqiAdapter,
  ) {
    // 64 MiB initial, 512 MiB ceiling. Maximum is a reservation, not resident usage.
    this.memory = new WebAssembly.Memory({ shared: true, initial: 1024, maximum: 8192 });
    this.protocol = new PikafishProtocol(
      () => {},
      () => this.ready?.(),
      { threads: 1, hashSize: 16 },
    );
  }
  static async create(rules: XiangqiAdapter, assets: PikafishAssets): Promise<PikafishEngine> {
    const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', assets.network));
    const digest = Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== assets.networkSha256) throw new Error('Pikafish network checksum mismatch');
    if (typeof SharedArrayBuffer === 'undefined')
      throw new Error('Pikafish needs shared memory; serve the browser with COOP/COEP headers');
    const engine = new PikafishEngine(`${assets.version}/${digest.slice(0, 12)}`, rules);
    const moduleUrl = assets.moduleUrl,
      wasmUrl = assets.wasmUrl;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        engine.ready = resolve;
        engine.failure = reject;
        timer = setTimeout(() => engine.fail(new Error('Pikafish initialization timed out')), 30000);
        void (async () => {
          const imported = await import(/* @vite-ignore */ moduleUrl);
          const module = (await imported.default({
            wasmMemory: engine.memory,
            ...(new URL(moduleUrl).protocol === 'file:'
              ? {}
              : {
                  locateFile: (file: string) =>
                    file.endsWith('.wasm') && wasmUrl ? wasmUrl : new URL(file, moduleUrl).href,
                  mainScriptUrlOrBlob: moduleUrl,
                }),
          })) as Module;
          if (engine.dead) {
            module.uci('quit');
            return;
          }
          engine.module = module;
          module.listen = line => {
            if (engine.dead) return;
            if (line.trim() === 'readyok') engine.resetReady?.();
            if (/^info string (CRITICAL ERROR|ERROR:)/.test(line)) {
              engine.fail(new Error(line));
              return;
            }
            if (engine.currentFen) {
              const nodes = /\bnodes (\d+)/.exec(line);
              if (nodes) engine.reportedNodes = Math.max(engine.reportedNodes, Number(nodes[1]));
              const parsed = parsePikafishInfo(line, engine.currentFen);
              if (parsed) {
                engine.reportedNodes = Math.max(engine.reportedNodes, parsed.nodes);
                if (!parsed.score.bound) engine.currentLines.set(parsed.pvMoves[0], parsed);
              }
            }
            engine.protocol.received(line);
          };
          module.onError = message => engine.fail(new Error(message));
          module.setNnueBuffer(assets.network);
          engine.protocol.connected(command => module.uci(command));
        })().catch(error => engine.fail(error instanceof Error ? error : new Error(String(error))));
      });
      return engine;
    } catch (error) {
      engine.close();
      throw error;
    } finally {
      clearTimeout(timer);
      engine.ready = undefined;
      engine.failure = undefined;
    }
  }
  /** Clear search history between laboratory samples or identities; keep weights loaded. */
  reset(): Promise<void> {
    if (this.dead || this.busy) return Promise.reject(new Error('Cannot reset an unavailable engine'));
    this.busy = true;
    return new Promise<void>((resolve, reject) => {
      const clean = () => {
        clearTimeout(timer);
        this.busy = false;
        this.failure = undefined;
        this.resetReady = undefined;
      };
      const timer = setTimeout(() => this.fail(new Error('Pikafish reset timed out')), 3000);
      this.failure = error => {
        clean();
        reject(error);
      };
      this.resetReady = () => {
        clean();
        resolve();
      };
      this.module!.uci('ucinewgame');
      this.module!.uci('isready');
    });
  }
  analyze(query: EngineQuery<XiangqiPosition>): Promise<EngineEvidence> {
    if (this.dead || this.busy) return Promise.reject(new Error('Pikafish is closed or already searching'));
    if (query.signal?.aborted) return Promise.reject(new Error('Engine search aborted'));
    const observation = query.position.observation;
    if (
      !query.actions.length ||
      new Set(query.actions).size !== query.actions.length ||
      query.actions.some(action => !observation.moves.some(move => move.action === action)) ||
      !Number.isInteger(query.nodes) ||
      query.nodes < 1 ||
      query.nodes > 1000000 ||
      !Number.isInteger(query.multiPv) ||
      query.multiPv < 1 ||
      query.multiPv > 8 ||
      !Number.isFinite(query.maxTimeMs) ||
      query.maxTimeMs < 1 ||
      query.maxTimeMs > 10000
    )
      return Promise.reject(new Error('Invalid Pikafish search envelope'));
    this.busy = true;
    this.currentFen = query.position.fen;
    this.currentLines.clear();
    this.reportedNodes = 0;
    const started = performance.now();
    return new Promise<EngineEvidence>((resolve, reject) => {
      let stopped = false,
        settled = false;
      const clean = () => {
        clearTimeout(stopTimer);
        clearTimeout(watchdog);
        query.signal?.removeEventListener('abort', abort);
        this.busy = false;
        this.failure = undefined;
        this.currentFen = undefined;
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clean();
        reject(error);
      };
      const abort = () => this.fail(new Error('Engine search aborted; recreate the engine before reuse'));
      this.failure = fail;
      query.signal?.addEventListener('abort', abort, { once: true });
      const stopTimer = setTimeout(() => {
        stopped = true;
        this.module?.uci('stop');
      }, query.maxTimeMs);
      const watchdog = setTimeout(
        () => this.fail(new Error('Pikafish did not acknowledge stop')),
        query.maxTimeMs + 1000,
      );
      try {
        this.protocol.compute({
          fen: query.position.fen,
          history: query.position.snapshot,
          legalMoves: query.actions,
          search: { nodes: query.nodes },
          multiPv: Math.min(query.multiPv, query.actions.length),
          threads: 1,
          hashSize: 16,
          stopRequested: false,
          emit: (analysis, final) => {
            if (!final || settled) return;
            try {
              const lines = this.convert(analysis, query);
              const evidence: EngineEvidence = {
                version: this.version,
                observation: observation.key,
                bestAction: lines[0].action,
                unscoredBest: analysis.bestMove !== lines[0].action ? analysis.bestMove : undefined,
                lines,
                nodes: Math.max(this.reportedNodes, analysis.nodes),
                elapsedMs: performance.now() - started,
                stopped,
              };
              settled = true;
              clean();
              resolve(evidence);
            } catch (error) {
              fail(error instanceof Error ? error : new Error(String(error)));
            }
          },
        });
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  private convert(analysis: EngineAnalysis, query: EngineQuery<XiangqiPosition>): EngineLine[] {
    if (!analysis.bestMove || !query.actions.includes(analysis.bestMove))
      throw new Error('Pikafish returned no legal best move');
    // Prefer a newer scored recommendation. If its score was not published,
    // retain the last completed set, flag the uncertainty, and never mix iterations.
    const source = scoredPikafishLines(analysis, this.currentLines);
    const result: EngineLine[] = [];
    for (const line of source) {
      if (!query.actions.includes(line.pvMoves[0])) throw new Error('Pikafish returned an illegal root move');
      let position = query.position;
      const pv: string[] = [];
      let terminal: Readonly<Record<string, number>> | undefined;
      // Rules are authoritative. Reject an incompatible history-dependent PV;
      // never silently substitute a homemade evaluation or an unscored move.
      for (const action of line.pvMoves.slice(0, 64)) {
        if (position.observation.terminal) break;
        if (!position.observation.moves.some(move => move.action === action))
          throw new Error('Pikafish variation conflicts with canonical rules/history');
        position = this.rules.play(position, action)[0].position;
        pv.push(action);
        terminal = position.observation.terminal;
      }
      const red = query.position.observation.turn === 'red' ? 1 : -1;
      const cp = line.score.cp;
      const mate = line.score.mate;
      if (cp === undefined && mate === undefined) throw new Error('Pikafish omitted a score');
      const value = clamp((cp ?? 0) / 100, -90, 90) * red;
      const winner = mate === undefined ? undefined : Math.sign(mate) * red;
      result.push({
        action: pv[0],
        pv,
        depth: line.depth,
        utilities: { red: value, black: -value },
        forced: terminal ?? (winner === undefined ? undefined : { red: winner, black: -winner }),
        distance: mate === undefined ? undefined : Math.abs(mate),
        uncertainty: clamp(
          1 / Math.sqrt(Math.max(1, line.depth)) + (analysis.bestMove !== source[0].pvMoves[0] ? 0.2 : 0),
        ),
      });
    }
    if (!result.length) throw new Error('Pikafish produced no scored legal candidate');
    return result;
  }
  private fail(error: Error): void {
    const reject = this.failure;
    this.failure = undefined;
    this.close();
    reject?.(error);
  }
  close(): void {
    if (this.dead) return;
    this.dead = true;
    this.protocol.disconnected();
    this.module?.uci('stop');
    this.module?.uci('quit');
    this.failure?.(new Error('Pikafish engine closed'));
  }
}
