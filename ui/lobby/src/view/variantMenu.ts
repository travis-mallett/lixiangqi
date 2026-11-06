import { licon } from 'lib/licon';
import { bind, hl } from 'lib/view';

import type LobbyController from '../ctrl';
import type { GameType } from '../interfaces';
import { occupancy } from './occupancy';

export default function variantMenu(
  ctrl: LobbyController,
  variant: 'jieqi' | 'minixiangqi' | 'manchu' | 'threeKingdoms',
  navigate: (action: () => void) => void,
) {
  const pool = ctrl.variantPool(variant);
  const kingdoms = variant === 'threeKingdoms';
  const mini = variant === 'minixiangqi';
  const manchu = variant === 'manchu';
  const disabled =
    !!ctrl.me?.isBot ||
    ctrl.playban ||
    ctrl.hasOngoingRealTimeGame(true) ||
    ctrl.opts.hasUnreadLichessMessage;
  const setup = (type: GameType) =>
    navigate(() => {
      ctrl.setupCtrl.openModal(type, { variant });
      ctrl.redraw();
    });
  const content = (icon: string, label: string, detail?: string, count?: number) => [
    hl('span.lobby__variant-menu-icon', { attrs: { 'data-icon': icon, 'aria-hidden': 'true' } }),
    hl('span.lobby__variant-menu-label', [hl('span', label), detail && hl('small', detail)]),
    count !== undefined && occupancy(count),
    hl('span.lobby__variant-menu-chevron', {
      attrs: { 'data-icon': licon.GreaterThan, 'aria-hidden': 'true' },
    }),
  ];
  const button = (icon: string, label: string, action: () => void, count: number) =>
    hl(
      'button.lobby__variant-menu-row',
      { attrs: { type: 'button' }, hook: bind('click', action) },
      content(icon, label, undefined, count),
    );
  const link = (icon: string, label: string, href: string) =>
    hl('a.lobby__variant-menu-row', { attrs: { href } }, content(icon, label));
  return hl('div.lobby__variant-menu', [
    hl('header.lobby__variant-menu-heading', [
      hl(
        'h2#variant-menu-title',
        manchu
          ? i18n.site.manchuTitle
          : kingdoms
            ? `${i18n.site.threeKingdoms} (三国棋)`
            : mini
              ? i18n.site.miniXiangqiTitle
              : i18n.site.jieqiTitle,
      ),
      hl(
        'a.text',
        { attrs: { href: `/variant/${variant}`, 'data-icon': licon.Book } },
        manchu
          ? i18n.site.manchuLearnToPlay
          : kingdoms
            ? i18n.site.learnMenu
            : mini
              ? i18n.site.miniXiangqiLearnToPlay
              : i18n.site.jieqiLearnToPlay,
      ),
    ]),
    hl(
      'button.lobby__variant-menu-row.lobby__variant-menu-row--rated',
      {
        attrs: {
          type: 'button',
          disabled,
          title: kingdoms ? i18n.site.threeKingdomsTimeControl : i18n.site.jieqiTimeControl,
        },
        hook: bind('click', () => navigate(() => ctrl.openHomepagePool(pool))),
      },
      content(
        licon.Trophy,
        manchu
          ? i18n.site.playRatedManchu
          : kingdoms
            ? i18n.site.playRatedThreeKingdoms
            : mini
              ? i18n.site.playRatedMiniXiangqi
              : i18n.site.playRatedJieqi,
        kingdoms ? i18n.site.threeKingdomsTimeControl : i18n.site.minutesShort(pool.lim),
        ctrl.poolCount(pool.id),
      ),
    ),
    button(licon.Cogs, i18n.site.playAgainstComputer, () => setup('ai'), ctrl.poolCount(`${variant}-ai`)),
    button(
      licon.Swords,
      kingdoms ? i18n.site.challengeTwoFriends : i18n.site.challengeAFriend,
      () => setup('friend'),
      ctrl.poolCount(`${variant}-friend`),
    ),
    link(
      licon.Microscope,
      manchu
        ? i18n.site.manchuAnalysisBoard
        : kingdoms
          ? i18n.site.threeKingdomsAnalysisBoard
          : mini
            ? i18n.site.miniXiangqiAnalysisBoard
            : i18n.site.jieqiAnalysisBoard,
      `/analysis/${variant}`,
    ),
    link(
      licon.Book,
      i18n.site.gameHistory,
      ctrl.me
        ? `/@/${ctrl.me.username}/${variant}`
        : '/login?referrer=' + encodeURIComponent(`/?variant=${variant}`),
    ),
  ]);
}
