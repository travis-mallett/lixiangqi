import { numberFormat } from 'lib/i18n';
import { licon } from 'lib/licon';
import { hl } from 'lib/view';

export function occupancy(count: number, highlighted = false) {
  const formatted = numberFormat(count);
  return hl(
    'span.lobby__occupancy.text',
    {
      class: { 'lobby__occupancy--online': highlighted },
      attrs: {
        'data-icon': licon.Group,
        title: i18n.site.nbPlayers(count, formatted),
        'aria-label': i18n.site.nbPlayers(count, formatted),
      },
    },
    formatted,
  );
}
