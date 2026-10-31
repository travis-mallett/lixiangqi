import { XIANGQI_PUZZLE_ENGINE_MOVETIME_MS } from './xiangqiPuzzleEngine';

/** Estimate elapsed search work, reserving the final 5% for completion. */
export function evaluationPercent(timeMs: number): number {
  return 95 * Math.min(1, Math.max(0, timeMs) / XIANGQI_PUZZLE_ENGINE_MOVETIME_MS);
}
