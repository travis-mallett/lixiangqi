import { positionFromFen, positionToFen, recordedPosition, standardXiangqi } from '@lixiangqi/board';

import type { RulesState } from 'lib/game/xiangqiNotation';
import { createMoveTreeFromStates } from 'lib/tree/native';

/** Display/tree fixtures provide explicit position snapshots; legality belongs to the native rules tests. */
export function fixtureTree(initialFen: string, moves: string[], notations = moves) {
  let position = positionFromFen(initialFen, standardXiangqi);
  const initialPly = (Number(initialFen.split(' ')[5]) - 1) * 2 + Number(position.active === 'black');
  const snapshot = (ply: number): RulesState => ({
    fen:
      positionToFen(position, standardXiangqi).split(' ').slice(0, 2).join(' ') +
      ` - - ${ply - initialPly} ${Math.floor(ply / 2) + 1}`,
    ply,
    turn: position.active as 'red' | 'black',
    check: false,
    legalMoves: [],
    gameResult: '*',
  });
  const states = [{ ...snapshot(initialPly), fen: initialFen }];
  moves.forEach((move, index) => {
    const count = position.pieces.size;
    position = recordedPosition(position, move, position.active === 'red' ? 'black' : 'red');
    states.push({ ...snapshot(initialPly + index + 1), capture: position.pieces.size < count });
  });
  return createMoveTreeFromStates(states, moves, notations, [], [], 0, 'unrestricted-v1');
}
