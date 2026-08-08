import { numberFormat } from 'lib/i18n';
import { hl, onInsert } from 'lib/view';

import type LobbyController from '@/ctrl';

export default function siteCounters(ctrl: LobbyController) {
  const { members, rounds } = ctrl.data.counters;

  return hl('div.lobby__site-counters', [
    hl(
      'a',
      { attrs: { href: '/player' } },
      i18n.site.nbPlayers.asArray(
        members,
        hl(
          'strong',
          {
            hook: onInsert<HTMLAnchorElement>(element => {
              ctrl.spreadPlayersNumber = ctrl.initNumberSpreader(element, 10, members);
            }),
          },
          numberFormat(members),
        ),
      ),
    ),
    hl(
      'a',
      { attrs: { href: '/games' } },
      i18n.site.nbGamesInPlay.asArray(
        rounds,
        hl(
          'strong',
          {
            hook: onInsert<HTMLAnchorElement>(element => {
              ctrl.spreadGamesNumber = ctrl.initNumberSpreader(element, 8, rounds);
            }),
          },
          numberFormat(rounds),
        ),
      ),
    ),
  ]);
}
