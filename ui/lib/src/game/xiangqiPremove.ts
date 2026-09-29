import type { BoardPosition } from '@lixiangqi/board';

/** Potential premove targets, ignoring occupancy. Authoritative legal destinations validate execution. */
export function xiangqiPremoveTargets(position: BoardPosition, from: string): string[] {
  const piece = position.pieces.get(from);
  if (piece?.face !== 'up') return [];
  const x = from.charCodeAt(0) - 97,
    y = Number(from.slice(1));
  const red = piece.participant === 'red';
  const targets: string[] = [];
  for (let file = 0; file < 9; file++)
    for (let rank = 1; rank <= 10; rank++) {
      const dx = Math.abs(file - x),
        dy = Math.abs(rank - y);
      if (!dx && !dy) continue;
      const palace = file >= 3 && file <= 5 && (red ? rank <= 3 : rank >= 8);
      const possible =
        piece.role === 'chariot' || piece.role === 'cannon'
          ? dx === 0 || dy === 0
          : piece.role === 'horse'
            ? dx * dy === 2
            : piece.role === 'elephant'
              ? dx === 2 && dy === 2 && (red ? rank <= 5 : rank >= 6)
              : piece.role === 'advisor'
                ? dx === 1 && dy === 1 && palace
                : piece.role === 'general'
                  ? dx + dy === 1 && palace
                  : piece.role === 'soldier'
                    ? (dx === 0 && rank === y + (red ? 1 : -1)) ||
                      (dy === 0 && dx === 1 && (red ? y >= 6 : y <= 5))
                    : false;
      if (possible) targets.push(`${String.fromCharCode(97 + file)}${rank}`);
    }
  return targets;
}
