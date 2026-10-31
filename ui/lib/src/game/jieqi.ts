import { coordinateMove, positionFromFen, standardXiangqi } from '@lixiangqi/board';

import type { RulesState } from './xiangqiNotation';

export const JIEQI_START_FEN = 'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w j - 0 1';

export interface JieqiCapture {
  side: 'red' | 'black';
  square: string;
  role?: string | null;
  concealed: boolean;
  ply: number;
}

export interface JieqiObservation {
  fen: string;
  remaining: Record<string, number>;
}

export function mergeCaptures(
  publicCaptures: readonly JieqiCapture[],
  known: readonly JieqiCapture[],
): JieqiCapture[] {
  return publicCaptures.map(capture => {
    const remembered = known.find(
      previous => previous.ply === capture.ply && previous.square === capture.square,
    );
    return !capture.role && remembered?.role ? { ...capture, role: remembered.role } : capture;
  });
}

/** Uses only visible pieces and the caller's already projected capture ledger. */
export function jieqiObservation(state: Pick<RulesState, 'fen' | 'captures'>): JieqiObservation {
  const remaining = Object.fromEntries(
    [...'RACPNBracpnb'].map(piece => [piece, piece.toLowerCase() === 'p' ? 5 : 2]),
  );
  for (const piece of state.fen.split(' ')[0]) if (piece in remaining) remaining[piece]--;
  for (const capture of state.captures ?? []) {
    if (!capture.role) continue;
    const letter = standardXiangqi.roles[capture.role];
    if (!letter || letter === 'k') throw new Error('Invalid Jieqi capture');
    remaining[capture.side === 'red' ? letter.toUpperCase() : letter]--;
  }
  if (Object.values(remaining).some(count => count < 0)) throw new Error('Invalid Jieqi inventory');
  return { fen: state.fen, remaining };
}

export function jieqiEngineFen(observation: JieqiObservation): string {
  const [placement, turn, , , quiet, fullmove] = observation.fen.split(' ');
  const inventory = [...'RACPNBracpnb']
    .filter(piece => observation.remaining[piece])
    .map(piece => piece + observation.remaining[piece])
    .join('');
  return `${placement} ${turn} ${inventory || '-'} ${quiet} ${fullmove}`;
}

export interface RevealChoice {
  role: string;
  count: number;
  probability: number;
}

export function revealChoices(state: RulesState, move: string): RevealChoice[] {
  const [from] = coordinateMove(move);
  const piece = positionFromFen(state.fen, standardXiangqi).pieces.get(from);
  if (piece?.face !== 'down') return [];
  const { remaining } = jieqiObservation(state);
  const choices = Object.keys(standardXiangqi.roles)
    .map(role => {
      const letter = standardXiangqi.roles[role];
      return { role, count: remaining[state.turn === 'red' ? letter.toUpperCase() : letter] ?? 0 };
    })
    .filter(choice => choice.count > 0);
  const total = choices.reduce((sum, choice) => sum + choice.count, 0);
  return choices.map(choice => ({ ...choice, probability: choice.count / total }));
}

/** Sample counts, not rounded display percentages or equally weighted roles. */
export function randomReveal(
  choices: readonly RevealChoice[],
  random: () => number = Math.random,
): string | undefined {
  let ticket = random() * choices.reduce((sum, choice) => sum + choice.count, 0);
  for (const choice of choices) {
    ticket -= choice.count;
    if (ticket < 0) return choice.role;
  }
  return undefined;
}
