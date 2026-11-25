import {
  coordinateMove,
  banqi,
  miniXiangqi,
  manchu,
  positionFromFen,
  positionToFen,
  recordedPosition,
  standardXiangqi,
} from '@lixiangqi/board';

import type { RulesState } from './xiangqiNotation';

/** Verify visible recorded identity, using server-provided legality rather than a second rules engine. */
export function assertRecordedMovePosition(before: RulesState, move: string, after: RulesState): void {
  const invalid = () => new Error('Invalid recorded move position for notation export');
  const variant = before.variant ?? 'xiangqi';
  if (
    !['xiangqi', 'banqi', 'jieqi', 'minixiangqi', 'manchu'].includes(variant) ||
    variant !== (after.variant ?? 'xiangqi') ||
    !before.legalMoves.includes(move) ||
    after.ply !== before.ply + 1 ||
    after.turn !== (before.turn === 'red' ? 'black' : 'red')
  )
    throw invalid();
  const definition =
    variant === 'banqi'
      ? banqi
      : variant === 'minixiangqi'
        ? miniXiangqi
        : variant === 'manchu'
          ? manchu
          : standardXiangqi;
  const initial = positionFromFen(before.fen, definition);
  const actual = positionFromFen(after.fen, definition);
  if (variant !== 'banqi' && (initial.active !== before.turn || actual.active !== after.turn))
    throw invalid();
  const [from, to] = coordinateMove(move);
  const piece = initial.pieces.get(from);
  if (
    !piece ||
    (piece.participant !== initial.active && !(variant === 'banqi' && piece.face === 'down' && from === to))
  )
    throw invalid();
  const expected = recordedPosition(initial, move, actual.active);
  const pieces = new Map(expected.pieces);
  if (piece.face === 'down' && variant === 'banqi') {
    const face = after.reveal;
    const role = Object.keys(banqi.roles).find(r => banqi.roles[r] === face?.toLowerCase());
    if (!face || !role || from !== to || !before.fen.split(' ')[6].includes(face)) throw invalid();
    pieces.set(to, { face: 'up', participant: face === face.toUpperCase() ? 'red' : 'black', role });
  } else if (piece.face === 'down') {
    const role = after.reveal;
    if (
      variant !== 'jieqi' ||
      !piece.participant ||
      !role ||
      !definition.roles[role] ||
      definition.royalRoles.includes(role)
    )
      throw invalid();
    pieces.set(to, { face: 'up', participant: piece.participant, role });
  } else if (after.reveal) throw invalid();
  if (positionToFen({ ...expected, pieces }, definition) !== positionToFen(actual, definition))
    throw invalid();
}
