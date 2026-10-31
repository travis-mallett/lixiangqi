import { toggle, type Toggle } from 'lib';
import { displayColumns, isTouchDevice } from 'lib/device';
import { storage } from 'lib/storage';
import {
  hl,
  type LooseVNode,
  type LooseVNodes,
  type BoardMenu,
  boardMenu as menuDropdown,
  boolPrefXhrToggle,
} from 'lib/view';
import { cmnToggleWrap } from 'lib/view/cmn-toggle';

import type RoundController from '../ctrl';

export default function (ctrl: RoundController): LooseVNode {
  return roomBoardMenu(ctrl.redraw, ctrl.menu, ctrl.flip, ctrl.flipNow, menu => {
    const d = ctrl.data,
      spectator = d.player.spectator,
      portraitMobile = displayColumns() === 1 && isTouchDevice(),
      swapClockStorage = storage.boolean('swapClock');
    return [
      menu.blindfold(
        toggle(ctrl.blindfold(), v => ctrl.blindfold(v)),
        !spectator,
      ),
      'vibrate' in navigator &&
        cmnToggleWrap({
          id: 'haptics',
          name: 'Vibration feedback',
          checked: ctrl.vibration(),
          change: v => ctrl.vibration(v),
          redraw: ctrl.redraw,
        }),
      portraitMobile &&
        cmnToggleWrap({
          id: 'swapClock',
          name: 'Show clock on left',
          checked: swapClockStorage.get(),
          change: v => swapClockStorage.set(v),
          redraw: ctrl.redraw,
        }),

      menu.voiceInput(boolPrefXhrToggle('voice', !!ctrl.voiceMove), !spectator),
      !portraitMobile &&
        menu.keyboardInput(boolPrefXhrToggle('keyboardMove', !!ctrl.keyboardMove), !spectator),
      !spectator && (d.pref.submitMove || ctrl.voiceMove)
        ? menu.confirmMove(ctrl.confirmMoveToggle)
        : undefined,
    ];
  });
}

/** Common room settings; variant adapters supply only supported input controls. */
export function roomBoardMenu(
  redraw: Redraw,
  opened: Toggle,
  flipped: boolean,
  flip: () => void,
  controls: (menu: BoardMenu) => LooseVNodes = () => [],
): LooseVNode {
  return menuDropdown(redraw, opened, menu => [
    hl('section', [
      menu.flip(i18n.site.flipBoard, flipped, () => {
        flip();
        opened(false);
      }),
    ]),
    hl('section', [menu.zenMode(true), controls(menu)]),
    hl('section.board-menu__links', [
      hl(
        'a',
        { attrs: { target: '_blank', href: '/account/preferences/display' } },
        i18n.preferences.display,
      ),
      hl(
        'a',
        { attrs: { target: '_blank', href: '/account/preferences/game-behavior' } },
        i18n.preferences.gameBehavior,
      ),
    ]),
  ]);
}
