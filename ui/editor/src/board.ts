import { boardPresentation, type BoardView, type VisiblePiece } from '@lixiangqi/board';

import { makeBoardResizable, createXiangqiBoard, xiangqiPosition } from 'lib/board';

import type EditorCtrl from './ctrl';

export function makeGround(element: HTMLElement, ctrl: EditorCtrl): BoardView {
  const board = createXiangqiBoard(
    element,
    xiangqiPosition(ctrl.state.fen),
    {
      ...boardPresentation('editor', ctrl.orientation === 'red' ? 'red' : 'black'),
      coordinates: ctrl.cfg.options?.coordinates !== false,
      motion: { duration: ctrl.cfg.animation.duration },
    },
    { mode: 'edit', onChange: () => ctrl.changed() },
  );

  makeBoardResizable(board);
  const placeSelected = (event: MouseEvent | TouchEvent): void => {
    if (ctrl.selected === 'pointer') return;
    event.preventDefault();
    const pointer = 'touches' in event ? event.touches[0] : event;
    if (!pointer) return;
    const location = board.locationAt([pointer.clientX, pointer.clientY]);
    if (!location) return;
    board.cancelInput();
    board.place(location, ctrl.selected === 'trash' ? undefined : ctrl.selected);
  };
  element.addEventListener('mousedown', placeSelected);
  element.addEventListener('touchstart', placeSelected, { passive: false });
  board.onDestroy(() => {
    element.removeEventListener('mousedown', placeSelected);
    element.removeEventListener('touchstart', placeSelected);
  });
  ctrl.attachGround(board);
  return board;
}

export function dragPiece(board: BoardView, piece: VisiblePiece, event: MouseEvent | TouchEvent): void {
  event.preventDefault();
  board.dragPiece(piece, event);
}
