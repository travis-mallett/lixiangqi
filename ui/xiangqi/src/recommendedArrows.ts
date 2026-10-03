import { coordinateMove, type BoardMark } from '@lixiangqi/board';

const RED = '#e04b4d';
const BLACK = '#282828';
const BADGE = '#77a718';
/** Highest engine-line rank drawn; mirrors the engine's MultiPV range. */
const MAX_ARROW_LINES = 5;
/** Each engine line contributes its move and the opponent's reply. */
const MAX_LINE_PLIES = 2;
/**
 * Opacity by engine-line rank. Deeper lines are drawn fainter so the primary
 * recommendation stays visually dominant, and the last one is dashed.
 */
const RANK_OPACITY = [1, 0.6, 0.4, 0.28, 0.2];
const MOVE_PATTERN = /^[a-i](?:10|[1-9])[a-i](?:10|[1-9])$/;
/** Distance from the arrow tip to the head base, in hundredths of a square. */
const HEAD_OFFSET = 37.5;
const HEAD_HALF_WIDTH = 19.5;
const BADGE_RADIUS = 17;

interface Point {
  x: number;
  y: number;
}

export interface ArrowStyle {
  readonly color: string;
  /** Whole-arrow opacity; defaults to fully opaque. */
  readonly opacity?: number;
  /** Dashed shaft; the head stays solid. */
  readonly dashed?: boolean;
  /** Rank badge drawn at the head. Omit for an unnumbered arrow. */
  readonly badge?: number;
}

const add = (a: Point, b: Point, scale = 1): Point => ({ x: a.x + b.x * scale, y: a.y + b.y * scale });
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const magnitude = (point: Point): number => Math.hypot(point.x, point.y);
const unit = (point: Point): Point => {
  const length = magnitude(point);
  return length ? { x: point.x / length, y: point.y / length } : { x: 0, y: 0 };
};
const normal = (point: Point): Point => ({ x: -point.y, y: point.x });
const format = (value: number): string => Number(value.toFixed(2)).toString();
const svgPoint = (point: Point): string => `${format(point.x)},${format(point.y)}`;
const pathData = (points: Point[]): string =>
  points.map((point, index) => `${index ? 'L' : 'M'}${svgPoint(point)}`).join(' ');

function squarePosition(key: string): Point {
  return {
    x: key.charCodeAt(0) - 97,
    y: Number(key.slice(1)) - 1,
  };
}

function routeForMove(orig: string, dest: string, orientation: string): Point[] {
  const source = squarePosition(orig);
  const target = squarePosition(dest);
  const orientationSign = orientation === 'red' ? 1 : -1;
  const fileDelta = target.x - source.x;
  const rankDelta = target.y - source.y;
  const start = { x: 50, y: 50 };
  const end = {
    x: start.x + fileDelta * 100 * orientationSign,
    y: start.y - rankDelta * 100 * orientationSign,
  };

  if (Math.abs(fileDelta) === 1 && Math.abs(rankDelta) === 2)
    return [start, { x: start.x, y: start.y + (end.y - start.y) / 2 }, end];
  if (Math.abs(fileDelta) === 2 && Math.abs(rankDelta) === 1)
    return [start, { x: start.x + (end.x - start.x) / 2, y: start.y }, end];
  return [start, end];
}

function offsetAt(points: Point[], index: number, halfWidth: number): Point {
  if (index === 0) return add({ x: 0, y: 0 }, normal(unit(subtract(points[1], points[0]))), halfWidth);
  if (index === points.length - 1)
    return add({ x: 0, y: 0 }, normal(unit(subtract(points[index], points[index - 1]))), halfWidth);

  const before = normal(unit(subtract(points[index], points[index - 1])));
  const after = normal(unit(subtract(points[index + 1], points[index])));
  const miter = unit(add(before, after));
  const denominator = miter.x * after.x + miter.y * after.y;
  return add({ x: 0, y: 0 }, miter, denominator ? halfWidth / denominator : halfWidth);
}

function taperedShaft(points: Point[]): string {
  const segmentLengths = points.slice(1).map((point, index) => magnitude(subtract(point, points[index])));
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  let travelled = 0;
  const left: Point[] = [];
  const right: Point[] = [];

  points.forEach((point, index) => {
    if (index) travelled += segmentLengths[index - 1];
    const halfWidth = 2.5 + (totalLength ? travelled / totalLength : 1) * 3;
    const offset = offsetAt(points, index, halfWidth);
    left.push(add(point, offset));
    right.push(add(point, offset, -1));
  });
  return [...left, ...right.reverse()].map(svgPoint).join(' ');
}

function arrowSvg(route: Point[], style: ArrowStyle): string {
  const tip = route[route.length - 1];
  const preceding = route[route.length - 2];
  const direction = unit(subtract(tip, preceding));
  const perpendicular = normal(direction);
  const headBase = add(tip, direction, -HEAD_OFFSET);
  const shaftRoute = [...route.slice(0, -1), headBase];
  const headLeft = add(headBase, perpendicular, HEAD_HALF_WIDTH);
  const headRight = add(headBase, perpendicular, -HEAD_HALF_WIDTH);
  const color = style.color;
  const shaft = style.dashed
    ? `<path d="${pathData(shaftRoute)}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="15 11"/>`
    : `<polygon points="${taperedShaft(shaftRoute)}" fill="${color}"/>`;
  const badge =
    style.badge === undefined
      ? ''
      : `
  <circle cx="${format(headBase.x)}" cy="${format(headBase.y)}" r="${BADGE_RADIUS}" fill="${BADGE}"/>
  <text x="${format(headBase.x)}" y="${format(headBase.y)}" dy="0.36em" fill="#fff" font-family="Arial, sans-serif" font-size="25" font-weight="400" text-anchor="middle">${style.badge}</text>`;

  return `<g class="xiangqi-recommended-arrow${style.dashed ? ' xiangqi-recommended-arrow--dashed' : ''}" data-route="${route.map(svgPoint).join(' ')}" opacity="${format(style.opacity ?? 1)}">
  ${shaft}
  <polygon points="${svgPoint(headLeft)} ${svgPoint(tip)} ${svgPoint(headRight)}" fill="${color}"/>${badge}
</g>`;
}

/** One analysis-board arrow, drawn in the shared Xiangqi arrow style. */
export function moveArrowShape(from: string, to: string, orientation: string, style: ArrowStyle): BoardMark {
  return { from, svg: arrowSvg(routeForMove(from, to, orientation), style) };
}

/**
 * Draw one numbered pair of arrows per engine line: the side to move's move
 * and the opponent's reply. Numbers follow the ply inside the line, so the
 * side to move's arrows are all labelled 1 and the opponent's replies all 2.
 * Deeper lines fade and the faintest one is dashed.
 */
export function recommendedArrowShapes(
  lines: readonly (readonly string[])[],
  turn: 'red' | 'black',
  orientation = 'red',
): BoardMark[] {
  const ranks = lines
    .slice(0, MAX_ARROW_LINES)
    .map(moves => moves.slice(0, MAX_LINE_PLIES).filter(move => MOVE_PATTERN.test(move)))
    .filter(moves => moves.length > 0);
  const faintestRank = ranks.length - 1;
  return ranks
    .map((moves, rank) => {
      const opacity = RANK_OPACITY[Math.min(rank, RANK_OPACITY.length - 1)];
      const dashed = rank === faintestRank && faintestRank > 0;
      return moves.map((move, ply): BoardMark => {
        const [orig, dest] = coordinateMove(move);
        const moverIsRed = ply % 2 === 0 ? turn === 'red' : turn === 'black';
        return moveArrowShape(orig, dest, orientation, {
          color: moverIsRed ? RED : BLACK,
          opacity,
          dashed,
          badge: ply + 1,
        });
      });
    })
    .reverse()
    .flat();
}

/** The moves an engine-line arrow covers, so callers never draw them twice. */
export function engineArrowMoves(lines: readonly (readonly string[])[]): string[] {
  return lines.slice(0, MAX_ARROW_LINES).flatMap(moves => moves.slice(0, MAX_LINE_PLIES));
}
