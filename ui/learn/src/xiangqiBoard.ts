import { boardPresentation, type BoardView } from '@lixiangqi/board';
import { h, type VNode } from 'snabbdom';

import { makeBoardResizable, createXiangqiBoard, xiangqiPosition } from 'lib/board';

import type { RunCtrl } from './run/runCtrl';

export default function xiangqiBoard(ctrl: RunCtrl): VNode {
  const level = ctrl.level;
  return h('section.learn-xiangqi-board.main-board.xiangqi9x10', { key: `${ctrl.stage.id}-${level.id}` }, [
    h('div.cg-wrap.xiangqi9x10', {
      attrs: {
        role: 'application',
        'aria-label': `${level.title}. ${level.goal}`,
      },
      hook: {
        insert: vnode => {
          const element = vnode.elm as HTMLElement;
          const ground = createXiangqiBoard(
            element,
            xiangqiPosition(ctrl.fen),
            boardPresentation('interactive', level.color),
          );
          makeBoardResizable(ground);
          vnode.data!.board = ground;
          ctrl.setGround(ground);
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
    }),
  ]);
}
