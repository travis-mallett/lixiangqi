import type { BoardView } from '@lixiangqi/board';
import { h, type VNode } from 'snabbdom';

import { createXiangqiBoard } from 'lib/board';

import type PuzzleCtrl from '../ctrl';

export default function (ctrl: PuzzleCtrl): VNode {
  const setup = ctrl.boardSetup();
  return h(`div.cg-wrap.cgv${ctrl.cgVersion}.xiangqi9x10`, {
    attrs: {
      'data-legal-move-count': `${setup.legalMoves.length}`,
      'data-movable-color': setup.canMove ? setup.position.active : '',
    },
    hook: {
      insert: vnode => {
        const board = createXiangqiBoard(vnode.elm as HTMLElement, setup.position, setup.presentation);
        vnode.data!.board = board;
        ctrl.setBoard(board);
      },
      postpatch: (old, vnode) => {
        vnode.data!.board = old.data!.board;
      },
      destroy: vnode => (vnode.data!.board as BoardView).destroy(),
    },
  });
}
