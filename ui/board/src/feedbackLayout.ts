import { rotateGraphPoint } from './renderer/graphGeometry';
import type { BoardEffect, BoardTransition, GraphGeometry, Participant } from './types';

export interface FeedbackPlacement {
  effect: BoardEffect | 'victory';
  point: readonly [number, number];
  width: number;
}

/** Shared choreography: renderers provide geometry, games provide semantic events. */
export function feedbackLayout(
  transition: BoardTransition,
  geometry: GraphGeometry,
  perspective: Participant,
): FeedbackPlacement[] {
  const result: FeedbackPlacement[] = [];
  const center = [geometry.width / 2, geometry.height / 2];
  const percent = (p: readonly [number, number]): readonly [number, number] => {
    const rotated = rotateGraphPoint(geometry, p, perspective);
    return [(100 * rotated[0]) / geometry.width, (100 * rotated[1]) / geometry.height];
  };
  const groups = new Map<string, { point: readonly [number, number]; effects: BoardEffect[] }>();
  for (const effect of transition.effects ?? []) {
    if (effect === 'checkmate' || effect === 'defeat') {
      for (const target of transition.effectTargets?.[effect] ?? []) {
        const anchor = geometry.territoryAnchors?.[target];
        if (anchor) result.push({ effect, point: percent(anchor), width: 22 });
      }
      continue;
    }
    for (const route of transition.effectRoutes?.[effect] ?? []) {
      const key = [...route].sort().join(':');
      const point = geometry.riverAnchors?.[key];
      if (!point) continue;
      const group = groups.get(key) ?? { point, effects: [] };
      if (!group.effects.includes(effect)) group.effects.push(effect);
      groups.set(key, group);
    }
  }
  for (const { point, effects } of groups.values()) {
    effects.sort((a, b) => Number(a === 'check') - Number(b === 'check'));
    const length = Math.hypot(point[0] - center[0], point[1] - center[1]);
    effects.forEach((effect, index) => {
      const offset = effects.length > 1 ? (index - 0.5) * geometry.height * 0.19 : 0;
      result.push({
        effect,
        width: effects.length > 1 ? 14 : 17,
        point: percent([
          point[0] + (offset * (point[0] - center[0])) / length,
          point[1] + (offset * (point[1] - center[1])) / length,
        ]),
      });
    });
  }
  for (const winner of transition.winners ?? []) {
    const point = geometry.territoryAnchors?.[winner];
    if (point) result.push({ effect: 'victory', point: percent(point), width: 22 });
  }
  // Peak animation canvases are square. Keep a gap in screen space, including
  // after rotation; narrowing a board scales the same non-overlapping regions.
  const aspect = geometry.width / geometry.height;
  const gap = 1.2;
  let scale = 1;
  for (const [i, a] of result.entries()) {
    scale = Math.min(
      scale,
      (2 * Math.min(a.point[0], 100 - a.point[0], a.point[1] / aspect, (100 - a.point[1]) / aspect)) /
        a.width,
    );
    for (const b of result.slice(i + 1)) {
      const distance = Math.max(
        Math.abs(a.point[0] - b.point[0]),
        Math.abs(a.point[1] - b.point[1]) / aspect,
      );
      scale = Math.min(scale, (Math.max(0, distance - gap) * 2) / (a.width + b.width));
    }
  }
  return result.map(placement => ({ ...placement, width: placement.width * scale }));
}
