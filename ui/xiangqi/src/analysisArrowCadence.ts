import type { EngineAnalysis } from 'lib/ceval';

export const MIN_ARROW_DEPTH = 5;
export const DEFAULT_ARROW_UPDATES = 4;

export interface ArrowCadence {
  /** The most recent engine result allowed to drive recommendation arrows. */
  published: EngineAnalysis | undefined;
  reset(targetDepth: number, requestedUpdates?: number): void;
  configure(targetDepth: number, requestedUpdates?: number): void;
  accept(result: EngineAnalysis, final: boolean): EngineAnalysis | undefined;
}

/**
 * Throttle recommendation arrows during one engine search. The engine may
 * report every completed depth, but arrows are published at evenly spaced
 * milestones and once more for an early final result.
 */
export function createArrowCadence(
  targetDepth: number,
  requestedUpdates: number = DEFAULT_ARROW_UPDATES,
): ArrowCadence {
  let milestones: number[] = [];
  let milestoneIndex = 0;
  let lastPublishedDepth = 0;
  let lastObservedDepth = 0;
  let lastFinalDepth = -1;
  const cadence: ArrowCadence = {
    published: undefined,
    reset(target, updates = DEFAULT_ARROW_UPDATES) {
      cadence.published = undefined;
      lastPublishedDepth = 0;
      lastObservedDepth = 0;
      lastFinalDepth = -1;
      cadence.configure(target, updates);
    },
    configure(target, updates = DEFAULT_ARROW_UPDATES) {
      milestones = makeMilestones(target, updates);
      milestoneIndex = milestones.findIndex(depth => depth > lastObservedDepth);
      if (milestoneIndex < 0) milestoneIndex = milestones.length;
    },
    accept(result, final) {
      lastObservedDepth = Math.max(lastObservedDepth, result.depth);
      if (result.depth < MIN_ARROW_DEPTH) return undefined;
      const milestoneReached = result.depth >= (milestones[milestoneIndex] ?? Infinity);
      if (!milestoneReached && !final) return undefined;
      if (
        result.depth < lastPublishedDepth ||
        (result.depth === lastPublishedDepth && (!final || lastFinalDepth === result.depth))
      )
        return undefined;
      if (final) lastFinalDepth = result.depth;
      lastPublishedDepth = result.depth;
      while (milestoneIndex < milestones.length && milestones[milestoneIndex] <= result.depth)
        milestoneIndex++;
      cadence.published = result;
      return result;
    },
  };
  cadence.reset(targetDepth, requestedUpdates);
  return cadence;
}

export function makeMilestones(targetDepth: number, updates: number): number[] {
  const target = Math.max(MIN_ARROW_DEPTH, Math.round(targetDepth));
  const count = Math.min(4, Math.max(1, Math.round(updates)));
  if (count === 1) return [target];
  const milestones: number[] = [];
  for (let index = 0; index < count; index++) {
    const depth = Math.round(MIN_ARROW_DEPTH + ((target - MIN_ARROW_DEPTH) * index) / (count - 1));
    if (depth > (milestones[milestones.length - 1] ?? 0)) milestones.push(depth);
  }
  return milestones;
}
