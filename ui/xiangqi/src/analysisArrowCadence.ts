import type { EngineAnalysis } from 'lib/ceval';

export const MIN_ARROW_DEPTH = 5;
export const DEFAULT_ARROW_UPDATES = 4;
export type ArrowBudget = number | { nodes: number };

type ArrowResult = Pick<EngineAnalysis, 'depth' | 'nodes'> & { lines: { pvMoves: string[] }[] };

export interface ArrowCadence<T extends ArrowResult = EngineAnalysis> {
  /** The most recent engine result allowed to drive recommendation arrows. */
  published: T | undefined;
  reset(budget: ArrowBudget, requestedUpdates?: number): void;
  configure(budget: ArrowBudget, requestedUpdates?: number): void;
  accept(result: T, final: boolean): T | undefined;
}

/**
 * Throttle recommendation arrows during one engine search. The engine may
 * report every completed depth, but arrows are published at evenly spaced
 * milestones and once more for an early final result.
 */
export function createArrowCadence<T extends ArrowResult = EngineAnalysis>(
  targetDepth: ArrowBudget,
  requestedUpdates: number = DEFAULT_ARROW_UPDATES,
  minimumDepth: number = MIN_ARROW_DEPTH,
): ArrowCadence<T> {
  let milestones: number[] = [];
  let milestoneIndex = 0;
  let lastPublishedProgress = 0;
  let lastObservedProgress = 0;
  let lastFinalProgress = -1;
  let nodeBudget = false;
  const cadence: ArrowCadence<T> = {
    published: undefined,
    reset(target, updates = DEFAULT_ARROW_UPDATES) {
      cadence.published = undefined;
      lastPublishedProgress = 0;
      lastObservedProgress = 0;
      lastFinalProgress = -1;
      cadence.configure(target, updates);
    },
    configure(target, updates = DEFAULT_ARROW_UPDATES) {
      nodeBudget = typeof target !== 'number';
      const count = Math.min(4, Math.max(1, Math.round(updates)));
      milestones =
        typeof target === 'number'
          ? makeMilestones(target, updates, minimumDepth)
          : Array.from({ length: count }, (_, index) =>
              count === 1 ? target.nodes : Math.max(1, (index * target.nodes) / (count - 1)),
            );
      milestoneIndex = milestones.findIndex(depth => depth > lastObservedProgress);
      if (milestoneIndex < 0) milestoneIndex = milestones.length;
    },
    accept(result, final) {
      if (!result.lines.some(line => line.pvMoves.length)) return undefined;
      const progress = nodeBudget ? result.nodes : result.depth;
      lastObservedProgress = Math.max(lastObservedProgress, progress);
      if (!final && !nodeBudget && result.depth < minimumDepth) return undefined;
      const milestoneReached = progress >= (milestones[milestoneIndex] ?? Infinity);
      if (!milestoneReached && !final) return undefined;
      if (
        (!final &&
          (progress < lastPublishedProgress || (progress === lastPublishedProgress && cadence.published))) ||
        (final && lastFinalProgress === progress)
      )
        return undefined;
      if (final) lastFinalProgress = progress;
      lastPublishedProgress = progress;
      while (milestoneIndex < milestones.length && milestones[milestoneIndex] <= progress) milestoneIndex++;
      cadence.published = result;
      return result;
    },
  };
  cadence.reset(targetDepth, requestedUpdates);
  return cadence;
}

export function makeMilestones(
  targetDepth: number,
  updates: number,
  minimumDepth: number = MIN_ARROW_DEPTH,
): number[] {
  const target = Math.max(minimumDepth, Math.round(targetDepth));
  const count = Math.min(4, Math.max(1, Math.round(updates)));
  if (count === 1) return [target];
  const milestones: number[] = [];
  for (let index = 0; index < count; index++) {
    const depth = Math.round(minimumDepth + ((target - minimumDepth) * index) / (count - 1));
    if (depth > (milestones[milestones.length - 1] ?? 0)) milestones.push(depth);
  }
  return milestones;
}
