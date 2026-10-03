import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { VNode } from 'snabbdom';

import { statusOf } from 'lib/game';

import type RoundController from '../src/ctrl';
import type { RoundData } from '../src/interfaces';

mock.module('lib/permalog', { namedExports: { log: () => Promise.resolve() } });
const { backToSwiss, backToTournament, followUp, watcherFollowUp } = await import('../src/view/button');
const { analysisButton } = await import('../src/view/replay');
const { make } = await import('../src/socket');

Object.assign(globalThis, {
  i18n: {
    site: {
      analysis: 'Analysis',
      rematch: 'Rematch',
      newOpponent: 'New opponent',
      viewRematch: 'View rematch',
      viewTournament: 'View tournament',
      backToTournament: 'Back to tournament',
      pause: 'Pause',
    },
  },
});

function controller(color: Color = 'white'): RoundController {
  const data = {
    game: {
      id: 'abcd1234',
      variant: { key: 'standard' },
      source: 'lobby',
      status: statusOf('mate'),
      turns: 20,
    },
    player: { id: 'wxyz', color, user: { id: 'player' } },
    opponent: { color: color === 'white' ? 'black' : 'white', onGame: true, user: { id: 'opponent' } },
    clock: { initial: 300, increment: 3 },
  } as RoundData;
  return { data, ply: 7, redraw: mock.fn(), setRedirecting: mock.fn() } as unknown as RoundController;
}

function children(node: unknown): VNode[] {
  assert.ok(node && typeof node === 'object' && 'sel' in node);
  return ((node as VNode).children ?? []).filter((child): child is VNode => typeof child === 'object');
}

function analysisLink(node: unknown): VNode {
  const link = children(node).find(child => child.sel === 'a.fbt' && text(child) === 'Analysis');
  assert.ok(link, 'the finished round has a visible Analysis link');
  return link;
}

function text(node: VNode): string {
  return node.text ?? children(node).map(text).join('');
}

for (const color of ['white', 'black'] as const) {
  test(`${color}: both analysis controls preserve the viewed ply and use the explicit public route`, () => {
    const ctrl = controller(color);
    const expected = `/abcd1234/${color}/analysis#7`;
    assert.equal(analysisLink(followUp(ctrl)).data?.attrs?.href, expected);
    assert.equal((analysisButton(ctrl) as VNode).data?.attrs?.href, expected);
    assert.ok(children(followUp(ctrl)).some(child => child.sel === 'button.fbt.rematch.white'));
  });
}

test('spectator and event follow-ups use the same explicit Analysis link', () => {
  const ctrl = controller('black');
  ctrl.data.player.spectator = true;
  assert.equal(analysisLink(watcherFollowUp(ctrl)).data?.attrs?.href, '/abcd1234/black/analysis#7');
  ctrl.data.tournament = { id: 'tourney1', running: true } as RoundData['tournament'];
  assert.equal(analysisLink(backToTournament(ctrl)).data?.attrs?.href, '/abcd1234/black/analysis#7');
  ctrl.data.swiss = { id: 'swiss123', running: true };
  assert.equal(analysisLink(backToSwiss(ctrl)).data?.attrs?.href, '/abcd1234/black/analysis#7');
});

test('analysis completion keeps the finished player on the round with Analysis and working rematch controls', () => {
  const ctrl = controller();
  const send = mock.fn();
  ctrl.socket = make(send, ctrl);
  const redirect = mock.fn();
  Object.assign(globalThis, { location: { assign: redirect, reload: redirect, href: '/abcd1234wxyz' } });
  Object.assign(site, { reload: redirect, redirect });

  for (const complete of [false, true]) {
    ctrl.socket.receive('analysisProgress', { complete, tree: { ply: 7, eval: { cp: 35 }, children: [] } });
    assert.equal(analysisLink(followUp(ctrl)).data?.attrs?.href, '/abcd1234/white/analysis#7');
    assert.equal(location.href, '/abcd1234wxyz');
    assert.equal(redirect.mock.callCount(), 0);
  }

  const rematch = children(followUp(ctrl)).find(child => child.sel === 'button.fbt.rematch.white');
  assert.ok(rematch);
  rematch.elm = document.createElement('button');
  rematch.data?.hook?.insert?.(rematch);
  (rematch.elm as HTMLButtonElement).click();
  assert.deepEqual(
    send.mock.calls.map(call => call.arguments),
    [['rematch-yes']],
  );
});

test('an analysis completion message cannot expose analysis controls or navigate an active timed player', () => {
  const ctrl = controller();
  ctrl.data.game.status = statusOf('started');
  ctrl.socket = make(mock.fn(), ctrl);
  const redirect = mock.fn();
  Object.assign(globalThis, { location: { assign: redirect, reload: redirect, href: '/abcd1234wxyz' } });
  Object.assign(site, { reload: redirect, redirect });
  ctrl.socket.receive('analysisProgress', {
    complete: true,
    tree: { ply: 7, eval: { cp: 35 }, children: [] },
  });
  assert.equal(analysisButton(ctrl), false);
  assert.equal(children(followUp(ctrl)).length, 0);
  assert.equal(ctrl.data.game.status.name, 'started');
  assert.equal(location.href, '/abcd1234wxyz');
  assert.equal(redirect.mock.callCount(), 0);
});

test('aborted games offer analysis only after both players moved', () => {
  const ctrl = controller();
  ctrl.data.game.status = statusOf('aborted');
  ctrl.data.game.turns = 1;
  assert.ok(!children(followUp(ctrl)).some(child => text(child) === 'Analysis'));
  ctrl.data.game.turns = 2;
  assert.equal(analysisLink(followUp(ctrl)).data?.attrs?.href, '/abcd1234/white/analysis#7');
});

test('local games still hand off to local analysis instead of navigating to a saved game', () => {
  const ctrl = controller();
  const analyse = mock.fn();
  ctrl.data.local = { analyse } as unknown as RoundData['local'];
  const link = analysisLink(followUp(ctrl));
  link.elm = document.createElement('a');
  link.data?.hook?.insert?.(link);
  const click = new window.MouseEvent('click', { cancelable: true });
  link.elm.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true);
  assert.equal(analyse.mock.callCount(), 1);
  assert.equal(analysisButton(ctrl), false);
});

test('both analysis controls retain the supported Racing Kings orientation', () => {
  const ctrl = controller('black');
  ctrl.data.game.variant.key = 'racingKings';
  assert.equal(analysisLink(followUp(ctrl)).data?.attrs?.href, '/abcd1234/white/analysis#7');
  assert.equal((analysisButton(ctrl) as VNode).data?.attrs?.href, '/abcd1234/white/analysis#7');
});
