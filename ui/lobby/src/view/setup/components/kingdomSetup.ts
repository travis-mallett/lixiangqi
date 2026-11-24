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
  hl('div.label-select.kingdom-side', [
    hl(
      'label',
      { attrs: { for: 'sf_kingdom' } },
      ctrl.gameType === 'friend' ? i18n.site.side : i18n.threeKingdoms.yourKingdom,
    ),
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

export const friendOpponent = (ctrl: SetupController, key: 'friendUser' | 'friendUserTwo', label: string) =>
  hl('div.label-select', [
    hl('label', { attrs: { for: `sf_${key}` } }, label),
    hl('div.complete-parent', [
      hl(`input#sf_${key}`, {
        attrs: {
          type: 'text',
          required: ctrl.isThreeKingdoms(),
          maxlength: 30,
          autocomplete: 'off',
          spellcheck: 'false',
        },
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
  ]);

export const kingdomOpponents = (ctrl: SetupController) =>
  hl('div.config-group', [
    ...(ctrl.gameType === 'hook'
      ? []
      : ctrl.kingdomFriendBot()
        ? (['friendUser'] as const)
        : (['friendUser', 'friendUserTwo'] as const)
    ).map((key, i) =>
      friendOpponent(ctrl, key, i === 0 ? i18n.threeKingdoms.opponentOne : i18n.threeKingdoms.opponentTwo),
    ),
    !ctrl.selectedRatedPool() &&
      hl('label.kingdom-bot-toggle', [
        hl('input', {
          attrs: { type: 'checkbox' },
          props: { checked: ctrl.kingdomFriendBot() },
          on: { change: (event: Event) => ctrl.kingdomFriendBot((event.target as HTMLInputElement).checked) },
        }),
        i18n.threeKingdoms.secondOpponentBot,
      ]),
    ctrl.kingdomFriendBot() &&
      choice(
        'sf_kingdom_bot_level',
        i18n.site.aiDifficulty,
        Array.from({ length: ctrl.variantLevelCount() }, (_, index) => index + 1),
        ctrl.aiLevel,
      ),
    !ctrl.root.me &&
      hl(
        'a',
        { attrs: { href: '/login?referrer=' + encodeURIComponent('/?variant=threeKingdoms#friend') } },
        i18n.threeKingdoms.login,
      ),
  ]);
