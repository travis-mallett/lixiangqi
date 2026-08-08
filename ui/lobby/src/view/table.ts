import { numberFormat } from 'lib/i18n';
import { licon } from 'lib/licon';
import { formatMoveTime } from 'lib/setup/timeControl';
import { bind, hl, spinnerVdom } from 'lib/view';

import type LobbyController from '@/ctrl';
import type { GameType, Pool } from '@/interfaces';

import renderSetupModal from './setup/modal';

type ActionInfo = { gameType: Exclude<GameType, 'hook'>; label: string; disabled: boolean };

export default function table(ctrl: LobbyController) {
  const { opts } = ctrl;
  const hasOngoingRealTimeGame = ctrl.hasOngoingRealTimeGame(true);
  const quickDisabled =
    opts.playban || opts.hasUnreadLichessMessage || !!ctrl.me?.isBot || hasOngoingRealTimeGame;
  const performance = ctrl.homePools.find(pool => pool.lim === 15)!;
  const quickRooms = ctrl.homePools.filter(pool => pool.lim !== 15).sort((a, b) => a.lim - b.lim);
  const actions: ActionInfo[] = [
    { gameType: 'friend', label: i18n.site.challengeAFriend, disabled: hasOngoingRealTimeGame },
    { gameType: 'ai', label: i18n.site.playAgainstComputer, disabled: hasOngoingRealTimeGame },
  ];

  return hl('div.lobby__table', [
    featurePoolButton(performance),
    hl('div.lobby__quick-rooms', [
      ...quickRooms.map(compactPoolButton),
      hl(
        'button.lobby__quick-room.lobby__quick-room--lobby',
        {
          attrs: { type: 'button' },
          hook: bind('click', ctrl.openLobbyOverlay),
        },
        [hl('strong', i18n.site.lobby), occupancy(ctrl.poolCount('lobby'))],
      ),
    ]),
    hl('div.lobby__actions', actions.map(actionButton)),
    renderSetupModal(ctrl),
  ]);

  function featurePoolButton(pool: Pool) {
    const active = ctrl.isPoolSeeking(pool.id);
    return hl(
      'button.lobby__feature-card.lobby__feature-card--evaluation',
      {
        class: {
          active,
          'bar-glider': active,
          transp: ctrl.hasPoolSeeking() && !active,
          disabled: quickDisabled && !active,
        },
        attrs: {
          type: 'button',
          disabled: quickDisabled && !active,
          'aria-pressed': active ? 'true' : 'false',
          'aria-label': `${i18n.site.chessPerformance} ${i18n.site.evaluation} (${i18n.site.chessPerformanceEvaluationChinese}). ${formatMoveTime(pool.moveTime!)}`,
        },
        hook: quickDisabled && !active ? {} : bind('click', () => clickPool(pool.id)),
      },
      [
        hl('img.lobby__feature-card__image', {
          attrs: {
            src: site.asset.url('images/homepage/xiangqi-evaluation-mode.webp'),
            alt: '',
            'aria-hidden': 'true',
            width: '384',
            height: '384',
          },
        }),
        hl('span.lobby__feature-card__body', [
          hl('strong.lobby__feature-card__title', [
            hl('span', i18n.site.chessPerformance),
            hl('span', i18n.site.evaluation),
          ]),
          hl('span.lobby__feature-card__subtitle', i18n.site.chessPerformanceEvaluationChinese),
          hl('span.lobby__feature-card__meta', [
            hl('span.lobby__feature-card__time', i18n.site.minutesShort(pool.lim)),
            occupancy(ctrl.poolCount(pool.id)),
          ]),
          active ? waitingStatus() : null,
        ]),
      ],
    );
  }

  function compactPoolButton(pool: Pool) {
    const active = ctrl.isPoolSeeking(pool.id);
    return hl(
      'button.lobby__quick-room',
      {
        class: {
          active,
          'bar-glider': active,
          transp: ctrl.hasPoolSeeking() && !active,
          disabled: quickDisabled && !active,
        },
        attrs: {
          type: 'button',
          disabled: quickDisabled && !active,
          title: formatMoveTime(pool.moveTime!),
          'aria-pressed': active ? 'true' : 'false',
        },
        hook: quickDisabled && !active ? {} : bind('click', () => clickPool(pool.id)),
      },
      [
        hl('span.lobby__quick-room__summary', [
          hl('strong', i18n.site.minutesShort(pool.lim)),
          occupancy(ctrl.poolCount(pool.id)),
        ]),
        active ? waitingStatus() : null,
      ],
    );
  }

  function actionButton(action: ActionInfo) {
    return hl(
      `button.button.button-metal.lobby__action.lobby__action--${action.gameType}`,
      {
        class: { active: ctrl.setupCtrl.gameType === action.gameType, disabled: action.disabled },
        attrs: {
          type: 'button',
          disabled: action.disabled,
          'aria-disabled': action.disabled ? 'true' : 'false',
        },
        hook: action.disabled
          ? {}
          : bind('click', () => ctrl.setupCtrl.openModal(action.gameType), ctrl.redraw),
      },
      [
        action.gameType === 'friend'
          ? hl('span.lobby__action__icon.text', {
              attrs: { 'data-icon': licon.User, 'aria-hidden': 'true' },
            })
          : hl('span.lobby__action__icon.lobby__action__icon--ai', {
              attrs: { 'aria-hidden': 'true' },
            }),
        hl('span.lobby__action__label', action.label),
        occupancy(ctrl.poolCount(action.gameType)),
      ],
    );
  }

  function waitingStatus() {
    return hl('span.lobby__seeking', { attrs: { role: 'status', 'aria-live': 'polite' } }, [
      spinnerVdom(),
      hl('span', i18n.site.waitingForOpponent),
    ]);
  }

  function occupancy(count: number) {
    const formatted = numberFormat(count);
    return hl(
      'span.lobby__occupancy.text',
      {
        attrs: {
          'data-icon': licon.Group,
          title: i18n.site.nbPlayers(count, formatted),
          'aria-label': i18n.site.nbPlayers(count, formatted),
        },
      },
      formatted,
    );
  }

  function clickPool(id: string) {
    if (ctrl.redirecting) return;
    ctrl.clickPool(id);
  }
}
