import type { BoardView, VisiblePiece } from '@lixiangqi/board';

import { hl, onInsert, type VNode } from '@/view';

import type { PieceStyle, PrefixStyle, PositionStyle, BoardStyle } from './xiangqi';

export interface AccessibleBoardStyle {
  pieceStyle?: PieceStyle;
  prefixStyle?: PrefixStyle;
  positionStyle?: PositionStyle;
  boardStyle?: BoardStyle;
}
export function pieceText(piece: VisiblePiece, options: AccessibleBoardStyle = {}): string {
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
  const side = piece.participant === 'red' ? i18n.site.red : i18n.site.black;
  const prefix = options.prefixStyle === 'none' ? '' : options.prefixStyle === 'letter' ? side[0] : side;
  const letters: Record<string, string> = {
    general: 'k',
    advisor: 'a',
    elephant: 'e',
    horse: 'h',
    chariot: 'r',
    cannon: 'c',
    soldier: 'p',
  };
  let value = options.pieceStyle?.includes('letter')
    ? (letters[piece.role] ?? piece.role)
    : (roles[piece.role] ?? piece.role);
  if (options.pieceStyle?.startsWith('red uppercase') && piece.participant === 'red')
    value = value.toUpperCase();
  return `${prefix} ${value}`.trim();
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
  options: AccessibleBoardStyle = {},
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
  const label = (location: string) => {
    const piece = pieces.get(location);
    const value = piece ? pieceText(piece, options) : i18n.nvui.emptyLocation;
    return options.positionStyle === 'none'
      ? value
      : options.positionStyle === 'after'
        ? `${value}: ${location}`
        : `${location}: ${value}`;
  };
  const table = options.boardStyle !== 'plain';
  return hl(
    table ? 'table.board-wrapper' : 'div.board-wrapper',
    { attrs: { 'aria-label': i18n.site.board } },
    [
      ...(table
        ? [
            hl(
              'thead',
              hl('tr', [hl('td'), ...files.map(file => hl('th', { attrs: { scope: 'col' } }, file))]),
            ),
          ]
        : []),
      hl(
        table ? 'tbody' : 'div',
        ranks.map(rank =>
          hl(table ? 'tr' : 'div', [
            ...(table ? [hl('th', { attrs: { scope: 'row' } }, String(rank))] : []),
            ...files.map(file => {
              const location = `${file}${rank}`;
              return hl(
                table ? 'td' : 'span',
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
                        announce(
                          `${location}: ${piece ? pieceText(piece, options) : i18n.nvui.emptyLocation}`,
                        );
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
                              .closest('.board-wrapper')
                              ?.querySelector<HTMLButtonElement>(`[data-location="${locations[next]}"]`)
                              ?.focus();
                        } else if (event.key === 'm')
                          announce((board.destinations().get(location) ?? []).join(', ') || i18n.site.none);
                      });
                    }),
                  },
                  label(location),
                ),
              );
            }),
          ]),
        ),
      ),
    ],
  );
}
