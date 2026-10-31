import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

test('an empty TV embed subscribes and displays the next broadcast without reloading', async () => {
  let receive: (event: { data: string }) => void = () => {};
  let initialized = 0;
  let updated = 0;
  let url = '';
  class Feed {
    constructor(source: string) {
      url = source;
    }
    addEventListener(_type: string, callback: typeof receive) {
      receive = callback;
    }
  }
  Object.assign(globalThis, { EventSource: Feed });
  Object.assign(window, { EventSource: Feed });
  mock.module('lib/view', {
    namedExports: {
      initMiniGame: () => initialized++,
      updateMiniGame: () => updated++,
    },
  });
  document.body.dataset.streamUrl = '/tv/computer/feed?bc=1';
  document.body.innerHTML = '<div id="featured-game"><p role="status">No game found</p></div>';
  await import('../src/site.tvEmbed');
  window.onload?.(new window.Event('load'));
  assert.equal(url, '/tv/computer/feed?bc=1');
  assert.equal(initialized, 0);
  receive({ data: JSON.stringify({ t: 'fen', d: {} }) });
  assert.equal(updated, 0);
  receive({
    data: JSON.stringify({
      t: 'featured',
      d: { html: '<a class="mini-game"><span class="mini-game__player">Player</span></a>' },
    }),
  });
  assert.equal(initialized, 1);
  assert.equal(document.querySelector('[role="status"]'), null);
  receive({ data: JSON.stringify({ t: 'fen', d: {} }) });
  assert.equal(updated, 1);
});
