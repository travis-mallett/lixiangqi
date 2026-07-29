import type { Api } from 'chessgroundx/api';

import {
  XIANGQI_DIMENSIONS,
  XIANGQI_START_FEN,
  xiangqiCgToUci,
  xiangqiLegalMoveDests,
  xiangqiUciMoveToCg,
  xiangqiUciToCg,
} from 'lib/game';

export {
  XIANGQI_DIMENSIONS,
  XIANGQI_START_FEN,
  xiangqiCgToUci as cgToUci,
  xiangqiLegalMoveDests as legalMoveDests,
  xiangqiUciMoveToCg as uciMoveToCg,
  xiangqiUciToCg as uciToCg,
};

/**
 * Prevent another move while an optimistically played move is being validated.
 * Deliberately do not set a FEN here: Chessground has already moved the piece,
 * and restoring the last authoritative FEN would animate it back to its origin.
 */
export function setXiangqiGroundPending(ground: Pick<Api, 'set'>): void {
  ground.set({ movable: { color: undefined, dests: new Map() } });
}
