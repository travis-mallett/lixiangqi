import type { BoardMark } from '@lixiangqi/board';

import type { Shape } from 'lib/tree/types';

// Study's persisted/socket square encoding is an existing external contract. It stays at this boundary.
export const studyLocation = (location: string): string => location.replace(':', '10');
export function storedStudyLocation(location: string): Key {
  if (!/^[a-i](?:10|[1-9])$/.test(location)) throw new Error(`Invalid study location: ${location}`);
  return location.replace('10', ':') as Key;
}
export const studyMarks = (shapes: readonly Shape[] = []): BoardMark[] =>
  shapes.map(shape => ({
    from: studyLocation(shape.orig),
    to: shape.dest ? studyLocation(shape.dest) : undefined,
    brush: shape.brush,
  }));
export const storedStudyMarks = (marks: readonly BoardMark[]): Shape[] =>
  marks.map(mark => ({
    orig: storedStudyLocation(mark.from),
    dest: mark.to ? storedStudyLocation(mark.to) : undefined,
    brush: mark.brush,
  }));
