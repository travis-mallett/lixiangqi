import type { Api } from 'chessgroundx/api';
import { Chessground } from 'chessgroundx/chessground';
import { premove } from 'chessgroundx/premove';
import { Notation, type Color } from 'chessgroundx/types';

import resizeHandle from 'lib/chessgroundResize';
import { ShowResizeHandle, type ShowResizeHandle as ShowResizeHandlePref } from 'lib/prefs';

import {
  cgToUci,
  legalMoveDests,
  setXiangqiGroundPending,
  uciMoveToCg,
  XIANGQI_DIMENSIONS,
  XIANGQI_START_FEN,
} from './groundUtil';

export { hydrateXiangqiState, requestXiangqi } from './api';
export * from './groundUtil';
export {
  createMoveTreeFromUciMainline,
  createMoveTreeFromStates,
  type RulesState,
  type XiangqiMoveTree,
  type XiangqiPositionNode,
  type XiangqiTreeNode,
} from './tree';
export {
  playXiangqiMoveSound,
  playXiangqiTransitionSound,
  xiangqiMoveSound,
  xiangqiTransitionSound,
  type XiangqiMoveSound,
} from './sound';

export interface XiangqiGroundOptions {
  fen?: string;
  orientation?: Color;
  turnColor?: Color;
  movableColor?: Color;
  legalMoves?: readonly string[];
  lastMove?: string;
  onMove?: (uci: string) => void;
  coordinates?: boolean;
  viewOnly?: boolean;
  resizeHandle?: ShowResizeHandlePref;
  ply?: number;
  addDimensionsCssVarsTo?: HTMLElement;
}

export function makeXiangqiGround(element: HTMLElement, options: XiangqiGroundOptions = {}): Api {
  const movableColor = options.viewOnly ? undefined : options.movableColor;
  const ground = Chessground(element, {
    fen: options.fen ?? XIANGQI_START_FEN,
    dimensions: XIANGQI_DIMENSIONS,
    notation: Notation.XIANGQI_HANNUM,
    kingRoles: ['k-piece'],
    orientation: options.orientation ?? 'white',
    turnColor: options.turnColor ?? 'white',
    coordinates: options.coordinates ?? true,
    viewOnly: options.viewOnly ?? false,
    autoCastle: false,
    addDimensionsCssVarsTo: options.addDimensionsCssVarsTo ?? document.body,
    lastMove: options.lastMove ? uciMoveToCg(options.lastMove) : undefined,
    events: {
      insert(elements) {
        resizeHandle(elements, options.resizeHandle ?? ShowResizeHandle.Always, options.ply ?? 0);
      },
    },
    movable: {
      free: false,
      color: movableColor,
      dests: legalMoveDests(options.legalMoves ?? []),
      rookCastle: false,
      events: {
        after: (orig, dest) => {
          if (!options.onMove) return;
          setXiangqiGroundPending(ground);
          options.onMove(cgToUci(`${orig}${dest}`));
        },
      },
    },
    premovable: {
      enabled: !options.viewOnly,
      castle: false,
      premoveFunc: premove('xiangqi', false, XIANGQI_DIMENSIONS),
    },
    draggable: { enabled: false, showGhost: false },
    selectable: { enabled: !options.viewOnly },
    highlight: { lastMove: true, check: true },
    animation: { enabled: true, duration: 200 },
    drawable: { enabled: true, defaultSnapToValidMove: true },
    disableContextMenu: true,
  });
  return ground;
}

export function setXiangqiCoordinates(ground: Api, coordinates: boolean): void {
  ground.set({ coordinates });
  // Coordinates are part of the Chessground wrapper, not its incremental
  // piece render, so changing them requires the same full redraw as a flip.
  ground.redrawAll();
}
