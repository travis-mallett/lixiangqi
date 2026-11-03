import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { Game } from 'threeKingdoms';

const games: Game[] = [];
const mounted: Game[] = [];
let selected: Game | undefined;
let destroyed = 0;
let miniLoads = 0;
mock.module('threeKingdoms', {
  namedExports: {
    ...(await import('threeKingdoms')),
    loadRules: async () => ({}),
    request: async () => ({ game: selected, history: games }),
  },
});
mock.module('../src/variants/threeKingdomsCtrl', {
  namedExports: {
    Round: class {
      constructor(_root: HTMLElement, game: Game) {
        mounted.push(game);
      }
      destroy() {
        destroyed++;
      }
    },
    localGame() {},
  },
});

const streams: { closed: boolean; close(): void }[] = [];
Object.assign(globalThis, {
  EventSource: class {
    closed = false;
    constructor() {
      streams.push(this);
    }
    close() {
      this.closed = true;
    }
  },
  i18n: {
    site: {
      noGameFound: 'No games found',
      previouslyOnLichessTV: 'Previously on TV',
      anonymous: 'Anonymous',
    },
    threeKingdoms: { computer: 'Computer', rated: 'Rated', casual: 'Casual' },
  },
});
Object.assign(site.asset, {
  loadEsm: async () => {
    miniLoads++;
  },
});

const { initThreeKingdoms } = await import('../src/variants/threeKingdoms');
const game = {
  id: 'kingdom1',
  position: 'saved-position',
  seats: [{ user: { name: 'Player' } }, { guest: true }, { aiLevel: 3 }],
  createdAt: 1_000,
  rated: false,
} as Game;

function page() {
  document.body.innerHTML =
    '<main class="round tv-single"><aside class="round__side"></aside><div class="round__app"></div><div class="round__underboard"></div></main>';
}

test('quiet Three Kingdoms TV renders board previews under the round and keeps the selection stream open', async () => {
  page();
  games.push(game);
  const tv = await initThreeKingdoms({ mode: 'tv', me: null });
  try {
    assert.equal(document.querySelector('.round__status')?.textContent, 'No games found');
    const history = document.querySelector('.round__underboard .tv-history .now-playing')!;
    const preview = history.querySelector<HTMLElement>('[data-three-kingdoms-position]')!;
    assert.equal(preview.dataset.threeKingdomsPosition, game.position);
    assert.equal(history.querySelector('a')?.getAttribute('href'), '/three-kingdoms/game/kingdom1');
    assert.match(history.textContent, /Player · Anonymous · Computer 3/);
    assert.equal(miniLoads, 1);
    assert.equal(streams.at(-1)!.closed, false);
  } finally {
    tv.destroy();
    games.length = 0;
  }
  assert.equal(streams.at(-1)!.closed, true);
});

test('selected Three Kingdoms TV mounts the round and renders an explicit empty history', async () => {
  page();
  selected = game;
  const tv = await initThreeKingdoms({ mode: 'tv', me: 'spectator' });
  try {
    assert.deepEqual(mounted, [game]);
    assert.equal(document.querySelector('.tv-history .now-playing')?.textContent, 'No games found');
    assert.equal(document.querySelectorAll('main').length, 1);
  } finally {
    tv.destroy();
    selected = undefined;
  }
  assert.equal(destroyed, 1);
  assert.equal(streams.at(-1)!.closed, true);
});
