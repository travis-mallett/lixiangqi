import { winningChances } from 'lib/ceval';

import type { EvaluationNode } from './interface';

// Scores are always from the first player's perspective (Red in Xiangqi).
// Mate zero means the side to move is mated, so its sign must come from the ply.
export function evaluationValue(node: EvaluationNode): number | null {
  if (node.eval?.mate !== undefined)
    return node.eval.mate === 0 ? (node.ply % 2 === 1 ? 1 : -1) : Math.sign(node.eval.mate);
  if (node.eval?.cp !== undefined) return winningChances.povChances('red', { cp: node.eval.cp });
  return null;
}

export function evaluationLabel(node: EvaluationNode): string {
  if (node.eval?.mate !== undefined) return `#${node.eval.mate}`;
  if (node.eval?.cp === undefined) return '';
  const cp = node.eval.cp;
  return `${cp > 0 ? '+' : ''}${Math.max(-99, Math.min(99, Math.round(cp / 10) / 10))}`;
}
