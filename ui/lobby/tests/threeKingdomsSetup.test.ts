import assert from 'node:assert/strict';
import { test } from 'node:test';
import { init, attributesModule, propsModule, eventListenersModule } from 'snabbdom';

import { timePickerAndSliders } from 'lib/setup/view/timeControl';

import SetupController from '../src/setupCtrl';
import { kingdomClock, kingdomOpponents, kingdomSide } from '../src/view/setup/components/kingdomSetup';
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

test('rated friend clocks follow the selected variant without changing casual settings', () => {
  const ctrl = setup('friend');
  ctrl.root.homePools = ['xiangqi', 'jieqi', 'minixiangqi', 'manchu', 'threeKingdoms'].map(rankTrack => ({
    id: rankTrack,
    name: rankTrack,
    rankTrack,
    ranked: true,
    lim: rankTrack === 'xiangqi' || rankTrack === 'threeKingdoms' ? 15 : 10,
    inc: 0,
    moveTime: { seconds: rankTrack === 'xiangqi' ? 90 : 60 },
  }));
  ctrl.timeControl.mode('realTime');
  ctrl.kingdomFriendBot(true);
  ctrl.setRated(true);
  assert.equal(ctrl.kingdomFriendBot(), false);
  assert.equal(ctrl.valid(), false);
  for (const variant of ['standard', 'jieqi', 'minixiangqi', 'manchu'] as const) {
    ctrl.variant(variant);
    const fields = ctrl.propsToFormData('black');
    assert.equal(fields.get('rated'), 'true');
    assert.equal(fields.get('color'), 'random');
    assert.equal(fields.get('time'), variant === 'standard' ? '15' : '10');
    assert.equal(fields.get('timeMode'), '1');
  }
  ctrl.setRated(false);
  ctrl.timeControl.mode('correspondence');
  assert.equal(ctrl.ratedCorrespondence(), true);
  assert.equal(ctrl.propsToFormData('black').has('rated'), false);
});

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

test('friend setup exposes shared time modes and the three kingdoms plus random', () => {
  const ctrl = setup('friend');
  const patch = init([attributesModule, propsModule, eventListenersModule]);
  const time = patch(document.createElement('div'), timePickerAndSliders(ctrl.timeControl))
    .elm as HTMLElement;
  const tabs = [...time.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  assert.equal(tabs.length, 3);
  for (const [index, mode] of (['realTime', 'correspondence', 'unlimited'] as const).entries()) {
    tabs[index].click();
    assert.equal(ctrl.timeControl.mode(), mode);
  }
  const side = patch(document.createElement('div'), kingdomSide(ctrl)).elm as HTMLElement;
  const select = side.querySelector('select')!;
  assert.deepEqual(
    [...select.options].map(option => option.value),
    ['red', 'green', 'black', 'random'],
  );
  assert.equal(select.value, 'random');
});

test('shared friend setup requires two distinct opponents other than the challenger', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ctrl = setup('friend');
  const patch = init([attributesModule, propsModule, eventListenersModule]);
  const root = patch(document.createElement('div'), kingdomOpponents(ctrl)).elm as HTMLElement;
  const inputs = root.querySelectorAll<HTMLInputElement>('input[type="text"]');
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
  const tc = ctrl.timeControl;
  tc.mode('realTime');
  tc.selectPreset({ lim: 7, inc: 5, moveTime: { seconds: 30, first: { moves: 2, seconds: 15 } } });
  ctrl.kingdom('green');
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
    assert.equal(data.incrementSeconds, 5);
    assert.deepEqual(data.opening, { moves: 2, seconds: 15 });
    assert.equal(data.color, 'green');
    assert.equal(redirected, '/three-kingdoms/challenge/abcdefgh');

    ctrl.loading = false;
    ctrl.kingdomFriendBot(true);
    tc.mode('correspondence');
    ctrl.aiLevel(4);
    await ctrl.submit();
    const mixed = JSON.parse(request!.body as string);
    assert.deepEqual(mixed.opponents, ['Bob']);
    assert.equal(mixed.botLevel, 4);
    assert.equal(mixed.timeMode, 'correspondence');
    assert.equal(mixed.days, tc.days());
    assert.equal(mixed.initialSeconds, undefined);

    ctrl.loading = false;
    tc.mode('unlimited');
    await ctrl.submit();
    const unlimited = JSON.parse(request!.body as string);
    assert.equal(unlimited.timeMode, 'unlimited');
    assert.equal(unlimited.days, undefined);

    ctrl.openModal('hook', { variant: 'threeKingdoms', timeMode: 'correspondence' });
    let posted = '';
    ctrl.root.showKingdomOffer = offer => {
      posted = offer.id;
    };
    redirected = undefined;
    for (const bot of [false, true]) {
      ctrl.loading = false;
      ctrl.kingdomFriendBot(bot);
      ctrl.aiLevel(3);
      await ctrl.submit();
      const offer = JSON.parse(request!.body as string);
      assert.equal(posted, 'abcdefgh');
      assert.equal(redirected, undefined);
      assert.equal(offer.publicSeek, true);
      assert.deepEqual(offer.opponents, []);
      assert.equal(offer.botLevel, bot ? 3 : undefined);
      assert.equal(offer.timeMode, 'correspondence');
    }
  } finally {
    globalThis.fetch = originalFetch;
    site.redirect = originalRedirect;
  }
});
