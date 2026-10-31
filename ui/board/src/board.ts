import { pieceGeometry } from './layout';
import { GraphBoardView } from './renderer/graph';
import { RectangularBoardView } from './renderer/rectangular';
import type {
  BoardDefinition,
  BoardInteraction,
  BoardMark,
  BoardOptions,
  BoardPosition,
  BoardPresentation,
  BoardTransition,
  Location,
  VisiblePiece,
} from './types';

/** Public renderer contract shared by rectangular and explicit-location boards. */
export interface BoardView {
  readonly element: HTMLElement;
  display(position: BoardPosition, transition?: BoardTransition): void;
  setPresentation(presentation: BoardPresentation): void;
  setInteraction(interaction: BoardInteraction): void;
  position(): BoardPosition;
  setMarks(marks: readonly BoardMark[], layer?: 'user' | 'annotation'): void;
  select(location?: Location): void;
  locationAt(point: readonly [number, number]): Location | undefined;
  place(location: Location, piece?: VisiblePiece): void;
  dragPiece(piece: VisiblePiece, event: MouseEvent | TouchEvent): void;
  cancelInput(): void;
  getDefinition(): BoardDefinition;
  getPresentation(): BoardPresentation;
  presentTransition(transition: BoardTransition): void;
  cancelPremove(): void;
  playPremove(): boolean;
  redraw(): void;
  onDestroy(cleanup: () => void): void;
  onMarksChange(listener: (marks: readonly BoardMark[]) => void): () => void;
  selectedLocation(): Location | undefined;
  destinations(): ReadonlyMap<Location, readonly Location[]>;
  allowsMove(from: Location, to: Location): boolean;
  mountControl(element: HTMLElement): void;
  destroy(): void;
}

export function createBoard(element: HTMLElement, options: BoardOptions): BoardView {
  element.style.setProperty('--board-piece-scale', String(pieceGeometry.scale));
  element.style.setProperty(
    '--board-piece-diameter',
    String(pieceGeometry.bodyDiameter / pieceGeometry.canvasSize),
  );
  return options.definition.geometry.kind === 'graph'
    ? new GraphBoardView(element, options)
    : new RectangularBoardView(element, options);
}
