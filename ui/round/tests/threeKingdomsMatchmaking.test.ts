import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import { pubsub } from 'lib/pubsub';

const sent: string[] = [];
let boardDestroyed = 0;
mock.module('lib/board', {
  namedExports: {
    ...(await import('lib/board')),
    createXiangqiBoard: () => ({
      destroy() {
        boardDestroyed++;
      },
    }),
    makeBoardResizable() {},
  },
});
mock.module('lib/socket', {
  namedExports: {
    ...(await import('lib/socket')),
    wsSetActivity() {},
    wsConnect: () => ({ send: (type: string) => sent.push(type) }),
  },
});
mock.module('lib/traffic', {
  namedExports: {
    ...(await import('lib/traffic')),
    trafficAttemptId: () => 'test',
    trafficActivity() {},
    trafficNavigate() {},
    trackTraffic() {},
  },
});
pubsub.complete('socket.hasConnected');
const { PoolMatchmakingSession, initModule } = await import('../src/round.matchmaking');
const pool = {
  id: 'threeKingdoms-v1-ranked-15+0-m60',
  lim: 15,
  inc: 0,
  ranked: true,
  variant: 'threeKingdoms' as const,
  moveTime: { seconds: 60 },
};

test('entering the shared room does not join until Start; cancellation waits for a pending join', async () => {
  const original = globalThis.fetch;
  const methods: string[] = [];
  let finishJoin!: (response: Response) => void;
  globalThis.fetch = async (_url: string, init: RequestInit) => {
    methods.push(init.method!);
    if (init.method === 'POST')
      return new Promise<Response>(resolve => {
        finishJoin = resolve;
      });
    return new Response(JSON.stringify({ waiting: false }));
  };
  const session = new PoolMatchmakingSession(
    pool,
    true,
    () => assert.fail('Cancelled search paired'),
    () => {},
  );
  try {
    assert.deepEqual(methods, []);
    await session.start();
    assert.deepEqual(methods, ['POST']);
    const cancelled = session.cancel();
    assert.deepEqual(methods, ['POST']);
    finishJoin(new Response(JSON.stringify({ waiting: true })));
    assert.equal(await cancelled, undefined);
    assert.deepEqual(methods, ['POST', 'DELETE']);
    assert.equal(sent.includes('poolIn'), false);
  } finally {
    session.complete();
    globalThis.fetch = original;
  }
});

test('cancelling an already committed three-player match returns its round URL', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url: string, init: RequestInit) =>
    new Response(JSON.stringify(init.method === 'POST' ? { waiting: true } : { gameId: 'abcdefgh' }));
  const session = new PoolMatchmakingSession(
    pool,
    true,
    () => {},
    () => {},
  );
  try {
    await session.start();
    assert.equal(await session.cancel(), '/three-kingdoms/game/abcdefgh');
  } finally {
    session.complete();
    globalThis.fetch = original;
  }
});

test('a three-player pairing hands off to the shared round bootstrap without a page redirect', async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  const options = { mode: 'game', game: { id: 'abcdefgh' } };
  let loaded: unknown;
  let resolveLoaded!: () => void;
  const ready = new Promise<void>(resolve => {
    resolveLoaded = resolve;
  });
  Object.assign(site.asset, {
    loadEsm: async (name: string, opts: unknown) => {
      assert.equal(name, 'round');
      loaded = opts;
      resolveLoaded();
    },
  });
  Object.assign(site, { redirect: () => assert.fail('Unexpected page redirect') });
  Object.defineProperty(globalThis, 'history', { configurable: true, value: window.history });
  document.body.innerHTML =
    '<div id="main-wrap"><main class="round"><div class="round__app"></div></main></div>';
  globalThis.fetch = async (url: string) => {
    requested.push(url);
    return new Response(
      JSON.stringify(
        url.includes('/bootstrap/')
          ? {
              html: '<main class="round"><div class="round__app"></div></main>',
              options,
              url: '/three-kingdoms/game/abcdefgh',
              title: 'Three Kingdoms',
            }
          : { gameId: 'abcdefgh' },
      ),
    );
  };
  try {
    initModule({ pool, userId: 'player' });
    assert.deepEqual(requested, []);
    document.querySelector<HTMLButtonElement>('.round__matchmaking-start')!.click();
    await ready;
    assert.deepEqual(requested, ['/api/three-kingdoms/pool', '/round/bootstrap/abcdefgh']);
    assert.deepEqual(loaded, { init: options });
    assert.equal(window.location.pathname, '/three-kingdoms/game/abcdefgh');
    assert.equal(boardDestroyed, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
