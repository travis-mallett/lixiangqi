import { h } from 'snabbdom';

import { aiCustomLevel, aiCustomLevelIndex, aiCustomLevels } from 'lib/game';
import { option } from 'lib/setup/option';

import type SetupController from '@/setupCtrl';

import { aiSide } from './aiSide';

const maxLevel = aiCustomLevels.length - 1;
const sliderThumbSize = 2.5;

const percent = (wins: number, games: number) => `${games ? Math.round((wins * 1000) / games) / 10 : 0}%`;

export const levelButtons = (ctrl: SetupController) => {
  const level = ctrl.aiLevel();
  const selection = aiCustomLevelIndex(level);
  const stats = ctrl.aiStats?.levels.find(item => item.level === level)?.registered;
  const passRate = stats ? percent(stats.wins, stats.games) : ctrl.aiStatsLoading ? '…' : '—';
  const progress = selection / maxLevel;
  const thumbLeft = `calc(${progress * 100}% + ${(0.5 - progress) * sliderThumbSize}rem)`;

  if (site.blindMode)
    return h('div.config-group.ai-settings', [
      h('div.ai-level-summary', [
        h('strong', selection.toString()),
        h('span', `${i18n.site.passRate}: ${passRate}`),
      ]),
      h('label', { attrs: { for: 'sf_level' } }, i18n.site.difficulty),
      h(
        'select#sf_level',
        {
          on: {
            change: (e: Event) =>
              ctrl.aiLevel(aiCustomLevel(parseInt((e.target as HTMLSelectElement).value))),
          },
        },
        aiCustomLevels.map((_, index) =>
          option({ key: index.toString(), name: index.toString() }, selection.toString()),
        ),
      ),
      aiSide(ctrl),
    ]);

  return h('section.ai-settings', [
    h('div.ai-level-summary', [
      h('div.ai-level-summary__name', [h('strong', selection.toString()), h('span', i18n.site.aiDifficulty)]),
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
            min: 0,
            max: maxLevel,
            step: 1,
            'aria-valuetext': selection.toString(),
          },
          props: { value: selection },
          on: {
            input: (e: Event) => ctrl.aiLevel(aiCustomLevel(parseInt((e.target as HTMLInputElement).value))),
          },
        }),
        h(
          'output.ai-difficulty__value',
          { attrs: { for: 'sf_level', style: `left:${thumbLeft}` } },
          selection.toString(),
        ),
      ]),
    ]),
    aiSide(ctrl),
  ]);
};
