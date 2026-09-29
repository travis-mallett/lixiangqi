import { positionFromFen, standardXiangqi } from '@lixiangqi/board';

import type { CheckCount, CheckState } from './interfaces';

// Fixed material values describe an imbalance, not a positional engine evaluation.
export const xiangqiMaterialValues = {
  general: 0,
  advisor: 2,
  elephant: 2,
  horse: 4,
  chariot: 9,
  cannon: 4.5,
  soldier: 1,
} as const;
type MaterialRole = keyof typeof xiangqiMaterialValues;
export type MaterialDiffSide = Record<MaterialRole, number>;
export type MaterialDiff = Record<'red' | 'black', MaterialDiffSide>;

export function getMaterialDiff(fen: FEN): MaterialDiff {
  const empty = () =>
    Object.fromEntries(Object.keys(xiangqiMaterialValues).map(role => [role, 0])) as MaterialDiffSide;
  const diff = { red: empty(), black: empty() };
  if (!fen) return diff;
  for (const piece of positionFromFen(fen, standardXiangqi).pieces.values()) {
    if (piece.face !== 'up') continue;
    const role = piece.role as MaterialRole;
    const color = piece.participant as 'red' | 'black';
    const them = diff[color === 'red' ? 'black' : 'red'];
    if (them[role] > 0) them[role]--;
    else diff[color][role]++;
  }
  return diff;
}

export function getScore(diff: MaterialDiff): number {
  return (Object.keys(xiangqiMaterialValues) as MaterialRole[]).reduce(
    (score, role) => score + (diff.red[role] - diff.black[role]) * xiangqiMaterialValues[role],
    0,
  );
}

export function xiangqiMaterialScore(fen: FEN, player: 'red' | 'black'): number {
  return getScore(getMaterialDiff(fen)) * (player === 'red' ? 1 : -1);
}

export const NO_CHECKS: CheckCount = {
  white: 0,
  black: 0,
};

export function countChecks(steps: CheckState[], ply: Ply): CheckCount {
  const checks: CheckCount = { ...NO_CHECKS };
  for (const step of steps) {
    if (ply < step.ply) break;
    if (step.check === true || (typeof step.check === 'function' && step.check())) {
      if (step.ply % 2 === 1) checks.white++;
      else checks.black++;
    }
  }
  return checks;
}
