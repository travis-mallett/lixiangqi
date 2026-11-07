import assert from 'node:assert/strict';
import { afterEach, test, type TestContext } from 'node:test';

import { XIANGQI_START_FEN } from 'lib/game/xiangqi';

import EditorCtrl from '../src/ctrl';
import { editorFen, emptyFen } from '../src/fen';
import type { Config } from '../src/interfaces';
import EditorView from '../src/view';

const config: Config = {
  baseUrl: '/editor',
  startFen: XIANGQI_START_FEN,
  animation: { duration: 0 },
  embed: true,
};
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

function validation(t: TestContext, cfg = config) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending: Array<{ resolve: (response: Response) => void; signal: AbortSignal }> = [];
  const fetch = t.mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
    assert.equal(url, '/editor/validate?variant=xiangqi');
    return new Promise<Response>(resolve => pending.push({ resolve, signal: init.signal as AbortSignal }));
  });
  const ctrl = new EditorCtrl(cfg, () => {});
  t.after(() => ctrl.destroy());
  const reply = (index: number, body: object, status = 200) =>
    pending[index].resolve(new Response(JSON.stringify(body), { status }));
  const valid = (fen = ctrl.getFen()) => ({ fen, playable: true });
  return { ctrl, pending, fetch, reply, valid };
}

test('Standard FEN keeps counters, rank ten and side; accepts editable diagrams', () => {
  assert.equal(editorFen(XIANGQI_START_FEN.replace(/ /g, '_')), XIANGQI_START_FEN);
  assert.equal(editorFen(emptyFen.split(' ')[0]), emptyFen);
  assert.equal(
    editorFen(emptyFen.replace('w - - 0 1', 'b - - 23 42')),
    emptyFen.replace('w - - 0 1', 'b - - 23 42'),
  );
});

test('rejects variants, concealed pieces, wrong geometry and malformed metadata without changing the board', () => {
  const ctrl = new EditorCtrl(config, () => {});
  for (const fen of [
    emptyFen.replace(' w ', ' red '),
    emptyFen.replace(' - - ', ' j - '),
    emptyFen.replace(' - - ', ' m - '),
    emptyFen.replace('9/', 'X8/'),
    emptyFen.replace('9/', 'M8/'),
    '7/7/7/7/7/7/7 w - - 0 1',
    emptyFen.replace('0 1', '-1 1'),
    emptyFen.replace('0 1', '0 0'),
    emptyFen.replace('0 1', '0 1junk'),
    emptyFen.replace('0 1', '0 999999999999'),
    `${emptyFen} extra`,
  ]) {
    assert.equal(editorFen(fen), undefined, fen);
    assert.equal(ctrl.setFen(fen), false, fen);
    assert.equal(ctrl.getFen(), XIANGQI_START_FEN);
  }
  ctrl.destroy();
});

test('an invalid incoming link is visible and does not silently become the starting position', () => {
  const ctrl = new EditorCtrl({ ...config, fen: 'invalid' }, () => {});
  assert.equal(ctrl.invalidFen, 'invalid');
  assert.equal(ctrl.getFen(), emptyFen);
  assert.equal(ctrl.state.playable, false);
  ctrl.destroy();
});

test('rapid edits debounce requests, revoke stale actions and ignore out-of-order responses', async t => {
  const { ctrl, fetch, pending, reply, valid } = validation(t);
  ctrl.changed();
  t.mock.timers.tick(200);
  reply(0, valid());
  await tick();
  assert.equal(ctrl.state.playable, true);
  ctrl.clearBoard();
  assert.equal(ctrl.state.legalFen, undefined);
  assert.equal(ctrl.state.playable, false);
  ctrl.startPosition();
  t.mock.timers.tick(200);
  ctrl.clearBoard();
  assert.equal(pending[1].signal.aborted, true);
  t.mock.timers.tick(200);
  reply(2, { error: 'Missing generals' }, 400);
  await tick();
  reply(1, valid(XIANGQI_START_FEN));
  await tick();
  assert.equal(fetch.mock.callCount(), 3);
  assert.equal(ctrl.state.fen, emptyFen);
  assert.equal(ctrl.state.error, 'invalid');
  assert.equal(ctrl.state.legalFen, undefined);
});

test('flipping preserves pending validation and shares the diagram with its perspective', async t => {
  const { ctrl, fetch, reply, valid } = validation(t);
  ctrl.changed();
  t.mock.timers.tick(200);
  ctrl.flip();
  assert.equal(ctrl.state.validating, true);
  assert.equal(new URL(ctrl.url(), 'https://example.test').searchParams.get('color'), 'black');
  reply(0, valid());
  await tick();
  assert.equal(ctrl.state.playable, true);
  assert.equal(fetch.mock.callCount(), 1);
});

test('service failure can be retried and destruction cancels pending validation', async t => {
  const { ctrl, pending, reply, valid } = validation(t);
  ctrl.changed();
  t.mock.timers.tick(200);
  reply(0, { error: 'Offline' }, 503);
  await tick();
  assert.equal(ctrl.state.error, 'unavailable');
  ctrl.retry();
  t.mock.timers.tick(200);
  ctrl.destroy();
  assert.equal(pending[1].signal.aborted, true);
  reply(1, valid());
  await tick();
  assert.equal(ctrl.state.playable, false);
});

test('terminal positions allow analysis but not another game', async t => {
  const { ctrl, reply } = validation(t);
  ctrl.changed();
  t.mock.timers.tick(200);
  reply(0, { fen: ctrl.getFen(), playable: false });
  await tick();
  assert.ok(ctrl.state.legalFen);
  assert.equal(ctrl.state.playable, false);
});

afterEach(() => document.body.replaceChildren());

test('embedded editor synchronizes turn, swaps palettes, exposes both colors and releases its board', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const root = document.createElement('div');
  document.body.append(root);
  const ctrl = new EditorCtrl(config, () => view.update());
  const view = new EditorView(root, ctrl);
  view.mount();
  t.after(() => view.destroy());
  assert.equal(root.querySelectorAll('.spare .white').length, 7);
  assert.equal(root.querySelectorAll('.spare .black').length, 7);
  assert.equal(root.querySelectorAll('cg-resize, .copyables, .actions a').length, 0);
  ctrl.setFen(XIANGQI_START_FEN.replace(' w ', ' b '));
  assert.equal(root.querySelector('select')!.value, 'black');
  ctrl.startPosition();
  assert.equal(root.querySelector('select')!.value, 'red');
  ctrl.flip();
  assert.ok(root.querySelector('.spare-black.spare-bottom'));
  (root.querySelector('[data-selection="red:cannon"]') as HTMLElement).click();
  assert.equal(root.querySelector('[data-selection="red:cannon"]')!.getAttribute('aria-pressed'), 'true');
  ctrl.ground!.place('a10', { face: 'up', participant: 'red', role: 'cannon' });
  assert.ok(ctrl.getFen().startsWith('Cnbakabnr/'));
  ctrl.ground!.place('a10');
  assert.ok(ctrl.getFen().startsWith('1nbakabnr/'));
});
