import type { Dests, Key, Move, Orig } from 'chessgroundx/types';

export const XIANGQI_START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
export const XIANGQI_DIMENSIONS = { width: 9, height: 10 } as const;

export type XiangqiNotationStyle = 'english' | 'chinese';

export const selectXiangqiNotation = (
  english: string,
  chinese: string | undefined,
  style: XiangqiNotationStyle,
): string => (style === 'chinese' ? chinese || english : english);

// ChessgroundX keeps every key two characters wide, encoding rank 10 as ':'.
export const xiangqiUciToCg = (move: string): string => move.replace(/10/g, ':');
export const xiangqiCgToUci = (move: string): string => move.replace(/:/g, '10');
export const xiangqiKeyToCg = (key: string): Key => xiangqiUciToCg(key) as Key;
export const xiangqiCgKeyToUci = (key: Key): string => xiangqiCgToUci(key);

export function xiangqiUciMoveToCg(move: string): Move {
  const encoded = xiangqiUciToCg(move);
  return [encoded.slice(0, 2) as Orig, encoded.slice(2, 4) as Key];
}

export function xiangqiLegalMoveDests(legalMoves: readonly string[]): Dests {
  const dests: Dests = new Map();
  for (const move of legalMoves) {
    const [orig, dest] = xiangqiUciMoveToCg(move);
    const current = dests.get(orig);
    if (current) current.push(dest);
    else dests.set(orig, [dest]);
  }
  return dests;
}
