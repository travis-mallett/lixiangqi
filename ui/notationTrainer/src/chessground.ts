import type { Api } from 'chessgroundx/api';
import { h, type VNode } from 'snabbdom';
import { makeXiangqiGround, XIANGQI_START_FEN } from 'xiangqi';

import { onInsert } from 'lib/view';

import type NotationTrainerCtrl from './ctrl';

export default function notationBoard(ctrl: NotationTrainerCtrl): VNode {
  return h('div.cg-wrap.xiangqi9x10', {
    attrs: {
      role: 'application',
      'aria-label': i18n.notation.notationBoard,
    },
    hook: {
      ...onInsert(element => {
        const ground: Api = makeXiangqiGround(element, {
          fen: ctrl.exercise?.fen ?? XIANGQI_START_FEN,
          orientation: ctrl.orientation(),
          turnColor: ctrl.orientation(),
          movableColor: undefined,
          legalMoves: [],
          coordinates: ctrl.showBoardCoordinates(),
          onMove: ctrl.onMove,
        });
        ctrl.ground = ground;
        ctrl.setGroundPosition(ctrl.playing);
      }),
      destroy: () => {
        ctrl.ground?.destroy();
        ctrl.ground = undefined;
      },
    },
  });
}
