import type { EngineScore } from 'lib/tree/native';

export const UNKNOWN_EVALUATION: EngineScore = Object.freeze({});

export function displayedEvaluation(
  incoming: EngineScore | undefined,
  previous: EngineScore = UNKNOWN_EVALUATION,
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
  if (score.redCp === undefined) return '—';
  const pawns = score.redCp / 100;
  return `${pawns >= 0 ? '+' : '−'}${Math.abs(pawns).toFixed(2)}`;
}
