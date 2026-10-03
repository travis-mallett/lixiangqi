import type { BoardView, BoardEffect } from '@lixiangqi/board';

import { isXiangqiCapture } from 'lib/game';
import { isXiangqiMate } from 'lib/game/adjudication';
import { nodeAtPath, parentPath, type RulesState, type XiangqiMoveTree } from 'lib/tree/native';

export interface XiangqiMoveSound {
  capture: boolean;
  check: boolean;
  mate: boolean;
}

export function xiangqiMoveSound(state?: RulesState): XiangqiMoveSound {
  return {
    capture: state?.capture === true,
    check: state?.check === true,
    mate: state?.termination
      ? isXiangqiMate(undefined, state.termination)
      : state?.checkmate === true ||
        (state?.immediateEnd?.ended === true &&
          state.legalMoves.length === 0 &&
          ['1-0', '0-1'].includes(state.gameResult)),
  };
}

export function xiangqiTransitionSound(
  tree: XiangqiMoveTree,
  fromPath: string,
  toPath: string,
): XiangqiMoveSound | undefined {
  if (parentPath(toPath) !== fromPath || !tree.pathExists(fromPath)) return undefined;
  const origin = nodeAtPath(tree, fromPath);
  const destination = nodeAtPath(tree, toPath);
  if (!origin || !destination || destination === tree.root) return undefined;
  return xiangqiMoveSound({
    ...destination.state,
    capture: destination.state.capture ?? isXiangqiCapture(origin.state.fen, destination.state.fen),
  });
}

export function playXiangqiMoveSound(board: BoardView, state: RulesState): void {
  board.presentTransition({ kind: 'forward', effects: moveEffects(xiangqiMoveSound(state)) });
}

export function playXiangqiTransitionSound(
  board: BoardView,
  tree: XiangqiMoveTree,
  fromPath: string,
  toPath: string,
): void {
  const sound = xiangqiTransitionSound(tree, fromPath, toPath);
  if (sound) board.presentTransition({ kind: 'forward', effects: moveEffects(sound) });
}

function moveEffects(sound: XiangqiMoveSound): BoardEffect[] {
  const effects: BoardEffect[] = [];
  if (sound.capture) effects.push('capture');
  if (sound.check) effects.push('check');
  if (sound.mate) effects.push('checkmate');
  return effects;
}
