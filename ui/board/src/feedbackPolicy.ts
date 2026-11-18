import type { BoardEffect } from './types';

/** Semantic priority is independent of animation preferences and asset availability. */
export function primaryBoardEffect(effects: readonly BoardEffect[]): BoardEffect | undefined {
  return (['checkmate', 'check', 'capture'] as const).find(effect => effects.includes(effect));
}
