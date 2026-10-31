import assert from 'node:assert/strict';
import { test } from 'node:test';
import { init, attributesModule, propsModule, eventListenersModule } from 'snabbdom';

import SetupController from '../src/setupCtrl';
import { kingdomClock, kingdomOpponents } from '../src/view/setup/components/kingdomSetup';
import { levelButtons } from '../src/view/setup/components/levelButtons';

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

test('shared friend setup requires two distinct opponents other than the challenger', () => {
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
