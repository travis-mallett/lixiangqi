import type { BoardView } from '@lixiangqi/board';
export interface MoveRootCtrl {
  pluginMove(orig: string, dest: string, prom: Role | undefined, preConfirmed?: boolean): void;
  redraw: () => void;
  flipNow: () => void;
  offerDraw?: (v: boolean, immediately?: boolean) => void;
  takebackYes?: () => void;
  resign?: (v: boolean, immediately?: boolean) => void;
  rematch?: (accept?: boolean) => boolean;
  nextPuzzle?: () => void;
  vote?: (v: boolean) => void;
  solve?: () => void;
  blindfold?: (v?: boolean) => boolean;
  speakClock?: () => void;
  goBerserk?: () => void;
  confirmMoveToggle?: () => boolean;
}

export interface MoveUpdate {
  fen: FEN;
  canMove: boolean;
  board?: BoardView;
}
