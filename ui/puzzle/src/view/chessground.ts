import { h, type VNode } from 'snabbdom';
import { makeXiangqiGround } from 'xiangqi';

import { onInsert } from 'lib/view';

import type PuzzleCtrl from '../ctrl';

export default function (ctrl: PuzzleCtrl): VNode {
  const xiangqiOpts = ctrl.makeXiangqiGroundOpts();
  return h(`div.cg-wrap.cgv${ctrl.cgVersion}.xiangqi9x10`, {
    attrs: {
      'data-legal-move-count': `${xiangqiOpts.legalMoves?.length ?? 0}`,
      'data-movable-color': xiangqiOpts.movableColor ?? '',
    },
    hook: {
      ...onInsert(el =>
        ctrl.setChessground(
          makeXiangqiGround(el, {
            ...xiangqiOpts,
            onMove: ctrl.userXiangqiMove,
          }),
        ),
      ),
      destroy: () => {
        // ctrl.disableGooglyEyes();
        ctrl.ground().destroy();
      },
    },
  });
}
