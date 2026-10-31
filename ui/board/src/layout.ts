import type { BoardGeometry } from './types';

/** All piece sets use this asset contract and the same rendering scale. */
export const pieceGeometry: Readonly<{ canvasSize: number; bodyDiameter: number; scale: number }> =
  Object.freeze({ canvasSize: 100, bodyDiameter: 90, scale: 1 });

interface BoardLayout {
  canvasWidth: number;
  canvasHeight: number;
  viewport: { width: number; height: number; left: number; top: number };
}

/** The renderer includes half a cell around the outer intersections. */
export function boardLayout(geometry: BoardGeometry): BoardLayout {
  if (geometry.kind === 'graph')
    return {
      canvasWidth: geometry.width,
      canvasHeight: geometry.height,
      viewport: { width: 1, height: 1, left: 0, top: 0 },
    };
  const { columns, rows, frame } = geometry;
  const { cellSize, marginX, marginY } = frame ?? { cellSize: 100, marginX: 50, marginY: 50 };
  if (
    ![cellSize, marginX, marginY].every(Number.isFinite) ||
    cellSize <= 0 ||
    marginX < cellSize / 2 ||
    marginY < cellSize / 2
  )
    throw new Error('Invalid board artwork frame');
  const canvasWidth = (columns - 1) * cellSize + marginX * 2;
  const canvasHeight = (rows - 1) * cellSize + marginY * 2;
  return {
    canvasWidth,
    canvasHeight,
    viewport: {
      width: (columns * cellSize) / canvasWidth,
      height: (rows * cellSize) / canvasHeight,
      left: (marginX - cellSize / 2) / canvasWidth,
      top: (marginY - cellSize / 2) / canvasHeight,
    },
  };
}
