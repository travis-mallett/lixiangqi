import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attributesModule, h, init } from 'snabbdom';

import type LobbyController from '../src/ctrl';
import correspondence from '../src/view/correspondence';

test('a full correspondence lobby keeps creation available and routes offer clicks by ID', () => {
  const actions: unknown[] = [];
  const ctrl = {
    me: { username: 'player' },
    data: {
      seeks: Array.from({ length: 8 }, (_, i) => ({
        id: String(i),
        username: i ? 'opponent' : 'player',
        rank: '1D',
        days: 2,
        action: i ? 'joinSeek' : 'cancelSeek',
      })),
    },
    openSetupFromLobby: (...args: unknown[]) => actions.push(args),
    clickSeek: (id: string) => actions.push(id),
  } as unknown as LobbyController;
  const node = init([attributesModule])(document.createElement('section'), h('div', correspondence(ctrl)));
  const lobby = node.elm as HTMLElement;
  lobby.querySelector<HTMLButtonElement>('.create button')!.click();
  lobby.querySelector<HTMLElement>('tr.join td')!.click();
  lobby.querySelector<HTMLElement>('tr.cancel td')!.click();
  assert.deepEqual(actions, [['hook', { timeMode: 'correspondence' }], '1', '0']);
});
