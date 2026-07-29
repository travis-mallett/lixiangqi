import type { DrawShape } from 'chessgroundx/draw';
import type { Color, Key } from 'chessgroundx/types';

import { uciMoveToCg } from './groundUtil';

const RED = '#e04b4d';
const BLACK = '#282828';
const BADGE = '#77a718';
const MAX_RECOMMENDED_PLIES = 2;

interface Point {
  x: number;
  y: number;
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

function squarePosition(key: Key): Point {
  return {
    x: key.charCodeAt(0) - 97,
    y: key.charCodeAt(1) - 49,
  };
}

function routeForMove(orig: Key, dest: Key, orientation: Color): Point[] {
  const source = squarePosition(orig);
  const target = squarePosition(dest);
  const orientationSign = orientation === 'white' ? 1 : -1;
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

function arrowSvg(route: Point[], moveNumber: number, color: string): string {
  const tip = route[route.length - 1];
  const preceding = route[route.length - 2];
  const direction = unit(subtract(tip, preceding));
  const perpendicular = normal(direction);
  const badgeCenter = add(tip, direction, -37.5);
  const shaftRoute = [...route.slice(0, -1), badgeCenter];
  const headLeft = add(badgeCenter, perpendicular, 19.5);
  const headRight = add(badgeCenter, perpendicular, -19.5);

  return `<g class="xiangqi-recommended-arrow" data-route="${route.map(svgPoint).join(' ')}">
  <polygon points="${taperedShaft(shaftRoute)}" fill="${color}"/>
  <polygon points="${svgPoint(headLeft)} ${svgPoint(tip)} ${svgPoint(headRight)}" fill="${color}"/>
  <circle cx="${format(badgeCenter.x)}" cy="${format(badgeCenter.y)}" r="17" fill="${BADGE}"/>
  <text x="${format(badgeCenter.x)}" y="${format(badgeCenter.y)}" dy="0.36em" fill="#fff" font-family="Arial, sans-serif" font-size="25" font-weight="400" text-anchor="middle">${moveNumber}</text>
</g>`;
}

export function recommendedArrowShapes(
  moves: readonly string[],
  turn: 'red' | 'black',
  orientation: Color = 'white',
): DrawShape[] {
  return moves.slice(0, MAX_RECOMMENDED_PLIES).flatMap((move, index) => {
    if (!/^[a-i](?:10|[1-9])[a-i](?:10|[1-9])$/.test(move)) return [];
    const [orig, dest] = uciMoveToCg(move);
    const moverIsRed = index % 2 === 0 ? turn === 'red' : turn === 'black';
    return [
      {
        orig: orig as Key,
        customSvg: arrowSvg(
          routeForMove(orig as Key, dest, orientation),
          index + 1,
          moverIsRed ? RED : BLACK,
        ),
      },
    ];
  });
}
