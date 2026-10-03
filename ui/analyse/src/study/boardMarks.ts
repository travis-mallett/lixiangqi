import type { BoardMark } from '@lixiangqi/board';

import type { Shape } from 'lib/tree/types';

export function studyLocation(location: string): string {
  if (!/^[a-i](?:10|[1-9])$/.test(location)) throw new Error(`Invalid study location: ${location}`);
  return location;
}
export const storedStudyLocation = studyLocation;
export const studyMarks = (shapes: readonly Shape[] = []): BoardMark[] =>
  shapes.map(shape => ({
    from: studyLocation(shape.orig),
    to: shape.dest ? studyLocation(shape.dest) : undefined,
    brush: shape.brush,
  }));
export const storedStudyMarks = (marks: readonly BoardMark[]): Shape[] =>
  marks.map(mark => ({
    orig: studyLocation(mark.from),
    dest: mark.to ? studyLocation(mark.to) : undefined,
    brush: mark.brush,
  }));
