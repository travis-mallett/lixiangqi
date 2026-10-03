import { type Attrs, type Hooks, init as initSnabbdom, attributesModule, type VNodeData } from 'snabbdom';
import type { Tablesort } from 'tablesort';

import { defined } from 'lib';
import { isTouchDevice } from 'lib/device';
import perfIcons from 'lib/game/perfIcons';
import type { XiangqiSide as Color } from 'lib/game/xiangqi';
import { licon } from 'lib/licon';
import { pubsub } from 'lib/pubsub';
import { sortTable, extendTablesortNumber } from 'lib/tablesort';
import { type VNode, dataIcon, hl, onInsert, type LooseVNodes } from 'lib/view';
import { userLink, userTitle } from 'lib/view/userLink';
import { json as xhrJson } from 'lib/xhr';

import { playerFedFlag } from '@/view/util';

import type { ChapterId, PlayerId, PointsStr, StudyPlayer, StudyPlayerFromServer } from '../interfaces';
import { loading } from '../loading';
import { pinIcon } from '../multiBoard';
import { convertPlayerFromServer } from '../studyChapters';
import { playerColoredResult } from './customScoreStatus';
import { teamLinkData } from './deepLink';
import type {
  RatingCategory,
  Photo,
  RelayRound,
  RelayTeamName,
  RelayTour,
  RoundId,
  StatByRatingCategory,
} from './interfaces';
import { playerId } from './playerId';
import RelayPlayerPin from './relayPlayerPin';

export type RelayPlayerId = string;

interface Tiebreak {
  extendedCode: string;
  description: string;
  points: number;
}

export interface RelayPlayer extends StudyPlayer {
  score?: number;
  played?: number;
  ratingsMap?: StatByRatingCategory;
  ratingDiffs?: StatByRatingCategory;
  performances?: StatByRatingCategory;
  tiebreaks?: Tiebreak[];
  rank?: number;
}

interface RelayPlayerGame {
  id: ChapterId;
  round: RoundId;
  roundObj?: RelayRound;
  opponent: RelayPlayer;
  color: Color;
  ratingCategory: RatingCategory;
  points?: PointsStr;
  customPoints?: number;
  ratingDiff?: number;
  ongoing?: boolean;
}

interface RelayPlayerWithGames extends RelayPlayer {
  games: RelayPlayerGame[];
  directory?: DirectoryPlayer;
  user?: LightUser;
}

interface DirectoryPlayer {
  ratings?: StatByRatingCategory;
  provenance: { provider: string; url: string; publishedAt: string };
  year?: number;
  follow?: boolean;
}

interface PlayerToShow {
  id?: RelayPlayerId;
  player?: RelayPlayerWithGames;
}

export default class RelayPlayers {
  loading = false;
  players?: RelayPlayer[];
  show?: PlayerToShow;
  readonly pins: RelayPlayerPin;
  private readonly table?: Tablesort;

  constructor(
    readonly tour: RelayTour,
    readonly switchToPlayerTab: () => void,
    readonly isEmbed: boolean,
    readonly hideResultsSinceRoundId: () => RoundId | undefined,
    readonly directoryPhoto: (id: PlayerId) => Photo | undefined,
    private readonly redraw: Redraw,
  ) {
    this.pins = new RelayPlayerPin(tour.id, redraw);
    const locationPlayer = location.hash.startsWith('#players/') && location.hash.slice(9);
    if (locationPlayer) this.showPlayer(locationPlayer);
  }

  tabHash = () => (this.show ? `#players/${this.show.id}` : '#players');

  switchTabAndShowPlayer = async (id: RelayPlayerId) => {
    this.switchToPlayerTab();
    this.showPlayer(id);
    this.redraw();
  };

  showPlayer = async (id: RelayPlayerId) => {
    this.show = { id };
    const player = await this.loadPlayerWithGames(id);
    this.show = { id, player };
    this.redraw();
  };

  closePlayer = () => {
    this.show = undefined;
  };

  loadFromXhr = async (onInsert?: boolean) => {
    if (this.players && !onInsert) {
      this.loading = true;
      this.redraw();
    }
    const players: (RelayPlayer & StudyPlayerFromServer)[] = await xhrJson(
      `/broadcast/${this.tour.id}/players`,
    );
    this.players = players.map(convertPlayerFromServer);
    this.table?.refresh();
    this.redraw();
  };

  loadPlayerWithGames = async (id: RelayPlayerId) => {
    const full: RelayPlayerWithGames = await xhrJson(
      `/broadcast/${this.tour.id}/players/${encodeURIComponent(id)}`,
    ).then(convertPlayerFromServer);
    full.games.forEach((g: RelayPlayerGame) => {
      g.opponent = convertPlayerFromServer(g.opponent as RelayPlayer & StudyPlayerFromServer);
    });
    return full;
  };

  playerLinkConfig = (p: StudyPlayer) => playerLinkConfig(this, p, true);
}

export const playersView = (ctrl: RelayPlayers): VNode =>
  ctrl.show ? playerView(ctrl, ctrl.show) : playersList(ctrl);

const ratingCategs: Record<RatingCategory, string> = {
  standard: i18n.site.classical,
  rapid: i18n.site.rapid,
  blitz: i18n.site.blitz,
};
const playerView = (ctrl: RelayPlayers, show: PlayerToShow): VNode => {
  const tour = ctrl.tour;
  const p = show.player;
  const year = (tour.dates?.[0] ? new Date(tour.dates[0]) : new Date()).getFullYear();
  const tc = tour.info.ratingCategory || 'standard';
  const age: number | undefined = p?.directory?.year && year - p.directory.year;
  const directoryPageAttrs = p ? directoryPageLinkAttrs(p, ctrl.isEmbed) : {};
  const photo = p?.playerId ? ctrl.directoryPhoto(p.playerId) : undefined;
  return hl(
    'div.directory-player',
    {
      class: { loading: !show.player },
    },
    p
      ? [
          hl(
            'div.directory-player__header',
            {
              hook: onInsert(el => {
                site.asset.loadEsm('directoryPlayerFollow');
                pubsub.emit('content-loaded', el);
              }),
            },
            [
              photo &&
                hl(
                  'div.directory-player__photo',
                  playerPhotoOrFallback(p, photo, 'medium', 'directory-player__photo'),
                ),
              hl('div.directory-player__header__info', [
                hl('a.directory-player__header__name', { attrs: directoryPageAttrs }, [
                  hl('span', [userTitle(p), p.name]),
                  p.user && userLink({ ...p.user, title: undefined }),
                ]),
                p.directory &&
                  hl('label.directory-player__follow', [
                    hl('span.cmn-favourite', [
                      hl(`input#directory-follow-${p.playerId}`, {
                        attrs: {
                          type: 'checkbox',
                          'data-action': `/players/${p.playerId}/follow?follow=true`,
                          checked: !!p.directory?.follow,
                        },
                      }),
                      hl('label', { attrs: { for: `directory-follow-${p.playerId}` } }),
                    ]),
                    i18n.site.follow,
                  ]),
                hl('table.directory-player__header__table', [
                  p.directory &&
                    hl('tr', [
                      hl('th', i18n.broadcast.playerSource),
                      hl('td', [
                        hl(
                          'a',
                          { attrs: { href: p.directory.provenance.url, target: '_blank', rel: 'noopener' } },
                          p.directory.provenance.provider.toUpperCase(),
                        ),
                        ' ',
                        p.directory.provenance.publishedAt,
                      ]),
                    ]),
                  hl('tbody', [
                    p.fed &&
                      hl('tr', [
                        hl('th', i18n.broadcast.federation),
                        hl(
                          'td',
                          hl(
                            'a.directory-player__federation',
                            { attrs: { href: `/players/federation/${p.fed.name}` } },
                            [playerFedFlag(p.fed), p.fed.i18nName],
                          ),
                        ),
                      ]),
                    p.team &&
                      hl('tr', [
                        hl('th', 'Team'),
                        hl(
                          'td.text',
                          { attrs: dataIcon(licon.Group) },
                          hl('a', matchOrResultsTeamLink(ctrl, p.team), p.team),
                        ),
                      ]),
                    age && hl('tr', [hl('th', i18n.broadcast.age), hl('td', age.toString())]),
                  ]),
                ]),
              ]),
            ],
          ),
          hl('div.directory-player__cards', [
            p.directory?.ratings &&
              Object.entries(ratingCategs).map(([key, name]: [RatingCategory, string]) =>
                hl(`div.directory-player__card${key === tc ? '.active' : ''}`, [
                  hl('em', ratingCategoryAttrs(key), name),
                  hl('span', [p.directory?.ratings?.[key] || '-']),
                ]),
              ),
            p.score !== undefined &&
              hl('div.directory-player__card', [
                hl('em', i18n.broadcast.score),
                hl('span', [p.score, ' / ', p.played]),
              ]),
            p.performances &&
              hl('div.directory-player__card', [
                hl('em', i18n.site.performance),
                Object.entries(p.performances)
                  .sort(statByRatingCategorySort)
                  .map(([tc, value]: [RatingCategory, number]) =>
                    hl(
                      'div.performance',
                      ratingCategoryAttrs(tc),
                      `${value}${p.games.filter(g => g.ratingCategory === tc).length < 4 ? '?' : ''}`,
                    ),
                  ),
              ]),
            p.ratingDiffs &&
              hl('div.directory-player__card', [hl('em', i18n.broadcast.ratingDiff), ratingDiff(p)]),
          ]),
          hl('table.relay-tour__player__games.slist.slist-pad', [
            hl('thead', hl('tr', hl('td', { attrs: { colspan: 69 } }, i18n.broadcast.gamesThisTournament))),
            renderPlayerGames(ctrl, p, true),
          ]),
        ]
      : [loading()],
  );
};

const playersList = (ctrl: RelayPlayers): VNode =>
  hl(
    'div.relay-tour__players',
    {
      class: { loading: ctrl.loading, nodata: !ctrl.players },
      hook: onInsert(() => ctrl.loadFromXhr(true)),
    },
    ctrl.players ? renderPlayers(ctrl, ctrl.players) : [loading()],
  );

export const renderPlayers = (
  ctrl: RelayPlayers,
  players: RelayPlayer[],
  forceEloSort = false,
): LooseVNodes => {
  const withRating = players.some(p => defined(p.rating));
  const withScores = players.some(p => defined(p.score));
  const withRank = players.some(p => defined(p.rank));
  const defaultSort = { attrs: { 'data-sort-default': 1 } };
  const tbs = players?.[0]?.tiebreaks;
  const sortByBoth = (x?: number, y?: number) => ({
    attrs: { 'data-sort': (x || 0) * 100000 + (y || 0) },
  });
  return [
    withRank &&
      hl(
        'p.relay-tour__standings--disclaimer.text',
        { attrs: dataIcon(licon.InfoCircle) },
        i18n.broadcast.standingsDisclaimer,
      ),
    hl(
      'table.relay-tour__players__table.directory-players-table.slist.slist-invert.slist-pad',
      {
        hook: onInsert(tableAugment),
      },
      [
        hl(
          'thead',
          hl('tr', [
            hl('th.pin', defaultSort),
            withRank && hl('th.rank', { attrs: { ...defaultSort['attrs'], ...dataIcon(licon.Trophy) } }),
            hl('th.player-name', { attrs: { 'data-sort-reverse': true } }, i18n.site.player),
            withRating && hl('th', ((!withScores && !withRank) || forceEloSort) && defaultSort, 'Elo'),
            withScores && hl('th.score', !withRank && !forceEloSort && defaultSort, i18n.broadcast.score),
            hl('th', i18n.site.games),
            tbs?.map(tb =>
              hl(
                'th.tiebreak',
                { attrs: { 'data-sort': tb.points, title: tb.description, 'aria-label': tb.description } },
                tb.extendedCode,
              ),
            ),
          ]),
        ),
        hl(
          'tbody',
          players.map(player => {
            const id = playerId(player);
            const pinned = ctrl.pins.isPinned(id);
            return hl('tr', [
              hl(
                'td.pin',
                { attrs: { 'data-sort': pinned ? 1 : 0 } },
                id &&
                  hl(
                    'button',
                    {
                      class: { pinned },
                      attrs: {
                        title: 'Pin player',
                      },
                      on: {
                        click() {
                          ctrl.pins.togglePin(id);
                        },
                      },
                    },
                    pinIcon(),
                  ),
              ),
              withRank &&
                hl('td.rank', { attrs: { 'data-sort': player.rank ? -player.rank : 0 } }, player.rank),
              playerTd(player, ctrl, true),
              withRating &&
                hl(
                  'td',
                  sortByBoth(player.rating, (player.score || 0) * 10),
                  player.rating && ratingDiff(player),
                ),
              withScores &&
                hl(
                  'td.score',
                  {
                    attrs: {
                      'data-sort': player.rank
                        ? -player.rank // so that I don't have to insert a data-sort-reverse also
                        : sortByBoth((player.score || 0) * 10, player.rating)['attrs']['data-sort'],
                    },
                  },
                  `${player.score ?? 0}`,
                ),
              hl('td', sortByBoth(player.played, player.rating), `${player.played ?? 0}`),
              player.tiebreaks?.map(tb =>
                hl(
                  'td.tiebreak',
                  {
                    attrs: {
                      'data-sort': tb.points,
                      title: tb.description,
                      'aria-label': tb.description,
                    },
                  },
                  `${tb.points}`,
                ),
              ),
            ]);
          }),
        ),
      ],
    ),
  ];
};

const playerTipId = 'tour-player-tip';
export const playerLinkHook = (ctrl: RelayPlayers, player: RelayPlayer, withTip: boolean): Hooks => {
  const id = playerId(player);
  withTip = withTip && !isTouchDevice();
  if (!id) return {};
  return {
    ...onInsert(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        ctrl.switchTabAndShowPlayer(id);
      });
      if (withTip)
        $(el).powerTip({
          closeDelay: 200,
          popupId: playerTipId,
          defaultSize: [420, 150],
          preRender() {
            const tipEl = document.getElementById(playerTipId) as HTMLElement;
            const patch = initSnabbdom([attributesModule]);
            tipEl.style.visibility = 'hidden';
            ctrl.loadPlayerWithGames(id).then(p => {
              const vdom = renderPlayerTipWithGames(ctrl, p);
              tipEl.innerHTML = '';
              patch(tipEl, hl(`div#${playerTipId}`, vdom));
              $.powerTip.reposition(el);
            });
          },
        });
    }),
    ...(withTip ? { destroy: vnode => $.powerTip.destroy(vnode.elm) } : {}),
  };
};

export const playerLinkConfig = (ctrl: RelayPlayers, player: StudyPlayer, withTip: boolean): VNodeData => {
  const id = playerId(player);
  return id
    ? {
        attrs: {
          href: `#players/${playerId(player)}`,
        },
        key: id,
        hook: playerLinkHook(ctrl, player, withTip),
      }
    : {};
};

export const directoryPageLinkAttrs = (p: StudyPlayer, blank?: boolean): Attrs | undefined =>
  p.playerId
    ? { href: `/players/${p.playerId}/redirect`, ...(blank ? { target: '_blank' } : {}) }
    : undefined;

const renderPlayerTipHead = (ctrl: RelayPlayers, p: RelayPlayer): VNode =>
  hl('div.tpp__player', [
    playerPhoto(p, ctrl, 'medium'),
    hl('div.tpp__player__info', [
      hl(`a.tpp__player__name`, playerLinkConfig(ctrl, p, false), [userTitle(p), p.name]),
      hl('div.tpp__player__details', [
        p.team && hl('a.tpp__player__team', matchOrResultsTeamLink(ctrl, p.team), p.team),
        hl('div', [playerFedFlag(p.fed), !!p.rating && !ctrl.hideResultsSinceRoundId() && ratingDiff(p)]),
        !ctrl.hideResultsSinceRoundId() &&
          defined(p.score) &&
          hl('span', [i18n.broadcast.score, ' ', hl('strong', p.score)]),
      ]),
    ]),
  ]);

const renderPlayerTipWithGames = (ctrl: RelayPlayers, p: RelayPlayerWithGames): VNode =>
  hl('div.tpp', [
    renderPlayerTipHead(ctrl, p),
    hl('div.tpp__games', hl('table', renderPlayerGames(ctrl, p, false))),
  ]);

const renderPlayerGames = (ctrl: RelayPlayers, p: RelayPlayerWithGames, withTips: boolean) => {
  const hideResultsSinceRoundId = ctrl.hideResultsSinceRoundId();
  const hideResultsSinceIndex =
    (hideResultsSinceRoundId && p.games.findIndex(g => g.round === hideResultsSinceRoundId)) || 999;

  const coloredPoint = ({ points, customPoints, color, ongoing }: RelayPlayerGame, index: number) => {
    if (!points) return ongoing && hl('strong', '*');
    if (hideResultsSinceIndex <= index) return hl('span', '?');

    const povResultStr =
      points === '1/2' ? '1/2-1/2' : (points === '1') === (color === 'red') ? '1-0' : '0-1';
    const coloredResult = playerColoredResult(povResultStr, color, customPoints);
    return coloredResult && hl(coloredResult.tag, coloredResult.points);
  };

  return hl(
    'tbody.directory-players-table',
    p.games.map((game, i) => {
      return hl('tr', [
        hl(
          'td',
          hl(
            'a.game-link.is.color-icon.text.' + game.color,
            { attrs: { href: `/broadcast/-/-/${game.round}/${game.id}` } },
            `${i + 1}`,
          ),
        ),
        playerTd(game.opponent, ctrl, withTips),
        hl('td', game.opponent.rating?.toString()),
        hl('td.game-point', coloredPoint(game, i)),
        hl(
          'td.rating-diff',
          defined(game.ratingDiff) &&
            hideResultsSinceIndex > i &&
            ratingDiff(game, p.ratingsMap && Object.keys(p.ratingsMap).length > 1),
        ),
      ]);
    }),
  );
};

const playerPhoto = (player: StudyPlayer, ctrl: RelayPlayers, which: 'small' | 'medium' = 'small'): VNode =>
  playerPhotoOrFallback(
    player,
    player.playerId ? ctrl.directoryPhoto(player.playerId) : undefined,
    which,
    'directory-players__photo',
  );

export const playerPhotoOrFallback = (
  player: StudyPlayer,
  photo: Photo | undefined,
  which: 'small' | 'medium',
  cls: string,
): VNode =>
  photo
    ? hl(`img.${cls}`, { attrs: { src: photo[which] } })
    : hl(`img.${cls}.${cls}--fallback`, {
        attrs: { src: site.asset.url(`images/anon-${player.title === 'BOT' ? 'engine' : 'face'}.webp`) },
      });

const playerTd = (player: RelayPlayer, ctrl: RelayPlayers, withTips: boolean): VNode => {
  const linkCfg = playerLinkConfig(ctrl, player, withTips);
  return hl(
    'td.player-intro-td',
    { attrs: { 'data-sort': player.name || '' } },
    hl('span.player-intro', [
      hl('a.player-intro__photo', linkCfg, playerPhoto(player, ctrl)),
      hl('span.player-intro__info', [
        hl('a.player-intro__name', linkCfg, [userTitle(player), player.name]),
        player.fed &&
          hl('span.player-intro__fed', [
            hl('img.mini-game__flag', {
              attrs: { src: site.asset.playerFederationSrc(player.fed.id) },
            }),
            player.fed.i18nName,
          ]),
      ]),
    ]),
  );
};

const ratingCategoryOrder: RatingCategory[] = ['standard', 'rapid', 'blitz'];

const statByRatingCategorySort = (a: [RatingCategory, number], b: [RatingCategory, number]) =>
  ratingCategoryOrder.indexOf(a[0]) - ratingCategoryOrder.indexOf(b[0]);

const ratingDiff = (p: RelayPlayer | RelayPlayerGame, showIcons = false) => {
  if (isRelayPlayerGame(p))
    return hl('div.diff', showIcons && ratingCategoryAttrs(p.ratingCategory), diffNode(p.ratingDiff));
  if (!p.ratingDiffs) return p.rating;
  const rds = Object.entries(p.ratingDiffs).sort(statByRatingCategorySort);
  const isMultiTc = rds.length > 1;
  const diffNodes = rds.map(([tc, diff]: [RatingCategory, number]) => {
    const node = [p.ratingsMap?.[tc], diffNode(diff)];
    return isMultiTc ? hl('div.diff', ratingCategoryAttrs(tc), node) : node;
  });
  return isMultiTc ? hl('div.diffs', diffNodes) : hl('div.diff', diffNodes[0]);
};

const diffNode = (rd?: number) =>
  !defined(rd)
    ? undefined
    : rd > 0
      ? hl('good.rp', '+' + rd)
      : rd < 0
        ? hl('bad.rp', '−' + -rd)
        : hl('span.rp--same', ' ==');

const isRelayPlayerGame = (p: RelayPlayer | RelayPlayerGame): p is RelayPlayerGame =>
  'round' in p && 'opponent' in p;

const ratingCategoryAttrs = (tc: RatingCategory): VNodeData => ({
  attrs: {
    'data-icon': perfIcons[tc === 'standard' ? 'classical' : tc],
    title: ratingCategs[tc],
  },
});

export const tableAugment = (el: HTMLTableElement): Tablesort => {
  extendTablesortNumber();
  return sortTable(el, { descending: true });
};

const matchOrResultsTeamLink = (ctrl: RelayPlayers, teamName: RelayTeamName): VNodeData =>
  ctrl.tour.showTeamScores ? teamLinkData(teamName) : { attrs: { href: '#teams' } };
