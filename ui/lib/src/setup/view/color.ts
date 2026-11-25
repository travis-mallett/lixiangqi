import { hl, type VNode } from '@/view';

import { colors, type ColorChoice, type ColorProp } from '../color';
import { option } from '../option';

export const blindModeColorPicker = (colorProp: ColorProp, choices: typeof colors = colors): VNode[] => [
  hl('label', { attrs: { for: 'sf_color' } }, i18n.site.side),
  hl(
    'select#sf_color',
    {
      on: {
        change: (e: Event) => colorProp((e.target as HTMLSelectElement).value as ColorChoice),
      },
    },
    choices.map(color => option(color, colorProp())),
  ),
];

export const colorButtons = (colorProp: ColorProp, choices: typeof colors = colors): VNode =>
  hl('div.config-group', [
    hl('div.label', i18n.site.side),
    hl(
      'group.radio.color-picker.color-cards',
      choices.map(({ key, name }) =>
        hl('div', [
          hl(`input#color-picker-${key}`, {
            attrs: { name: 'color', type: 'radio', value: key, checked: colorProp() === key },
            on: { change: () => colorProp(key) },
          }),
          hl(`label.card-radio`, { attrs: { for: `color-picker-${key}` } }, [
            hl('div.color-picker__button', { class: { [key]: true } }, hl('icon')),
            hl('span.text', name),
          ]),
        ]),
      ),
    ),
  ]);
