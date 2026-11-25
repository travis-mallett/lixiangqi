import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BANQI_START_FEN, searchBanqi } from '../src/game/banqi';

test('BanqiFish reuses one idle worker, terminates cancelled work and releases idle memory', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const workers: TestWorker[] = [];
  class TestWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    stopped = false;
    sent?: { wasm: string; history: string[]; multiPv: number };
    constructor(readonly url: string) {
      workers.push(this);
    }
    postMessage(request: typeof this.sent) {
      this.sent = request;
    }
    terminate() {
      this.stopped = true;
    }
    answer() {
      this.onmessage!({ data: { move: 'a1a1', lines: [], nodes: 1 } });
    }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: TestWorker });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'Worker', original);
    else Reflect.deleteProperty(globalThis, 'Worker');
  });
  const search = (signal: AbortSignal) => searchBanqi([BANQI_START_FEN], 10, signal, 17, 3);
  const first = new AbortController(),
    a = search(first.signal);
  workers[0].answer();
  assert.equal((await a).move, 'a1a1');
  first.abort();
  assert.equal(workers[0].stopped, false);
  const abort = new AbortController(),
    b = search(abort.signal);
  const c = search(new AbortController().signal);
  assert.equal(workers.length, 2);
  assert.match(workers[0].url, /banqifish-worker-v1\.js$/);
  assert.match(workers[0].sent!.wasm, /banqifish-v1\.wasm$/);
  assert.equal(workers[0].sent!.multiPv, 3);
  abort.abort();
  await assert.rejects(b, { name: 'AbortError' });
  assert(workers[0].stopped);
  workers[1].answer();
  await c;
  t.mock.timers.tick(30_000);
  assert(workers[1].stopped);
  await assert.rejects(search(abort.signal), { name: 'AbortError' });
  assert.equal(workers.length, 2);
});
