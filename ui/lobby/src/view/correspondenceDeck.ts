import { aiLevelName } from 'lib/game';
import { timeago } from 'lib/i18n';
import { pubsub } from 'lib/pubsub';
import { hl, initMiniBoard, onInsert } from 'lib/view';

import type LobbyController from '@/ctrl';
import type { NowPlaying } from '@/interfaces';

import { bindMouseDragging } from './mouseDragScroll';

const remainingSeconds = (game: NowPlaying) => game.secondsLeft ?? Number.POSITIVE_INFINITY;

const orderedGames = (games: NowPlaying[]) => {
  const correspondence = games.filter(game => game.speed === 'correspondence');
  const myTurn = correspondence
    .filter(game => game.isMyTurn)
    .sort((a, b) => remainingSeconds(a) - remainingSeconds(b));
  const waiting = correspondence.filter(game => !game.isMyTurn).reverse();
  return [...myTurn, ...waiting];
};

const deadline = (game: NowPlaying) => {
  if (game.secondsLeft === undefined) return null;
  const date = Date.now() + game.secondsLeft * 1000;
  return hl(
    'time.timeago',
    { hook: onInsert(element => element.setAttribute('datetime', String(date))) },
    timeago(date),
  );
};

const enableMouseDragging = onInsert<HTMLElement>(bindMouseDragging);

const gameCard = (ctrl: LobbyController, game: NowPlaying) => {
  const opponent = game.opponent.ai ? aiLevelName(game.opponent.ai) : game.opponent.username;
  const status = game.isMyTurn ? i18n.site.yourTurn : i18n.site.waitingForOpponent;
  const timeLeft = game.isMyTurn ? deadline(game) : null;

  return hl(
    `a.lobby__correspondence-card.${game.variant.key}`,
    {
      key: `${game.gameId}${game.lastMove}`,
      class: { 'lobby__correspondence-card--my-turn': game.isMyTurn },
      attrs: {
        href: `/${game.fullId}`,
        'aria-label': `${opponent}. ${status}`,
      },
    },
    [
      hl('span.lobby__correspondence-player', [
        hl('strong', opponent),
        game.opponent.rank ? hl('small', game.opponent.rank) : null,
      ]),
      hl('span.lobby__correspondence-board.mini-board.cg-wrap.is2d.xiangqi9x10', {
        attrs: { 'data-state': `${game.fen},${game.orientation || game.color},${game.lastMove}` },
        hook: onInsert(initMiniBoard),
      }),
      hl('span.lobby__correspondence-player.lobby__correspondence-player--me', ctrl.me?.username ?? 'You'),
      hl('span.lobby__correspondence-status', timeLeft ? [status, ' · ', timeLeft] : status),
    ],
  );
};

function kingdomCard(id: string, players: string[], status: string, encoded?: string, myTurn = false) {
  const pending = encoded === undefined;
  return hl(
    'a.lobby__correspondence-card',
    {
      key: id,
      class: {
        'lobby__correspondence-card--pending': pending,
        'lobby__correspondence-card--my-turn': myTurn,
      },
      attrs: { href: pending ? '/#home-tab-seeks' : '/three-kingdoms/game/' + id },
    },
    [
      hl('span.lobby__correspondence-player', hl('strong', i18n.site.threeKingdoms)),
      hl(
        'span.lobby__correspondence-board.lobby__correspondence-kingdom',
        {
          key: encoded ?? 'initial',
          hook: onInsert<HTMLElement>(element => {
            if (element.isConnected)
              void site.asset
                .loadEsm('threeKingdoms.mini')
                .then(() => pubsub.emit('content-loaded', element));
          }),
        },
        [hl('span', { attrs: { 'data-three-kingdoms-position': encoded ?? '' } })],
      ),
      hl('span.lobby__correspondence-player.lobby__correspondence-player--me', players.join(' · ')),
      hl('span.lobby__correspondence-status', status),
    ],
  );
}
export default function correspondenceDeck(ctrl: LobbyController) {
  const games = orderedGames(ctrl.data.nowPlaying);
  const kingdoms = (ctrl.data.kingdomsPlaying ?? []).filter(g => !g.realTime);
  const pending = (ctrl.kingdomOffers ?? []).filter(o => ctrl.myKingdomOffer(o));
  const count = games.length + kingdoms.length + pending.length;
  if (!count) return null;

  return hl('section.lobby__correspondence', { attrs: { 'aria-labelledby': 'lobby-correspondence-title' } }, [
    hl('header.lobby__correspondence-header', [
      hl('h2#lobby-correspondence-title', 'Correspondence games'),
      hl('span', pending.length ? String(count) : `${count} active`),
    ]),
    hl(
      'div.lobby__correspondence-track',
      {
        attrs: { 'aria-label': 'Active correspondence games' },
        hook: enableMouseDragging,
      },
      [
        ...games.map(game => gameCard(ctrl, game)),
        ...kingdoms.map(g =>
          kingdomCard(
            g.gameId,
            g.players,
            g.isMyTurn ? i18n.site.yourTurn : i18n.site.waitingForOpponent,
            g.position,
            g.isMyTurn,
          ),
        ),
        ...pending.map(o =>
          kingdomCard(
            o.id,
            o.users,
            `${ctrl.opts.waitingToStart} · ${o.users.length + (o.botLevel ? 1 : 0)}/3`,
          ),
        ),
      ],
    ),
  ]);
}
