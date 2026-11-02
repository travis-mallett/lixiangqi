import type { BoardInteraction, BoardPosition } from '@lixiangqi/board';
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { Engine, type Rules } from 'threeKingdoms';

import { pubsub } from 'lib/pubsub';

let interaction: BoardInteraction;
let displayed: BoardPosition;
let destroyed = 0;
let zenToggles = 0;
mock.module('lib/view/zen', { namedExports: { toggleZenMode: () => zenToggles++ } });
mock.module('lib/board', {
  namedExports: {
    ...(await import('lib/board')),
    createXiangqiBoard: (_element: HTMLElement, position: BoardPosition) => {
      displayed = position;
      return {
        setInteraction(value: BoardInteraction) {
          interaction = value;
        },
        display(value: BoardPosition) {
          displayed = value;
        },
        setPresentation() {},
        destroy() {
          destroyed++;
        },
      };
    },
    makeBoardResizable() {},
  },
});
mock.module('lib/socket', { namedExports: { ...(await import('lib/socket')), wsSetActivity() {} } });
mock.module('lib/menuHover', { defaultExport() {} });

document.documentElement.lang = 'en';
const { Round, localGame } = await import('../src/variants/threeKingdomsCtrl');
const rules: Rules = (
  await import(new URL('../../../public/three-kingdoms-engine/main.js', import.meta.url).href)
).ThreeKingdoms;

const keyboards = new Map<string, () => void>();
window.matchMedia = globalThis.matchMedia;
Object.assign(site, {
  sound: { preloadBoardSounds() {} },
  mousetrap: {
    bind(keys: string | string[], callback: () => void) {
      for (const key of typeof keys === 'string' ? [keys] : keys) keyboards.set(key, callback);
      return this;
    },
    unbind(key: string) {
      keyboards.delete(key);
      return this;
    },
  },
});
const translations = (namespace: string) =>
  new Proxy(
    {},
    {
      get: (_, key: string) =>
        ['turn', 'controls', 'place', 'drawOffered', 'takebackOffered'].includes(key)
          ? (text: string) => `${key}: ${text}`
          : `${namespace}.${key}`,
    },
  );
Object.defineProperty(globalThis, 'i18n', {
  value: { site: translations('site'), threeKingdoms: translations('threeKingdoms') },
});

test('local three-seat play uses round controls, preserves replay, and releases the room', async t => {
  t.mock.method(Date, 'now', () => 1_000_000);
  document.body.innerHTML =
    '<main class="round"><aside class="round__side"></aside><div class="round__app"></div></main>';
  const game = localGame(rules, 'red', 1, 900, 60);
  // Keep opponents idle to test the human move and replay without a worker.
  game.seats.forEach(seat => {
    seat.aiLevel = null;
  });
  const round = new Round(
    document.querySelector('.round__app')!,
    game,
    rules,
    { mode: 'local', me: null, preferences: {} },
    true,
  );
  try {
    assert.ok(document.querySelector('.round__app.variant-threeKingdoms .rcontrols .ricons'));
    assert.equal(document.querySelectorAll('[data-seat]').length, 3);
    assert.equal(document.querySelectorAll('bo3 button[data-ply]').length, 4);
    assert.equal(document.querySelectorAll('#three-kingdoms').length, 0);
    assert.equal(interaction.mode, 'play');
    assert.equal(document.querySelector('[data-clock="red"]')?.textContent, '15:00');
    keyboards.get('z')!();
    assert.equal(zenToggles, 1);
    const move = rules.inspect(game.position).moves[0];
    const [from, to] = move.split('>');
    if (interaction.mode === 'play') interaction.onMove({ from, to });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(JSON.parse(localStorage.getItem('threeKingdoms.localGame')!).eventCount, 1);
    assert.equal(document.querySelectorAll('.round__event-moves .kingdom-move-row').length, 1);
    assert.equal(document.querySelectorAll('.round__event-moves .kingdom-piece').length, 1);
    assert.equal(displayed.active, 'green');
    const first = document.querySelector<HTMLButtonElement>('bo3 button[data-ply="0"]')!;
    assert.equal(first.disabled, false);
    first.click();
    assert.equal(displayed.active, 'red');
    assert.equal(interaction.mode, 'display');
    keyboards.get('end')!();
    assert.equal(displayed.active, 'green');
    const rotate = document.querySelector<HTMLButtonElement>('button[title="threeKingdoms.rotate"]')!;
    rotate.click();
    assert.equal(document.querySelector('.ruser-bottom [data-seat]')?.getAttribute('data-seat'), 'black');
  } finally {
    round.destroy();
  }
  assert.equal(destroyed, 1);
  assert.equal(keyboards.size, 0);
  pubsub.emit('zen');
  assert.equal(zenToggles, 1);
  round.destroy();
  assert.equal(destroyed, 1);
});

test('server updates preserve a replay cursor and elimination switches the player to spectating', async () => {
  document.body.innerHTML =
    '<main class="round"><aside class="round__side"></aside><div class="round__app"></div></main>';
  let stream: { onmessage: (event: { data: string }) => void; close(): void };
  let closed = false;
  Object.defineProperty(globalThis, 'EventSource', {
    configurable: true,
    value: class {
      onmessage: (event: { data: string }) => void;
      constructor() {
        stream = this;
      }
      close() {
        closed = true;
      }
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ lines: [], writeable: false, bookmarked: false }));
  let game = localGame(rules, 'red', 1, 900, 60);
  game.seats.forEach(seat => {
    seat.aiLevel = null;
  });
  game = { ...game, id: 'abcdefgh', rated: true };
  const round = new Round(document.querySelector('.round__app')!, game, rules, {
    mode: 'game',
    me: 'local',
    preferences: {},
  });
  const send = (action: string) => {
    const actor = rules.inspect(game.position).turn;
    game = {
      ...game,
      position: rules.event(game.position, actor, action),
      revision: game.revision + 1,
      eventCount: game.eventCount + 1,
      events: [...game.events, { action, actor, at: Date.now(), clocks: game.clock.remaining }],
    };
    stream.onmessage({ data: JSON.stringify(game) });
  };
  try {
    send(rules.inspect(game.position).moves[0]);
    keyboards.get('home')!();
    send(rules.inspect(game.position).moves[0]);
    assert.equal(displayed.active, 'red');
    assert.equal(document.querySelectorAll('.round__event-moves .kingdom-piece').length, 2);
    keyboards.get('end')!();
    assert.equal(displayed.active, 'black');
    send(rules.inspect(game.position).moves[0]);
    send('resign');
    assert.equal(interaction.mode, 'display');
    assert.ok(document.querySelector('[data-seat="red"].eliminated'));
    assert.ok(document.querySelector('a[href="/analysis/threeKingdoms?game=abcdefgh"]'));
    assert.equal(closed, false, 'Eliminated players can keep watching the final duel');
  } finally {
    round.destroy();
    globalThis.fetch = originalFetch;
  }
  assert.equal(closed, true);
  assert.equal(document.querySelectorAll('.round__chat').length, 0);
});

for (const searchTime of [0, 750, 2500])
  test(`computer turns take at least two seconds with a ${searchTime}ms search`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.mock.method(performance, 'now', () => Date.now());
    t.mock.method(Engine.prototype, 'analyze', async (position: string) => {
      await new Promise(resolve => setTimeout(resolve, searchTime));
      const state = rules.inspect(position);
      return {
        depth: 1,
        nodes: 1,
        lines: [{ scores: [], pvMoves: [state.moves[0]], active: state.active, winners: null }],
      };
    });
    const flush = async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    };
    document.body.innerHTML =
      '<main class="round"><aside class="round__side"></aside><div class="round__app"></div></main>';
    const game = localGame(rules, 'black', 1, 900, 60);
    const round = new Round(
      document.querySelector('.round__app')!,
      game,
      rules,
      { mode: 'local', me: null, preferences: {} },
      true,
    );
    const eventCount = () => JSON.parse(localStorage.getItem('threeKingdoms.localGame')!).eventCount;
    try {
      for (let turn = 0; turn < 2; turn++) {
        t.mock.timers.tick(searchTime);
        await flush();
        if (searchTime < 2000) {
          t.mock.timers.tick(1999 - searchTime);
          await flush();
          assert.equal(eventCount(), turn);
          t.mock.timers.tick(1);
          await flush();
        }
        assert.equal(eventCount(), turn + 1);
      }
    } finally {
      round.destroy();
    }
  });
