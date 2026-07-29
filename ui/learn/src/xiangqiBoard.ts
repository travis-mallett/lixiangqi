import type { Api } from 'chessgroundx/api';
import { h, type VNode } from 'snabbdom';
import { makeXiangqiGround } from 'xiangqi';

import { onInsert } from 'lib/view';

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
        ...onInsert(element => {
          const ground: Api = makeXiangqiGround(element, {
            fen: ctrl.fen,
            orientation: level.color === 'red' ? 'white' : 'black',
            turnColor: level.color === 'red' ? 'white' : 'black',
            movableColor: level.reading ? undefined : level.color === 'red' ? 'white' : 'black',
            legalMoves: ctrl.legalMoves(),
            coordinates: true,
            viewOnly: level.reading,
            onMove: ctrl.onMove,
          });
          ctrl.setGround(ground);
        }),
        destroy: () => ctrl.destroyGround(),
      },
    }),
  ]);
}
