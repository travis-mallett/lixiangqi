import {
  XIANGQI_PUZZLE_ENGINE_MOVETIME_MS,
  XIANGQI_PUZZLE_CONFIRM_MOVETIME_MS,
  XIANGQI_PUZZLE_MAX_SEARCH_MS,
} from './xiangqiPuzzleEngine';

/** Completed-depth timestamps measure actual search work better than b^depth:
 * pruning and endgame positions make the effective branching factor variable.
 * Sampling elapsed work at each depth naturally gives expensive depths more width.
 * Reserve space for confirmation without moving backward when a search extends.
 * This is a display estimate, not a deadline or a depth requirement.
 */
export function evaluationPercent(timeMs: number): number {
  const initial = XIANGQI_PUZZLE_ENGINE_MOVETIME_MS;
  const confirmation = initial + XIANGQI_PUZZLE_CONFIRM_MOVETIME_MS;
  if (timeMs <= initial) return (75 * Math.max(0, timeMs)) / initial;
  if (timeMs <= confirmation) return 75 + (10 * (timeMs - initial)) / (confirmation - initial);
  return 85 + 10 * Math.min(1, (timeMs - confirmation) / (XIANGQI_PUZZLE_MAX_SEARCH_MS - confirmation));
}
