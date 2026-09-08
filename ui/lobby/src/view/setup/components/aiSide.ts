import { h } from 'snabbdom';

import type SetupController from '@/setupCtrl';

export const aiSide = ({ color }: SetupController) =>
  h('div.ai-side', { attrs: { role: 'radiogroup', 'aria-labelledby': 'ai-side-label' } }, [
    h('span#ai-side-label.ai-side__label', i18n.site.side),
    h('div.ai-side__controls', [
      h('div.ai-side__toggle', [
        h('input#ai-color-white', {
          attrs: { name: 'color', type: 'radio', value: 'white' },
          props: { checked: color() === 'white' },
          on: { change: () => color('white') },
        }),
        h('label', { attrs: { for: 'ai-color-white', 'data-side': 'white' } }, i18n.site.white),
        h('input#ai-color-black', {
          attrs: { name: 'color', type: 'radio', value: 'black' },
          props: { checked: color() === 'black' },
          on: { change: () => color('black') },
        }),
        h('label', { attrs: { for: 'ai-color-black', 'data-side': 'black' } }, i18n.site.black),
      ]),
      h('div.ai-side__random', [
        h('input#ai-color-random', {
          attrs: { name: 'color', type: 'radio', value: 'random' },
          props: { checked: color() === 'random' },
          on: { change: () => color('random') },
        }),
        h('label', { attrs: { for: 'ai-color-random' } }, i18n.site.random),
      ]),
    ]),
  ]);
