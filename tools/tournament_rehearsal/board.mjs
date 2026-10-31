export const initialPlacement = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR';

export function placementToMap(fen) {
  const board = new Map();
  fen.split('/').forEach((rank, y) => {
    let x = 0;
    for (const p of rank) {
      if (/\d/.test(p)) x += Number(p);
      else board.set(String.fromCharCode(97 + x++) + (9 - y), p);
    }
    if (x !== 9) throw new Error('Invalid board rank');
  });
  return board;
}

export function mapToPlacement(board) {
  return Array.from({ length: 10 }, (_, y) => {
    let rank = '',
      empty = 0;
    for (let x = 0; x < 9; x++) {
      const p = board.get(String.fromCharCode(97 + x) + (9 - y));
      if (!p) empty++;
      else {
        if (empty) rank += empty;
        empty = 0;
        rank += p;
      }
    }
    return rank + (empty || '');
  }).join('/');
}

export function afterMove(placement, move) {
  const board = placementToMap(placement),
    from = move.slice(0, 2),
    to = move.slice(2);
  const piece = board.get(from);
  if (!piece) throw new Error(`No visible piece at ${from}`);
  board.delete(from);
  board.set(to, piece);
  return mapToPlacement(board);
}

/** Read only rendered DOM geometry and CSS classes, never application objects or network frames. */
export async function readBoard(page) {
  const visible = await page.locator('.round__app cg-board').evaluate(board => {
    const bounds = board.getBoundingClientRect();
    const wrap = board.closest('.cg-wrap');
    const black = wrap.classList.contains('orientation-black');
    const pieces = [...board.querySelectorAll('piece:not(.ghost):not(.fading)')].map(piece => {
      const rect = piece.getBoundingClientRect();
      const file = Math.round((rect.x + rect.width / 2 - bounds.x) / (bounds.width / 9) - 0.5);
      const rank = Math.round((rect.y + rect.height / 2 - bounds.y) / (bounds.height / 10) - 0.5);
      const role = [...piece.classList].find(c => /^[rnbakcp]-piece$/.test(c))?.[0];
      return {
        square: String.fromCharCode(97 + (black ? 8 - file : file)) + (black ? rank : 9 - rank),
        role: role && (piece.classList.contains('white') ? role.toUpperCase() : role),
      };
    });
    return { pieces, black, animating: !!board.querySelector('.anim, .dragging') };
  });
  if (visible.pieces.some(p => !p.role))
    throw new Error('Unknown visible piece; rehearsal supports Standard Xiangqi');
  const board = new Map(visible.pieces.map(p => [p.square, p.role]));
  if (board.size !== visible.pieces.length) return undefined;
  return { placement: mapToPlacement(board), black: visible.black, animating: visible.animating };
}

export async function clickMove(page, move, black) {
  const board = page.locator('.round__app cg-board');
  await board.scrollIntoViewIfNeeded();
  const box = await board.boundingBox();
  if (!box) throw new Error('Board is not visible');
  for (const square of [move.slice(0, 2), move.slice(2)]) {
    const file = square.charCodeAt(0) - 97,
      rank = Number(square[1]);
    await page.mouse.click(
      box.x + (((black ? 8 - file : file) + 0.5) * box.width) / 9,
      box.y + (((black ? rank : 9 - rank) + 0.5) * box.height) / 10,
    );
  }
}
