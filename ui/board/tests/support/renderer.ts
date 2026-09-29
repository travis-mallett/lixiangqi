// Low-level rendering regressions may inspect the private backend. Application consumers may not.
import { Chessground } from 'chessgroundx/chessground';
import { premove } from 'chessgroundx/premove';
import { Notation, type Color } from 'chessgroundx/types';

import { standardXiangqi } from '../../src/definitions';
import { coordinateMove } from '../../src/position';
import { rendererKey } from '../../src/renderer/coordinates';

interface Options {
  fen?: string;
  orientation?: Color;
  turnColor?: Color;
  movableColor?: Color;
  legalMoves?: readonly string[];
  lastMove?: string;
  onMove?: (move: string) => void;
  coordinates?: boolean;
  viewOnly?: boolean;
  animationDuration?: number;
  moveEvent?: number;
  highlight?: boolean;
}
export function makeRenderer(element: HTMLElement, options: Options = {}) {
  element.classList.add('cg-wrap', 'xiangqi9x10');
  const key = (value: string) => rendererKey(value, standardXiangqi.geometry);
  const dests = new Map();
  for (const value of options.legalMoves ?? []) {
    const [from, to] = coordinateMove(value);
    const source = key(from);
    dests.set(source, [...(dests.get(source) ?? []), key(to)]);
  }
  return Chessground(element, {
    fen: options.fen ?? 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',
    dimensions: { width: 9, height: 10 },
    notation: Notation.XIANGQI_HANNUM,
    kingRoles: ['k-piece'],
    orientation: options.orientation ?? 'white',
    turnColor: options.turnColor ?? 'white',
    coordinates: options.coordinates ?? true,
    viewOnly: options.viewOnly ?? false,
    autoCastle: false,
    layeredPieces: true,
    lastMove: options.lastMove ? coordinateMove(options.lastMove).map(key) : undefined,
    movable: { free: false, color: options.movableColor, dests, rookCastle: false },
    premovable: {
      enabled: !options.viewOnly,
      castle: false,
      premoveFunc: premove('xiangqi', false, { width: 9, height: 10 }),
    },
    draggable: {
      enabled: !options.viewOnly && (options.moveEvent ?? 0) !== 0,
      showGhost: options.highlight ?? true,
    },
    selectable: { enabled: !options.viewOnly && options.moveEvent !== 1 },
    highlight: { lastMove: options.highlight ?? true, check: options.highlight ?? true },
    animation: {
      enabled: (options.animationDuration ?? 200) > 0,
      duration: options.animationDuration ?? 200,
    },
    drawable: { enabled: true, defaultSnapToValidMove: true },
    disableContextMenu: true,
  });
}
export function setCoordinates(board: ReturnType<typeof makeRenderer>, coordinates: boolean): void {
  board.set({ coordinates });
  board.redrawAll();
}

export { Chessground, Notation };
export { end as endDrag, start as startDrag } from 'chessgroundx/drag';
export { computeSquareCenter } from 'chessgroundx/util';
