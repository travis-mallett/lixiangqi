import { h } from 'snabbdom';

import { aiCustomLevel, aiCustomLevelIndex, aiCustomLevels } from 'lib/game';
import { option } from 'lib/setup/option';

import type SetupController from '@/setupCtrl';

import { aiSide } from './aiSide';

const sliderThumbSize = 2.5;

const percent = (wins: number, games: number) => `${games ? Math.round((wins * 1000) / games) / 10 : 0}%`;

export const levelButtons = (ctrl: SetupController) => {
  const variantLevels = ctrl.usesVariantLevels();
  const levels = variantLevels
    ? Array.from({ length: ctrl.variantLevelCount() }, (_, i) => i + 1)
    : aiCustomLevels;
  const maxLevel = levels.length - 1;
  const label = (index: number) => String(index + (variantLevels ? 1 : 0));
  const choose = (index: number) => (variantLevels ? index + 1 : aiCustomLevel(index));
  const level = ctrl.aiLevel();
  const selection = variantLevels ? Math.max(0, Math.min(maxLevel, level - 1)) : aiCustomLevelIndex(level);
  const stats = ctrl.aiStats?.levels.find(item => item.level === level)?.registered;
  const passRate = stats ? percent(stats.wins, stats.games) : ctrl.aiStatsLoading ? '…' : '—';
  const progress = selection / maxLevel;
  const thumbLeft = `calc(${progress * 100}% + ${(0.5 - progress) * sliderThumbSize}rem)`;

  if (site.blindMode)
    return h('div.config-group.ai-settings', [
      h('div.ai-level-summary', [
        h('strong', label(selection)),
        variantLevels ? undefined : h('span', `${i18n.site.passRate}: ${passRate}`),
      ]),
      h('label', { attrs: { for: 'sf_level' } }, i18n.site.difficulty),
      h(
        'select#sf_level',
        {
          on: {
            change: (e: Event) => ctrl.aiLevel(choose(parseInt((e.target as HTMLSelectElement).value))),
          },
        },
        levels.map((_, index) => option({ key: index.toString(), name: label(index) }, selection.toString())),
      ),
      aiSide(ctrl),
    ]);

  return h('section.ai-settings', [
    h('div.ai-level-summary', [
      h('div.ai-level-summary__name', [h('strong', label(selection)), h('span', i18n.site.aiDifficulty)]),
      variantLevels
        ? undefined
        : h('div.ai-level-summary__rate', [h('strong', passRate), h('span', i18n.site.passRate)]),
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
            'aria-valuetext': label(selection),
          },
          props: { value: selection },
          on: {
            input: (e: Event) => ctrl.aiLevel(choose(parseInt((e.target as HTMLInputElement).value))),
          },
        }),
        h(
          'output.ai-difficulty__value',
          { attrs: { for: 'sf_level', style: `left:${thumbLeft}` } },
          label(selection),
        ),
      ]),
    ]),
    aiSide(ctrl),
  ]);
};
