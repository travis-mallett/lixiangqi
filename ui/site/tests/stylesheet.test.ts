import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { loadStylesheet } from '../src/stylesheet';

afterEach(() => document.head.replaceChildren());

test('concurrent loads wait for CSS instead of exposing unstyled content', async () => {
  const first = loadStylesheet('/assets/css/menu.12345678.css', 'menu');
  const second = loadStylesheet('/assets/css/menu.12345678.css', 'menu');
  assert.equal(first, second);
  assert.equal(document.head.children.length, 1);
  let loaded = false;
  void second.then(() => (loaded = true));
  await Promise.resolve();
  assert.equal(loaded, false);
  document.head.firstElementChild!.dispatchEvent(new window.Event('load'));
  await second;
  assert.equal(loaded, true);
});

test('an existing link is not ready until its load event', async () => {
  document.head.innerHTML = '<link rel="stylesheet" href="/assets/css/page.css">';
  const promise = loadStylesheet('/assets/css/page.css');
  let loaded = false;
  void promise.then(() => (loaded = true));
  await Promise.resolve();
  assert.equal(loaded, false);
  document.head.firstElementChild!.dispatchEvent(new window.Event('load'));
  await promise;
});

test('a failed load rejects every waiter and can be retried', async () => {
  const first = loadStylesheet('/assets/css/menu.css');
  const second = loadStylesheet('/assets/css/menu.css');
  const rejected = Promise.all([
    assert.rejects(first, /Stylesheet failed/),
    assert.rejects(second, /Stylesheet failed/),
  ]);
  document.head.firstElementChild!.dispatchEvent(new window.Event('error'));
  await rejected;
  assert.equal(document.head.children.length, 0);
  const retry = loadStylesheet('/assets/css/menu.css');
  document.head.firstElementChild!.dispatchEvent(new window.Event('load'));
  await retry;
});

test('already applied CSS resolves without waiting for another event', async () => {
  document.head.innerHTML = '<link rel="stylesheet" href="/assets/css/page.css">';
  Object.defineProperty(document.head.firstElementChild!, 'sheet', { value: {} });
  await loadStylesheet('/assets/css/page.css');
});
