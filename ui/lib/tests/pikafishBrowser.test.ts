import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { setImmediate } from 'node:timers/promises';

let download: (options: {
  signal: AbortSignal;
  onProgress: (bytes: number, total: number) => void;
}) => Promise<Uint8Array>;
let evicted = 0;
mock.module(new URL('../src/bigFileStorage.ts', import.meta.url).href, {
  namedExports: {
    bigFileStorage: () => ({
      get: (_url: string, options: Parameters<typeof download>[0]) => download(options),
      delete: async () => {
        evicted++;
      },
    }),
  },
});
const { PikafishBrowserEngine } = await import('../src/ceval/engines/pikafishBrowser.ts');

function moduleHarness() {
  const commands: string[] = [];
  const module = {
    listen: (_line: string) => {},
    onError: (_message: string) => {},
    uci: (command: string) => commands.push(command),
    getRecommendedNnue: () => 'test.nnue',
    setNnueBuffer: () => {},
  };
  const urls: { path: string; options: AssetUrlOpts }[] = [];
  Object.assign(globalThis, { crossOriginIsolated: true, pikafishTestModule: module });
  Object.assign(site, {
    asset: {
      url: (path: string, options: AssetUrlOpts = {}) => {
        urls.push({ path, options });
        return 'data:text/javascript,export default async () => globalThis.pikafishTestModule';
      },
    },
  });
  return { module, commands, urls };
}

test('a disposed engine cannot evict the replacement engine cache or announce readiness', async () => {
  const h = moduleHarness();
  evicted = 0;
  download = async () => new Uint8Array(1);
  const statuses: string[] = [];
  const engine = new PikafishBrowserEngine(status => statuses.push(status.state));
  const cancelled = assert.rejects(engine.prepare(), /destroyed/);
  await setImmediate();
  engine.destroy();
  await cancelled;
  h.module.onError('Pikafish could not initialize the NNUE network');
  h.module.listen('uciok');
  h.module.listen('readyok');
  await setImmediate();
  assert.equal(evicted, 0);
  assert.equal(statuses.includes('ready'), false);
});

test('preparation configures native threads and hash, awaits readyok, and performs no search', async () => {
  const h = moduleHarness();
  download = async () => new Uint8Array(1);
  const statuses: string[] = [];
  const engine = new PikafishBrowserEngine(s => statuses.push(s.state), { threads: 4, hashSize: 32 });
  let ready = false;
  const preparation = engine.prepare().then(() => {
    ready = true;
  });
  await setImmediate();
  assert.deepEqual(statuses, ['loading', 'initializing']);
  assert.deepEqual(h.commands, ['uci']);
  assert.equal(ready, false);
  h.module.listen('uciok');
  assert.deepEqual(h.commands, [
    'uci',
    'setoption name Threads value 4',
    'setoption name Hash value 32',
    'ucinewgame',
    'isready',
  ]);
  assert.equal(ready, false);
  h.module.listen('readyok');
  await preparation;
  assert.equal(statuses.at(-1), 'ready');
  assert.ok(!h.commands.some(c => c.startsWith('go')));
  assert.ok(
    h.urls.every(url => !url.options.pathVersion),
    'use the content-hashed asset manifest',
  );
  engine.destroy();
});

test('a progressing download can exceed a minute; startup must still acknowledge readiness', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = moduleHarness();
  let progress!: (bytes: number, total: number) => void;
  let complete!: (bytes: Uint8Array) => void;
  download = options => {
    progress = options.onProgress;
    return new Promise(resolve => {
      complete = resolve;
    });
  };
  const statuses: string[] = [];
  const engine = new PikafishBrowserEngine(s => statuses.push(s.state));
  const prepared = engine.prepare();
  await setImmediate();
  for (let step = 1; step <= 4; step++) {
    t.mock.timers.tick(30_000);
    progress(step, 4);
  }
  assert.equal(statuses.includes('error'), false);
  assert.equal(statuses.includes('ready'), false);
  complete(new Uint8Array(1));
  await setImmediate();
  h.module.listen('uciok');
  assert.equal(statuses.at(-1), 'initializing');
  h.module.listen('readyok');
  await prepared;
  assert.equal(statuses.at(-1), 'ready');
  engine.destroy();
});

test('a stalled download is aborted and late completion cannot publish ready', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = moduleHarness();
  let signal!: AbortSignal;
  let complete!: (bytes: Uint8Array) => void;
  download = options => {
    signal = options.signal;
    return new Promise(resolve => {
      complete = resolve;
    });
  };
  const statuses: string[] = [];
  const engine = new PikafishBrowserEngine(s => statuses.push(s.state));
  const failed = assert.rejects(engine.prepare(), /timed out/);
  await setImmediate();
  t.mock.timers.tick(60_000);
  await failed;
  assert.equal(signal.aborted, true);
  assert.equal(statuses.at(-1), 'error');
  complete(new Uint8Array(1));
  await setImmediate();
  h.module.listen('uciok');
  h.module.listen('readyok');
  assert.equal(statuses.includes('ready'), false);
  assert.deepEqual(h.commands, ['quit']);
  engine.destroy();
});
test('destroy during NNUE download cannot reconnect the disposed engine', async () => {
  const commands: string[] = [];
  let buffers = 0;
  let downloaded!: (buffer: Uint8Array) => void;
  download = () =>
    new Promise(resolve => {
      downloaded = resolve;
    });
  Object.assign(globalThis, {
    crossOriginIsolated: true,
    pikafishTestModule: {
      uci: (command: string) => commands.push(command),
      getRecommendedNnue: () => 'test.nnue',
      setNnueBuffer: () => {
        buffers++;
      },
    },
  });
  Object.assign(site, {
    asset: { url: () => 'data:text/javascript,export default async () => globalThis.pikafishTestModule' },
  });
  const statuses: string[] = [];
  const engine = new PikafishBrowserEngine(status => statuses.push(status.state));
  await setImmediate();
  assert.equal(typeof downloaded, 'function');
  engine.destroy();
  downloaded(new Uint8Array());
  await setImmediate();
  assert.equal(buffers, 0);
  assert.deepEqual(commands, ['quit']);
  assert.equal(statuses.includes('ready'), false);
  assert.throws(
    () => engine.start({ fen: '', search: { depth: 1 }, multiPv: 1, threads: 1, hashSize: 16, emit() {} }),
    /destroyed/,
  );
});

test('destroy while the module is loading disposes it when it arrives', async () => {
  const commands: string[] = [];
  let loaded!: (module: object) => void;
  Object.assign(globalThis, {
    crossOriginIsolated: true,
    pikafishTestFactory: () =>
      new Promise(resolve => {
        loaded = resolve;
      }),
  });
  Object.assign(site, {
    asset: { url: () => 'data:text/javascript,export default () => globalThis.pikafishTestFactory()' },
  });
  const engine = new PikafishBrowserEngine(() => {});
  await setImmediate();
  engine.destroy();
  loaded({ uci: (command: string) => commands.push(command) });
  await setImmediate();
  assert.deepEqual(commands, ['quit']);
});
