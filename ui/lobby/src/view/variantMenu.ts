import { licon } from 'lib/licon';
import { svgIcon } from 'lib/svgIcon';
import { bind, hl } from 'lib/view';

import type LobbyController from '../ctrl';
import { occupancy } from './occupancy';

export type LobbyVariant = 'banqi' | 'jieqi' | 'minixiangqi' | 'manchu' | 'threeKingdoms';

export const ratedVariantDisabled = (ctrl: LobbyController) =>
  !!(
    ctrl.me?.isBot ||
    ctrl.playban ||
    ctrl.hasOngoingRealTimeGame(true) ||
    ctrl.opts.hasUnreadLichessMessage
  );

export function playVariant(ctrl: LobbyController, variant: LobbyVariant, action: 'rated' | 'ai' | 'friend') {
  if (action === 'rated') ctrl.openHomepagePool(ctrl.variantPool(variant));
  else {
    ctrl.setupCtrl.openModal(action, { variant });
    ctrl.redraw();
  }
}

export default function variantMenu(
  ctrl: LobbyController,
  variant: LobbyVariant,
  navigate: (action: () => void) => void,
) {
  const pool = ctrl.variantPool(variant);
  const kingdoms = variant === 'threeKingdoms';
  const mini = variant === 'minixiangqi';
  const manchu = variant === 'manchu';
  const play = (action: 'rated' | 'ai' | 'friend') => navigate(() => playVariant(ctrl, variant, action));
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
              : variant === 'banqi'
                ? i18n.site.banqiTitle
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
              : variant === 'banqi'
                ? i18n.site.banqiLearnToPlay
                : i18n.site.jieqiLearnToPlay,
      ),
    ]),
    hl(
      'button.lobby__variant-menu-row.lobby__variant-menu-row--rated',
      {
        attrs: {
          type: 'button',
          disabled: ratedVariantDisabled(ctrl),
          title: kingdoms ? i18n.site.threeKingdomsTimeControl : i18n.site.jieqiTimeControl,
        },
        hook: bind('click', () => play('rated')),
      },
      content(
        licon.Trophy,
        manchu
          ? i18n.site.playRatedManchu
          : kingdoms
            ? i18n.site.playRatedThreeKingdoms
            : mini
              ? i18n.site.playRatedMiniXiangqi
              : variant === 'banqi'
                ? i18n.site.playRatedBanqi
                : i18n.site.playRatedJieqi,
        kingdoms ? i18n.site.threeKingdomsTimeControl : i18n.site.minutesShort(pool.lim),
        ctrl.poolCount(`${variant}-rated`),
      ),
    ),
    button(licon.Cogs, i18n.site.playAgainstComputer, () => play('ai'), ctrl.poolCount(`${variant}-ai`)),
    button(
      svgIcon.Challenge,
      kingdoms ? i18n.threeKingdoms.friends : i18n.site.challengeAFriend,
      () => play('friend'),
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
            : variant === 'banqi'
              ? i18n.site.banqiAnalysisBoard
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
