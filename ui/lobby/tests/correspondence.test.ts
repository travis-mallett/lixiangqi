import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attributesModule, classModule, h, init } from 'snabbdom';

import type LobbyController from '../src/ctrl';
import correspondence from '../src/view/correspondence';
import { render as realTime } from '../src/view/realTime/list';

document.documentElement.lang = 'en';
const { default: correspondenceDeck } = await import('../src/view/correspondenceDeck');

const offerVariants = {
  xiangqi: { name: 'Xiangqi', icon: '帥' },
  minixiangqi: { name: 'Mini Xiangqi', icon: '迷' },
};

test('a full correspondence lobby routes offer clicks by ID', () => {
  const actions: unknown[] = [];
  const ctrl = {
    opts: { offerVariants },
    me: { username: 'player' },
    data: {
      seeks: Array.from({ length: 8 }, (_, i) => ({
        id: String(i),
        username: i ? 'opponent' : 'player',
        rank: '1D',
        days: 2,
        variant: i ? { key: 'minixiangqi' } : undefined,
        action: i ? 'joinSeek' : 'cancelSeek',
      })),
    },
    openSetupFromLobby: (...args: unknown[]) => actions.push(args),
    clickSeek: (id: string) => actions.push(id),
  } as unknown as LobbyController;
  const node = init([attributesModule])(document.createElement('section'), h('div', correspondence(ctrl)));
  const lobby = node.elm as HTMLElement;
  assert.equal(lobby.querySelector('th:last-child')?.textContent, String(i18n.site.variant));
  assert.equal(lobby.querySelector('tr.cancel td:last-child')?.textContent, 'Xiangqi');
  assert.equal(lobby.querySelector('tr.join td:last-child')?.textContent, 'Mini Xiangqi');
  lobby.querySelector<HTMLElement>('tr.join [data-icon="迷"]')!.click();
  lobby.querySelector<HTMLElement>('tr.cancel td')!.click();
  assert.deepEqual(actions, ['1', '0']);
});

test('a reserved seat moves to the participant deck and other players can still join', () => {
  const joined: string[] = [];
  const ctrl = {
    data: { seeks: [], nowPlaying: [] },
    opts: { waitingToStart: 'Waiting to start' },
    me: { username: 'Han' },
    kingdomOffers: [
      { id: 'pending1', users: ['alice', 'han'], days: 2 },
      { id: 'mixedbot', users: ['mei'], botLevel: 4, days: 3 },
    ],
    myKingdomOffer(o: { users: string[] }) {
      return o.users.includes(this.me.username.toLowerCase());
    },
    joinKingdomOffer(id: string) {
      joined.push(id);
    },
  };
  const lobby = ctrl as unknown as LobbyController;
  const mount = () =>
    init([attributesModule, classModule])(
      document.createElement('section'),
      h('div', [correspondence(lobby), ...(correspondenceDeck(lobby) ? [correspondenceDeck(lobby)!] : [])]),
    ).elm as HTMLElement;
  const member = mount();
  assert(member.querySelector('a[href="/three-kingdoms/challenge/pending1"]'));
  assert(member.querySelector('.lobby__correspondence-card--pending [data-three-kingdoms-position]'));
  assert.equal(member.querySelector('.lobby__correspondence-status')?.textContent, 'Waiting to start · 2/3');
  assert.equal(member.querySelectorAll('tr.seek').length, 1);
  assert(
    member.querySelector('[data-kingdom="mixedbot"]')?.textContent?.includes(`${i18n.threeKingdoms.level} 4`),
  );
  ctrl.me.username = 'third';
  const viewer = mount();
  assert.equal(viewer.querySelectorAll('tr.seek').length, 2);
  viewer.querySelector<HTMLElement>('[data-kingdom="pending1"] td')!.click();
  assert.deepEqual(joined, ['pending1']);
});

test('real-time offers show variant names and icons for ordinary and custom positions', () => {
  const ctrl = { opts: { offerVariants }, redraw() {} } as unknown as LobbyController;
  const hooks = (['standard', 'minixiangqi', 'fromPosition'] as const).map((variant, i) => ({
    id: String(i),
    sri: 'opponent',
    action: 'join' as const,
    clock: '5+0',
    t: 300,
    i: 0,
    perf: 'xiangqi',
    variant,
  }));
  const node = init([attributesModule])(document.createElement('section'), h('div', realTime(ctrl, hooks)));
  const lobby = node.elm as HTMLElement;
  assert.equal(lobby.querySelector('th:last-child')?.textContent, String(i18n.site.variant));
  for (const [id, name, icon] of [
    ['0', 'Xiangqi', '帥'],
    ['1', 'Mini Xiangqi', '迷'],
    ['2', String(i18n.variant.fromPosition), '帥'],
  ]) {
    const cell = lobby.querySelector(`tr[data-id="${id}"] td:last-child`)!;
    assert.equal(cell.textContent, name);
    assert.equal(cell.querySelector('[data-icon]')?.getAttribute('data-icon'), icon);
  }
});
