import type { VNode } from 'snabbdom';

import { snabDialog } from 'lib/view';

import type RoundController from './ctrl';
import { bindReplayKeyboard } from './view/navigation';

export const prev = (ctrl: RoundController): void => ctrl.userJump(ctrl.ply - 1);

export const next = (ctrl: RoundController): void => ctrl.userJump(ctrl.ply + 1);

export const init = (ctrl: RoundController): LichessMousetrap => {
  bindReplayKeyboard({
    previous: () => {
      prev(ctrl);
      ctrl.redraw();
    },
    next: () => {
      next(ctrl);
      ctrl.redraw();
    },
    first: () => {
      ctrl.userJump(0);
      ctrl.redraw();
    },
    last: () => {
      ctrl.userJump(ctrl.data.steps.length - 1);
      ctrl.redraw();
    },
    flip: ctrl.flipNow,
  });
  return site.mousetrap
    .bind('F', ctrl.yeet)
    .bind('G', ctrl.googlyEyesStart)
    .bind('?', () => {
      ctrl.keyboardHelp = !ctrl.keyboardHelp;
      ctrl.redraw();
    })
    .bind('h', ctrl.menu.toggle);
};

export const view = (ctrl: RoundController): VNode =>
  snabDialog({
    class: 'help',
    htmlUrl: '/round/help',
    onClose() {
      ctrl.keyboardHelp = false;
      ctrl.redraw();
    },
    modal: true,
    easyClose: 'clickOutside',
  });
