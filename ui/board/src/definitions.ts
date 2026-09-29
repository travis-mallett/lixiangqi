import type { BoardDefinition, BoardPresentation, Participant } from './types';

export const standardXiangqi: BoardDefinition = Object.freeze({
  id: 'xiangqi',
  geometry: Object.freeze({ id: 'xiangqi-9x10', columns: 9, rows: 10, placement: 'intersections' as const }),
  participants: ['red', 'black'] as const,
  roles: Object.freeze({
    general: 'k',
    advisor: 'a',
    elephant: 'b',
    horse: 'n',
    chariot: 'r',
    cannon: 'c',
    soldier: 'p',
  }),
  royalRoles: ['general'],
  coordinates: 'xiangqi' as const,
});

export const supportedBoards: readonly BoardDefinition[] = [standardXiangqi];

export function boardDefinition(id: string): BoardDefinition {
  const definition = supportedBoards.find(board => board.id === id);
  if (!definition) throw new Error(`Unsupported board: ${id}`);
  return definition;
}

export type BoardPurpose = 'interactive' | 'replay' | 'editor' | 'thumbnail' | 'preview';

export function boardPresentation(purpose: BoardPurpose, perspective: Participant): BoardPresentation {
  const quiet = purpose === 'thumbnail' || purpose === 'preview' || purpose === 'editor';
  return {
    perspective,
    coordinates: purpose !== 'thumbnail' && purpose !== 'preview',
    highlight: purpose !== 'editor',
    motion: { duration: purpose === 'preview' ? 0 : 200 },
    feedback: { effects: quiet ? [] : ['capture', 'check', 'checkmate'], audio: !quiet },
    drawing: purpose === 'interactive' || purpose === 'replay',
  };
}
