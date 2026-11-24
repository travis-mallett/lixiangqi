import { numberFormat } from 'lib/i18n';
import { licon } from 'lib/licon';
import { svgIcon } from 'lib/svgIcon';
import { hl } from 'lib/view';

import type LobbyController from '@/ctrl';
import type { Pool, Tab } from '@/interfaces';

import botMap from './botMap';
import renderSeeks from './correspondence';
import correspondenceDeck from './correspondenceDeck';
import homepageRoomView from './homepageRoom';
import { occupancy } from './occupancy';
import { render as renderHooks } from './realTime/list';
import renderSetupModal from './setup/modal';

export default function table(ctrl: LobbyController) {
  if (ctrl.botMapOpen)
    return hl('div.lobby__table.lobby__table--bot-map', [
      botMap(ctrl),
      !ctrl.setupCtrl.startingBot && renderSetupModal(ctrl),
    ]);
  if (ctrl.homepageRoom)
    return hl('div.lobby__table.lobby__table--homepage-room', homepageRoomView(ctrl, ctrl.homepageRoom));

  const { opts } = ctrl;
  const hasOngoingRealTimeGame = ctrl.hasOngoingRealTimeGame(true);
  const poolSeeking = ctrl.hasPoolSeeking();
  const offersDisabled = !!opts.playban || opts.hasUnreadLichessMessage || !!ctrl.me?.isBot;
  const quickDisabled = offersDisabled || hasOngoingRealTimeGame;
  const performance = ctrl.homePools.find(pool => pool.lim === 15)!;
  const tabs = [
    ['pools', licon.LineGraph, i18n.site.ratedXiangqi],
    [
      'real_time',
      svgIcon.Lobby,
      i18n.site.lobby,
      !quickDisabled && ctrl.data.hooks.some(hook => hook.action === 'join' && !hook.disabled),
    ],
    [
      'seeks',
      svgIcon.Correspondence,
      i18n.site.correspondence,
      !offersDisabled &&
        (ctrl.data.seeks.some(seek => seek.action === 'joinSeek') ||
          ctrl.kingdomOffers?.some(o => !ctrl.myKingdomOffer(o))),
    ],
  ] as const;

  function selectTab(key: Tab) {
    ctrl.setTab(key);
    document.getElementById('home-tab-' + key)?.focus();
  }

  return hl('div.lobby__table', { class: { 'lobby__table--seeking': poolSeeking } }, [
    hl('section.lobby__match', [
      hl(
        'div.lobby__match-tabs',
        { attrs: { role: 'tablist', 'aria-label': i18n.site.play } },
        tabs.map(([key, icon, label, available], index) =>
          hl(
            'button',
            {
              attrs: {
                type: 'button',
                id: 'home-tab-' + key,
                role: 'tab',
                'aria-label': label,
                'aria-description': available ? i18n.site.openGamesAvailable : false,
                'aria-selected': String(ctrl.tab === key),
                tabindex: ctrl.tab === key ? 0 : -1,
                'aria-controls': 'home-match-panel',
                'data-icon': icon,
              },
              on: {
                click: () => selectTab(key),
                keydown: (event: KeyboardEvent) => {
                  const next = { ArrowLeft: (index + 2) % 3, ArrowRight: (index + 1) % 3, Home: 0, End: 2 }[
                    event.key
                  ];
                  if (next === undefined) return;
                  event.preventDefault();
                  selectTab(tabs[next][0]);
                },
              },
            },
            hl('span.lobby__match-tab-label', { class: { 'has-open-games': !!available } }, label),
          ),
        ),
      ),
      hl(
        'div#home-match-panel',
        { attrs: { role: 'tabpanel', 'aria-labelledby': 'home-tab-' + ctrl.tab } },
        ctrl.tab === 'pools' ? featurePoolButton(performance) : offers(),
      ),
    ]),
    hl('div.lobby__actions', [
      hl(
        'button.button.button-metal.lobby__action.lobby__action--ai',
        {
          attrs: { type: 'button', disabled: hasOngoingRealTimeGame },
          on: {
            click: () => {
              ctrl.openBotMap();
              ctrl.redraw();
            },
          },
        },
        [lobbyIcon('computer'), i18n.site.playAgainstComputer],
      ),
      hl('a.button.button-metal.lobby__action', { attrs: { href: '/training/themes' } }, [
        lobbyIcon('puzzle'),
        i18n.site.puzzles,
      ]),
      hl(
        'button.button.button-metal.lobby__action',
        {
          attrs: { type: 'button', disabled: hasOngoingRealTimeGame },
          on: { click: () => ctrl.openSetupFromLobby('friend') },
        },
        [
          hl('span', { attrs: { 'data-icon': svgIcon.Challenge, 'aria-hidden': 'true' } }),
          i18n.site.challengeAFriend,
        ],
      ),
    ]),
    correspondenceDeck(ctrl),
    renderSetupModal(ctrl),
  ]);

  function lobbyIcon(name: string) {
    return hl('span.lobby__svg-icon.lobby__svg-icon--' + name, { attrs: { 'aria-hidden': 'true' } });
  }

  function offers() {
    const realTime = ctrl.tab === 'real_time';
    const label = realTime ? i18n.site.createCustomGame : i18n.site.createCorrespondenceGame;
    const disabled = realTime ? quickDisabled : offersDisabled;
    const rows = realTime ? ctrl.stepHooks : ctrl.data.seeks;
    return hl('div.lobby__offers', { key: ctrl.tab }, [
      hl('div.lobby__offers-list', { attrs: { inert: disabled } }, [
        realTime ? renderHooks(ctrl, ctrl.stepHooks) : renderSeeks(ctrl),
        !rows.length && (realTime || !ctrl.kingdomOffers?.length) && hl('p', i18n.site.noGameFound),
      ]),
      !realTime && !ctrl.me
        ? hl(
            'a.button',
            { attrs: { href: '/login?referrer=' + encodeURIComponent('/?time=correspondence#hook') } },
            label,
          )
        : hl(
            'button.button',
            {
              attrs: { type: 'button', disabled },
              on: {
                click: () =>
                  ctrl.openSetupFromLobby('hook', { timeMode: realTime ? 'realTime' : 'correspondence' }),
              },
            },
            label,
          ),
    ]);
  }

  function featurePoolButton(pool: Pool) {
    const active = ctrl.isPoolSeeking(pool.id);
    const playerCount = ctrl.poolCount(pool.id);
    return hl(
      'button.lobby__feature-card.lobby__feature-card--evaluation',
      {
        class: {
          active,
          'bar-glider': active,
          'lobby__feature-card--anonymous': !ctrl.me,
          transp: poolSeeking && !active,
          disabled: quickDisabled && !active,
        },
        attrs: {
          type: 'button',
          disabled: quickDisabled && !active,
          'aria-pressed': active ? 'true' : 'false',
          'data-traffic-action': 'home.time-control',
          'data-traffic-pool': pool.id,
          'aria-label': `${i18n.site.playNow}. ${i18n.site.chessPerformanceEvaluationChinese}. ${i18n.site.playRatedXiangqi}. ${i18n.site.standard}, ${i18n.site.minutesShort(pool.lim)}. ${i18n.site.nbPlayers(playerCount, numberFormat(playerCount))}`,
        },
        on: { click: () => ctrl.openHomepagePool(pool) },
      },
      [
        hl('span.lobby__feature-card__content', [
          hl('span.lobby__feature-card__divider', { attrs: { 'aria-hidden': 'true' } }),
          hl('span.lobby__feature-card__body', [
            bilingualLabel(
              i18n.site.chessPerformanceEvaluationChinese,
              i18n.site.playRatedXiangqi,
              'lobby__feature-card__heading',
            ),
            hl('span.lobby__feature-card__meta', [
              hl('span', [
                i18n.site.standard,
                hl('span.lobby__feature-card__separator', { attrs: { 'aria-hidden': 'true' } }, ' · '),
                hl('span.lobby__feature-card__time', i18n.site.minutesShort(pool.lim)),
              ]),
              occupancy(playerCount, true),
            ]),
            hl(
              'span.button.lobby__play-now',
              { attrs: { 'data-icon': licon.PlayTriangle } },
              i18n.site.playNow,
            ),
            !ctrl.me && hl('span.lobby__feature-card__sign-in', i18n.site.signInToPlayRatedXiangqi),
          ]),
        ]),
      ],
    );
  }

  function bilingualLabel(chinese: string, english: string, className: string) {
    return hl(`span.${className}`, [
      hl('span.lobby__label-zh', chinese),
      hl('span.lobby__label-en', english),
    ]);
  }
}
