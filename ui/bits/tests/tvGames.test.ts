import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

test('TV grids recover from empty channels, preserve live boards, and retry failed refreshes', async () => {
  const cash = await import('../../../public/javascripts/vendor/cash.min.js');
  Object.assign(globalThis, { $: cash.default, DOMParser: window.DOMParser });
  let refresh: () => Promise<void> = async () => {};
  let response = '';
  let failed = false;
  let requests = 0;
  let reloads = 0;
  let contentLoaded = 0;
  Object.assign(site, { load: Promise.resolve(), reload: () => reloads++ });
  mock.method(globalThis, 'setInterval', ((callback: () => Promise<void>) => {
    refresh = callback;
    return 1;
  }) as typeof setInterval);
  mock.module('lib/api', { namedExports: { api: { overrides: {} } } });
  mock.module('lib/pubsub', {
    namedExports: { pubsub: { on: () => {}, emit: () => contentLoaded++ } },
  });
  mock.module('lib/xhr', {
    namedExports: {
      text: async () => {
        requests++;
        if (failed) throw new Error('offline');
        return response;
      },
      json: async () => ({}),
    },
  });
  const grid = (contents: string, recent = '') =>
    `<main class="tv-games"><div class="page-menu__content"><div class="tv-current now-playing">${contents}</div><div class="tv-recent now-playing">${recent}</div></div></main>`;
  const board = (id: string) => `<a class="mini-game" href="/${id}/white">${id}</a>`;
  document.body.innerHTML = grid('<p role="status">No game found</p>');
  await import('../src/bits.tvGames');
  await Promise.resolve();

  response = grid(board('game0001'));
  await refresh();
  assert.equal(document.querySelectorAll('.mini-game').length, 1);
  assert.equal(document.querySelector('[role="status"]'), null);
  const first = document.querySelector('.mini-game');
  response = grid(board('game0001') + board('game0002'));
  await refresh();
  assert.equal(document.querySelector('.mini-game'), first);
  assert.equal(document.querySelectorAll('.mini-game').length, 2);

  failed = true;
  await refresh();
  assert.equal(document.querySelectorAll('.mini-game').length, 2);
  failed = false;
  response = grid(board('game0002'));
  await refresh();
  assert.equal(document.querySelectorAll('.mini-game').length, 1);
  assert.equal(document.querySelector('.mini-game')?.textContent, 'game0002');

  response = grid(board('game0002'), board('game0001'));
  await refresh();
  assert.equal(document.querySelector('.tv-current .mini-game')?.textContent, 'game0002');
  assert.equal(document.querySelector('.tv-recent .mini-game')?.textContent, 'game0001');

  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  const before = requests;
  await refresh();
  assert.equal(requests, before);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });

  response = '<main class="tv-single"></main>';
  await refresh();
  assert.equal(reloads, 1);
  assert.equal(contentLoaded, 4);
});
