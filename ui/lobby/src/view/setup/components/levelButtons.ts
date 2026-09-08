import { h } from 'snabbdom';

import { option } from 'lib/setup/option';

import type SetupController from '@/setupCtrl';

import { aiSide } from './aiSide';

const levels = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const maxLevel = levels[levels.length - 1];
const sliderThumbSize = 2.5;

export const aiLevelName = (level: number): string =>
  [
    i18n.site.aiLevelNewcomer,
    i18n.site.aiLevelRookie,
    i18n.site.aiLevelInitiate,
    i18n.site.aiLevelElementary,
    i18n.site.aiLevelIntermediate,
    i18n.site.aiLevelAdvanced,
    i18n.site.aiLevelElite,
    i18n.site.aiLevelMaster,
    i18n.site.aiLevelGrandmaster,
  ][level - 1] || level.toString();

const percent = (wins: number, games: number) => `${games ? Math.round((wins * 1000) / games) / 10 : 0}%`;

export const levelButtons = (ctrl: SetupController) => {
  const level = ctrl.aiLevel();
  const stats = ctrl.aiStats?.levels.find(item => item.level === level)?.registered;
  const passRate = stats ? percent(stats.wins, stats.games) : ctrl.aiStatsLoading ? '…' : '—';
  const progress = (level - levels[0]) / (maxLevel - levels[0]);
  const thumbLeft = `calc(${progress * 100}% + ${(0.5 - progress) * sliderThumbSize}rem)`;

  if (site.blindMode)
    return h('div.config-group.ai-settings', [
      h('div.ai-level-summary', [
        h('strong', aiLevelName(level)),
        h('span', `${i18n.site.passRate}: ${passRate}`),
      ]),
      h('label', { attrs: { for: 'sf_level' } }, i18n.site.difficulty),
      h(
        'select#sf_level',
        {
          on: { change: (e: Event) => ctrl.aiLevel(parseInt((e.target as HTMLSelectElement).value)) },
        },
        levels.map(value => option({ key: value.toString(), name: aiLevelName(value) }, level.toString())),
      ),
      aiSide(ctrl),
    ]);

  return h('section.ai-settings', [
    h('div.ai-level-summary', [
      h('div.ai-level-summary__name', [h('strong', aiLevelName(level)), h('span', i18n.site.aiDifficulty)]),
      h('div.ai-level-summary__rate', [h('strong', passRate), h('span', i18n.site.passRate)]),
    ]),
    h('div.ai-difficulty', [
      h('label', { attrs: { for: 'sf_level' } }, i18n.site.difficulty),
      h('div.ai-difficulty__control', [
        h('div.ai-difficulty__track', { attrs: { 'aria-hidden': 'true' } }, [
          h('span', { attrs: { style: `width:${progress * 100}%` } }),
        ]),
        h('input#sf_level.ai-difficulty__range', {
          attrs: {
            type: 'range',
            min: levels[0],
            max: maxLevel,
            step: 1,
            'aria-valuetext': aiLevelName(level),
          },
          props: { value: level },
          on: { input: (e: Event) => ctrl.aiLevel(parseInt((e.target as HTMLInputElement).value)) },
        }),
        h(
          'output.ai-difficulty__value',
          { attrs: { for: 'sf_level', style: `left:${thumbLeft}` } },
          level.toString(),
        ),
      ]),
    ]),
    aiSide(ctrl),
  ]);
};
