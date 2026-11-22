import { h } from 'snabbdom';

import { hl, type MaybeVNodes } from 'lib/view';

import type { LobbyOpts } from '@/interfaces';

export function offerHead() {
  return h(
    'thead',
    h(
      'tr',
      [i18n.site.player, i18n.site.rank, i18n.site.time, i18n.site.variant].map(label =>
        h('th', String(label)),
      ),
    ),
  );
}

export function offerVariant(variants: LobbyOpts['offerVariants'], key = 'standard') {
  const fromPosition = key === 'fromPosition';
  const variant = variants[key === 'standard' || fromPosition ? 'xiangqi' : key];
  return hl('span.hooks__variant', [
    variant && h('span', { attrs: { 'data-icon': variant.icon, 'aria-hidden': 'true' } }),
    h('span', fromPosition ? String(i18n.variant.fromPosition) : (variant?.name ?? key)),
  ]);
}

export function tds(bits: MaybeVNodes): MaybeVNodes {
  return bits.map(bit => h('td', [bit]));
}
