import { clamp } from './random';
import type { DistributionEntry } from './types';

export function validateDistribution(entries: readonly DistributionEntry[]): void {
  if (
    !entries.length ||
    entries.some(e => !Number.isFinite(e.probability) || e.probability < 0 || !Number.isFinite(e.value)) ||
    Math.abs(entries.reduce((sum, e) => sum + e.probability, 0) - 1) > 1e-8
  )
    throw new Error('Outcome distribution must preserve unit probability mass');
}
export function lowerTailMean(entries: readonly DistributionEntry[], mass = 0.25): number {
  validateDistribution(entries);
  if (mass < 0.05 || mass > 1 || !Number.isFinite(mass)) throw new Error('Tail mass must be in [0.05, 1]');
  let remaining = mass,
    value = 0;
  for (const entry of [...entries].sort((a, b) => a.value - b.value)) {
    const used = Math.min(remaining, entry.probability);
    value += used * entry.value;
    remaining -= used;
    if (remaining <= 1e-12) break;
  }
  return value / mass;
}
export function outcomeValue(entries: readonly DistributionEntry[], risk: number): number {
  const tail = lowerTailMean(entries);
  const mean = entries.reduce((sum, e) => sum + e.probability * e.value, 0);
  return (1 - clamp(risk)) * mean + clamp(risk) * tail;
}
