import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attributesModule, classModule, h, init } from 'snabbdom';

import type AnalyseCtrl from '../src/ctrl';
import { GlyphForm, view, viewDisabled } from '../src/study/studyGlyph';

const palette = {
  move: [{ id: 1, symbol: '!', name: 'Good move' }],
  position: [{ id: 14, symbol: '⩲', name: 'Red is slightly better' }],
  observation: [{ id: 40, symbol: '→', name: 'Attack' }],
};

test('study glyph palette loads once, recovers from failure, and annotates the selected native move', async t => {
  const translations = globalThis.i18n;
  globalThis.i18n = {
    site: { loading: 'Loading…', retry: 'Retry' },
    study: { glyphsFailedToLoad: 'Could not load annotation glyphs.' },
  } as I18n;
  t.after(() => (globalThis.i18n = translations));
  Object.defineProperty(globalThis, 'MouseEvent', { value: window.MouseEvent, configurable: true });
  t.after(() => Reflect.deleteProperty(globalThis, 'MouseEvent'));
  document.documentElement.lang = 'en-GB';
  t.after(() => document.documentElement.removeAttribute('lang'));
  const requests: { url: string; init: RequestInit }[] = [];
  let respond: (response: Response) => void = () => {};
  t.mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return new Promise<Response>(resolve => (respond = resolve));
  });

  const changes: unknown[] = [];
  const selected = { chapterId: 'chapter1', path: 'a4a5' };
  const root = {
    node: { glyphs: [] },
    study: {
      withPosition: (data: object) => ({ ...selected, ...data }),
      makeChange: (type: string, data: object) => changes.push({ type, data }),
    },
    redraw: () => {
      vnode = patch(vnode, view(form));
    },
  } as unknown as AnalyseCtrl;
  const form = new GlyphForm(root);
  const patch = init([attributesModule, classModule]);
  const mount = document.createElement('div');
  document.body.append(mount);
  let vnode = patch(mount, viewDisabled('Select a move to annotate'));
  t.after(() => (vnode.elm as HTMLElement).remove());
  vnode = patch(vnode, view(form));
  const element = () => vnode.elm as HTMLElement;
  assert.equal(element().querySelector('svg'), null, 'loading uses text, without the horse spinner');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/study/glyphs/en-GB.json');
  assert.ok(requests[0].init.signal instanceof AbortSignal);
  await form.loadGlyphs();
  assert.equal(requests.length, 1, 'in-flight requests are shared across panel openings');

  respond(new Response('', { status: 503 }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(form.failed, true);
  assert.equal(form.loading, false);
  assert.equal(element().querySelector('button')?.textContent, 'Retry');
  element().querySelector('button')!.click();
  assert.equal(requests.length, 2);
  assert.equal(form.failed, false);
  assert.equal(element().querySelector('button'), null, 'retry returns to loading text');

  respond(new Response(JSON.stringify(palette)));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(form.all(), palette);
  assert.equal(element().querySelectorAll('button').length, 3);
  element().querySelector<HTMLButtonElement>('.move button')!.click();
  assert.deepEqual(changes, [{ type: 'toggleGlyph', data: { ...selected, id: 1 } }]);

  root.node.glyphs = palette.move;
  root.redraw();
  assert.equal(element().querySelector('.move button')?.classList.contains('active'), true);
  vnode = patch(vnode, h('div'));
  vnode = patch(vnode, view(form));
  assert.equal(requests.length, 2, 'the localized palette is reused after reopening');
});
