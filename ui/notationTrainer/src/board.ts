import { boardPresentation, type BoardView } from '@lixiangqi/board';
import { h, type VNode } from 'snabbdom';
import { XIANGQI_START_FEN } from 'xiangqi';

import { makeBoardResizable, createXiangqiBoard, xiangqiPosition } from 'lib/board';

import type NotationTrainerCtrl from './ctrl';

export default function notationBoard(ctrl: NotationTrainerCtrl): VNode {
  return h('div.cg-wrap.xiangqi9x10', {
    attrs: {
      role: 'application',
      'aria-label': i18n.notation.notationBoard,
    },
    hook: {
      insert: vnode => {
        const element = vnode.elm as HTMLElement;
        const ground = createXiangqiBoard(element, xiangqiPosition(ctrl.exercise?.fen ?? XIANGQI_START_FEN), {
          ...boardPresentation('interactive', ctrl.orientation() === 'white' ? 'red' : 'black'),
          coordinates: ctrl.showBoardCoordinates(),
        });
        makeBoardResizable(ground);
        vnode.data!.board = ground;
        ctrl.ground = ground;
        ctrl.setGroundPosition(ctrl.playing);
      },
      postpatch: (old, vnode) => {
        vnode.data!.board = old.data!.board;
      },
      destroy: vnode => {
        const board = vnode.data!.board as BoardView;
        board.destroy();
        if (ctrl.ground === board) ctrl.ground = undefined;
      },
    },
  });
}
