import assert from 'node:assert/strict';
import { test } from 'node:test';
import { init, attributesModule, propsModule, eventListenersModule } from 'snabbdom';

import SetupController from '../src/setupCtrl';
import { kingdomClock, kingdomOpponents } from '../src/view/setup/components/kingdomSetup';
import { levelButtons } from '../src/view/setup/components/levelButtons';

const cash = await import('../../../public/javascripts/vendor/cash.min.js');
Object.assign(globalThis, { $: cash.default });

function setup(type: 'ai' | 'friend', authenticated = true) {
  const ctrl = new SetupController({
    leavePool() {},
    redraw() {},
    pools: [],
    me: authenticated ? { username: 'Alice' } : undefined,
  } as any);
  ctrl.loadAiStats = async () => assert.fail('Three Kingdoms must not request Xiangqi bot stats');
  ctrl.openModal(type, { variant: 'threeKingdoms' });
  return ctrl;
}

test('shared computer setup exposes five levels, three seats and only legal clocks', () => {
  const ctrl = setup('ai');
  const patch = init([attributesModule, propsModule, eventListenersModule]);
  const root = patch(document.createElement('div'), levelButtons(ctrl)).elm as HTMLElement;
  assert.equal(root.querySelector<HTMLInputElement>('#sf_level')!.max, '4');
  assert.deepEqual(
    [...root.querySelectorAll('#sf_kingdom option')].map(o => o.getAttribute('value')),
    ['red', 'green', 'black', 'random'],
  );
  const clocks = patch(document.createElement('div'), kingdomClock(ctrl)).elm as HTMLElement;
  assert.deepEqual(
    [...clocks.querySelectorAll('#sf_kingdom_time option')].map(o => o.textContent),
    ['7', '10', '15'],
  );
  assert.equal(ctrl.valid(), true);
  ctrl.kingdomTime(5);
  assert.equal(ctrl.valid(), false);
});

test('shared friend setup requires two distinct opponents other than the challenger', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ctrl = setup('friend');
  const patch = init([attributesModule, propsModule, eventListenersModule]);
  const root = patch(document.createElement('div'), kingdomOpponents(ctrl)).elm as HTMLElement;
  const inputs = root.querySelectorAll<HTMLInputElement>('input');
  assert.equal(inputs.length, 2);
  inputs[0].value = 'Bob';
  inputs[0].dispatchEvent(new window.Event('input'));
  inputs[1].value = 'Carol';
  inputs[1].dispatchEvent(new window.Event('input'));
  assert.equal(ctrl.valid(), true);
  ctrl.friendUserTwo = ' BOB ';
  assert.equal(ctrl.valid(), false);
  ctrl.friendUserTwo = 'alice';
  assert.equal(ctrl.valid(), false);
  const guest = setup('friend', false);
  guest.friendUser = 'Bob';
  guest.friendUserTwo = 'Carol';
  assert.equal(guest.valid(), false);
});

test('both friend fields use shared suggestions and retain mouse and keyboard selections on redraw', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const previousFlairSrc = site.asset.flairSrc;
  site.asset.flairSrc = flair => `/flair/${flair}.webp`;
  const users = [
    {
      id: 'fixture-bob',
      name: 'Fixture-Bob',
      online: true,
      title: 'GM',
      flair: 'flags.united-states',
      patron: true,
      patronColor: 2,
    },
    { id: '测试棋友', name: '测试棋友', online: false, flair: 'nature.cat' },
  ];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    const parsed = new URL(String(url), window.location.href);
    assert.equal(parsed.pathname, '/api/player/autocomplete');
    assert.equal(parsed.searchParams.get('object'), '1');
    assert.equal(parsed.searchParams.get('friend'), '1');
    return new Response(
      JSON.stringify({
        result: users.filter(user => user.name.startsWith(parsed.searchParams.get('term')!)),
      }),
    );
  });
  const ctrl = setup('friend');
  const patch = init([attributesModule, propsModule, eventListenersModule]);
  let vnode = patch(document.createElement('div'), kingdomOpponents(ctrl));
  const root = vnode.elm as HTMLElement;
  document.body.append(root);
  ctrl.root.redraw = () => {
    vnode = patch(vnode, kingdomOpponents(ctrl));
  };
  try {
    assert.equal(root.querySelectorAll('.complete-list').length, 2);
    for (const [index, key] of (['friendUser', 'friendUserTwo'] as const).entries()) {
      const input = root.querySelector<HTMLInputElement>(`#sf_${key}`)!;
      input.value = users[index].name.slice(0, -1);
      input.focus();
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      const parent = input.parentElement!;
      const rendered = new Promise<void>(resolve => {
        const observer = new window.MutationObserver(() => {
          if (parent.querySelector('.complete-result')) {
            observer.disconnect();
            resolve();
          }
        });
        observer.observe(parent, { childList: true, subtree: true });
        t.after(() => observer.disconnect());
      });
      t.mock.timers.tick(150);
      await rendered;
      const result = parent.querySelector<HTMLElement>('.complete-result')!;
      assert.equal(result.tagName, 'SPAN');
      assert.equal(
        result.querySelector('img.uflair')!.getAttribute('src'),
        `/flair/${users[index].flair}.webp`,
      );
      if (index === 0) {
        assert(result.classList.contains('online'));
        assert.equal(result.querySelector('.utitle')!.textContent, 'GM');
        assert(result.querySelector('.line.patron.paco2'));
        result.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
      } else {
        input.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'ArrowDown', bubbles: true }));
        input.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
      }
      assert.equal(ctrl[key], users[index].name);
      ctrl.root.redraw();
      assert.equal(input.value, users[index].name);
      assert.equal(root.querySelectorAll('.complete-list').length, 2);
    }
    assert.equal(ctrl.valid(), true);
  } finally {
    site.asset.flairSrc = previousFlairSrc;
    root.remove();
  }
});

test('shared setup submits all three-player choices with CSRF XHR headers', async () => {
  const ctrl = setup('friend');
  ctrl.friendUser = 'Bob';
  ctrl.friendUserTwo = 'Carol';
  ctrl.kingdomTime(7);
  ctrl.kingdomMoveTime(30);
  const originalFetch = globalThis.fetch,
    originalRedirect = site.redirect;
  let request: RequestInit | undefined, redirected: unknown;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    assert.equal(url, '/api/three-kingdoms/challenge');
    request = init;
    return new Response(JSON.stringify({ id: 'abcdefgh' }));
  }) as typeof fetch;
  site.redirect = value => {
    redirected = value;
  };
  try {
    await ctrl.submit();
    assert.equal((request!.headers as Record<string, string>)['X-Requested-With'], 'XMLHttpRequest');
    const data = JSON.parse(request!.body as string);
    assert.deepEqual(data.opponents, ['Bob', 'Carol']);
    assert.equal(data.initialSeconds, 420);
    assert.equal(data.moveSeconds, 30);
    assert.equal(redirected, '/three-kingdoms/challenge/abcdefgh');
  } finally {
    globalThis.fetch = originalFetch;
    site.redirect = originalRedirect;
  }
});
