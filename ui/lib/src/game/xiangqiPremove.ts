import { positionFromFen, standardXiangqi, type BoardPosition } from '@lixiangqi/board';

import { XIANGQI_START_FEN } from './xiangqi';

const startingPieces = positionFromFen(XIANGQI_START_FEN, standardXiangqi).pieces;

/** Potential premove targets, ignoring occupancy. Authoritative legal destinations validate execution. */
export function xiangqiPremoveTargets(position: BoardPosition, from: string, jieqi = false): string[] {
  const mini = position.board === 'minixiangqi';
  const files = mini ? 7 : 9;
  const rows = mini ? 7 : 10;
  const center = Math.floor(files / 2);
  const visible = position.pieces.get(from);
  const piece = visible?.face === 'down' && jieqi ? startingPieces.get(from) : visible;
  const unrestrictedDiagonals = jieqi && visible?.face === 'up';
  if (piece?.face !== 'up') return [];
  const x = from.charCodeAt(0) - 97,
    y = Number(from.slice(1));
  const red = piece.participant === 'red';
  const targets: string[] = [];
  for (let file = 0; file < files; file++)
    for (let rank = 1; rank <= rows; rank++) {
      const dx = Math.abs(file - x),
        dy = Math.abs(rank - y);
      if (!dx && !dy) continue;
      const palace = file >= center - 1 && file <= center + 1 && (red ? rank <= 3 : rank >= rows - 2);
      const possible =
        piece.role === 'chariot' || piece.role === 'cannon'
          ? dx === 0 || dy === 0
          : piece.role === 'horse'
            ? dx * dy === 2
            : piece.role === 'elephant'
              ? dx === 2 && dy === 2 && (unrestrictedDiagonals || (red ? rank <= 5 : rank >= 6))
              : piece.role === 'advisor'
                ? dx === 1 && dy === 1 && (unrestrictedDiagonals || palace)
                : piece.role === 'general'
                  ? dx + dy === 1 && palace
                  : piece.role === 'soldier'
                    ? (dx === 0 && rank === y + (red ? 1 : -1)) ||
                      (dy === 0 && dx === 1 && (mini || (red ? y >= 6 : y <= 5)))
                    : false;
      if (possible) targets.push(`${String.fromCharCode(97 + file)}${rank}`);
    }
  return targets;
}
