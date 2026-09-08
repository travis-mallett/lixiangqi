import { h } from 'snabbdom';

import type { MaybeVNodes } from 'lib/view';

export function tds(bits: MaybeVNodes): MaybeVNodes {
  return bits.map(bit => h('td', [bit]));
}
