import { h, type VNode } from 'snabbdom';

import type LobbyController from '@/ctrl';
import type { AiStatsCounts } from '@/interfaces';
import type SetupController from '@/setupCtrl';

import { aiLevelName } from './levelButtons';

const percent = (count: number, games: number) => `${games ? Math.round((count * 1000) / games) / 10 : 0}%`;

const result = (label: string, count: number, games: number, className: string): VNode =>
  h(
    `div.ai-history__result.${className}`,
    { attrs: { 'aria-label': `${label}: ${count}, ${percent(count, games)}` } },
    [h('strong', percent(count, games)), h('span', label), h('small', count.toString())],
  );

const historyResults = (stats: AiStatsCounts) =>
  h('div.ai-history__results', [
    result(i18n.site.wins, stats.wins, stats.games, 'wins'),
    result(i18n.site.draws, stats.draws, stats.games, 'draws'),
    result(i18n.site.losses, stats.losses, stats.games, 'losses'),
  ]);

export const aiHistory = (ctrl: SetupController, root: LobbyController) => {
  const level = ctrl.aiLevel();
  const stats = ctrl.aiStats?.levels.find(item => item.level === level)?.mine;
  return h('section.ai-history', [
    h('h3', i18n.site.standardHistoryAgainst('Pikafish', aiLevelName(level))),
    !root.me
      ? h(
          'a.ai-history__login',
          { attrs: { href: '/login?referrer=%2F' } },
          i18n.site.signInOrRegisterToTrackWinRate,
        )
      : ctrl.aiStatsFailed
        ? h('p.ai-history__status', i18n.site.statisticsUnavailable)
        : stats
          ? historyResults(stats)
          : h('p.ai-history__status', '…'),
  ]);
};
