import type { NotationExercise, NotationSystem } from './interfaces';

export const notationFor = (exercise: NotationExercise, system: NotationSystem): string =>
  exercise[system === 'chinese' ? 'chinese' : 'wxf'];

export const normalizeNotation = (value: string): string =>
  value
    .trim()
    .replace(/\s+/g, '')
    .replace(/[.．]/g, '=')
    .replace(/[−–—]/g, '-');

export const isCorrectNotation = (answer: string, expected: string): boolean =>
  normalizeNotation(answer) === normalizeNotation(expected);
