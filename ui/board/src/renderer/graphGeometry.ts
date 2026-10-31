import type { GraphGeometry, Location, Participant } from '../types';

export function graphPoint(
  geometry: GraphGeometry,
  location: Location,
  perspective: Participant,
): readonly [number, number] {
  const point = geometry.locations[location];
  if (!point) throw new Error('Invalid board location');
  return rotateGraphPoint(geometry, point, perspective);
}

export function rotateGraphPoint(
  geometry: GraphGeometry,
  point: readonly [number, number],
  perspective: Participant,
): readonly [number, number] {
  const degrees = geometry.rotations[perspective];
  if (!Number.isFinite(degrees)) throw new Error('Invalid board perspective');
  const angle = (degrees * Math.PI) / 180;
  const x = point[0] - geometry.width / 2;
  const y = point[1] - geometry.height / 2;
  return [
    geometry.width / 2 + x * Math.cos(angle) - y * Math.sin(angle),
    geometry.height / 2 + x * Math.sin(angle) + y * Math.cos(angle),
  ];
}

export function validateGraphGeometry(geometry: GraphGeometry, participants: readonly Participant[]): void {
  if (![geometry.width, geometry.height, geometry.pieceSize].every(n => Number.isFinite(n) && n > 0))
    throw new Error('Invalid graph board dimensions');
  if (!participants.length || new Set(participants).size !== participants.length)
    throw new Error('Invalid graph board participants');
  const points = Object.values(geometry.locations);
  if (!points.length || new Set(points.map(p => p.join(','))).size !== points.length)
    throw new Error('Graph board locations must be distinct');
  for (const participant of participants)
    for (const location of Object.keys(geometry.locations)) {
      const [x, y] = graphPoint(geometry, location, participant);
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        x > geometry.width ||
        y < 0 ||
        y > geometry.height
      )
        throw new Error('Graph board location is outside its artwork');
    }
}
