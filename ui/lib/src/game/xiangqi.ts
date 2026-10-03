export const XIANGQI_START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
export const XIANGQI_DIMENSIONS = { width: 9, height: 10 } as const;

export type XiangqiNotationStyle = 'english' | 'chinese';

export const selectXiangqiNotation = (
  english: string,
  chinese: string | undefined,
  style: XiangqiNotationStyle,
): string => (style === 'chinese' ? chinese || english : english);

const xiangqiPieceCount = (fen: string): number => fen.split(/\s/, 1)[0].split(/[a-z]/i).length - 1;

export const isXiangqiCapture = (before: string, after: string): boolean =>
  xiangqiPieceCount(after) < xiangqiPieceCount(before);

export type XiangqiSide = 'red' | 'black';
export const xiangqiSides: readonly XiangqiSide[] = ['red', 'black'];
export const oppositeSide = (side: XiangqiSide): XiangqiSide => (side === 'red' ? 'black' : 'red');
export const plySide = (ply: number): XiangqiSide => (ply % 2 === 0 ? 'red' : 'black');
export const fenSide = (fen: string): XiangqiSide => (fen.split(' ')[1] === 'b' ? 'black' : 'red');
