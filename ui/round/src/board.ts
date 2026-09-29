import { type BoardView, type BoardInteraction, type BoardTransition } from '@lixiangqi/board';
import { h, type VNode } from 'snabbdom';

import { createXiangqiBoard, xiangqiPosition, websiteBoardPresentation, makeBoardResizable } from 'lib/board';
import { plyColor } from 'lib/game';
import { xiangqiPremoveTargets } from 'lib/game/xiangqiPremove';
import { ShowResizeHandle, Coords, MoveEvent } from 'lib/prefs';

import type RoundController from './ctrl';
import type { RoundData, Step } from './interfaces';
import * as util from './util';

const participant = (color: Color): string => (color === 'white' ? 'red' : 'black');

export function interaction(ctrl: RoundController, playing: boolean = ctrl.isPlaying()): BoardInteraction {
  const { data } = ctrl;
  return playing && !ctrl.replaying()
    ? {
        mode: 'play',
        participant: participant(data.player.color),
        destinations: util.parsePossibleMoves(data.possibleMoves),
        input:
          data.pref.moveEvent === MoveEvent.Click
            ? 'click'
            : data.pref.moveEvent === MoveEvent.Drag
              ? 'drag'
              : 'both',
        showDestinations: data.pref.destination && !ctrl.blindfold(),
        onMove: ctrl.onBoardMove,
        premove: data.pref.enablePremove ? { destinations: xiangqiPremoveTargets } : undefined,
      }
    : { mode: 'display' };
}

function presentation(ctrl: RoundController) {
  return {
    ...websiteBoardPresentation(
      ctrl.data.pref,
      'interactive',
      participant(boardOrientation(ctrl.data, ctrl.flip)),
    ),
    coordinates: ctrl.data.pref.coords !== Coords.Hidden,
  };
}

export function createRoundBoard(element: HTMLElement, ctrl: RoundController): BoardView {
  const step = util.plyStep(ctrl.data, ctrl.ply);
  const board = createXiangqiBoard(
    element,
    xiangqiPosition(step.fen, step.uci, !!step.check),
    presentation(ctrl),
    interaction(ctrl),
  );
  const firstPly = util.firstPly(ctrl.data);
  const showUntil = firstPly + 2 + Number(plyColor(firstPly) !== ctrl.data.player.color);
  makeBoardResizable(
    board,
    ctrl.isPlaying() ? ctrl.data.pref.resizeHandle : ShowResizeHandle.Always,
    ctrl.ply,
    ply => ply <= showUntil,
  );
  return board;
}

export function reload(ctrl: RoundController): void {
  ctrl.board.setPresentation(presentation(ctrl));
  sync(ctrl, util.plyStep(ctrl.data, ctrl.ply), ctrl.isPlaying(), { kind: 'correction' });
}

export function sync(
  ctrl: RoundController,
  step: Step,
  playing: boolean,
  transition: BoardTransition = { kind: 'confirmation' },
): void {
  ctrl.board.display(xiangqiPosition(step.fen, step.uci, !!step.check), transition);
  ctrl.board.setInteraction(interaction(ctrl, playing));
}

export const boardOrientation = (data: RoundData, flip: boolean): Color =>
  flip ? data.opponent.color : data.player.color;

export const render = (ctrl: RoundController): VNode =>
  h('div.cg-wrap.xiangqi9x10', {
    hook: {
      insert: vnode => {
        const board = createRoundBoard(vnode.elm as HTMLElement, ctrl);
        vnode.data!.board = board;
        ctrl.setBoard(board);
      },
      postpatch: (old, vnode) => {
        vnode.data!.board = old.data!.board;
      },
      destroy: vnode => (vnode.data!.board as BoardView).destroy(),
    },
  });
