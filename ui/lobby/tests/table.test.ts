import assert from 'node:assert/strict';
import { test } from 'node:test';
import { init, toVNode, attributesModule, classModule, eventListenersModule } from 'snabbdom';

import type LobbyController from '../src/ctrl';

document.documentElement.lang = 'en';
const { default: table } = await import('../src/view/table');

test('computer button works after an ongoing game ends; Custom opens the full lobby', () => {
  let ongoing = true;
  let bots = 0;
  let lobby = 0;
  const ctrl = {
    opts: {},
    data: { nowPlaying: [] },
    homePools: [{ id: '15+0', lim: 15 }],
    setupCtrl: { gameType: null },
    hasOngoingRealTimeGame: () => ongoing,
    hasPoolSeeking: () => false,
    isPoolSeeking: () => false,
    poolCount: () => 0,
    openBotMap: () => bots++,
    openLobbyOverlay: () => lobby++,
    redraw: () => {},
  } as unknown as LobbyController;
  const patch = init([attributesModule, classModule, eventListenersModule]);
  // The server's first-paint button already exists: insert hooks will never run on it.
  const mount = document.createElement('div');
  mount.className = 'lobby__table';
  mount.innerHTML =
    '<div class="lobby__actions"><button class="lobby__action lobby__action--ai" disabled></button></div>';
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
  (vnode.elm as HTMLElement).querySelector<HTMLButtonElement>('.lobby__quick-room--lobby')!.click();
  assert.equal(lobby, 1);
});
