import type { BoardView, VisiblePiece } from '@lixiangqi/board';

import { hl, onInsert, type VNode } from '@/view';

export function pieceText(piece: VisiblePiece): string {
  if (piece.face === 'down') return i18n.nvui.concealedPiece;
  const roles: Record<string, string> = {
    general: i18n.nvui.general,
    advisor: i18n.nvui.advisor,
    elephant: i18n.nvui.elephant,
    horse: i18n.nvui.horse,
    chariot: i18n.nvui.chariot,
    cannon: i18n.nvui.cannon,
    soldier: i18n.nvui.soldier,
  };
  return `${piece.participant === 'red' ? i18n.site.white : i18n.site.black} ${roles[piece.role] ?? piece.role}`;
}

export function positionText(board: BoardView, filter = ''): string {
  return [...board.position().pieces]
    .filter(
      ([location, piece]) =>
        !filter ||
        location === filter ||
        (filter.length === 1 && location.startsWith(filter)) ||
        location.slice(1) === filter ||
        (piece.face === 'up' && (piece.role === filter || piece.participant === filter)),
    )
    .map(([location, piece]) => `${location}: ${pieceText(piece)}`)
    .join(', ');
}

/** The accessible representation consumes the same visible position and input contract as the visual board. */
export function accessibleBoard(
  board: BoardView,
  announce: (text: string) => void,
  perspective: string = board.getPresentation().perspective,
): VNode {
  const {
    geometry: { columns, rows },
    participants,
  } = board.getDefinition();
  const files = Array.from({ length: columns }, (_, file) => String.fromCharCode(97 + file));
  const ranks = Array.from({ length: rows }, (_, rank) => rows - rank);
  if (perspective !== participants[0]) {
    files.reverse();
    ranks.reverse();
  }
  const pieces = board.position().pieces;
  const locations = ranks.flatMap(rank => files.map(file => `${file}${rank}`));
  const label = (location: string) =>
    `${location}: ${pieces.has(location) ? pieceText(pieces.get(location)!) : i18n.nvui.emptyLocation}`;
  return hl('table.board-wrapper', { attrs: { 'aria-label': i18n.site.board } }, [
    hl('thead', hl('tr', [hl('td'), ...files.map(file => hl('th', { attrs: { scope: 'col' } }, file))])),
    hl(
      'tbody',
      ranks.map(rank =>
        hl('tr', [
          hl('th', { attrs: { scope: 'row' } }, String(rank)),
          ...files.map(file => {
            const location = `${file}${rank}`;
            return hl(
              'td',
              hl(
                'button',
                {
                  key: location,
                  attrs: {
                    type: 'button',
                    'data-location': location,
                    'aria-label': label(location),
                    'aria-pressed': board.selectedLocation() === location,
                  },
                  hook: onInsert(element => {
                    element.addEventListener('click', () => {
                      board.select(location);
                      const piece = board.position().pieces.get(location);
                      announce(`${location}: ${piece ? pieceText(piece) : i18n.nvui.emptyLocation}`);
                    });
                    element.addEventListener('keydown', event => {
                      const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[
                        event.key
                      ];
                      if (delta !== undefined) {
                        event.preventDefault();
                        const index = locations.indexOf(location),
                          next = index + delta;
                        if (
                          next >= 0 &&
                          next < locations.length &&
                          (Math.abs(delta) !== 1 ||
                            Math.floor(index / columns) === Math.floor(next / columns))
                        )
                          (event.target as HTMLElement)
                            .closest('table')
                            ?.querySelector<HTMLButtonElement>(`[data-location="${locations[next]}"]`)
                            ?.focus();
                      } else if (event.key === 'm')
                        announce((board.destinations().get(location) ?? []).join(', ') || i18n.site.none);
                    });
                  }),
                },
                pieces.has(location) ? pieceText(pieces.get(location)!) : '·',
              ),
            );
          }),
        ]),
      ),
    ),
  ]);
}
