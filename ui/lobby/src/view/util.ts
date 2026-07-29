import { h } from 'snabbdom';

import type { MaybeVNodes } from 'lib/view';

export function tds(bits: MaybeVNodes): MaybeVNodes {
  return bits.map(bit => h('td', [bit]));
}

export const perfNames: Partial<Record<Exclude<Perf, 'fromPosition'>, string>> = {
  xiangqi: 'Xiangqi',
  ultraBullet: i18n.site.ultraBullet,
  bullet: i18n.site.bullet,
  blitz: i18n.site.blitz,
  rapid: i18n.site.rapid,
  classical: i18n.site.classical,
  correspondence: i18n.site.correspondence,
};
