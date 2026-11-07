import { boardPresentation, type BoardView, type VisiblePiece } from '@lixiangqi/board';

import { makeBoardResizable, createXiangqiBoard } from 'lib/board';

import type EditorCtrl from './ctrl';

export function makeGround(element: HTMLElement, ctrl: EditorCtrl): BoardView {
  const board = createXiangqiBoard(
    element,
    ctrl.position(),
    {
      ...boardPresentation('editor', ctrl.orientation),
      coordinates: ctrl.cfg.options?.coordinates !== false,
      motion: { duration: ctrl.cfg.animation.duration },
    },
    { mode: 'edit', onChange: () => ctrl.changed() },
  );

  if (!ctrl.cfg.embed) makeBoardResizable(board);
  const placeSelected = (event: PointerEvent): void => {
    if (ctrl.selected === 'pointer') return;
    if (event.button !== 0 || !event.isPrimary) return;
    if ((event.target as Element).closest('cg-resize')) return;
    const location = board.locationAt([event.clientX, event.clientY]);
    if (!location) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    board.cancelInput();
    board.place(location, ctrl.selected === 'trash' ? undefined : ctrl.selected);
  };
  element.addEventListener('pointerdown', placeSelected, true);
  board.onDestroy(() => {
    element.removeEventListener('pointerdown', placeSelected, true);
  });
  ctrl.attachGround(board);
  return board;
}

export function dragPiece(board: BoardView, piece: VisiblePiece, event: MouseEvent | TouchEvent): void {
  event.preventDefault();
  board.dragPiece(piece, event);
}
