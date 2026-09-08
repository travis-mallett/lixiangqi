import { numberFormat } from 'lib/i18n';
import { hl, onInsert } from 'lib/view';

import type LobbyController from '@/ctrl';

export default function siteCounters(ctrl: LobbyController) {
  const { members, rounds } = ctrl.data.counters;
  const stats = ctrl.data.stats;
  const counter = (
    value: number,
    english: string,
    options: {
      href?: string;
      onInsert?: (element: HTMLElement) => void;
      online?: boolean;
      wide?: boolean;
    } = {},
  ) => {
    const selector = `${options.href ? 'a' : 'span'}.lobby__site-counter${options.online ? '.lobby__site-counter--online' : ''}${options.wide ? '.lobby__site-counter--wide' : ''}`;
    return hl(
      selector,
      {
        attrs: options.href ? { href: options.href } : {},
      },
      [
        hl(
          'strong',
          options.onInsert ? { hook: onInsert<HTMLElement>(element => options.onInsert?.(element)) } : {},
          numberFormat(value),
        ),
        hl('span.lobby__label-en', english),
      ],
    );
  };

  return hl('div.lobby__site-counters', [
    counter(members, 'Players online', {
      href: '/player',
      online: true,
      onInsert: element => {
        ctrl.spreadPlayersNumber = ctrl.initNumberSpreader(element, 10, members);
      },
    }),
    counter(rounds, 'Games in play', {
      href: '/games',
      onInsert: element => {
        ctrl.spreadGamesNumber = ctrl.initNumberSpreader(element, 8, rounds);
      },
    }),
    ...(stats
      ? [
          counter(stats.gamesPlayedToday, 'Games played today'),
          counter(stats.registeredUsers, 'Registered users'),
          counter(stats.gamesPlayedAllTime, 'Games played all time', { wide: true }),
        ]
      : []),
  ]);
}
