import type { Api } from 'chessgroundx/api';
import { Chessground } from 'chessgroundx/chessground';
import { Notation, type MouchEvent, type Piece } from 'chessgroundx/types';
import { eventPosition } from 'chessgroundx/util';

import resizeHandle from 'lib/chessgroundResize';
import { ShowResizeHandle } from 'lib/prefs';

import type EditorCtrl from './ctrl';

const DIMENSIONS = { width: 9, height: 10 } as const;

export function makeGround(element: HTMLElement, ctrl: EditorCtrl): Api {
  const ground = Chessground(element, {
    fen: ctrl.state.fen.split(/\s+/)[0],
    dimensions: DIMENSIONS,
    notation: Notation.XIANGQI_HANNUM,
    kingRoles: ['k-piece'],
    orientation: ctrl.orientation,
    turnColor: ctrl.turn,
    coordinates: ctrl.cfg.options?.coordinates !== false,
    autoCastle: false,
    addDimensionsCssVarsTo: document.body,
    movable: {
      free: true,
      color: 'both',
      rookCastle: false,
    },
    premovable: { enabled: false },
    draggable: {
      enabled: true,
      showGhost: true,
      deleteOnDropOff: true,
    },
    selectable: { enabled: false },
    drawable: { enabled: false },
    highlight: { lastMove: false, check: false },
    animation: {
      enabled: true,
      duration: ctrl.cfg.animation.duration,
    },
    events: {
      change: () => ctrl.changed(),
      insert: elements => resizeHandle(elements, ShowResizeHandle.Always, 0),
    },
    disableContextMenu: true,
  });

  const placeSelected = (event: MouchEvent): void => {
    if (event.type !== 'mousedown' && event.type !== 'touchstart') return;
    if (ctrl.selected === 'pointer') return;
    event.preventDefault();
    const position = eventPosition(event);
    const key = position && ground.getKeyAtDomPos(position);
    if (!key) return;
    if (ctrl.selected === 'trash') ground.setPieces(new Map([[key, undefined]]));
    else ground.setPieces(new Map([[key, ctrl.selected]]));
    ground.cancelMove();
    ctrl.changed();
  };

  element.addEventListener('mousedown', placeSelected);
  element.addEventListener('touchstart', placeSelected, { passive: false });
  ctrl.attachGround(ground);
  return ground;
}

export function dragPiece(ground: Api, piece: Piece, event: MouchEvent): void {
  event.preventDefault();
  ground.dragNewPiece(piece, false, event, true);
}
