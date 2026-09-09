import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readonly sent: string[] = [];
  readyState = FakeWebSocket.CONNECTING;
  onopen = () => {};
  onclose = (_event: CloseEvent) => {};
  onerror = (_event: Event) => {};
  onmessage = (_event: MessageEvent) => {};
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(message: string) {
    this.sent.push(message);
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen();
  }
}

Object.assign(globalThis, { WebSocket: FakeWebSocket });
document.body.dataset.socketDomains = 'localhost';
Object.assign(globalThis, { location: window.location });
mock.module(new URL('../src/permalog.ts', import.meta.url).href, { namedExports: { log: () => {} } });
const { wsConnect, wsDestroy, wsSetActivity } = await import('../src/socket');

afterEach(() => {
  wsDestroy();
  FakeWebSocket.instances.length = 0;
  localStorage.clear();
  mock.timers.reset();
});

beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'setInterval'] }));

test('presence activity is sent on open, update, and clear', () => {
  wsSetActivity('puzzle');
  wsConnect('/socket/v5', false);
  const socket = FakeWebSocket.instances[0];
  assert.match(socket.url, /activity=puzzle/);
  socket.open();
  assert.deepEqual(JSON.parse(socket.sent.at(-1)), { t: 'presence', d: { activity: 'puzzle', group: null } });

  wsSetActivity('lobby');
  assert.deepEqual(JSON.parse(socket.sent.at(-1)), { t: 'presence', d: { activity: 'lobby', group: null } });
  wsSetActivity();
  assert.deepEqual(JSON.parse(socket.sent.at(-1)), { t: 'presence', d: { activity: null, group: null } });
});

test('shared visitor id persists and reconnect URL uses latest activity', () => {
  wsSetActivity('pool-id');
  wsConnect('/socket/v5', false);
  const first = FakeWebSocket.instances[0];
  const firstVisitor = new URL(first.url).searchParams.get('visitor');
  assert.ok(firstVisitor);
  wsSetActivity('ai');
  wsDestroy();
  wsConnect('/socket/v5', false);
  const secondVisitor = new URL(FakeWebSocket.instances[1].url).searchParams.get('visitor');
  assert.equal(secondVisitor, firstVisitor);
  assert.match(FakeWebSocket.instances[1].url, /activity=ai/);
});
