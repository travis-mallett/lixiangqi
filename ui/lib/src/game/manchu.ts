// PyChess Manchu+R. The third field retains native identity after the Banner is captured.
export const MANCHU_START_FEN = 'm1bakab1r/9/9/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w m - 0 1';

/** Fairy-Stockfish receives ordinary FEN; UCI_Variant supplies the game identity. */
export function manchuEngineFen(fen: string): string {
  const fields = fen.trim().split(/\s+/);
  if (fields[2] === 'm') fields[2] = '-';
  return fields.join(' ');
}
