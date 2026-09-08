import { h } from 'snabbdom';

import { formatClock } from 'lib/setup/timeControl';
import { bind } from 'lib/view';

import type LobbyController from '@/ctrl';
import * as hookRepo from '@/hookRepo';
import type { Hook } from '@/interfaces';

import { tds } from '../util';

function renderHook(ctrl: LobbyController, hook: Hook) {
  return h(
    `tr.hook.${hook.action}`,
    {
      key: hook.id,
      class: { disabled: !!hook.disabled },
      attrs: {
        role: 'button',
        title: hook.disabled ? '' : hook.action === 'join' ? i18n.site.joinTheGame : i18n.site.cancel,
        'data-id': hook.id,
      },
    },
    tds([
      ctrl.me
        ? h('span.ulink.ulpt.mobile-powertip', { attrs: { 'data-href': `/@/${hook.u}` } }, hook.u)
        : i18n.site.anonymous,
      hook.rank || '',
      formatClock(hook.clock, hook.moveTime),
    ]),
  );
}

const isMine = (hook: Hook) => hook.action === 'cancel';
const isStandard = (value: boolean) => (hook: Hook) => (hook.variant === 'standard') === value;
const isNotMine = (hook: Hook) => !isMine(hook);

export const render = (ctrl: LobbyController, allHooks: Hook[]) => {
  const mine = allHooks.find(isMine);
  const max = mine ? 13 : 14;
  const hooks = allHooks.slice(0, max);
  const standards = hooks.filter(isNotMine).filter(isStandard(true));
  hookRepo.sort(standards);
  const variants = hooks
    .filter(isNotMine)
    .filter(isStandard(false))
    .slice(0, Math.max(0, max - standards.length - 1));
  hookRepo.sort(variants);

  const renderedHooks = [
    ...standards.map(hook => renderHook(ctrl, hook)),
    variants.length
      ? h('tr.variants', { key: 'variants' }, [
          h('td', { attrs: { colspan: 3 } }, `— ${i18n.site.variant} —`),
        ])
      : null,
    ...variants.map(hook => renderHook(ctrl, hook)),
  ];
  if (mine) renderedHooks.unshift(renderHook(ctrl, mine));

  return h('table.hooks__list', [
    h('thead', h('tr', [h('th', i18n.site.player), h('th', i18n.site.rank), h('th', i18n.site.time)])),
    h(
      'tbody',
      {
        class: { stepping: ctrl.stepping },
        hook: bind(
          'click',
          e => {
            let el = e.target as HTMLElement;
            do {
              el = el.parentNode as HTMLElement;
              if (el.nodeName === 'TR') return ctrl.clickHook(el.dataset['id']!);
            } while (el.nodeName !== 'TABLE');
            return undefined;
          },
          ctrl.redraw,
        ),
      },
      renderedHooks,
    ),
  ]);
};
