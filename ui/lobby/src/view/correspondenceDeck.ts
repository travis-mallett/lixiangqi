import { aiLevelName } from 'lib/game';
import { timeago } from 'lib/i18n';
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

export default function correspondenceDeck(ctrl: LobbyController) {
  const games = orderedGames(ctrl.data.nowPlaying);
  if (!games.length) return null;

  return hl('section.lobby__correspondence', { attrs: { 'aria-labelledby': 'lobby-correspondence-title' } }, [
    hl('header.lobby__correspondence-header', [
      hl('h2#lobby-correspondence-title', 'Correspondence games'),
      hl('span', `${games.length} active`),
    ]),
    hl(
      'div.lobby__correspondence-track',
      {
        attrs: { 'aria-label': 'Active correspondence games' },
        hook: enableMouseDragging,
      },
      games.map(game => gameCard(ctrl, game)),
    ),
  ]);
}
