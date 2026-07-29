import type { Level, Stage } from './stage/list';

export type Rank = 1 | 2 | 3;
export const COMPLETION_SCORE = 100;

export const getLevelRank = (_level: Level, score: number): Rank =>
  score >= COMPLETION_SCORE ? 1 : score > 0 ? 2 : 3;

export const getStageRank = (stage: Stage, scores: number | number[]): Rank => {
  const score = typeof scores === 'number' ? scores : scores.reduce((sum, value) => sum + value, 0);
  const max = Math.max(1, stage.levels.length) * COMPLETION_SCORE;
  return score >= max ? 1 : score >= max * 0.75 ? 2 : 3;
};

export const gtz = (score: number) => score > 0;
