import { numberFormat } from 'lib/i18n';
import { licon } from 'lib/licon';
import { formatMoveTime } from 'lib/setup/timeControl';
import { bind, hl } from 'lib/view';

import type LobbyController from '@/ctrl';
import type { Pool } from '@/interfaces';

import correspondenceDeck from './correspondenceDeck';
import homepageRoomView from './homepageRoom';
import renderSetupModal from './setup/modal';

export default function table(ctrl: LobbyController) {
  if (ctrl.homepageRoom)
    return hl('div.lobby__table.lobby__table--homepage-room', homepageRoomView(ctrl, ctrl.homepageRoom));

  const { opts } = ctrl;
  const hasOngoingRealTimeGame = ctrl.hasOngoingRealTimeGame(true);
  const poolSeeking = ctrl.hasPoolSeeking();
  const quickDisabled =
    opts.playban || opts.hasUnreadLichessMessage || !!ctrl.me?.isBot || hasOngoingRealTimeGame;
  const performance = ctrl.homePools.find(pool => pool.lim === 15)!;
  const quickRooms = ctrl.homePools.filter(pool => pool.lim !== 15).sort((a, b) => a.lim - b.lim);
  const quickRoomCounts = new Map(quickRooms.map(pool => [pool.id, ctrl.poolCount(pool.id)]));
  const customRoomCount = ctrl.poolCount('lobby');
  const otherTimeControlsCount =
    [...quickRoomCounts.values()].reduce((total, count) => total + count, 0) + customRoomCount;

  return hl('div.lobby__table', { class: { 'lobby__table--seeking': poolSeeking } }, [
    featurePoolButton(performance),
    hl('details.lobby__time-controls', [
      hl('summary.lobby__time-controls__summary', { class: { transp: poolSeeking } }, [
        chevron('lobby__time-controls__chevron'),
        englishLabel(i18n.site.otherTimeControls, 'lobby__time-controls__label'),
        occupancy(otherTimeControlsCount),
      ]),
      hl('div.lobby__quick-rooms', { attrs: { role: 'group', 'aria-label': i18n.site.otherTimeControls } }, [
        ...quickRooms.map(pool => compactPoolButton(pool, quickRoomCounts.get(pool.id)!)),
        hl(
          'button.lobby__quick-room.lobby__quick-room--lobby',
          {
            class: { transp: poolSeeking },
            attrs: { type: 'button' },
            hook: bind('click', ctrl.openLobbyOverlay),
          },
          [
            hl('span.lobby__quick-room__summary', [
              englishLabel('Custom', 'lobby__quick-room__label'),
              occupancy(customRoomCount),
              chevron('lobby__quick-room__chevron'),
            ]),
          ],
        ),
      ]),
    ]),
    hl('div.lobby__actions', [
      computerButton(),
      hl('a.lobby__action.lobby__action--puzzle', { attrs: { href: '/training' } }, [
        hl('span.lobby__svg-icon.lobby__svg-icon--puzzle', { attrs: { 'aria-hidden': 'true' } }),
        englishLabel(i18n.site.puzzles, 'lobby__action__label'),
        actionActivity(ctrl.poolCount('puzzle')),
      ]),
    ]),
    correspondenceDeck(ctrl),
    renderSetupModal(ctrl),
  ]);

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
          'aria-label': `${i18n.site.chessPerformanceEvaluationChinese}. ${i18n.site.playRatedXiangqi}. ${i18n.site.standard}, ${i18n.site.minutesShort(pool.lim)}. ${i18n.site.nbPlayers(playerCount, numberFormat(playerCount))}`,
        },
        hook: quickDisabled && !active ? {} : bind('click', () => clickPool(pool)),
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
            !ctrl.me && hl('span.lobby__feature-card__sign-in', i18n.site.signInToPlayRatedXiangqi),
          ]),
        ]),
        hl('img.lobby__feature-card__image', {
          attrs: {
            src: site.asset.url('images/homepage/xiangqi-evaluation-mode.webp'),
            alt: '',
            'aria-hidden': 'true',
            width: '320',
            height: '320',
            decoding: 'async',
          },
        }),
        chevron('lobby__feature-card__chevron'),
      ],
    );
  }

  function compactPoolButton(pool: Pool, playerCount: number) {
    const active = ctrl.isPoolSeeking(pool.id);
    return hl(
      'button.lobby__quick-room',
      {
        class: {
          active,
          'bar-glider': active,
          transp: poolSeeking && !active,
          disabled: quickDisabled && !active,
        },
        attrs: {
          type: 'button',
          disabled: quickDisabled && !active,
          title: formatMoveTime(pool.moveTime!),
          'aria-pressed': active ? 'true' : 'false',
        },
        hook: quickDisabled && !active ? {} : bind('click', () => clickPool(pool)),
      },
      [
        hl('span.lobby__quick-room__summary', [
          englishLabel(i18n.site.minutesShort(pool.lim), 'lobby__quick-room__label'),
          occupancy(playerCount),
          chevron('lobby__quick-room__chevron'),
        ]),
      ],
    );
  }

  function computerButton() {
    const active = ctrl.setupCtrl.gameType === 'ai';
    return hl(
      'button.lobby__action.lobby__action--ai',
      {
        class: { active, disabled: hasOngoingRealTimeGame, transp: poolSeeking },
        attrs: {
          type: 'button',
          disabled: hasOngoingRealTimeGame,
          'aria-disabled': hasOngoingRealTimeGame ? 'true' : 'false',
        },
        hook: hasOngoingRealTimeGame ? {} : bind('click', () => ctrl.setupCtrl.openModal('ai'), ctrl.redraw),
      },
      [
        hl('span.lobby__svg-icon.lobby__svg-icon--computer', { attrs: { 'aria-hidden': 'true' } }),
        englishLabel(i18n.site.playAgainstComputer, 'lobby__action__label'),
        actionActivity(ctrl.poolCount('ai')),
      ],
    );
  }

  function actionActivity(count: number) {
    return hl('span.lobby__action__activity', [occupancy(count), chevron('lobby__action__chevron')]);
  }

  function bilingualLabel(chinese: string, english: string, className: string) {
    return hl(`span.${className}`, [
      hl('span.lobby__label-zh', chinese),
      hl('span.lobby__label-en', english),
    ]);
  }

  function englishLabel(english: string, className: string) {
    return hl(`span.${className}`, hl('span.lobby__label-en.lobby__label-en--primary', english));
  }

  function chevron(className: string) {
    return hl(`span.${className}.text`, {
      attrs: { 'data-icon': licon.GreaterThan, 'aria-hidden': 'true' },
    });
  }

  function occupancy(count: number, highlighted = false) {
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

  function clickPool(pool: Pool) {
    ctrl.openHomepagePool(pool);
  }
}
