import type { EngineScore } from './tree';

export const NEUTRAL_EVALUATION: EngineScore = Object.freeze({ redCp: 0 });

export function displayedEvaluation(
  incoming: EngineScore | undefined,
  previous: EngineScore = NEUTRAL_EVALUATION,
): EngineScore {
  return incoming ?? previous;
}

export function evaluationShare(score?: EngineScore): number {
  if (score?.redMate !== undefined) return score.redMate > 0 ? 100 : score.redMate < 0 ? 0 : 50;
  if (score?.redCp === undefined) return 50;
  return Math.max(3, Math.min(97, 50 + 47 * Math.tanh(score.redCp / 300)));
}

export function formatEvaluation(score: EngineScore): string {
  if (score.redMate !== undefined)
    return score.redMate > 0 ? `+M${score.redMate}` : `−M${Math.abs(score.redMate)}`;
  const pawns = (score.redCp ?? 0) / 100;
  return `${pawns >= 0 ? '+' : '−'}${Math.abs(pawns).toFixed(2)}`;
}
