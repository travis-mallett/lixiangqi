import { threeKingdoms, graphPoint, type BoardMark } from '@lixiangqi/board';
import type { Color, Rules, State, EngineResult } from 'threeKingdoms';

import { analysisPlayerColors, recommendedArrowStyle, routedArrowShape } from './recommendedArrows';

export function kingdomArrows(
  rules: Rules,
  state: State,
  perspective: string,
  result?: EngineResult,
  children: string[] = [],
  preview?: string,
): BoardMark[] {
  const geometry = threeKingdoms.geometry;
  const shape = (position: string, move: string, style: Parameters<typeof routedArrowShape>[3]) =>
    routedArrowShape(
      move.split('>')[0],
      rules.route(position, move).map(at => graphPoint(geometry, at, perspective)),
      geometry.pieceSize,
      style,
    );
  const lines = result?.lines.slice(0, 5) ?? [];
  const covered = new Set(lines.map(line => line.pvMoves[0]));
  const alternatives = [...new Set(children)].filter(move => move.includes('>') && !covered.has(move));
  const marks =
    alternatives.length < 2
      ? []
      : alternatives.slice(0, 5).map(move => shape(state.position, move, { color: '#4a4a4a', opacity: 0.6 }));
  lines
    .map((line, rank) => {
      let current = state;
      const seen = new Set<Color>();
      const arrows: BoardMark[] = [];
      for (const [ply, move] of line.pvMoves.slice(0, 3).entries()) {
        if (seen.has(current.turn) || current.ending) break;
        seen.add(current.turn);
        if (move.includes('>'))
          arrows.push(
            shape(
              current.position,
              move,
              recommendedArrowStyle(rank, lines.length, ply, analysisPlayerColors[current.turn]),
            ),
          );
        current = rules.inspect(rules.play(current.position, move));
      }
      return arrows;
    })
    .reverse()
    .forEach(arrows => marks.push(...arrows));
  if (preview?.includes('>')) marks.push(shape(state.position, preview, { color: '#003088', opacity: 0.6 }));
  return marks;
}
