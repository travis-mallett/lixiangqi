import type { DrawBrush, DrawBrushes } from 'chessgroundx/draw';

export const annotationBrushes: DrawBrushes = {
  green: { key: 'g', color: '#15781b', opacity: 1, lineWidth: 10 },
  red: { key: 'r', color: '#882020', opacity: 1, lineWidth: 10 },
  blue: { key: 'b', color: '#003088', opacity: 1, lineWidth: 10 },
  yellow: { key: 'y', color: '#e68f00', opacity: 1, lineWidth: 10 },
  paleBlue: { key: 'pb', color: '#003088', opacity: 0.4, lineWidth: 15 },
  paleGreen: { key: 'pg', color: '#15781b', opacity: 0.4, lineWidth: 15 },
  paleRed: { key: 'pr', color: '#882020', opacity: 0.4, lineWidth: 15 },
  paleGrey: { key: 'pgr', color: '#4a4a4a', opacity: 0.35, lineWidth: 15 },
  variation: { key: 'variation', color: 'white', opacity: 0.5, lineWidth: 12 },
};

type Point = readonly [number, number];

function svg(tag: string, attributes: Record<string, string | number>): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

/** Geometry adapters supply projected points in cell units; no board keys or move rules belong here. */
export function renderAnnotation(
  brush: DrawBrush,
  from: Point,
  to: Point | undefined,
  current: boolean,
  shorten: boolean,
  radius: number,
  lineWidth?: number,
): SVGElement {
  // Match Chessground's custom-brush semantics, including zero-width fallback.
  // Rectangular annotations arrive normalized; graph annotations supply the modifier here.
  if (lineWidth !== undefined)
    brush = {
      ...brush,
      opacity: Math.round(brush.opacity * 10) / 10,
      lineWidth: Math.round(lineWidth || brush.lineWidth),
    };
  const opacity = brush.opacity * (current ? 0.9 : 1);
  if (!to)
    return svg('circle', {
      cx: from[0],
      cy: from[1],
      r: radius - 2 / 64,
      fill: 'none',
      stroke: brush.color,
      'stroke-width': (current ? 3 : 4) / 64,
      opacity,
    });
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const margin = (shorten && !current ? 20 : 10) / 64;
  const width = ((brush.lineWidth || 10) * (current ? 0.85 : 1)) / 64;
  const end: Point = [to[0] - Math.cos(angle) * margin, to[1] - Math.sin(angle) * margin];
  const group = svg('g', { opacity });
  group.append(
    svg('line', {
      x1: from[0],
      y1: from[1],
      x2: end[0],
      y2: end[1],
      stroke: brush.color,
      'stroke-width': width,
      'stroke-linecap': 'round',
    }),
  );
  // Same filled head as Chessground, without document-global marker IDs.
  group.append(
    svg('path', {
      d: 'M0,0 V4 L3,2 Z',
      fill: brush.color,
      transform: `translate(${end[0]} ${end[1]}) rotate(${(angle * 180) / Math.PI}) scale(${width}) translate(-2.05 -2.01)`,
    }),
  );
  return group;
}
