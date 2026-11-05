/** Deliberately synthetic, not sampled from human play. FEN serialization is not a rules implementation. */
export function fen(pieces: Readonly<Record<string, string>>, turn = 'w'): string {
  const ranks: string[] = [];
  for (let rank = 10; rank >= 1; rank--) {
    let row = '',
      empty = 0;
    for (let file = 0; file < 9; file++) {
      const piece = pieces[`${String.fromCharCode(97 + file)}${rank}`];
      if (!piece) empty++;
      else {
        if (empty) row += empty;
        row += piece;
        empty = 0;
      }
    }
    if (empty) row += empty;
    ranks.push(row);
  }
  return `${ranks.join('/')} ${turn} - - 0 1`;
}
export const FIXTURES = [
  { id: 'cannon-screen', fen: fen({ d1: 'K', f10: 'k', e5: 'C', e6: 'P', e8: 'r' }), legal: 'e5e8' },
  { id: 'missing-screen', fen: fen({ d1: 'K', f10: 'k', e5: 'C', e8: 'r' }), illegal: 'e5e8' },
  {
    id: 'double-screen',
    fen: fen({ d1: 'K', f10: 'k', e5: 'C', e6: 'P', e7: 'p', e8: 'r' }),
    illegal: 'e5e8',
  },
  { id: 'horse-leg', fen: fen({ d1: 'K', f10: 'k', e5: 'N', e6: 'P' }), illegal: 'e5d7' },
  { id: 'horse-unblocked', fen: fen({ d1: 'K', f10: 'k', e5: 'N' }), legal: 'e5d7' },
  { id: 'elephant-eye', fen: fen({ d1: 'K', f10: 'k', e3: 'B', d4: 'N' }), illegal: 'e3c5' },
  { id: 'crossed-soldier', fen: fen({ d1: 'K', f10: 'k', e6: 'P' }), legal: 'e6d6', illegal: 'e6e5' },
  { id: 'pinned-rook', fen: fen({ d1: 'K', f10: 'k', d10: 'r', d3: 'R' }), legal: 'd3d4', illegal: 'd3c3' },
  { id: 'palace-defense', fen: fen({ e1: 'K', f10: 'k', e2: 'A', c1: 'B', a5: 'r', h3: 'C', e5: 'P' }) },
  { id: 'rook-conversion', fen: '4k4/9/9/9/9/9/3R5/R8/9/5K3 w - - 0 1', legal: 'a3e3' },
  { id: 'stalemate', fen: '4k4/9/3R1R3/9/9/4P4/9/9/9/3K5 w - - 0 1', legal: 'd8d9' },
  {
    id: 'fortress-hypothesis',
    fen: fen({ e1: 'K', d1: 'A', f1: 'A', c1: 'B', g1: 'B', e10: 'k', a7: 'r', e5: 'P' }),
  },
];
