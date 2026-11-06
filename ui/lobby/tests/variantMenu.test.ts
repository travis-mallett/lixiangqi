import assert from 'node:assert/strict';
import { test } from 'node:test';
import { init, attributesModule, type VNode } from 'snabbdom';

import type LobbyController from '../src/ctrl';

document.documentElement.lang = 'en';
const { default: variantMenu } = await import('../src/view/variantMenu');
for (const variant of ['jieqi', 'minixiangqi', 'manchu', 'threeKingdoms'] as const) {
  test(`${variant} menu shows live per-mode populations, including zero, without the extra divider`, () => {
    const counts: Record<string, number> = { rated: 12, [`${variant}-ai`]: 3, [`${variant}-friend`]: 0 };
    const ctrl = {
      variantPool: () => ({ id: 'rated', lim: 10 }),
      isPoolSeeking: () => false,
      hasOngoingRealTimeGame: () => false,
      opts: {},
      poolCount: (id: string) => counts[id] ?? 0,
    } as unknown as LobbyController;
    const nodes = (node: VNode): VNode[] => [
      node,
      ...(node.children ?? []).flatMap(child => (child && typeof child === 'object' ? nodes(child) : [])),
    ];
    const render = () => nodes(variantMenu(ctrl, variant, () => {}));
    const populations = () =>
      render()
        .filter(node => node.sel === 'span.lobby__occupancy.text')
        .map(node => (node.children?.[0] as VNode)?.text);
    assert.deepEqual(populations(), ['12', '3', '0']);
    counts[`${variant}-friend`] = 2;
    assert.deepEqual(populations(), ['12', '3', '2']);
    assert.equal(
      render().some(node => node.sel === 'hr'),
      false,
    );
  });

  test(`rated ${variant} closes the menu before entering the shared play room without joining a queue`, () => {
    const pool = { id: `${variant}-v1-ranked-10+0-m60-30x3`, lim: 10 };
    let afterClose: (() => void) | undefined;
    let openedPool: unknown;
    const ctrl = {
      variantPool: () => pool,
      hasOngoingRealTimeGame: () => false,
      opts: {},
      poolCount: () => 0,
      openHomepagePool: (selected: unknown) => {
        openedPool = selected;
      },
      clickPool: () => assert.fail('The menu must not join matchmaking directly'),
    } as unknown as LobbyController;
    const patch = init([attributesModule]);
    const node = patch(
      document.createElement('div'),
      variantMenu(ctrl, variant, action => {
        afterClose = action;
      }),
    );
    (node.elm as HTMLElement).querySelector<HTMLButtonElement>('.lobby__variant-menu-row--rated')!.click();
    assert.equal(openedPool, undefined);
    assert.ok(afterClose);
    afterClose();
    assert.equal(openedPool, pool);
  });
}
