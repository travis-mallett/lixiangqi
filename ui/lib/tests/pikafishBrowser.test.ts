import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { setImmediate } from 'node:timers/promises';

let download: () => Promise<Uint8Array>;
mock.module(new URL('../src/bigFileStorage.ts', import.meta.url).href, {
  namedExports: { bigFileStorage: () => ({ get: () => download() }) },
});
const { PikafishBrowserEngine } = await import('../src/ceval/engines/pikafishBrowser.ts');

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
    () => engine.start({ fen: '', depth: 1, multiPv: 1, threads: 1, hashSize: 16, emit() {} }),
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
