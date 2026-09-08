import { licon } from 'lib/licon';
import { bind, hl, initMiniGames, onInsert } from 'lib/view';

import type LobbyController from '@/ctrl';
import type { HomepageRoom, Pool } from '@/interfaces';

export default function homepageRoomView(ctrl: LobbyController, room: HomepageRoom) {
  return hl('section.lobby__homepage-room', [roomHeader(ctrl, room.pool), liveGames(ctrl, room)]);
}

function roomHeader(ctrl: LobbyController, pool: Pool) {
  return hl('header.lobby__homepage-room__header', [
    hl(
      'button.lobby__homepage-room__back.text',
      {
        attrs: {
          type: 'button',
          'data-icon': licon.LessThan,
          'aria-label': i18n.site.backToHomepage,
        },
        hook: bind('click', ctrl.closeHomepageRoom),
      },
      i18n.site.backToHomepage,
    ),
    hl('span.lobby__homepage-room__title', [
      hl('strong', i18n.site.playRatedXiangqi),
      hl('span', i18n.site.minutesShort(pool.lim)),
    ]),
  ]);
}

function liveGames(ctrl: LobbyController, room: HomepageRoom) {
  return hl('div.lobby__live-games', [
    hl('div.lobby__live-games__heading', [
      hl('span.lobby__live-games__eyebrow', '棋力评测'),
      hl('h2', i18n.site.liveRatedGames),
      hl('p', i18n.site.currentGames),
    ]),
    // The server intentionally returns the standard mini-game markup. Reusing it
    // keeps spectator links, clocks, ranks, and live board updates canonical.
    hl('div.lobby__live-games__grid.now-playing', {
      props: { innerHTML: room.liveGamesHtml },
      hook: onInsert(initMiniGames),
    }),
    hl(
      'button.button.button-metal.lobby__live-games__play',
      {
        attrs: { type: 'button' },
        hook: bind('click', ctrl.enterHomepageMatchmaking),
      },
      i18n.site.playRatedXiangqi,
    ),
  ]);
}
