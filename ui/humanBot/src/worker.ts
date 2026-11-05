import { compileProfile } from './controls';
import { BotSession, type SessionSnapshot } from './session';
import type { ClockSnapshot, ProfileSpec } from './types';
import { PikafishEngine } from './xiangqi/engine';
import { XiangqiKnowledge } from './xiangqi/knowledge';
import { XiangqiAdapter, type NativeRules, type XiangqiSnapshot } from './xiangqi/rules';

type Command =
  | {
      id: string;
      kind: 'init';
      profile: ProfileSpec;
      game: string;
      saved?: SessionSnapshot;
      engineBaseUrl?: string;
    }
  | {
      id: string;
      kind: 'decide';
      snapshot: XiangqiSnapshot;
      player: string;
      clock: ClockSnapshot;
      now: number;
    }
  | {
      id: string;
      kind: 'accept';
      token: string;
      before: XiangqiSnapshot;
      after: XiangqiSnapshot;
      acceptedAt: number;
    }
  | { id: string; kind: 'cancel'; token: string }
  | { id: string; kind: 'prepare'; snapshot: XiangqiSnapshot; player: string; observedWaitMs: number }
  | { id: string; kind: 'snapshot' };
interface WorkerScope {
  onmessage: ((event: MessageEvent<Command>) => void) | null;
  postMessage(message: unknown): void;
}
const scope = globalThis as unknown as WorkerScope;
let session: BotSession<import('./xiangqi/rules').XiangqiPosition> | undefined;
let queue = Promise.resolve();
// A dedicated worker owns one identity and one single-threaded WASM engine.
scope.onmessage = event => {
  const receivedAt = performance.now();
  const receivedWall = Date.now();
  queue = queue.then(async () => {
    const command = event.data;
    try {
      if (command.kind === 'init') {
        if (session) throw new Error('Worker is already initialized');
        if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined')
          throw new Error('Browser Pikafish requires cross-origin isolation (COOP/COEP) and shared memory');
        const rulesUrl = new URL('./rules/main.js', import.meta.url).href;
        const module = (await import(/* @vite-ignore */ rulesUrl)) as { XiangqiRules: NativeRules };
        const rules = new XiangqiAdapter(module.XiangqiRules),
          pack = new XiangqiKnowledge();
        const compiled = compileProfile(command.profile, pack.manifest);
        const manifestResponse = await fetch(new URL('./engine-manifest.json', import.meta.url));
        if (!manifestResponse.ok) throw new Error('Pikafish manifest could not be loaded');
        const manifest = (await manifestResponse.json()) as {
          version: string;
          networkSha256: string;
          files: Record<string, string>;
        };
        const base = new URL(command.engineBaseUrl ?? '/pikafish-web/', import.meta.url);
        const asset = (file: string): string => {
          const url = new URL(file, base);
          url.searchParams.set('v', manifest.files[file]);
          return url.href;
        };
        const networkResponse = await fetch(asset('pikafish.nnue'), { cache: 'force-cache' });
        if (!networkResponse.ok) throw new Error('Pikafish network could not be loaded');
        const network = new Uint8Array(await networkResponse.arrayBuffer());
        const engine = await PikafishEngine.create(rules, {
          ...manifest,
          moduleUrl: asset('pikafish.js'),
          wasmUrl: asset('pikafish.wasm'),
          network,
        });
        try {
          session = new BotSession(compiled, rules, pack, engine, command.game, command.saved);
        } catch (error) {
          engine.close();
          throw error;
        }
        scope.postMessage({
          id: command.id,
          ok: true,
          value: {
            ...session.snapshot(),
            runtime: {
              engine: engine.version,
              wasmHeapBytes: engine.memory.buffer.byteLength,
              networkBytes: network.byteLength,
            },
          },
        });
        return;
      }
      if (!session) throw new Error('Worker is not initialized');
      const rules = session.rules as XiangqiAdapter;
      let value: unknown;
      switch (command.kind) {
        case 'decide': {
          const state = session.state();
          const started = performance.now();
          const effectiveNow = Math.max(command.now, receivedWall) + started - receivedAt;
          const pending = await session.propose({
            id: command.id,
            game: state.game,
            player: command.player,
            position: rules.restore(command.snapshot),
            expectedRevision: state.revision,
            clock: command.clock,
            now: effectiveNow,
          });
          const elapsedMs = performance.now() - started;
          // No late action is disguised as ordinary personality behavior.
          if (effectiveNow + elapsedMs >= pending.expiresAt) {
            session.cancel(pending.token);
            throw new Error('Runtime exceeded the authoritative deadline');
          }
          value = { pending, computeMs: elapsedMs };
          break;
        }
        case 'accept':
          value = session.accept(
            command.token,
            rules.restore(command.before),
            rules.restore(command.after),
            command.acceptedAt,
          );
          break;
        case 'cancel':
          session.cancel(command.token);
          value = session.snapshot();
          break;
        case 'prepare':
          session.prepare(rules.restore(command.snapshot), command.player, command.observedWaitMs);
          value = session.snapshot();
          break;
        case 'snapshot':
          value = session.snapshot();
          break;
      }
      scope.postMessage({ id: command.id, ok: true, value });
    } catch (error) {
      scope.postMessage({
        id: command.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
};
