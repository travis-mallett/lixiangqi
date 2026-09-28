import { pubsub } from 'lib/pubsub';
import { snabDialog } from 'lib/view';

import * as control from './control';
import type PuzzleCtrl from './ctrl';

export default (ctrl: PuzzleCtrl) =>
  site.mousetrap
    .bind(['left', 'k'], () => {
      control.prev(ctrl);
      ctrl.redraw();
    })
    .bind(['right', 'j'], () => {
      control.next(ctrl);
      ctrl.redraw();
    })
    .bind(['up', '0', 'home'], () => {
      control.first(ctrl);
      ctrl.redraw();
    })
    .bind(['down', '$', 'end'], () => {
      control.last(ctrl);
      ctrl.redraw();
    })
    .bind('z', () => pubsub.emit('zen'))
    .bind('?', () => ctrl.keyboardHelp(!ctrl.keyboardHelp()))
    .bind('f', ctrl.flip)
    .bind('n', ctrl.nextPuzzle)
    .bind('h', ctrl.menu.toggle)
    .bind('G', ctrl.googlyEyesStart);

export const view = (ctrl: PuzzleCtrl) =>
  snabDialog({
    class: 'help',
    htmlUrl: '/training/help',
    onClose: () => ctrl.keyboardHelp(false),
    modal: true,
    easyClose: 'clickOutside',
  });
