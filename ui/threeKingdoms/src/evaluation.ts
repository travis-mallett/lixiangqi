import { colors, type EngineLine, type State } from './types';

/** Relative balance, never a calibrated win probability. Survival bonuses cancel
 * between active players; eliminated players do not enter the normalization. */
export function balanceShares(line: Pick<EngineLine, 'scores' | 'active' | 'winners'>): number[] {
  const eligible = line.winners ?? line.active;
  if (!eligible.length) throw new Error('Evaluation has no active players');
  if (line.winners) return colors.map(color => (eligible.includes(color) ? 100 / eligible.length : 0));
  const maximum = Math.max(
    ...colors.flatMap((color, i) => (eligible.includes(color) ? [line.scores[i]] : [])),
  );
  const weights = colors.map((color, i) =>
    eligible.includes(color) ? Math.exp((line.scores[i] - maximum) / 600) : 0,
  );
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map(value => (value * 100) / total);
}

export function terminalShares(state: State): number[] | undefined {
  return state.ending
    ? balanceShares({ scores: [0, 0, 0], active: state.active, winners: state.ending.winners })
    : undefined;
}

export interface Evaluation {
  shares: number[];
  depth: number;
}

export function validEvaluation(value: Evaluation): boolean {
  return (
    !!value &&
    Number.isInteger(value.depth) &&
    value.depth >= 0 &&
    value.depth <= 6 &&
    Array.isArray(value.shares) &&
    value.shares.length === 3 &&
    value.shares.every(n => Number.isFinite(n) && n >= 0 && n <= 100) &&
    Math.abs(value.shares.reduce((a, b) => a + b, 0) - 100) < 0.001
  );
}
