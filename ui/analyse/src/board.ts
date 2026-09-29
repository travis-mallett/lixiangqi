import { type BoardView, type BoardInteraction, moveDestinations } from '@lixiangqi/board';
import { h, type VNode } from 'snabbdom';

import { createXiangqiBoard, xiangqiPosition, websiteBoardPresentation, makeBoardResizable } from 'lib/board';
import { xiangqiPremoveTargets } from 'lib/game/xiangqiPremove';
import * as Prefs from 'lib/prefs';

import type AnalyseCtrl from './ctrl';
import { storedStudyMarks } from './study/boardMarks';

export function presentation(ctrl: AnalyseCtrl) {
  return {
    ...websiteBoardPresentation(
      ctrl.data.pref,
      'interactive',
      ctrl.bottomColor() === 'white' ? 'red' : 'black',
    ),
    coordinates: ctrl.data.pref.coords !== Prefs.Coords.Hidden,
    ...(site.blindMode ? { motion: { duration: 0 }, drawing: false } : {}),
  };
}

export function interaction(ctrl: AnalyseCtrl): BoardInteraction {
  const gamebook = ctrl.gamebookPlay();
  const color = gamebook ? gamebook.movableColor() : ctrl.practice ? ctrl.bottomColor() : ctrl.turnColor();
  if (!color || !ctrl.node.xiangqiLegalMoves?.length) return { mode: 'display' };
  return {
    mode: 'play',
    participant: color === 'white' ? 'red' : 'black',
    destinations: moveDestinations(ctrl.node.xiangqiLegalMoves),
    input:
      ctrl.data.pref.moveEvent === Prefs.MoveEvent.Drag
        ? 'drag'
        : ctrl.data.pref.moveEvent === Prefs.MoveEvent.Click
          ? 'click'
          : 'both',
    showDestinations: ctrl.data.pref.destination ?? true,
    onMove: move => ctrl.userMove(move.from, move.to),
    premove: {
      destinations: xiangqiPremoveTargets,
      onChange: move => {
        if (move) ctrl.onPremoveSet();
      },
    },
  };
}

export function createStudyBoard(element: HTMLElement, ctrl: AnalyseCtrl): BoardView {
  const board = createXiangqiBoard(
    element,
    xiangqiPosition(ctrl.node.fen, ctrl.node.uci?.replaceAll(':', '10'), ctrl.node.check()),
    presentation(ctrl),
    interaction(ctrl),
  );
  makeBoardResizable(board, Prefs.ShowResizeHandle.Always, ctrl.node.ply);
  board.onMarksChange(marks => ctrl.study?.onBoardMarksChange(storedStudyMarks(marks)));
  return board;
}

export const render = (ctrl: AnalyseCtrl): VNode =>
  h(`div.cg-wrap.xiangqi9x10.cgv${ctrl.cgVersion.js}`, {
    hook: {
      insert: vnode => {
        const board = createStudyBoard(vnode.elm as HTMLElement, ctrl);
        vnode.data!.board = board;
        ctrl.setBoard(board);
      },
      postpatch: (old, vnode) => {
        vnode.data!.board = old.data!.board;
      },
      destroy: vnode => (vnode.data!.board as BoardView | undefined)?.destroy(),
    },
  });
