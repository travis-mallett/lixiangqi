import type { GraphGeometry, GraphCoordinate, Participant } from '../types';
import { rotateGraphPoint } from './graphGeometry';

/** Coordinate positions rotate with the board; letters remain upright for the viewer. */
export function graphCoordinates(geometry: GraphGeometry, perspective: Participant): GraphCoordinate[] {
  return (geometry.coordinates ?? []).map(label => ({
    ...label,
    point: rotateGraphPoint(geometry, label.point, perspective),
  }));
}

export function renderGraphCoordinates(geometry: GraphGeometry, perspective: Participant): SVGElement[] {
  return graphCoordinates(geometry, perspective).map(label => {
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(label.point[0]));
    text.setAttribute('y', String(label.point[1]));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.dataset.coordinateLocation = label.location;
    text.dataset.axis = label.axis;
    text.textContent = label.text;
    return text;
  });
}
