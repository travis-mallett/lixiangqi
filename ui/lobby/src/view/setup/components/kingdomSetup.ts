import type { Prop } from 'lib';
import { hl, onInsert } from 'lib/view';
import { userComplete } from 'lib/view/userComplete';

import type SetupController from '@/setupCtrl';

const choice = (id: string, label: string, values: readonly number[], value: Prop<number>) =>
  hl('div.label-select', [
    hl('label', { attrs: { for: id } }, label),
    hl(
      `select#${id}`,
      {
        on: { change: (event: Event) => value(Number((event.target as HTMLSelectElement).value)) },
      },
      values.map(n => hl('option', { attrs: { value: n }, props: { selected: value() === n } }, String(n))),
    ),
  ]);

export const kingdomClock = (ctrl: SetupController) =>
  hl('div.config-group', [
    choice('sf_kingdom_time', i18n.site.minutesPerSide, [7, 10, 15], ctrl.kingdomTime),
    choice('sf_kingdom_deadline', i18n.threeKingdoms.moveTime, [15, 30, 60], ctrl.kingdomMoveTime),
  ]);

export const kingdomSide = (ctrl: SetupController) =>
  hl('div.label-select', [
    hl('label', { attrs: { for: 'sf_kingdom' } }, i18n.threeKingdoms.yourKingdom),
    hl(
      'select#sf_kingdom',
      {
        on: {
          change: (event: Event) =>
            ctrl.kingdom((event.target as HTMLSelectElement).value as ReturnType<typeof ctrl.kingdom>),
        },
      },
      (['red', 'green', 'black', 'random'] as const).map(color =>
        hl(
          'option',
          {
            attrs: { value: color },
            props: { selected: ctrl.kingdom() === color },
          },
          color === 'random' ? i18n.site.random : i18n.threeKingdoms[color],
        ),
      ),
    ),
  ]);

export const kingdomOpponents = (ctrl: SetupController) =>
  hl('div.config-group', [
    ...(['friendUser', 'friendUserTwo'] as const).map((key, i) =>
      hl('div.label-select', [
        hl(
          'label',
          { attrs: { for: `sf_${key}` } },
          i === 0 ? i18n.threeKingdoms.opponentOne : i18n.threeKingdoms.opponentTwo,
        ),
        hl('div.complete-parent', [
          hl(`input#sf_${key}`, {
            attrs: { type: 'text', required: true, maxlength: 30, autocomplete: 'off', spellcheck: 'false' },
            props: { value: ctrl[key] },
            hook: onInsert<HTMLInputElement>(input =>
              userComplete({
                input,
                tag: 'span',
                friend: true,
                onSelect: user => {
                  ctrl[key] = user.name;
                  ctrl.root.redraw();
                },
              }),
            ),
            on: {
              input: (event: Event) => {
                ctrl[key] = (event.target as HTMLInputElement).value;
                ctrl.root.redraw();
              },
            },
          }),
        ]),
      ]),
    ),
    !ctrl.root.me &&
      hl(
        'a',
        { attrs: { href: '/login?referrer=' + encodeURIComponent('/?variant=threeKingdoms#friend') } },
        i18n.threeKingdoms.login,
      ),
  ]);
