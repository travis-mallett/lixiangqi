import assert from 'node:assert/strict';
import { test } from 'node:test';
import { init, toVNode, attributesModule, classModule, eventListenersModule } from 'snabbdom';

import type LobbyController from '../src/ctrl';

document.documentElement.lang = 'en';
const { default: table } = await import('../src/view/table');

test('computer button works after an ongoing game ends; tabs open the matching setup', () => {
  let ongoing = true;
  let bots = 0;
  const setups: unknown[] = [];
  const ctrl = {
    opts: {},
    me: {},
    tab: 'pools',
    stepHooks: [],
    setTab: (tab: LobbyController['tab']) => {
      ctrl.tab = tab;
      ctrl.redraw();
    },
    data: { nowPlaying: [], nbNowPlaying: 1, hooks: [], seeks: [] },
    homePools: [{ id: '15+0', lim: 15 }],
    setupCtrl: { gameType: null },
    hasOngoingRealTimeGame: () => ongoing,
    hasPoolSeeking: () => false,
    isPoolSeeking: () => false,
    poolCount: () => 0,
    openBotMap: () => bots++,
    openSetupFromLobby: (...args: unknown[]) => setups.push(args),
    redraw: () => {
      vnode = patch(vnode, table(ctrl));
    },
  } as unknown as LobbyController;
  const patch = init([attributesModule, classModule, eventListenersModule]);
  // The server's first-paint button already exists: insert hooks will never run on it.
  const mount = document.createElement('div');
  mount.className = 'lobby__table';
  mount.innerHTML =
    '<div class="lobby__actions"><button class="button button-metal lobby__action lobby__action--ai" disabled></button></div>';
  const original = mount.querySelector('button');
  let vnode = patch(toVNode(mount), table(ctrl));
  const button = (vnode.elm as HTMLElement).querySelector<HTMLButtonElement>('.lobby__action--ai')!;
  assert.equal(button, original);
  button.click();
  assert.equal(bots, 0);
  ongoing = false;
  vnode = patch(vnode, table(ctrl));
  assert.equal((vnode.elm as HTMLElement).querySelector('.lobby__action--ai'), button);
  button.click();
  assert.equal(bots, 1);
  const root = vnode.elm as HTMLElement;
  const dots = () => root.querySelectorAll('.has-open-games').length;
  const hook = { id: 'hook0001', sri: 'player', t: 300, clock: '5+0', variant: 'standard' } as const;
  const seek = { id: 'seek0001', username: 'Player', rank: '', days: 2 } as const;
  ctrl.data.hooks = [{ ...hook, action: 'cancel' }];
  ctrl.data.seeks = [{ ...seek, action: 'cancelSeek' }];
  ctrl.redraw();
  assert.equal(dots(), 0);
  ctrl.data.hooks.push({ ...hook, action: 'join', disabled: true });
  ctrl.data.seeks.push({ ...seek, action: 'joinSeek' });
  ctrl.redraw();
  assert.equal(dots(), 1);
  ctrl.data.hooks[1].disabled = false;
  ctrl.redraw();
  assert.equal(dots(), 2);
  ctrl.data.hooks = [];
  ctrl.data.seeks = [];
  ctrl.redraw();
  assert.equal(dots(), 0);

  for (const tab of ['real_time', 'seeks']) {
    root.querySelector<HTMLButtonElement>('#home-tab-' + tab)!.click();
    assert.equal(root.querySelector('#home-match-panel .now-playing'), null);
    root.querySelector<HTMLButtonElement>('.lobby__offers button')!.click();
  }
  assert.deepEqual(setups, [
    ['hook', { timeMode: 'realTime' }],
    ['hook', { timeMode: 'correspondence' }],
  ]);
});
